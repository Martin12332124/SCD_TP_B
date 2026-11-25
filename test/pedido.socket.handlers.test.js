const { registrarHandlersPedido } = require('../src/modules/pedidos');

describe('controlador Socket.IO del módulo pedidos', () => {
  let handlers;
  let socket;
  let pedidoService;
  let responderSeguro;

  beforeEach(() => {
    handlers = {};
    socket = {
      on: jest.fn((evento, handler) => {
        handlers[evento] = handler;
      })
    };
    pedidoService = {
      actualizarEstado: jest.fn(() => ({ ok: true })),
      confirmarPedido: jest.fn(() => ({ ok: true }))
    };
    responderSeguro = jest.fn();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([
    ['actualizar_pedido', 'actualizarEstado', { mesa: 'Mesa 2', estado: 'Recibido 📝' }],
    ['confirmar_pedido', 'confirmarPedido', { mesa: 'Mesa 2', items: [{ id: 1, cantidad: 1 }] }]
  ])('delega %s al servicio y conserva el evento de respuesta', (evento, metodo, datos) => {
    registrarHandlersPedido(socket, { pedidoService, responderSeguro });

    handlers[evento](datos);

    expect(responderSeguro).toHaveBeenCalledWith(
      socket,
      expect.objectContaining({ eventoRespuesta: 'respuesta_pedido' })
    );
    expect(responderSeguro.mock.calls[0][1].operacion()).toEqual({ ok: true });
    expect(pedidoService[metodo]).toHaveBeenCalledWith(datos);
  });
});
