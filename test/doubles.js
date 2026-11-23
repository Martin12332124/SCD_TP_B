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

/**
 * MesasQueFallan: repositorio de mesas que lanza error al ocupar o liberar,
 * para verificar que MesaService deshace la operación y lanza DependenciaError.
 */
class MesasQueFallan {
  constructor(cantidad = 10) {
    this._mesas = [];
    for (let i = 1; i <= cantidad; i++) {
      this._mesas.push({ id: `Mesa ${i}`, numero: i, estado: 'libre' });
    }
  }

  obtener(mesaId) {
    return this._mesas.find((m) => m.id === mesaId) || null;
  }

  ocupar() {
    throw new Error('Fallo simulado: no se puede ocupar la mesa');
  }

  liberar() {
    throw new Error('Fallo simulado: no se puede liberar la mesa');
  }

  listar() {
    return this._mesas.map((m) => ({ ...m }));
  }
}

module.exports = { NotificadorEspia, PedidosQueFallan, NotificadorCaido, MesasQueFallan };
