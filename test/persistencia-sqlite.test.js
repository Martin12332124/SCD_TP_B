// test/persistencia-sqlite.test.js
// Persistencia con SQLite: conexión (carpeta, pragmas, esquema) y atomicidad de
// los casos de uso (transacciones + eventos publicados solo tras el commit).
// Usa una carpeta temporal para no tocar la base de desarrollo (data/).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { abrirBaseDeDatos, RUTA_POR_DEFECTO } = require('../src/infraestructura/sqlite/conexion');
const {
  PedidosSQLite,
  MesasSQLite,
  MenuItemsSQLite
} = require('../src/infraestructura/sqlite/repositorios-sqlite');
const {
  NotificadorTransaccional,
  envolverEnTransaccion
} = require('../src/infraestructura/sqlite/transacciones');
const { PedidoService } = require('../src/dominio/pedido.service');
const { MesaService, DependenciaError } = require('../src/dominio/mesa.service');
const { NotificadorEspia } = require('./doubles');

let carpeta;
const abiertas = [];

/** Abre una base y la registra para cerrarla al terminar el test. */
function abrir(ruta) {
  const db = abrirBaseDeDatos(ruta);
  abiertas.push(db);
  return db;
}

beforeEach(() => {
  carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'restaurante-test-'));
});

afterEach(() => {
  while (abiertas.length) {
    const db = abiertas.pop();
    if (db.open) db.close();
  }
  fs.rmSync(carpeta, { recursive: true, force: true });
});

describe('Conexión SQLite', () => {
  test('crea la carpeta del archivo si no existe', () => {
    const ruta = path.join(carpeta, 'anidada', 'otra', 'restaurante.db');
    abrir(ruta);
    expect(fs.existsSync(ruta)).toBe(true);
  });

  test('aplica WAL, synchronous FULL, claves foráneas y busy_timeout', () => {
    const db = abrir(path.join(carpeta, 'r.db'));
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('synchronous', { simple: true })).toBe(2); // 2 = FULL
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
  });

  test('crea las cuatro tablas del esquema', () => {
    const db = abrir(':memory:');
    const tablas = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((t) => t.name);
    expect(tablas).toEqual(['menu_items', 'mesas', 'pedido_items', 'pedidos']);
  });

  test('abrir dos veces el mismo archivo no borra los datos (CREATE TABLE IF NOT EXISTS)', () => {
    const ruta = path.join(carpeta, 'r.db');
    const db1 = abrir(ruta);
    db1.prepare("INSERT INTO mesas (id, numero, estado) VALUES ('Mesa 1', 1, 'libre')").run();
    db1.close();

    const db2 = abrir(ruta);
    expect(db2.prepare('SELECT COUNT(*) AS n FROM mesas').get().n).toBe(1);
  });

  test('la ruta por defecto queda en data/restaurante.db de la raíz del repo', () => {
    expect(RUTA_POR_DEFECTO).toBe(path.join(__dirname, '..', 'data', 'restaurante.db'));
  });
});

describe('Transacciones y notificador diferido', () => {
  let db, espia, notificador;

  beforeEach(() => {
    db = abrir(':memory:');
    new MesasSQLite(db, 10);
    espia = new NotificadorEspia();
    notificador = new NotificadorTransaccional(espia);
  });

  /** Servicio de prueba que escribe en mesas y emite eventos. */
  function servicioDePrueba() {
    const mesas = new MesasSQLite(db, 10);
    return {
      mesas,
      ocuparYFallar() {
        mesas.ocupar('Mesa 1');
        notificador.emitir('estado_mesas', 'antes del fallo');
        throw new Error('fallo a mitad');
      },
      ocupar(id) {
        mesas.ocupar(id);
        notificador.emitir('ocupada', id);
        // Los eventos se retienen: todavía no llegaron al notificador real.
        return espia.eventos.length;
      },
      ocuparDosConFalloInterno() {
        this.ocupar('Mesa 2');
        try {
          this.ocuparYFallar();
        } catch {
          // el error interno se ignora a propósito
        }
        return 'ok';
      }
    };
  }

  test('si el método lanza un error, se deshacen sus escrituras y no se emiten eventos', () => {
    const s = servicioDePrueba();
    envolverEnTransaccion(db, notificador, s, ['ocuparYFallar']);

    expect(() => s.ocuparYFallar()).toThrow('fallo a mitad');
    expect(s.mesas.obtener('Mesa 1').estado).toBe('libre');
    expect(espia.eventos).toEqual([]);
  });

  test('los eventos se publican después del commit, no durante la transacción', () => {
    const s = servicioDePrueba();
    envolverEnTransaccion(db, notificador, s, ['ocupar']);

    const eventosDuranteLaTransaccion = s.ocupar('Mesa 3');
    expect(eventosDuranteLaTransaccion).toBe(0);
    expect(espia.eventos).toEqual([{ evento: 'ocupada', datos: 'Mesa 3' }]);
  });

  test('una transacción anidada que falla descarta solo sus escrituras y eventos', () => {
    const s = servicioDePrueba();
    envolverEnTransaccion(db, notificador, s, [
      'ocupar',
      'ocuparYFallar',
      'ocuparDosConFalloInterno'
    ]);

    expect(s.ocuparDosConFalloInterno()).toBe('ok');
    expect(s.mesas.obtener('Mesa 2').estado).toBe('ocupada');
    expect(s.mesas.obtener('Mesa 1').estado).toBe('libre');
    expect(espia.eventos).toEqual([{ evento: 'ocupada', datos: 'Mesa 2' }]);
  });

  test('fuera de una transacción el notificador emite de inmediato', () => {
    notificador.emitir('directo', 1);
    expect(espia.eventos).toEqual([{ evento: 'directo', datos: 1 }]);
  });
});

describe('Atomicidad de los casos de uso sobre SQLite (REF-09)', () => {
  let db, pedidos, mesas, espia, pedidoService, mesaService;

  beforeEach(() => {
    db = abrir(':memory:');
    pedidos = new PedidosSQLite(db);
    mesas = new MesasSQLite(db, 10);
    const menuItems = new MenuItemsSQLite(db, [
      { id: 1, nombre: 'Pizza Margarita', precioBase: 8500, disponible: true }
    ]);
    espia = new NotificadorEspia();
    const notificador = new NotificadorTransaccional(espia);

    pedidoService = new PedidoService({ pedidos, mesas, notificador, menuItems });
    mesaService = new MesaService({ pedidos, mesas, notificador });
    envolverEnTransaccion(db, notificador, pedidoService, ['actualizarEstado', 'confirmarPedido']);
    envolverEnTransaccion(db, notificador, mesaService, ['trasladarPedido']);
  });

  test('confirmarPedido persiste el pedido completo y emite sus eventos', () => {
    const r = pedidoService.confirmarPedido({ mesa: 'Mesa 1', items: [{ id: 1, cantidad: 2 }] });
    expect(r.ok).toBe(true);
    expect(pedidos.obtener('Mesa 1')).toEqual({
      mesa: 'Mesa 1',
      estado: 'En Cocina 🍳',
      items: [{ id: 1, nombre: 'Pizza Margarita', precioBase: 8500, cantidad: 2 }]
    });
    expect(mesas.obtener('Mesa 1').estado).toBe('ocupada');
    expect(espia.eventosDe('pedido_items_actualizado')).toHaveLength(1);
  });

  test('si confirmarPedido falla a mitad, no queda nada guardado ni se emite nada', () => {
    // Falla la última escritura (paso a "En Cocina 🍳"), después de ocupar la mesa
    // y guardar los ítems.
    const original = pedidos.guardar.bind(pedidos);
    jest.spyOn(pedidos, 'guardar').mockImplementation((mesa, pedido) => {
      if (pedido.estado === 'En Cocina 🍳') throw new Error('disco lleno');
      return original(mesa, pedido);
    });

    expect(() =>
      pedidoService.confirmarPedido({ mesa: 'Mesa 1', items: [{ id: 1, cantidad: 2 }] })
    ).toThrow('disco lleno');

    expect(pedidos.obtener('Mesa 1')).toBeNull();
    expect(mesas.obtener('Mesa 1').estado).toBe('libre');
    expect(espia.eventos).toEqual([]);
  });

  test('si el traslado falla a mitad, el pedido sigue solo en la mesa de origen', () => {
    pedidoService.actualizarEstado({ mesa: 'Mesa 2', estado: 'Recibido 📝' });
    espia.limpiar();
    jest.spyOn(mesas, 'ocupar').mockImplementation(() => {
      throw new Error('fallo al ocupar');
    });

    expect(() => mesaService.trasladarPedido({ origen: 2, destino: 5 })).toThrow(DependenciaError);

    expect(pedidos.obtener('Mesa 2')).toEqual({ mesa: 'Mesa 2', estado: 'Recibido 📝' });
    expect(pedidos.obtener('Mesa 5')).toBeNull();
    expect(mesas.obtener('Mesa 2').estado).toBe('ocupada');
    expect(mesas.obtener('Mesa 5').estado).toBe('libre');
    expect(espia.eventos).toEqual([]);
  });
});
