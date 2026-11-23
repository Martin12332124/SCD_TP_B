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

describe('Migración: columna pedidos.estado_desde', () => {
  test('una base creada antes de la columna la recibe sin perder los pedidos', () => {
    const ruta = path.join(carpeta, 'antigua.db');
    // Base con el esquema anterior (pedidos sin estado_desde) y un pedido guardado
    const Database = require('better-sqlite3');
    const vieja = new Database(ruta);
    vieja.exec(`
      CREATE TABLE mesas (id TEXT PRIMARY KEY, numero INTEGER NOT NULL UNIQUE, estado TEXT NOT NULL);
      CREATE TABLE pedidos (mesa_id TEXT PRIMARY KEY REFERENCES mesas (id), estado TEXT NOT NULL);
      INSERT INTO mesas VALUES ('Mesa 1', 1, 'ocupada');
      INSERT INTO pedidos VALUES ('Mesa 1', 'En Cocina 🍳');
    `);
    vieja.close();

    const db = abrir(ruta);
    const columnas = db
      .prepare('PRAGMA table_info(pedidos)')
      .all()
      .map((c) => c.name);
    expect(columnas).toContain('estado_desde');

    // El pedido sigue ahí; como no se sabe desde cuándo está así, no trae estadoDesde
    const pedidos = new PedidosSQLite(db);
    expect(pedidos.obtener('Mesa 1')).toEqual({ mesa: 'Mesa 1', estado: 'En Cocina 🍳' });
  });

  test('abrir dos veces una base ya migrada no falla', () => {
    const ruta = path.join(carpeta, 'r.db');
    abrir(ruta).close();
    expect(() => abrir(ruta)).not.toThrow();
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
      estadoDesde: expect.any(String),
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

    expect(pedidos.obtener('Mesa 2')).toEqual({
      mesa: 'Mesa 2',
      estado: 'Recibido 📝',
      estadoDesde: expect.any(String)
    });
    expect(pedidos.obtener('Mesa 5')).toBeNull();
    expect(mesas.obtener('Mesa 2').estado).toBe('ocupada');
    expect(mesas.obtener('Mesa 5').estado).toBe('libre');
    expect(espia.eventos).toEqual([]);
  });
});

describe('Reinicio del servidor: los datos sobreviven (REF-09)', () => {
  const { crearApp } = require('../src/app');

  /** Simula apagar el servidor: cierra Socket.io y la conexión a la base. */
  async function apagar(ctx) {
    await ctx.io.close();
    ctx.db.close();
  }

  test('mesas, menú y pedidos se conservan al cerrar y reabrir el mismo archivo', async () => {
    const rutaDb = path.join(carpeta, 'restaurante.db');

    const antes = crearApp({ rutaDb });
    antes.pedidoService.confirmarPedido({
      mesa: 'Mesa 3',
      items: [
        { id: 1, cantidad: 2 },
        { id: 2, cantidad: 1 }
      ]
    });
    antes.mesaEstadoService.abrirMesa('4');
    antes.menuItemService.editarItem('1', { precioBase: 9000 });
    antes.menuItemService.crearItem({ nombre: 'Jugo natural', precioBase: 2500 });
    const resumenAntes = antes.pedidoService.obtenerResumen('Mesa 3');
    await apagar(antes);

    const despues = crearApp({ rutaDb });
    try {
      // El pedido sigue igual: mismos ítems, precios del momento en que se confirmó.
      expect(despues.pedidoService.obtenerResumen('Mesa 3')).toEqual(resumenAntes);
      expect(resumenAntes.estado).toBe('En Cocina 🍳');
      expect(resumenAntes.total).toBe(8500 * 2 + 2000);

      // Las mesas conservan su estado (no se reinician a "libre").
      const mesas = despues.mesas.listar();
      expect(mesas).toHaveLength(10);
      expect(despues.mesas.obtener('Mesa 3').estado).toBe('ocupada');
      expect(despues.mesas.obtener('Mesa 4').estado).toBe('ocupada');

      // El menú conserva las ediciones y la semilla no se duplica.
      const menu = despues.menuItemService.listarItems().items;
      expect(menu).toHaveLength(4);
      expect(menu.find((i) => i.id === 1).precioBase).toBe(9000);
      expect(menu.find((i) => i.id === 4).nombre).toBe('Jugo natural');
    } finally {
      await apagar(despues);
    }
  });

  test('las mesas agregadas y quitadas se conservan al reiniciar', async () => {
    const rutaDb = path.join(carpeta, 'mesas.db');

    const antes = crearApp({ rutaDb });
    expect(antes.mesaConfiguracionService.quitarMesa(9).ok).toBe(true);
    expect(antes.mesaConfiguracionService.agregarMesa({ numero: 25 }).ok).toBe(true);
    await apagar(antes);

    const despues = crearApp({ rutaDb });
    try {
      // La mesa 9 no se vuelve a crear y la 25 sigue existiendo.
      const numeros = despues.mesas.listar().map((m) => m.numero);
      expect(numeros).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 10, 25]);
    } finally {
      await apagar(despues);
    }
  });

  test('un pedido Listo y su mesa ocupada se conservan al reiniciar, hasta liberar la mesa', async () => {
    const rutaDb = path.join(carpeta, 'listo.db');

    const antes = crearApp({ rutaDb });
    antes.pedidoService.confirmarPedido({ mesa: 'Mesa 6', items: [{ id: 3, cantidad: 2 }] });
    antes.pedidoService.actualizarEstado({ mesa: 'Mesa 6', estado: 'Listo 🍽️' });
    await apagar(antes);

    const despues = crearApp({ rutaDb });
    try {
      expect(despues.mesas.obtener('Mesa 6')).toMatchObject({
        estado: 'ocupada',
        estadoPedido: 'Listo 🍽️'
      });
      expect(despues.pedidoService.obtenerResumen('Mesa 6').total).toBe(13000);

      // Liberar la mesa cierra el pedido
      expect(despues.mesaEstadoService.cerrarMesa('6').ok).toBe(true);
      expect(despues.pedidos.obtener('Mesa 6')).toBeNull();
      expect(despues.mesas.obtener('Mesa 6').estado).toBe('libre');
    } finally {
      await apagar(despues);
    }
  });

  test('la hora del estado del pedido se conserva al reiniciar y viaja en la lista de mesas', async () => {
    const rutaDb = path.join(carpeta, 'tiempos.db');

    const antes = crearApp({ rutaDb });
    antes.pedidoService.actualizarEstado({ mesa: 'Mesa 4', estado: 'Recibido 📝' });
    const desde = antes.pedidos.obtener('Mesa 4').estadoDesde;
    await apagar(antes);

    const despues = crearApp({ rutaDb });
    try {
      expect(desde).toEqual(expect.any(String));
      expect(despues.mesas.obtener('Mesa 4').pedidoDesde).toBe(desde);
    } finally {
      await apagar(despues);
    }
  });

  test('por defecto crearApp usa una base en memoria nueva en cada llamada', async () => {
    const a = crearApp();
    a.mesaEstadoService.abrirMesa('1');
    const b = crearApp();
    try {
      expect(b.mesas.obtener('Mesa 1').estado).toBe('libre');
      expect(a.db.memory).toBe(true);
    } finally {
      await apagar(a);
      await apagar(b);
    }
  });
});
