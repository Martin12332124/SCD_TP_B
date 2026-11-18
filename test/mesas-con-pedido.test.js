// test/mesas-con-pedido.test.js
// Decorador que agrega `estadoPedido` a las mesas. Se prueba sobre los dos
// repositorios (memoria y SQLite) para comprobar que funciona igual con ambos.

const { MesasConEstadoPedido } = require('../src/infraestructura/mesas-con-pedido');
const { PedidosEnMemoria, MesasEnMemoria } = require('../src/infraestructura/repositorios');
const { PedidosSQLite, MesasSQLite } = require('../src/infraestructura/sqlite/repositorios-sqlite');
const { abrirBaseDeDatos } = require('../src/infraestructura/sqlite/conexion');

let db;

const implementaciones = {
  memoria: () => ({ pedidos: new PedidosEnMemoria(), base: new MesasEnMemoria(3) }),
  sqlite: () => {
    db = abrirBaseDeDatos(':memory:');
    return { pedidos: new PedidosSQLite(db), base: new MesasSQLite(db, 3) };
  }
};

afterEach(() => {
  if (db && db.open) db.close();
  db = null;
});

describe.each(Object.keys(implementaciones))('MesasConEstadoPedido (%s)', (nombre) => {
  let pedidos, base, mesas;
  beforeEach(() => {
    ({ pedidos, base } = implementaciones[nombre]());
    mesas = new MesasConEstadoPedido(base, pedidos);
  });

  test('sin pedidos, todas las mesas llevan estadoPedido null', () => {
    expect(mesas.listar()).toEqual([
      { id: 'Mesa 1', numero: 1, estado: 'libre', estadoPedido: null, pedidoDesde: null },
      { id: 'Mesa 2', numero: 2, estado: 'libre', estadoPedido: null, pedidoDesde: null },
      { id: 'Mesa 3', numero: 3, estado: 'libre', estadoPedido: null, pedidoDesde: null }
    ]);
  });

  test('listar incluye el estado del pedido vigente de cada mesa', () => {
    mesas.ocupar('Mesa 1');
    mesas.ocupar('Mesa 2');
    pedidos.guardar('Mesa 1', { mesa: 'Mesa 1', estado: 'Recibido 📝' });
    pedidos.guardar('Mesa 2', { mesa: 'Mesa 2', estado: 'En Cocina 🍳' });
    expect(mesas.listar().map((m) => m.estadoPedido)).toEqual([
      'Recibido 📝',
      'En Cocina 🍳',
      null
    ]);
  });

  test('obtener incluye el estado del pedido, y devuelve null si la mesa no existe', () => {
    mesas.ocupar('Mesa 2');
    pedidos.guardar('Mesa 2', { mesa: 'Mesa 2', estado: 'En Cocina 🍳' });
    expect(mesas.obtener('Mesa 2')).toEqual({
      id: 'Mesa 2',
      numero: 2,
      estado: 'ocupada',
      estadoPedido: 'En Cocina 🍳',
      pedidoDesde: null
    });
    expect(mesas.obtener('Mesa 1').estadoPedido).toBeNull();
    expect(mesas.obtener('Mesa 9')).toBeNull();
  });

  test('al eliminarse el pedido, estadoPedido vuelve a null', () => {
    mesas.ocupar('Mesa 1');
    pedidos.guardar('Mesa 1', { mesa: 'Mesa 1', estado: 'En Cocina 🍳' });
    pedidos.eliminar('Mesa 1');
    expect(mesas.obtener('Mesa 1').estadoPedido).toBeNull();
  });

  test('ocupar, liberar, agregar y eliminar llegan al repositorio envuelto', () => {
    mesas.ocupar('Mesa 3');
    expect(base.obtener('Mesa 3').estado).toBe('ocupada');
    mesas.liberar('Mesa 3');
    expect(base.obtener('Mesa 3').estado).toBe('libre');

    expect(mesas.agregar(7)).toEqual({
      id: 'Mesa 7',
      numero: 7,
      estado: 'libre',
      estadoPedido: null,
      pedidoDesde: null
    });
    expect(base.obtener('Mesa 7')).not.toBeNull();

    mesas.eliminar('Mesa 7');
    expect(base.obtener('Mesa 7')).toBeNull();
  });

  test('no agrega el campo a los datos del repositorio envuelto', () => {
    mesas.obtener('Mesa 1');
    mesas.listar();
    expect(base.obtener('Mesa 1')).toEqual({ id: 'Mesa 1', numero: 1, estado: 'libre' });
  });
});

describe('MesasConEstadoPedido: dependencias', () => {
  test('exige el repositorio de mesas y el de pedidos', () => {
    expect(() => new MesasConEstadoPedido(null, new PedidosEnMemoria())).toThrow(/mesas/);
    expect(() => new MesasConEstadoPedido(new MesasEnMemoria(1))).toThrow(/pedidos/);
  });
});
