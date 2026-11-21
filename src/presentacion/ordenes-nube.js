// src/presentacion/ordenes-nube.js
// Tercera puerta de entrada al dominio, junto a la API REST y Socket.IO: las órdenes
// que la web pública deja en el buzón de Supabase (tabla ordenes_pendientes).
//
// Igual que socket.handlers.js, este módulo solo traduce: toma { tipo, payload } y llama
// al MISMO servicio de dominio que usaría el POS local. Las reglas (mesa libre, ítem
// disponible, cantidad 1–99...) se validan ahí, una sola vez, en el servidor local.
// Una orden que el dominio rechaza queda 'rechazada' con su motivo.

/**
 * Tipos de orden aceptados y a qué caso de uso llaman.
 * El payload tiene la misma forma que el cuerpo REST o el mensaje Socket.IO equivalente.
 */
const TIPOS_DE_ORDEN = {
  abrir_mesa: (s, p) => s.mesaEstadoService.abrirMesa(p.numero),
  cerrar_mesa: (s, p) => s.mesaEstadoService.cerrarMesa(p.numero),
  agregar_mesa: (s, p) => s.mesaConfiguracionService.agregarMesa(p),
  quitar_mesa: (s, p) => s.mesaConfiguracionService.quitarMesa(p.numero),
  confirmar_pedido: (s, p) => s.pedidoService.confirmarPedido(p),
  actualizar_estado: (s, p) => s.pedidoService.actualizarEstado(p),
  trasladar_pedido: (s, p) => s.mesaService.trasladarPedido(p)
};

class AplicadorOrdenes {
  /**
   * @param {object} deps
   * @param {object} deps.servicios - pedidoService, mesaService, mesaEstadoService,
   *   mesaConfiguracionService (los mismos que usan REST y Socket.IO)
   * @param {object} deps.registro - RegistroOrdenesSQLite (obtener, guardar)
   */
  constructor({ servicios, registro }) {
    if (!servicios) throw new Error('Dependencia requerida: servicios');
    if (!registro) throw new Error('Dependencia requerida: registro');
    this._servicios = servicios;
    this._registro = registro;
  }

  /**
   * Aplica una orden de la nube y devuelve con qué estado hay que marcarla en Supabase.
   * Nunca lanza: un error interno también se registra, como 'rechazada', para que una
   * orden defectuosa no bloquee la cola reintentándose para siempre.
   *
   * @param {{ id: number, tipo: string, payload: object }} orden
   * @returns {{ estado: 'aplicada'|'rechazada', resultado: object }}
   */
  aplicar(orden) {
    // Ya se aplicó antes (se cortó internet antes de avisar a Supabase): no se repite.
    const previa = this._registro.obtener(orden.id);
    if (previa) return { estado: previa.estado, resultado: previa.resultado };

    try {
      return this.aplicarYRegistrar(orden);
    } catch (error) {
      const resultado = { ok: false, tipo: 'ERROR_INTERNO', error: error.message };
      this._registro.guardar(orden.id, 'rechazada', resultado);
      return { estado: 'rechazada', resultado };
    }
  }

  /**
   * Ejecuta el caso de uso y lo anota en el registro. app.js envuelve este método en una
   * transacción (envolverEnTransaccion): el caso de uso y su registro se guardan juntos o
   * no se guarda ninguno, y los eventos Socket.IO salen recién después del COMMIT.
   */
  aplicarYRegistrar(orden) {
    const resultado = this._ejecutar(orden);
    const estado = resultado && resultado.ok ? 'aplicada' : 'rechazada';
    this._registro.guardar(orden.id, estado, resultado);
    return { estado, resultado };
  }

  _ejecutar({ tipo, payload }) {
    const caso = Object.hasOwn(TIPOS_DE_ORDEN, tipo) ? TIPOS_DE_ORDEN[tipo] : null;
    if (!caso) {
      return {
        ok: false,
        tipo: 'ENTRADA_INVALIDA',
        error: `Tipo de orden desconocido: ${JSON.stringify(tipo)}.`,
        esperado: Object.keys(TIPOS_DE_ORDEN).join(', ')
      };
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return {
        ok: false,
        tipo: 'ENTRADA_INVALIDA',
        error: 'El payload de la orden debe ser un objeto JSON.'
      };
    }
    return caso(this._servicios, payload);
  }
}

module.exports = { AplicadorOrdenes, TIPOS_DE_ORDEN };
