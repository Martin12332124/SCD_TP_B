// src/presentacion/ordenes-nube.js
// Tercera puerta de entrada al dominio, junto a la API REST y Socket.IO: las órdenes
// que la web pública deja en el buzón de Supabase (tabla ordenes_pendientes).
//
// Igual que socket.handlers.js, este módulo solo traduce: toma { tipo, payload } y llama
// al MISMO servicio de dominio que usaría el POS local. Las reglas (mesa libre, ítem
// disponible, cantidad 1–99...) se validan ahí, una sola vez, en el servidor local.
// Una orden que el dominio rechaza queda 'rechazada' con su motivo.
//
// Las órdenes VENCEN. Decisión de negocio: con el local desconectado la web ya no deja
// órdenes (se lo avisa al usuario), pero si una llegara igual y esperara horas, aplicarla
// después generaría conflictos (la mesa ya cambió, el cliente se fue...). Una orden que
// esperó más de VENCIMIENTO_ORDEN_MS se rechaza con tipo ORDEN_VENCIDA y NO se aplica.
//
// Invariante con la web: su espera máxima (ESPERA_RESULTADO_MS en SCD_TP_F/src/servicios/
// nube.js) debe ser MAYOR que este vencimiento, con margen. Así, cuando la web dice "el
// cambio no se aplicó", el local ya no puede aplicar esa orden. Si cambias uno, cambia el otro.
//
// La edad la mide la base de Supabase (ver supabase/esquema.sql, ordenes_pendientes_con_edad),
// no el reloj de este PC. Entre que se lee el lote y se aplica cada orden pasa tiempo (el
// aviso de la anterior a Supabase puede tardar), y ese tiempo se mide con un reloj monótono
// (solo avanza, no depende de la hora del sistema). Se suma a la edad leída: la estimación
// nunca queda por debajo de la edad real, o sea, en caso de duda se rechaza.

const VENCIMIENTO_ORDEN_MS = 10000;

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
   * @param {number} [deps.vencimientoMs] - edad máxima con la que se aplica una orden
   * @param {() => number} [deps.relojMonotono] - ms que solo avanzan; mismo reloj que usa el
   *   cliente de Supabase para `leidaEn`
   */
  constructor({
    servicios,
    registro,
    vencimientoMs = VENCIMIENTO_ORDEN_MS,
    relojMonotono = () => performance.now()
  }) {
    if (!servicios) throw new Error('Dependencia requerida: servicios');
    if (!registro) throw new Error('Dependencia requerida: registro');
    this._servicios = servicios;
    this._registro = registro;
    this._vencimientoMs = vencimientoMs;
    this._relojMonotono = relojMonotono;
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
      // Después de consultar el registro: una orden aplicada a tiempo cuyo aviso se perdió
      // debe reenviarse como aplicada, aunque al reintentar ya sea "vieja".
      if (this._estaVencida(orden)) return this._rechazarVencida(orden);
      return this.aplicarYRegistrar(orden);
    } catch (error) {
      const resultado = { ok: false, tipo: 'ERROR_INTERNO', error: error.message };
      this._registro.guardar(orden.id, 'rechazada', resultado);
      return { estado: 'rechazada', resultado };
    }
  }

  /**
   * Edad estimada ≥ vencimiento. Sin `edadMs` (no la midió la base) no se puede juzgar y no
   * se rechaza: solo el cliente real de Supabase la entrega, y siempre lo hace.
   */
  _estaVencida({ edadMs, leidaEn }) {
    if (!Number.isFinite(edadMs)) return false;
    const transcurrido = Number.isFinite(leidaEn) ? this._relojMonotono() - leidaEn : 0;
    return edadMs + transcurrido >= this._vencimientoMs;
  }

  _rechazarVencida(orden) {
    const resultado = {
      ok: false,
      tipo: 'ORDEN_VENCIDA',
      error:
        `La orden esperó más de ${this._vencimientoMs / 1000} s al sistema del restaurante ` +
        'y se descartó sin aplicarse. Repite la acción si todavía la necesitas.'
    };
    this._registro.guardar(orden.id, 'rechazada', resultado);
    return { estado: 'rechazada', resultado };
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

module.exports = { AplicadorOrdenes, TIPOS_DE_ORDEN, VENCIMIENTO_ORDEN_MS };
