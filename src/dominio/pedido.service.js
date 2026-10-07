// src/dominio/pedido.service.js
// Servicio de dominio para la gestión de pedidos.
// Dependencias explícitas inyectadas por constructor: pedidos, mesas, notificador.

const { verificarConsistenciaMesasPedidos } = require('./consistencia');

const ESTADOS_VALIDOS = ['Recibido 📝', 'En Cocina 🍳', 'Listo 🍽️'];

// Mapa de transiciones permitidas:
// null (sin pedido)  → "Recibido 📝"
// "Recibido 📝"      → "En Cocina 🍳"
// "En Cocina 🍳"     → "Listo 🍽️"
// "Listo 🍽️"        → "Recibido 📝" (nuevo ciclo)
const TRANSICIONES = {
  null: 'Recibido 📝',
  'Recibido 📝': 'En Cocina 🍳',
  'En Cocina 🍳': 'Listo 🍽️',
  'Listo 🍽️': 'Recibido 📝',
};

class PedidoService {
  /**
   * @param {{ pedidos: object, mesas: object, notificador: object }} deps
   *   - pedidos:     repositorio de pedidos (obtener, guardar, eliminar)
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
   * Actualiza el estado de un pedido para una mesa dada.
   *
   * Precondiciones:
   *   1. "datos" es un objeto con "mesa" de formato "Mesa N" (N entero positivo)
   *      y "estado" igual a Recibido 📝, En Cocina 🍳 o Listo 🍽️.
   *   2. La mesa N existe y la transición es válida desde el estado actual.
   *
   * Postcondiciones:
   *   1. El pedido de esa mesa queda en el estado pedido;
   *      si es Recibido, la mesa queda "ocupada".
   *   2. Todos los clientes reciben "cambio_estado_pedido" { mesa, estado }
   *      (y "estado_mesas" si se ocupó una mesa);
   *      quien llamó recibe { ok: true, mesa, estado }.
   *
   * Invariante: Una mesa ocupada tiene exactamente un pedido vigente
   *   y todo pedido vigente está sobre una mesa ocupada.
   *
   * @param {{ mesa: any, estado: any }} datos
   * @returns {{ ok: boolean, mesa: string, estado: string } | { ok: false, error: string, tipo: string, esperado?: string }}
   */
  actualizarEstado(datos) {
    // ── Validación defensiva de la entrada ──────────────────────────

    // Protección contra datos nulos / undefined / no-objeto
    if (!datos || typeof datos !== 'object') {
      return {
        ok: false,
        tipo: 'ENTRADA_INVALIDA',
        error: 'Se esperaba un objeto con "mesa" y "estado".',
      };
    }

    const { mesa, estado } = datos;

    // Validar tipo de "mesa" (debe ser string)
    if (typeof mesa !== 'string') {
      return {
        ok: false,
        tipo: 'ENTRADA_INVALIDA',
        error: 'mesa no tiene un formato válido',
        esperado: '"Mesa N" con N entero positivo.',
      };
    }

    // Validar formato "Mesa N" con N entero positivo
    const match = mesa.match(/^Mesa (\d+)$/);
    if (!match || parseInt(match[1], 10) <= 0) {
      return {
        ok: false,
        tipo: 'ENTRADA_INVALIDA',
        error: 'mesa no tiene un formato válido',
        esperado: '"Mesa N" con N entero positivo.',
      };
    }

    // Validar que el estado sea uno de los permitidos
    if (!ESTADOS_VALIDOS.includes(estado)) {
      return {
        ok: false,
        tipo: 'ENTRADA_INVALIDA',
        error: `estado "${estado}" no es válido`,
        esperado: ESTADOS_VALIDOS.join(', '),
      };
    }

    // ── Validación de transición de estado ──────────────────────────

    const pedidoActual = this.pedidos.obtener(mesa);
    const estadoActual = pedidoActual ? pedidoActual.estado : null;
    const estadoEsperado = TRANSICIONES[estadoActual];

    if (estado !== estadoEsperado) {
      return {
        ok: false,
        tipo: 'ESTADO_NO_PERMITIDO',
        error: `Transición no permitida: ${estadoActual || 'sin pedido'} → ${estado}`,
        esperado: estadoEsperado,
      };
    }

    // ── Procesamiento ───────────────────────────────────────────────

    // Guardar el nuevo estado del pedido
    this.pedidos.guardar(mesa, { mesa, estado });

    // Si el estado es "Recibido 📝", la mesa se ocupa
    let mesaCambio = false;
    if (estado === 'Recibido 📝') {
      this.mesas.ocupar(mesa);
      mesaCambio = true;
    }

    // Si el estado es "Listo 🍽️", se elimina el pedido vigente y se libera la mesa
    if (estado === 'Listo 🍽️') {
      this.pedidos.eliminar(mesa);
      this.mesas.liberar(mesa);
      mesaCambio = true;
    }

    // ── Invariante (aserción interna) ───────────────────────────────
    verificarConsistenciaMesasPedidos(this.pedidos, this.mesas);

    // ── Notificación en tiempo real ─────────────────────────────────
    this.notificador.emitir('cambio_estado_pedido', { mesa, estado });

    if (mesaCambio) {
      this.notificador.emitir('estado_mesas', this.mesas.listar());
    }

    return { ok: true, mesa, estado };
  }
}

module.exports = { PedidoService, ESTADOS_VALIDOS, TRANSICIONES };
