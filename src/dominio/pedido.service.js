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
  'Listo 🍽️': 'Recibido 📝'
};

class PedidoService {
  /**
   * @param {{ pedidos: object, mesas: object, notificador: object }} deps
   *   - pedidos:     repositorio de pedidos (obtener, guardar, eliminar)
   *   - mesas:       repositorio de mesas   (obtener, ocupar, liberar, listar)
   *   - notificador: gateway de tiempo real  (emitir)
   */
  constructor({ pedidos, mesas, notificador, menuItems = null }) {
    if (!pedidos) throw new Error('Dependencia requerida: pedidos');
    if (!mesas) throw new Error('Dependencia requerida: mesas');
    if (!notificador) throw new Error('Dependencia requerida: notificador');
    this.pedidos = pedidos;
    this.mesas = mesas;
    this.notificador = notificador;
    // Opcional: si se inyecta, los ítems de confirmarPedido se validan contra el menú
    this.menuItems = menuItems;
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
        error: 'Se esperaba un objeto con "mesa" y "estado".'
      };
    }

    const { mesa, estado } = datos;

    // Validar tipo de "mesa" (debe ser string)
    if (typeof mesa !== 'string') {
      return {
        ok: false,
        tipo: 'ENTRADA_INVALIDA',
        error: 'mesa no tiene un formato válido',
        esperado: '"Mesa N" con N entero positivo.'
      };
    }

    // Validar formato "Mesa N" con N entero positivo
    const match = mesa.match(/^Mesa (\d+)$/);
    if (!match || parseInt(match[1], 10) <= 0) {
      return {
        ok: false,
        tipo: 'ENTRADA_INVALIDA',
        error: 'mesa no tiene un formato válido',
        esperado: '"Mesa N" con N entero positivo.'
      };
    }

    // Validar que la mesa exista (el restaurante tiene un número fijo de mesas)
    if (!this.mesas.obtener(mesa)) {
      return {
        ok: false,
        tipo: 'NO_ENCONTRADO',
        error: `La ${mesa.toLowerCase()} no existe.`
      };
    }

    // Validar que el estado sea uno de los permitidos
    if (!ESTADOS_VALIDOS.includes(estado)) {
      return {
        ok: false,
        tipo: 'ENTRADA_INVALIDA',
        error: `estado "${estado}" no es válido`,
        esperado: ESTADOS_VALIDOS.join(', ')
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
        esperado: estadoEsperado
      };
    }

    // ── Procesamiento ───────────────────────────────────────────────

    // Guardar el nuevo estado del pedido
    // Se conservan los ítems ya acumulados en el pedido vigente (si los hay)
    this.pedidos.guardar(mesa, { ...(pedidoActual || {}), mesa, estado });

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

  /**
   * Valida y normaliza los ítems de un pedido: [{ id, cantidad }, ...].
   * Si hay repositorio de menú, toma nombre y precio del menú y rechaza
   * ítems inexistentes o agotados. Sin menú, usa nombre y precioBase recibidos.
   * @returns {{ ok: true, items: object[] } | { ok: false, tipo: string, error: string }}
   */
  _validarItems(items) {
    if (!Array.isArray(items) || items.length === 0) {
      return {
        ok: false,
        tipo: 'ENTRADA_INVALIDA',
        error: 'El pedido debe incluir al menos un producto.'
      };
    }

    const normalizados = [];
    for (const it of items) {
      if (!it || !Number.isInteger(it.cantidad) || it.cantidad <= 0) {
        return {
          ok: false,
          tipo: 'ENTRADA_INVALIDA',
          error: 'La cantidad de cada producto debe ser un entero mayor a 0.'
        };
      }

      if (this.menuItems) {
        const delMenu = this.menuItems.obtener(it.id);
        if (!delMenu) {
          return {
            ok: false,
            tipo: 'NO_ENCONTRADO',
            error: `El producto con id ${it.id} no existe en el menú.`
          };
        }
        if (!delMenu.disponible) {
          return {
            ok: false,
            tipo: 'ENTRADA_INVALIDA',
            error: `El producto "${delMenu.nombre}" está agotado.`
          };
        }
        normalizados.push({
          id: delMenu.id,
          nombre: delMenu.nombre,
          precioBase: delMenu.precioBase,
          cantidad: it.cantidad
        });
      } else {
        if (typeof it.nombre !== 'string' || !Number.isInteger(it.precioBase)) {
          return {
            ok: false,
            tipo: 'ENTRADA_INVALIDA',
            error: 'Cada producto debe tener nombre y precio válidos.'
          };
        }
        normalizados.push({
          id: it.id,
          nombre: it.nombre,
          precioBase: it.precioBase,
          cantidad: it.cantidad
        });
      }
    }
    return { ok: true, items: normalizados };
  }

  /**
   * Atajo de toma de pedido: registra los ítems en la mesa y los envía directo
   * a cocina (Recibido 📝 → En Cocina 🍳 en una sola operación).
   *
   * - Mesa sin pedido (o con uno a medias en "Recibido 📝"): lo lleva a cocina.
   * - Mesa que ya tiene un pedido "En Cocina 🍳": los ítems nuevos se SUMAN
   *   a lo acumulado (nueva ronda) y el estado no cambia.
   * - Los ítems repetidos se acumulan por id (las cantidades se suman).
   *
   * @param {{ mesa: any, items: Array<{ id, cantidad }> }} datos
   * @returns {{ ok: true, mesa: string, estado: string, items: object[], total: number }
   *          | { ok: false, tipo: string, error: string }}
   */
  confirmarPedido(datos) {
    if (!datos || typeof datos !== 'object') {
      return {
        ok: false,
        tipo: 'ENTRADA_INVALIDA',
        error: 'Se esperaba un objeto con "mesa" e "items".'
      };
    }

    const validos = this._validarItems(datos.items);
    if (!validos.ok) return validos;

    const pedidoActual = typeof datos.mesa === 'string' ? this.pedidos.obtener(datos.mesa) : null;

    if (pedidoActual && pedidoActual.estado === 'En Cocina 🍳') {
      // Nueva ronda: solo se acumulan los ítems, el estado no cambia
      this.pedidos.guardar(datos.mesa, {
        ...pedidoActual,
        items: this._acumular(pedidoActual.items, validos.items)
      });
      this.notificador.emitir('pedido_items_actualizado', { mesa: datos.mesa });
      return this._resumen(datos.mesa);
    }

    if (!pedidoActual || pedidoActual.estado !== 'Recibido 📝') {
      const recibido = this.actualizarEstado({ mesa: datos.mesa, estado: 'Recibido 📝' });
      if (!recibido.ok) return recibido;
    }

    // Registrar los ítems antes de pasar a cocina
    const vigente = this.pedidos.obtener(datos.mesa);
    this.pedidos.guardar(datos.mesa, {
      ...vigente,
      items: this._acumular(vigente.items, validos.items)
    });

    const enCocina = this.actualizarEstado({ mesa: datos.mesa, estado: 'En Cocina 🍳' });
    if (!enCocina.ok) return enCocina;

    this.notificador.emitir('pedido_items_actualizado', { mesa: datos.mesa });
    return this._resumen(datos.mesa);
  }

  /** Suma las cantidades de ítems nuevos a los existentes, agrupando por id. */
  _acumular(existentes = [], nuevos = []) {
    const resultado = existentes.map((i) => ({ ...i }));
    for (const n of nuevos) {
      const previo = resultado.find((i) => i.id === n.id);
      if (previo) previo.cantidad += n.cantidad;
      else resultado.push({ ...n });
    }
    return resultado;
  }

  _resumen(mesa) {
    const pedido = this.pedidos.obtener(mesa);
    const items = pedido.items || [];
    const total = items.reduce((suma, i) => suma + i.precioBase * i.cantidad, 0);
    return { ok: true, mesa, estado: pedido.estado, items, total };
  }

  /**
   * Resumen del pedido vigente de una mesa (ítems acumulados y total).
   * @param {string} mesa - Identificador "Mesa N"
   * @returns {{ ok: true, mesa: string, estado: string|null, items: object[], total: number }}
   */
  obtenerResumen(mesa) {
    if (!this.pedidos.obtener(mesa)) {
      return { ok: true, mesa, estado: null, items: [], total: 0 };
    }
    return this._resumen(mesa);
  }
}

module.exports = { PedidoService, ESTADOS_VALIDOS, TRANSICIONES };
