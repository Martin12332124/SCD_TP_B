// src/dominio/mesa-estado.service.js
// Servicio de dominio para abrir y cerrar mesas (US-09).
// Dependencias explícitas inyectadas por constructor: pedidos, mesas, notificador.

const { verificarConsistenciaMesasPedidos } = require('./consistencia');

/**
 * MesaEstadoService
 *
 * Caso de uso US-09: "Como mesero, quiero cambiar el estado de una mesa entre
 * 'Libre' y 'Ocupada', para mostrar cuándo llegan o se retiran clientes."
 *
 * Invariante: una mesa ocupada tiene exactamente un pedido vigente;
 * una mesa libre no tiene ningún pedido vigente.
 *
 * Reglas de negocio:
 *   - abrirMesa: solo puede abrirse una mesa que esté libre.
 *     Al abrir se marca como 'ocupada' y se emite el evento 'estado_mesas'.
 *   - cerrarMesa: solo puede cerrarse una mesa que esté ocupada y SIN pedido
 *     activo pendiente (es decir, ya sin pedido vigente en el repositorio).
 *     Al cerrar se marca como 'libre' y se emite el evento 'estado_mesas'.
 */
class MesaEstadoService {
  /**
   * @param {{ pedidos: object, mesas: object, notificador: object }} deps
   *   - pedidos:     repositorio de pedidos (obtener, todos)
   *   - mesas:       repositorio de mesas   (obtener, ocupar, liberar, listar)
   *   - notificador: gateway de tiempo real  (emitir)
   */
  constructor({ pedidos, mesas, notificador }) {
    if (!pedidos) throw new Error('Dependencia requerida: pedidos');
    if (!mesas) throw new Error('Dependencia requerida: mesas');
    if (!notificador) throw new Error('Dependencia requerida: notificador');
    this.pedidos = pedidos;
    this.mesas = mesas;
    this.notificador = notificador;
  }

  // ─── helpers privados ──────────────────────────────────────────────────────

  /**
   * Valida que el número de mesa sea un entero entre 1 y 10.
   * Devuelve { ok: true, mesaId } o { ok: false, tipo, error }.
   *
   * Valores límite probados en Thunder Client:
   *   - numero = 0   → ENTRADA_INVALIDA
   *   - numero = 1   → válido (primera mesa)
   *   - numero = 10  → válido (última mesa)
   *   - numero = 11  → NO_ENCONTRADO
   *   - numero = -1  → ENTRADA_INVALIDA
   *   - numero = "abc" → ENTRADA_INVALIDA
   *   - numero = 1.5  → ENTRADA_INVALIDA
   */
  _validarNumero(numero) {
    // El parámetro llega como string desde la URL. Se exige solo dígitos, sin ceros
    // a la izquierda ni signos: rechaza "1e1", "0x5", " 5", "1.5", "-1" y "0".
    if (!/^[1-9]\d*$/.test(String(numero))) {
      return {
        ok: false,
        tipo: 'ENTRADA_INVALIDA',
        error: `"numero" debe ser un entero positivo. Se recibió: ${JSON.stringify(numero)}`,
        esperado: 'Entero positivo mayor a 0 (ej. 1–10).'
      };
    }

    // Ya validado el formato, la conversión a número es segura.
    const parsed = Number(numero);

    return { ok: true, mesaId: `Mesa ${parsed}`, numero: parsed };
  }

  // ─── caso de uso: abrir mesa ───────────────────────────────────────────────

  /**
   * Abre (marca como 'ocupada') una mesa que está 'libre'.
   *
   * Precondiciones:
   *   1. numero es un entero positivo y la mesa existe.
   *   2. La mesa está en estado 'libre'.
   *
   * Postcondiciones:
   *   1. La mesa queda en estado 'ocupada'.
   *   2. Se emite 'estado_mesas' con la lista actualizada.
   *   3. El invariante se mantiene (mesa ocupada sin pedido es permitido
   *      porque el pedido se creará a continuación vía Socket.io).
   *
   * @param {string|number} numero - Número de mesa (viene como string desde la URL)
   * @returns {{ ok: boolean, mesa: string, estado: string } | { ok: false, tipo: string, error: string }}
   */
  abrirMesa(numero) {
    // ── Validación de entrada ──────────────────────────────────────────
    const validacion = this._validarNumero(numero);
    if (!validacion.ok) return validacion;

    const { mesaId } = validacion;

    // ── Validación de existencia ───────────────────────────────────────
    const mesa = this.mesas.obtener(mesaId);
    if (!mesa) {
      return {
        ok: false,
        tipo: 'NO_ENCONTRADO',
        error: `La mesa ${numero} no existe.`
      };
    }

    // ── Validación de estado actual ────────────────────────────────────
    if (mesa.estado === 'ocupada') {
      return {
        ok: false,
        tipo: 'ESTADO_NO_PERMITIDO',
        error: `La mesa ${numero} ya está ocupada. No se puede abrir dos veces.`,
        esperado: 'Mesa en estado "libre".'
      };
    }

    // ── Procesamiento ──────────────────────────────────────────────────
    this.mesas.ocupar(mesaId);

    // ── Notificación en tiempo real ────────────────────────────────────
    this.notificador.emitir('estado_mesas', this.mesas.listar());

    return { ok: true, mesa: mesaId, estado: 'ocupada' };
  }

  // ─── caso de uso: cerrar mesa ──────────────────────────────────────────────

  /**
   * Cierra (marca como 'libre') una mesa que está 'ocupada' y sin pedido activo.
   *
   * Precondiciones:
   *   1. numero es un entero positivo y la mesa existe.
   *   2. La mesa está en estado 'ocupada'.
   *   3. No existe un pedido vigente asociado a la mesa (el pedido fue servido/
   *      eliminado previamente por PedidoService antes de cerrar la mesa).
   *
   * Postcondiciones:
   *   1. La mesa queda en estado 'libre'.
   *   2. Se emite 'estado_mesas' con la lista actualizada.
   *
   * @param {string|number} numero
   * @returns {{ ok: boolean, mesa: string, estado: string } | { ok: false, tipo: string, error: string }}
   */
  cerrarMesa(numero) {
    // ── Validación de entrada ──────────────────────────────────────────
    const validacion = this._validarNumero(numero);
    if (!validacion.ok) return validacion;

    const { mesaId } = validacion;

    // ── Validación de existencia ───────────────────────────────────────
    const mesa = this.mesas.obtener(mesaId);
    if (!mesa) {
      return {
        ok: false,
        tipo: 'NO_ENCONTRADO',
        error: `La mesa ${numero} no existe.`
      };
    }

    // ── Validación de estado actual ────────────────────────────────────
    if (mesa.estado === 'libre') {
      return {
        ok: false,
        tipo: 'ESTADO_NO_PERMITIDO',
        error: `La mesa ${numero} ya está libre. No se puede cerrar una mesa que no está abierta.`,
        esperado: 'Mesa en estado "ocupada".'
      };
    }

    // ── Regla de negocio: no cerrar con pedido activo ──────────────────
    const pedidoVigente = this.pedidos.obtener(mesaId);
    if (pedidoVigente) {
      return {
        ok: false,
        tipo: 'PEDIDO_ACTIVO',
        error: `La mesa ${numero} tiene un pedido activo (estado: "${pedidoVigente.estado}"). Debe servirse antes de cerrar la mesa.`,
        esperado: 'Mesa sin pedido vigente.'
      };
    }

    // ── Procesamiento ──────────────────────────────────────────────────
    this.mesas.liberar(mesaId);

    // ── Invariante (aserción interna) ──────────────────────────────────
    verificarConsistenciaMesasPedidos(this.pedidos, this.mesas);

    // ── Notificación en tiempo real ────────────────────────────────────
    this.notificador.emitir('estado_mesas', this.mesas.listar());

    return { ok: true, mesa: mesaId, estado: 'libre' };
  }
}

module.exports = { MesaEstadoService };
