// src/presentacion/socket.handlers.js
// Capa de presentación para Socket.io: traduce los eventos del cliente a llamadas
// a los servicios de dominio y responde por el mismo socket.
// Antes este código vivía dentro de app.js, mezclado con la composición de la app.

/**
 * Registra los eventos socket de la aplicación.
 * @param {import('socket.io').Server} io
 * @param {object} deps
 * @param {object} deps.pedidoService - actualizarEstado(datos), confirmarPedido(datos)
 * @param {object} deps.mesaService   - trasladarPedido(datos)
 * @param {object} deps.mesas         - repositorio con listar()
 */
function registrarHandlersSocket(io, { pedidoService, mesaService, mesas }) {
  io.on('connection', (socket) => {
    console.log(`[SOCKET] Nuevo cliente conectado. ID: ${socket.id}`);

    // Enviar estado inicial de mesas al cliente que se conecta
    socket.emit('estado_mesas', mesas.listar());

    // Recibir actualización de pedido desde el frontend
    socket.on('actualizar_pedido', (datos) => {
      console.log('\n[SOCKET] Intento de actualización de pedido:', datos);

      try {
        const resultado = pedidoService.actualizarEstado(datos);

        if (resultado.ok) {
          console.log(`✅ VALIDADO: ${resultado.mesa} → ${resultado.estado}`);
          // Responder al emisor con confirmación
          socket.emit('respuesta_pedido', resultado);
        } else {
          console.error(`❌ RECHAZADO [${resultado.tipo}]: ${resultado.error}`);
          socket.emit('respuesta_pedido', resultado);
        }
      } catch (error) {
        // Dependencia no disponible: propagar el error sin ocultar
        console.error(`💥 ERROR INTERNO: ${error.message}`);
        socket.emit('respuesta_pedido', {
          ok: false,
          tipo: 'ERROR_INTERNO',
          error: error.message
        });
      }
    });

    // Atajo: confirmar el pedido de una mesa y enviarlo directo a cocina
    socket.on('confirmar_pedido', (datos) => {
      console.log('\n[SOCKET] Confirmación de pedido (directo a cocina):', datos);

      try {
        const resultado = pedidoService.confirmarPedido(datos);
        if (!resultado.ok) {
          console.error(`❌ RECHAZADO [${resultado.tipo}]: ${resultado.error}`);
        }
        socket.emit('respuesta_pedido', resultado);
      } catch (error) {
        console.error(`💥 ERROR INTERNO: ${error.message}`);
        socket.emit('respuesta_pedido', {
          ok: false,
          tipo: 'ERROR_INTERNO',
          error: error.message
        });
      }
    });

    socket.on('disconnect', () => {
      console.log(`[SOCKET] Cliente desconectado. ID: ${socket.id}`);
    });

    // ── Operación 3 (US-05): Traslado de pedido entre mesas ──────────
    socket.on('trasladar_pedido', (datos) => {
      console.log('\n[SOCKET] Intento de traslado de pedido:', datos);

      try {
        const resultado = mesaService.trasladarPedido(datos);

        if (resultado.ok) {
          console.log(
            `✅ TRASLADO OK: ${resultado.origen} → ${resultado.destino} (${resultado.estado})`
          );
          socket.emit('respuesta_traslado', resultado);
        } else {
          console.error(`❌ TRASLADO RECHAZADO [${resultado.tipo}]: ${resultado.error}`);
          socket.emit('respuesta_traslado', resultado);
        }
      } catch (error) {
        // Dependencia no disponible: propagar el error sin ocultar
        console.error(`💥 ERROR INTERNO EN TRASLADO: ${error.message}`);
        socket.emit('respuesta_traslado', {
          ok: false,
          tipo: 'ERROR_INTERNO',
          error: error.message
        });
      }
    });
  });
}

module.exports = { registrarHandlersSocket };