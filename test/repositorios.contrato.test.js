// test/repositorios.contrato.test.js
// Pruebas de "contrato": los mismos tests corren contra los repositorios en memoria
// y contra los de SQLite, para comprobar que ambos se comportan igual ante el dominio.
// Al final hay tests solo para SQLite (copias defensivas, emojis, tipos).

const {
  PedidosEnMemoria,
  MesasEnMemoria,
  MenuItemsEnMemoria
} = require('../src/infraestructura/repositorios');
const {
  PedidosSQLite,
  MesasSQLite,
  MenuItemsSQLite
} = require('../src/infraestructura/sqlite/repositorios-sqlite');
const { abrirBaseDeDatos } = require('../src/infraestructura/sqlite/conexion');
const { ESTADOS_VALIDOS } = require('../src/dominio/pedido.service');

const SEMILLA = [
  { id: 1, nombre: 'Pizza Margarita', precioBase: 8500, disponible: true },
  { id: 2, nombre: 'Coca-Cola 500 ml', precioBase: 2000, disponible: true },
  { id: 3, nombre: 'Ensalada César', precioBase: 6500, disponible: true }
];

const ITEMS = [
  { id: 2, nombre: 'Coca-Cola 500 ml', precioBase: 2000, cantidad: 3 },
  { id: 1, nombre: 'Pizza Margarita', precioBase: 8500, cantidad: 1 }
];

let db;

const implementaciones = {
  memoria: () => ({
    pedidos: new PedidosEnMemoria(),
    mesas: new MesasEnMemoria(10),
    menuItems: new MenuItemsEnMemoria(SEMILLA)
  }),
  sqlite: () => {
    db = abrirBaseDeDatos(':memory:');
    return {
      pedidos: new PedidosSQLite(db),
      mesas: new MesasSQLite(db, 10),
      menuItems: new MenuItemsSQLite(db, SEMILLA)
    };
  }
};

afterEach(() => {
  if (db && db.open) db.close();
  db = null;
});

describe.each(Object.keys(implementaciones))('Contrato de repositorios (%s)', (nombre) => {
  let repos;
  beforeEach(() => {
    repos = implementaciones[nombre]();
  });

  describe('pedidos', () => {
    test('obtener devuelve null si la mesa no tiene pedido', () => {
      expect(repos.pedidos.obtener('Mesa 1')).toBeNull();
    });

    test('guardar y obtener un pedido sin ítems', () => {
      repos.pedidos.guardar('Mesa 1', { mesa: 'Mesa 1', estado: 'Recibido 📝' });
      expect(repos.pedidos.obtener('Mesa 1')).toEqual({ mesa: 'Mesa 1', estado: 'Recibido 📝' });
    });

    test('guardar y obtener un pedido con ítems, en el mismo orden', () => {
      repos.pedidos.guardar('Mesa 2', { mesa: 'Mesa 2', estado: 'En Cocina 🍳', items: ITEMS });
      expect(repos.pedidos.obtener('Mesa 2')).toEqual({
        mesa: 'Mesa 2',
        estado: 'En Cocina 🍳',
        items: ITEMS
      });
    });

    test('guardar de nuevo reemplaza estado e ítems', () => {
      repos.pedidos.guardar('Mesa 2', { mesa: 'Mesa 2', estado: 'Recibido 📝', items: ITEMS });
      repos.pedidos.guardar('Mesa 2', {
        mesa: 'Mesa 2',
        estado: 'En Cocina 🍳',
        items: [ITEMS[0]]
      });
      expect(repos.pedidos.obtener('Mesa 2')).toEqual({
        mesa: 'Mesa 2',
        estado: 'En Cocina 🍳',
        items: [ITEMS[0]]
      });
    });

    test('eliminar quita el pedido', () => {
      repos.pedidos.guardar('Mesa 3', { mesa: 'Mesa 3', estado: 'Recibido 📝', items: ITEMS });
      repos.pedidos.eliminar('Mesa 3');
      expect(repos.pedidos.obtener('Mesa 3')).toBeNull();
    });

    test('todos devuelve los pedidos indexados por mesa', () => {
      repos.pedidos.guardar('Mesa 1', { mesa: 'Mesa 1', estado: 'Recibido 📝' });
      repos.pedidos.guardar('Mesa 4', { mesa: 'Mesa 4', estado: 'En Cocina 🍳', items: ITEMS });
      expect(repos.pedidos.todos()).toEqual({
        'Mesa 1': { mesa: 'Mesa 1', estado: 'Recibido 📝' },
        'Mesa 4': { mesa: 'Mesa 4', estado: 'En Cocina 🍳', items: ITEMS }
      });
    });

    test('todos devuelve un objeto nuevo: agregarle claves no crea pedidos', () => {
      const copia = repos.pedidos.todos();
      copia['Mesa 9'] = { mesa: 'Mesa 9', estado: 'Recibido 📝' };
      expect(repos.pedidos.obtener('Mesa 9')).toBeNull();
    });
  });

  describe('mesas', () => {
    test('se crean 10 mesas libres, ordenadas por número', () => {
      const mesas = repos.mesas.listar();
      expect(mesas).toHaveLength(10);
      expect(mesas[0]).toEqual({ id: 'Mesa 1', numero: 1, estado: 'libre' });
      expect(mesas[9]).toEqual({ id: 'Mesa 10', numero: 10, estado: 'libre' });
      expect(mesas.every((m) => m.estado === 'libre')).toBe(true);
    });

    test('obtener devuelve null para una mesa que no existe', () => {
      expect(repos.mesas.obtener('Mesa 11')).toBeNull();
    });

    test('ocupar y liberar cambian el estado', () => {
      repos.mesas.ocupar('Mesa 5');
      expect(repos.mesas.obtener('Mesa 5').estado).toBe('ocupada');
      repos.mesas.liberar('Mesa 5');
      expect(repos.mesas.obtener('Mesa 5').estado).toBe('libre');
    });

    test('ocupar una mesa inexistente no hace nada ni lanza error', () => {
      expect(() => repos.mesas.ocupar('Mesa 99')).not.toThrow();
      expect(repos.mesas.listar()).toHaveLength(10);
    });

    test('listar devuelve copias: modificarlas no cambia el repositorio', () => {
      repos.mesas.listar()[0].estado = 'ocupada';
      expect(repos.mesas.obtener('Mesa 1').estado).toBe('libre');
    });

    test('agregar crea una mesa libre y la devuelve', () => {
      const nueva = repos.mesas.agregar(11);
      expect(nueva).toEqual({ id: 'Mesa 11', numero: 11, estado: 'libre' });
      expect(repos.mesas.obtener('Mesa 11')).toEqual(nueva);
      expect(repos.mesas.listar()).toHaveLength(11);
    });

    test('la lista sigue ordenada por número aunque se agreguen en desorden', () => {
      repos.mesas.eliminar('Mesa 4');
      repos.mesas.agregar(20);
      repos.mesas.agregar(15);
      repos.mesas.agregar(4);
      const numeros = repos.mesas.listar().map((m) => m.numero);
      expect(numeros).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20]);
    });

    test('agregar una mesa que ya existe lanza un error y no la duplica', () => {
      expect(() => repos.mesas.agregar(3)).toThrow();
      expect(repos.mesas.listar()).toHaveLength(10);
    });

    test('eliminar quita la mesa; eliminar una inexistente no hace nada', () => {
      repos.mesas.eliminar('Mesa 7');
      expect(repos.mesas.obtener('Mesa 7')).toBeNull();
      expect(repos.mesas.listar()).toHaveLength(9);
      expect(() => repos.mesas.eliminar('Mesa 99')).not.toThrow();
      expect(repos.mesas.listar()).toHaveLength(9);
    });
  });

  describe('ítems del menú', () => {
    test('la semilla queda cargada', () => {
      expect(repos.menuItems.listar()).toEqual(SEMILLA);
    });

    test('obtener por id devuelve el ítem, o null si no existe', () => {
      expect(repos.menuItems.obtener(3)).toEqual(SEMILLA[2]);
      expect(repos.menuItems.obtener(99)).toBeNull();
    });

    test('obtener con el id como string no encuentra el ítem', () => {
      expect(repos.menuItems.obtener('1')).toBeNull();
    });

    test('guardar sin id asigna el siguiente y lo escribe en el objeto recibido', () => {
      const nuevo = { nombre: 'Jugo', precioBase: 1500, disponible: true };
      const guardado = repos.menuItems.guardar(nuevo);
      expect(guardado).toEqual({ id: 4, nombre: 'Jugo', precioBase: 1500, disponible: true });
      expect(nuevo.id).toBe(4);
      expect(repos.menuItems.obtener(4)).toEqual(guardado);
    });

    test('guardar con id existente actualiza el ítem', () => {
      repos.menuItems.guardar({
        id: 1,
        nombre: 'Pizza Napolitana',
        precioBase: 9000,
        disponible: false
      });
      expect(repos.menuItems.obtener(1)).toEqual({
        id: 1,
        nombre: 'Pizza Napolitana',
        precioBase: 9000,
        disponible: false
      });
      expect(repos.menuItems.listar()).toHaveLength(3);
    });

    test('buscarPorNombre ignora mayúsculas, acentos en mayúscula y espacios extremos', () => {
      expect(repos.menuItems.buscarPorNombre('  ENSALADA CÉSAR ')).toEqual(SEMILLA[2]);
      expect(repos.menuItems.buscarPorNombre('pizza margarita').id).toBe(1);
      expect(repos.menuItems.buscarPorNombre('Hamburguesa')).toBeNull();
    });

    test('obtener devuelve una copia: modificarla no cambia el repositorio', () => {
      repos.menuItems.obtener(1).precioBase = 1;
      expect(repos.menuItems.obtener(1).precioBase).toBe(8500);
    });
  });
});

describe('Repositorios SQLite: detalles propios', () => {
  let pedidos, mesas;
  beforeEach(() => {
    db = abrirBaseDeDatos(':memory:');
    mesas = new MesasSQLite(db, 10);
    pedidos = new PedidosSQLite(db);
  });

  test.each(ESTADOS_VALIDOS)('el estado "%s" se guarda y se lee exactamente igual', (estado) => {
    pedidos.guardar('Mesa 1', { mesa: 'Mesa 1', estado });
    expect(pedidos.obtener('Mesa 1').estado).toBe(estado);
    expect(Buffer.from(pedidos.obtener('Mesa 1').estado)).toEqual(Buffer.from(estado));
  });

  test('un pedido sin ítems se lee sin la propiedad items (no null)', () => {
    pedidos.guardar('Mesa 1', { mesa: 'Mesa 1', estado: 'Recibido 📝' });
    expect(pedidos.obtener('Mesa 1')).not.toHaveProperty('items');
  });

  test('obtener devuelve copias de pedidos y mesas', () => {
    pedidos.guardar('Mesa 1', { mesa: 'Mesa 1', estado: 'Recibido 📝', items: ITEMS });
    const leido = pedidos.obtener('Mesa 1');
    leido.estado = 'otro';
    leido.items[0].cantidad = 50;
    expect(pedidos.obtener('Mesa 1')).toEqual({
      mesa: 'Mesa 1',
      estado: 'Recibido 📝',
      items: ITEMS
    });

    mesas.obtener('Mesa 2').estado = 'ocupada';
    expect(mesas.obtener('Mesa 2').estado).toBe('libre');
  });

  test('eliminar un pedido borra también sus ítems (ON DELETE CASCADE)', () => {
    pedidos.guardar('Mesa 1', { mesa: 'Mesa 1', estado: 'Recibido 📝', items: ITEMS });
    pedidos.eliminar('Mesa 1');
    expect(db.prepare('SELECT COUNT(*) AS n FROM pedido_items').get().n).toBe(0);
  });

  test('un pedido sobre una mesa inexistente se rechaza (clave foránea)', () => {
    expect(() => pedidos.guardar('Mesa 99', { mesa: 'Mesa 99', estado: 'Recibido 📝' })).toThrow();
  });

  test('si falla un ítem, guardar no deja el pedido a medias', () => {
    pedidos.guardar('Mesa 1', { mesa: 'Mesa 1', estado: 'Recibido 📝', items: [ITEMS[0]] });
    const roto = { id: 5, nombre: null, precioBase: 100, cantidad: 1 }; // nombre NOT NULL
    expect(() =>
      pedidos.guardar('Mesa 1', { mesa: 'Mesa 1', estado: 'En Cocina 🍳', items: [ITEMS[1], roto] })
    ).toThrow();
    expect(pedidos.obtener('Mesa 1')).toEqual({
      mesa: 'Mesa 1',
      estado: 'Recibido 📝',
      items: [ITEMS[0]]
    });
  });

  test('disponible se devuelve como boolean', () => {
    const menu = new MenuItemsSQLite(db, SEMILLA);
    menu.guardar({ id: 2, nombre: 'Coca-Cola 500 ml', precioBase: 2000, disponible: false });
    expect(menu.obtener(2).disponible).toBe(false);
    expect(menu.obtener(1).disponible).toBe(true);
  });

  test('las mesas iniciales se crean solo si la tabla está vacía', () => {
    // Simula que el restaurante quitó dos mesas y ocupó otra
    db.prepare("DELETE FROM mesas WHERE id IN ('Mesa 9', 'Mesa 10')").run();
    mesas.ocupar('Mesa 3');

    // Un nuevo arranque vuelve a construir el repositorio sobre la misma base
    const trasReinicio = new MesasSQLite(db, 10);
    expect(trasReinicio.listar()).toHaveLength(8);
    expect(trasReinicio.obtener('Mesa 9')).toBeNull();
    expect(trasReinicio.obtener('Mesa 3').estado).toBe('ocupada');
  });

  test('una mesa con pedido vigente no se puede eliminar (clave foránea)', () => {
    pedidos.guardar('Mesa 2', { mesa: 'Mesa 2', estado: 'Recibido 📝' });
    expect(() => mesas.eliminar('Mesa 2')).toThrow();
    expect(mesas.obtener('Mesa 2')).not.toBeNull();
  });

  test('con la tabla vacía crea la cantidad de mesas indicada', () => {
    db.prepare('DELETE FROM mesas').run();
    expect(new MesasSQLite(db, 4).listar().map((m) => m.numero)).toEqual([1, 2, 3, 4]);
  });
});
