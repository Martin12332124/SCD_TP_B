// src/infraestructura/notificador.js
// Adaptador de notificación en tiempo real vía Socket.io.

/**
 * SocketNotificador: envuelve una instancia de Socket.io Server
 * para emitir eventos a todos los clientes conectados.
 */
class SocketNotificador {
  constructor(io) {
    if (!io) throw new Error('Se requiere una instancia de Socket.io Server');
    this.io = io;
  }

  /**
   * Emite un evento a todos los clientes conectados.
   * @param {string} evento - Nombre del evento
   * @param {object} datos  - Payload del evento
   */
  emitir(evento, datos) {
    this.io.emit(evento, datos);
  }
}

module.exports = { SocketNotificador };
