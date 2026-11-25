/**
 * Controlador Socket.IO del módulo de pedidos.
 * @param {object} socket
 * @param {object} deps
 * @param {object} deps.pedidoService
 * @param {Function} deps.responderSeguro
 */
function registrarHandlersPedido(socket, { pedidoService, responderSeguro }) {
  socket.on('actualizar_pedido', (datos) => {
    console.log('\n[SOCKET] Intento de actualización de pedido:', datos);
    responderSeguro(socket, {
      eventoRespuesta: 'respuesta_pedido',
      operacion: () => pedidoService.actualizarEstado(datos),
      alExito: (r) => console.log(`✅ VALIDADO: ${r.mesa} → ${r.estado}`)
    });
  });

  socket.on('confirmar_pedido', (datos) => {
    console.log('\n[SOCKET] Confirmación de pedido (directo a cocina):', datos);
    responderSeguro(socket, {
      eventoRespuesta: 'respuesta_pedido',
      operacion: () => pedidoService.confirmarPedido(datos)
    });
  });
}

module.exports = { registrarHandlersPedido };
