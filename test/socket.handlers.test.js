// Pruebas unitarias de responderSeguro (src/presentacion/socket.handlers.js).
// El socket se sustituye por un doble con emit; no se levanta servidor.
const { responderSeguro } = require('../src/presentacion/socket.handlers');

function socketFalso() {
  return { emit: jest.fn() };
}

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('responderSeguro', () => {
  test('resultado ok: emite el resultado y llama a alExito', () => {
    const socket = socketFalso();
    const alExito = jest.fn();
    const resultado = { ok: true, mesa: 'Mesa 1', estado: 'Recibido 📝' };

    const emitido = responderSeguro(socket, {
      eventoRespuesta: 'respuesta_pedido',
      operacion: () => resultado,
      alExito
    });

    expect(socket.emit).toHaveBeenCalledWith('respuesta_pedido', resultado);
    expect(alExito).toHaveBeenCalledWith(resultado);
    expect(emitido).toBe(resultado);
  });

  test('resultado rechazado: emite el rechazo sin llamar a alExito', () => {
    const socket = socketFalso();
    const alExito = jest.fn();
    const rechazo = { ok: false, tipo: 'ENTRADA_INVALIDA', error: 'Estado desconocido' };

    responderSeguro(socket, {
      eventoRespuesta: 'respuesta_pedido',
      operacion: () => rechazo,
      alExito
    });

    expect(socket.emit).toHaveBeenCalledWith('respuesta_pedido', rechazo);
    expect(alExito).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('RECHAZADO [ENTRADA_INVALIDA]')
    );
  });

  test('si la operación lanza, emite ERROR_INTERNO en vez de propagar', () => {
    const socket = socketFalso();

    const emitido = responderSeguro(socket, {
      eventoRespuesta: 'respuesta_traslado',
      operacion: () => {
        throw new Error('Repositorio caído');
      },
      sufijoError: ' EN TRASLADO'
    });

    expect(emitido).toEqual({ ok: false, tipo: 'ERROR_INTERNO', error: 'Repositorio caído' });
    expect(socket.emit).toHaveBeenCalledWith('respuesta_traslado', emitido);
    expect(console.error).toHaveBeenCalledWith('💥 ERROR INTERNO EN TRASLADO: Repositorio caído');
  });

  test('alExito es opcional', () => {
    const socket = socketFalso();
    expect(() =>
      responderSeguro(socket, {
        eventoRespuesta: 'respuesta_pedido',
        operacion: () => ({ ok: true })
      })
    ).not.toThrow();
    expect(socket.emit).toHaveBeenCalledTimes(1);
  });
});