// src/dominio/mesa-configuracion.service.js
// Servicio de dominio para configurar las mesas del restaurante: agregar y quitar.
// Dependencias explícitas inyectadas por constructor: pedidos, mesas, notificador.

const { verificarConsistenciaMesasPedidos } = require('./consistencia');

/**
 * Número de mesa más alto permitido. El identificador de una mesa tiene la forma
 * "Mesa N"; acotar N evita números absurdos y mantiene ese formato legible.
 * Exportado como constante para poder ajustarlo sin tocar la lógica.
 */
const NUMERO_MESA_MAXIMO = 99;

/**
 * MesaConfiguracionService
 *
 * Caso de uso: el restaurante define cuántas mesas tiene y con qué números.
 *
 * Reglas de negocio:
 *   - agregarMesa: el número es un entero de 1 a NUMERO_MESA_MAXIMO y no puede repetirse.
 *     Si no se indica, se usa el siguiente al más alto que exista.
 *   - quitarMesa: solo se quita una mesa libre y sin pedido vigente, y nunca la última
 *     (el restaurante necesita al menos una mesa).
 *
 * Los cambios se avisan a todos los clientes con el evento 'estado_mesas'.
 */
class MesaConfiguracionService {
  /**
   * @param {{ pedidos: object, mesas: object, notificador: object }} deps
   *   - pedidos:     repositorio de pedidos (obtener, todos)
   *   - mesas:       repositorio de mesas   (obtener, listar, agregar, eliminar)
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
   * Agrega una mesa libre.
   *
   * Precondiciones:
   *   1. "datos" no se envía, o es un objeto. Si trae "numero", es un entero
   *      de 1 a NUMERO_MESA_MAXIMO.
   *   2. No existe otra mesa con ese número.
   *
   * Postcondiciones:
   *   1. La mesa queda registrada en estado 'libre'. Sin "numero" se usa el
   *      siguiente al más alto existente.
   *   2. Se emite 'estado_mesas' con la lista actualizada.
   *   3. Si se rechaza, no se crea ninguna mesa ni se emite nada.
   *
   * @param {{ numero?: number }} [datos]
   * @returns {{ ok: true, mesa: object } | { ok: false, tipo: string, error: string, esperado?: string }}
   */
  agregarMesa(datos) {
    if (datos !== undefined && datos !== null && typeof datos !== 'object') {
      return {
        ok: false,
        tipo: 'ENTRADA_INVALIDA',
        error: 'Se esperaba un objeto, opcionalmente con "numero".',
        esperado: `{ "numero": entero de 1 a ${NUMERO_MESA_MAXIMO} } o un cuerpo vacío.`
      };
    }

    const pedido = datos ? datos.numero : undefined;
    let numero;

    if (pedido === undefined || pedido === null) {
      // Sin número: la mesa se agrega "al final"
      const masAlto = this.mesas.listar().reduce((max, m) => Math.max(max, m.numero), 0);
      numero = masAlto + 1;
      if (numero > NUMERO_MESA_MAXIMO) {
        return {
          ok: false,
          tipo: 'LIMITE_ALCANZADO',
          error: `No quedan números después de la mesa ${NUMERO_MESA_MAXIMO}. Elige un número que esté libre.`,
          esperado: `Un "numero" libre entre 1 y ${NUMERO_MESA_MAXIMO}.`
        };
      }
    } else {
      if (!Number.isInteger(pedido) || pedido < 1 || pedido > NUMERO_MESA_MAXIMO) {
        return {
          ok: false,
          tipo: 'ENTRADA_INVALIDA',
          error: `"numero" debe ser un entero de 1 a ${NUMERO_MESA_MAXIMO}. Se recibió: ${JSON.stringify(pedido)}`,
          esperado: `Entero de 1 a ${NUMERO_MESA_MAXIMO}.`
        };
      }
      numero = pedido;
    }

    if (this.mesas.obtener(`Mesa ${numero}`)) {
      return {
        ok: false,
        tipo: 'DUPLICADO',
        error: `La mesa ${numero} ya existe.`
      };
    }

    // ── Procesamiento ──────────────────────────────────────────────────
    const mesa = this.mesas.agregar(numero);

    // ── Notificación en tiempo real ────────────────────────────────────
    this.notificador.emitir('estado_mesas', this.mesas.listar());

    return { ok: true, mesa };
  }

  /**
   * Quita una mesa del restaurante.
   *
   * Precondiciones:
   *   1. "numero" es un entero positivo y la mesa existe.
   *   2. La mesa está 'libre' y no tiene un pedido vigente.
   *   3. No es la única mesa registrada.
   *
   * Postcondiciones:
   *   1. La mesa deja de existir.
   *   2. Se emite 'estado_mesas' con la lista actualizada.
   *   3. Si se rechaza, no se modifica nada ni se emite nada.
   *
   * @param {string|number} numero - Número de mesa (llega como string desde la URL)
   * @returns {{ ok: true, mesa: string } | { ok: false, tipo: string, error: string, esperado?: string }}
   */
  quitarMesa(numero) {
    // Solo dígitos, sin ceros a la izquierda ni signos: rechaza "1e1", "1.5", "-1" y "0".
    if (!/^[1-9]\d*$/.test(String(numero))) {
      return {
        ok: false,
        tipo: 'ENTRADA_INVALIDA',
        error: `"numero" debe ser un entero positivo. Se recibió: ${JSON.stringify(numero)}`,
        esperado: 'Entero positivo mayor a 0.'
      };
    }

    const n = Number(numero);
    const mesaId = `Mesa ${n}`;

    const mesa = this.mesas.obtener(mesaId);
    if (!mesa) {
      return {
        ok: false,
        tipo: 'NO_ENCONTRADO',
        error: `La mesa ${n} no existe.`
      };
    }

    if (mesa.estado === 'ocupada') {
      return {
        ok: false,
        tipo: 'ESTADO_NO_PERMITIDO',
        error: `La mesa ${n} está ocupada. Libérala antes de quitarla.`,
        esperado: 'Mesa en estado "libre".'
      };
    }

    const pedidoVigente = this.pedidos.obtener(mesaId);
    if (pedidoVigente) {
      return {
        ok: false,
        tipo: 'PEDIDO_ACTIVO',
        error: `La mesa ${n} tiene un pedido activo (estado: "${pedidoVigente.estado}"). No se puede quitar.`,
        esperado: 'Mesa sin pedido vigente.'
      };
    }

    if (this.mesas.listar().length <= 1) {
      return {
        ok: false,
        tipo: 'ESTADO_NO_PERMITIDO',
        error: 'No se puede quitar la última mesa: el restaurante necesita al menos una.',
        esperado: 'Al menos dos mesas registradas.'
      };
    }

    // ── Procesamiento ──────────────────────────────────────────────────
    this.mesas.eliminar(mesaId);

    // ── Invariante (aserción interna) ──────────────────────────────────
    verificarConsistenciaMesasPedidos(this.pedidos, this.mesas);

    // ── Notificación en tiempo real ────────────────────────────────────
    this.notificador.emitir('estado_mesas', this.mesas.listar());

    return { ok: true, mesa: mesaId };
  }
}

module.exports = { MesaConfiguracionService, NUMERO_MESA_MAXIMO };
