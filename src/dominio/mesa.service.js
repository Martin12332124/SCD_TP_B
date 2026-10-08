// src/dominio/mesa.service.js
// Servicio de dominio para el traslado de pedidos entre mesas (US-05).
// Dependencias explícitas inyectadas por constructor: pedidos, mesas, notificador.

const { verificarConsistenciaMesasPedidos } = require('./consistencia');

/**
 * Error específico para fallos de dependencias durante el traslado.
 * Conserva la causa original para facilitar el diagnóstico.
 */
class DependenciaError extends Error {
  constructor(mensaje, causa) {
    super(mensaje);
    this.name = 'DependenciaError';
    this.causa = causa;
  }
}

class MesaService {
  /**
   * @param {{ pedidos: object, mesas: object, notificador: object }} deps
   *   - pedidos:     repositorio de pedidos (obtener, guardar, eliminar, todos)
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

  /**
   * Traslada el pedido activo de una mesa a otra (US-05).
   *
   * Precondiciones:
   *   1. "origen" y "destino" son enteros positivos distintos y ambas mesas existen.
   *   2. La mesa de origen está "ocupada" con un pedido vigente;
   *      la mesa de destino está "libre" y sin pedido.
   *
   * Postcondiciones:
   *   1. El pedido pasa a la mesa destino con su mismo estado;
   *      origen queda "libre" y destino "ocupada";
   *      no se crea ni se pierde ningún pedido.
   *   2. Los clientes reciben "pedido_trasladado" { origen, destino, estado }
   *      y "estado_mesas"; quien llamó recibe { ok: true, origen, destino, estado }.
   *
   * Invariante: Mesa ocupada ⇔ exactamente un pedido vigente;
   *   el total de pedidos no cambia con el traslado.
   *
   * @param {{ origen: any, destino: any }} datos
   * @returns {{ ok: boolean, origen: string, destino: string, estado: string }
   *          | { ok: false, tipo: string, error: string, esperado?: string }}
   */
  trasladarPedido(datos) {
    // ── Validación defensiva de la entrada ──────────────────────────

    // Protección contra datos nulos / undefined / no-objeto
    if (!datos || typeof datos !== 'object') {
      return {
        ok: false,
        tipo: 'ENTRADA_INVALIDA',
        error: 'Se esperaba un objeto con "origen" y "destino".'
      };
    }

    const { origen, destino } = datos;

    // Validar que origen sea un entero positivo
    if (!Number.isInteger(origen) || origen <= 0) {
      return {
        ok: false,
        tipo: 'ENTRADA_INVALIDA',
        error: `"origen" debe ser un entero positivo. Se recibió: ${JSON.stringify(origen)}`,
        esperado: 'Entero positivo mayor a 0.'
      };
    }

    // Validar que destino sea un entero positivo
    if (!Number.isInteger(destino) || destino <= 0) {
      return {
        ok: false,
        tipo: 'ENTRADA_INVALIDA',
        error: `"destino" debe ser un entero positivo. Se recibió: ${JSON.stringify(destino)}`,
        esperado: 'Entero positivo mayor a 0.'
      };
    }

    // Validar que origen y destino sean distintos
    if (origen === destino) {
      return {
        ok: false,
        tipo: 'ENTRADA_INVALIDA',
        error: 'origen y destino deben ser mesas distintas.',
        esperado: 'Dos números de mesa diferentes.'
      };
    }

    const origenId = `Mesa ${origen}`;
    const destinoId = `Mesa ${destino}`;

    // ── Validación de existencia de mesas ───────────────────────────

    const mesaOrigen = this.mesas.obtener(origenId);
    if (!mesaOrigen) {
      return {
        ok: false,
        tipo: 'NO_ENCONTRADO',
        error: `La mesa ${origen} no existe.`
      };
    }

    const mesaDestino = this.mesas.obtener(destinoId);
    if (!mesaDestino) {
      return {
        ok: false,
        tipo: 'NO_ENCONTRADO',
        error: `La mesa ${destino} no existe.`
      };
    }

    // ── Validación de estado de mesas ───────────────────────────────

    const pedidoOrigen = this.pedidos.obtener(origenId);

    // La mesa de origen debe estar ocupada y tener un pedido vigente
    if (mesaOrigen.estado !== 'ocupada' || !pedidoOrigen) {
      return {
        ok: false,
        tipo: 'ESTADO_NO_PERMITIDO',
        error: `La mesa ${origen} no tiene un pedido que trasladar.`,
        esperado: 'Mesa de origen en estado "ocupada" con pedido vigente.'
      };
    }

    // La mesa de destino debe estar libre y sin pedido
    const pedidoDestino = this.pedidos.obtener(destinoId);
    if (mesaDestino.estado !== 'libre' || pedidoDestino) {
      return {
        ok: false,
        tipo: 'ESTADO_NO_PERMITIDO',
        error: `La mesa ${destino} no está disponible para recibir el traslado.`,
        esperado: 'Mesa de destino en estado "libre" y sin pedido vigente.'
      };
    }

    // ── Procesamiento con rollback ante fallo de dependencia ─────────

    let pedidoGuardadoEnDestino = false;
    let origenEliminado = false;

    try {
      // 1. Guardar el pedido en la mesa destino (con id actualizado)
      const pedidoTrasladado = { ...pedidoOrigen, mesa: destinoId };
      this.pedidos.guardar(destinoId, pedidoTrasladado);
      pedidoGuardadoEnDestino = true;

      // 2. Eliminar el pedido de la mesa origen
      this.pedidos.eliminar(origenId);
      origenEliminado = true;

      // 3. Actualizar estados de mesas
      this.mesas.liberar(origenId);
      this.mesas.ocupar(destinoId);
    } catch (causa) {
      // Rollback: deshacer lo que se alcanzó a hacer
      if (pedidoGuardadoEnDestino) {
        try {
          this.pedidos.eliminar(destinoId);
        } catch (_) {
          // Ignorar errores durante el rollback
        }
      }
      if (origenEliminado) {
        try {
          this.pedidos.guardar(origenId, pedidoOrigen);
        } catch (_) {
          // Ignorar errores durante el rollback
        }
      }
      throw new DependenciaError(
        `Fallo al trasladar pedido de mesa ${origen} a mesa ${destino}: ${causa.message}`,
        causa
      );
    }

    // ── Invariante (aserción interna) ────────────────────────────────
    verificarConsistenciaMesasPedidos(this.pedidos, this.mesas);

    // ── Notificación en tiempo real ──────────────────────────────────
    const estado = pedidoOrigen.estado;
    this.notificador.emitir('pedido_trasladado', { origen: origenId, destino: destinoId, estado });
    this.notificador.emitir('estado_mesas', this.mesas.listar());

    return { ok: true, origen: origenId, destino: destinoId, estado };
  }
}

module.exports = { MesaService, DependenciaError };
