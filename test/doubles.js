// test/doubles.js
// Dobles de prueba para verificación controlada del PedidoService.

/**
 * NotificadorEspia: guarda todos los eventos emitidos para inspección en tests.
 */
class NotificadorEspia {
  constructor() {
    this.eventos = [];
  }

  emitir(evento, datos) {
    this.eventos.push({ evento, datos });
  }

  /** Devuelve los eventos filtrados por nombre. */
  eventosDe(nombre) {
    return this.eventos.filter((e) => e.evento === nombre);
  }

  limpiar() {
    this.eventos = [];
  }
}

/**
 * PedidosQueFallan: repositorio que lanza error al guardar,
 * para simular un fallo de persistencia.
 */
class PedidosQueFallan {
  obtener() {
    return null;
  }
  guardar() {
    throw new Error('Fallo simulado de persistencia');
  }
  eliminar() {
    throw new Error('Fallo simulado de persistencia');
  }
  todos() {
    return {};
  }
}

/**
 * NotificadorCaido: lanza error al emitir,
 * para verificar que un fallo de notificación se propaga correctamente.
 */
class NotificadorCaido {
  emitir() {
    throw new Error('Dependencia no disponible: servicio de notificación caído');
  }
}

module.exports = { NotificadorEspia, PedidosQueFallan, NotificadorCaido };
