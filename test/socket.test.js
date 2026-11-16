// test/socket.test.js
// Pruebas de los manejadores de Socket.io definidos en src/app.js:
// actualizar_pedido, confirmar_pedido y trasladar_pedido.
// Levanta la aplicación real en un puerto libre y se conecta con socket.io-client.

const { io: conectar } = require('socket.io-client');
const { crearApp } = require('../src/app');

let ctx;
let cliente;

/** Espera un evento una sola vez y devuelve su payload. */
function esperar(socket, evento) {
  return new Promise((resolve) => socket.once(evento, resolve));
}

/** Emite un evento y resuelve con la respuesta indicada. */
function pedir(evento, datos, respuesta) {
  const promesa = esperar(cliente, respuesta);
  cliente.emit(evento, datos);
  return promesa;
}

beforeEach(async () => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});

  ctx = crearApp();
  await new Promise((resolve) => ctx.server.listen(0, resolve));
  const puerto = ctx.server.address().port;

  cliente = conectar(`http://127.0.0.1:${puerto}`, { transports: ['websocket'] });
  // Se registra antes de conectar: el servidor emite estado_mesas al conectarse.
  await esperar(cliente, 'estado_mesas');
});

afterEach(async () => {
  cliente.close();
  await ctx.io.close(); // también cierra el servidor HTTP asociado
  jest.restoreAllMocks();
});

describe('Socket.io: conexión', () => {
  test('al conectarse el cliente recibe el estado inicial de las 10 mesas', async () => {
    const segundo = conectar(`http://127.0.0.1:${ctx.server.address().port}`, {
      transports: ['websocket']
    });
    const mesas = await esperar(segundo, 'estado_mesas');
    segundo.close();
    expect(mesas).toHaveLength(10);
  });
});

describe('Socket.io: actualizar_pedido', () => {
  test('un pedido válido es aceptado y se responde ok', async () => {
    const r = await pedir(
      'actualizar_pedido',
      { mesa: 'Mesa 1', estado: 'Recibido 📝' },
      'respuesta_pedido'
    );
    expect(r.ok).toBe(true);
    expect(r.mesa).toBe('Mesa 1');
  });

  test.each(['Mesa 0', 'Mesa -1', 'Mesa ABC'])(
    'rechaza la mesa inválida "%s" con ENTRADA_INVALIDA',
    async (mesa) => {
      const r = await pedir('actualizar_pedido', { mesa, estado: 'Recibido 📝' }, 'respuesta_pedido');
      expect(r.ok).toBe(false);
      expect(r.tipo).toBe('ENTRADA_INVALIDA');
    }
  );

  test('rechaza un estado desconocido sin guardar el pedido', async () => {
    const r = await pedir(
      'actualizar_pedido',
      { mesa: 'Mesa 1', estado: 'Cancelado' },
      'respuesta_pedido'
    );
    expect(r.ok).toBe(false);
    expect(ctx.pedidos.obtener('Mesa 1')).toBeFalsy();
  });

  test('si el servicio falla, responde ERROR_INTERNO en vez de caerse', async () => {
    jest.spyOn(ctx.pedidoService, 'actualizarEstado').mockImplementation(() => {
      throw new Error('dependencia caída');
    });
    const r = await pedir(
      'actualizar_pedido',
      { mesa: 'Mesa 1', estado: 'Recibido 📝' },
      'respuesta_pedido'
    );
    expect(r).toEqual({ ok: false, tipo: 'ERROR_INTERNO', error: 'dependencia caída' });
  });
});

describe('Socket.io: confirmar_pedido', () => {
  test('un pedido sin ítems válidos es rechazado', async () => {
    const r = await pedir('confirmar_pedido', { mesa: 'Mesa 1', items: [] }, 'respuesta_pedido');
    expect(r.ok).toBe(false);
  });

  test('si el servicio falla, responde ERROR_INTERNO', async () => {
    jest.spyOn(ctx.pedidoService, 'confirmarPedido').mockImplementation(() => {
      throw new Error('fallo inesperado');
    });
    const r = await pedir('confirmar_pedido', { mesa: 'Mesa 1', items: [] }, 'respuesta_pedido');
    expect(r.tipo).toBe('ERROR_INTERNO');
  });
});

describe('Socket.io: trasladar_pedido (US-05)', () => {
  test('traslada el pedido de una mesa a otra libre y responde ok', async () => {
    await pedir('actualizar_pedido', { mesa: 'Mesa 1', estado: 'Recibido 📝' }, 'respuesta_pedido');
    const r = await pedir('trasladar_pedido', { origen: 1, destino: 2 }, 'respuesta_traslado');
    expect(r.ok).toBe(true);
    expect(ctx.pedidos.obtener('Mesa 2')).toBeTruthy();
    expect(ctx.pedidos.obtener('Mesa 1')).toBeFalsy();
  });

  test('rechaza el traslado si la mesa de origen no tiene pedido', async () => {
    const r = await pedir('trasladar_pedido', { origen: 3, destino: 4 }, 'respuesta_traslado');
    expect(r.ok).toBe(false);
  });

  test('rechaza datos inválidos (origen no numérico)', async () => {
    const r = await pedir('trasladar_pedido', { origen: 'x', destino: 2 }, 'respuesta_traslado');
    expect(r.ok).toBe(false);
    expect(r.tipo).toBe('ENTRADA_INVALIDA');
  });

  test('si el servicio falla, responde ERROR_INTERNO', async () => {
    jest.spyOn(ctx.mesaService, 'trasladarPedido').mockImplementation(() => {
      throw new Error('fallo en traslado');
    });
    const r = await pedir('trasladar_pedido', { origen: 1, destino: 2 }, 'respuesta_traslado');
    expect(r).toEqual({ ok: false, tipo: 'ERROR_INTERNO', error: 'fallo en traslado' });
  });
});

describe('Socket.io: configuración de mesas', () => {
  const api = (metodo, ruta) =>
    fetch(`http://127.0.0.1:${ctx.server.address().port}${ruta}`, { method: metodo });

  test('al agregar una mesa por la API, los clientes reciben estado_mesas con la lista nueva', async () => {
    const evento = esperar(cliente, 'estado_mesas');
    await api('POST', '/api/mesas');
    const mesas = await evento;
    expect(mesas).toHaveLength(11);
    expect(mesas[10]).toMatchObject({ id: 'Mesa 11', numero: 11, estado: 'libre' });
  });

  test('al quitar una mesa por la API, los clientes reciben estado_mesas sin ella', async () => {
    const evento = esperar(cliente, 'estado_mesas');
    await api('DELETE', '/api/mesas/10');
    const mesas = await evento;
    expect(mesas).toHaveLength(9);
    expect(mesas.map((m) => m.id)).not.toContain('Mesa 10');
  });

  test('un cliente que se conecta después recibe la lista ya modificada', async () => {
    await api('DELETE', '/api/mesas/1');
    const segundo = conectar(`http://127.0.0.1:${ctx.server.address().port}`, {
      transports: ['websocket']
    });
    const mesas = await esperar(segundo, 'estado_mesas');
    segundo.close();
    expect(mesas.map((m) => m.numero)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe('Socket.io: estado del pedido en estado_mesas', () => {
  test('el estado inicial trae estadoPedido en cada mesa', async () => {
    const segundo = conectar(`http://127.0.0.1:${ctx.server.address().port}`, {
      transports: ['websocket']
    });
    const mesas = await esperar(segundo, 'estado_mesas');
    segundo.close();
    expect(mesas[0]).toEqual({ id: 'Mesa 1', numero: 1, estado: 'libre', estadoPedido: null });
  });

  test('al tomar un pedido, estado_mesas llega con el estado del pedido de esa mesa', async () => {
    const evento = esperar(cliente, 'estado_mesas');
    cliente.emit('actualizar_pedido', { mesa: 'Mesa 4', estado: 'Recibido 📝' });
    const mesas = await evento;
    expect(mesas.find((m) => m.id === 'Mesa 4')).toEqual({
      id: 'Mesa 4',
      numero: 4,
      estado: 'ocupada',
      estadoPedido: 'Recibido 📝'
    });
  });
});
