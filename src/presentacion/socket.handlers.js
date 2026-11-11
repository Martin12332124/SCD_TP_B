// src/presentacion/socket.handlers.js
// Capa de presentación para Socket.io: traduce los eventos del cliente a llamadas
// a los servicios de dominio y responde por el mismo socket.
// Antes este código vivía dentro de app.js, mezclado con la composición de la app.

/**
 * Ejecuta una operación de dominio y responde al cliente por `eventoRespuesta`.
 * Centraliza el try/catch que antes estaba copiado en cada evento.
 * - Si la operación devuelve { ok: true } → registra el éxito y lo emite.
 * - Si devuelve { ok: false, tipo, error } → registra el rechazo y lo emite.
 * - Si lanza una excepción → emite { ok: false, tipo: 'ERROR_INTERNO', error } en vez de caerse.
 *
 * @param {object} socket - socket del cliente (debe tener emit)
 * @param {object} opciones
 * @param {string} opciones.eventoRespuesta - evento por el que se responde
 * @param {Function} opciones.operacion - función sin argumentos que llama al servicio
 * @param {Function} [opciones.alExito] - log opcional cuando resultado.ok es true
 * @param {string} [opciones.prefijoRechazo] - texto antes de "RECHAZADO" en el log
 * @param {string} [opciones.sufijoError] - texto después de "ERROR INTERNO" en el log
 * @returns {object} el resultado emitido
 */
function responderSeguro(
  socket,
  { eventoRespuesta, operacion, alExito, prefijoRechazo = '', sufijoError = '' }
) {
  let resultado;
  try {
    resultado = operacion();
    if (resultado.ok) {
      if (alExito) alExito(resultado);
    } else {
      console.error(`❌ ${prefijoRechazo}RECHAZADO [${resultado.tipo}]: ${resultado.error}`);
    }
  } catch (error) {
    // Dependencia no disponible: propagar el error sin ocultar
    console.error(`💥 ERROR INTERNO${sufijoError}: ${error.message}`);
    resultado = { ok: false, tipo: 'ERROR_INTERNO', error: error.message };
  }
  socket.emit(eventoRespuesta, resultado);
  return resultado;
}

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
      responderSeguro(socket, {
        eventoRespuesta: 'respuesta_pedido',
        operacion: () => pedidoService.actualizarEstado(datos),
        alExito: (r) => console.log(`✅ VALIDADO: ${r.mesa} → ${r.estado}`)
      });
    });

    // Atajo: confirmar el pedido de una mesa y enviarlo directo a cocina
    socket.on('confirmar_pedido', (datos) => {
      console.log('\n[SOCKET] Confirmación de pedido (directo a cocina):', datos);
      responderSeguro(socket, {
        eventoRespuesta: 'respuesta_pedido',
        operacion: () => pedidoService.confirmarPedido(datos)
      });
    });

    socket.on('disconnect', () => {
      console.log(`[SOCKET] Cliente desconectado. ID: ${socket.id}`);
    });

    // ── Operación 3 (US-05): Traslado de pedido entre mesas ──────────
    socket.on('trasladar_pedido', (datos) => {
      console.log('\n[SOCKET] Intento de traslado de pedido:', datos);
      responderSeguro(socket, {
        eventoRespuesta: 'respuesta_traslado',
        operacion: () => mesaService.trasladarPedido(datos),
        alExito: (r) => console.log(`✅ TRASLADO OK: ${r.origen} → ${r.destino} (${r.estado})`),
        prefijoRechazo: 'TRASLADO ',
        sufijoError: ' EN TRASLADO'
      });
    });
  });
}

module.exports = { registrarHandlersSocket, responderSeguro };