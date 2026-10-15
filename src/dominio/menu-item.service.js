// src/dominio/menu-item.service.js
// Servicio de dominio para registrar y editar ítems del menú (US-07).
// Dependencias explícitas inyectadas por constructor: menuItems, notificador.

const { verificarConsistenciaMenu } = require('./consistencia-menu');

/**
 * Precio máximo permitido en pesos chilenos (CLP).
 * Exportado como constante para facilitar su ajuste sin modificar la lógica.
 */
const PRECIO_MAXIMO = 1_000_000;

/**
 * MenuItemService
 *
 * Caso de uso US-07: "Como administrador del restaurante, quiero registrar
 * y editar el precio base de cada producto para que el POS calcule
 * correctamente el importe de los pedidos."
 *
 * Invariante del catálogo: todo ítem tiene nombre no vacío y precioBase
 * entero entre 1 y PRECIO_MAXIMO.
 *
 * Reglas de negocio:
 *   - crearItem: registra un ítem nuevo con nombre único y precio válido.
 *     `disponible` se fija en true al crear y no se modifica en esta HU.
 *   - editarItem: modifica nombre y/o precioBase de un ítem existente.
 *     No se permite editar `id` ni `disponible` en esta HU.
 *   - obtenerItem / listarItems: consultas de solo lectura.
 */
class MenuItemService {
  /**
   * @param {{ menuItems: object, notificador: object }} deps
   *   - menuItems:   repositorio de ítems del menú (obtener, buscarPorNombre, guardar, listar)
   *   - notificador: gateway de tiempo real (emitir)
   */
  constructor({ menuItems, notificador }) {
    if (!menuItems) throw new Error('Dependencia requerida: menuItems');
    if (!notificador) throw new Error('Dependencia requerida: notificador');
    this.menuItems = menuItems;
    this.notificador = notificador;
  }

  // ─── helpers privados ──────────────────────────────────────────────────────

  /**
   * Valida que el nombre sea un string no vacío de entre 1 y 60 caracteres (tras trim).
   * @param {*} nombre
   * @returns {{ ok: true, nombre: string } | { ok: false, tipo: string, error: string }}
   */
  _validarNombre(nombre) {
    if (typeof nombre !== 'string') {
      return {
        ok: false,
        tipo: 'ENTRADA_INVALIDA',
        error: 'El nombre es obligatorio y debe ser un texto.',
        esperado: 'String de 1 a 60 caracteres.'
      };
    }

    const limpio = nombre.trim();

    if (limpio.length === 0) {
      return {
        ok: false,
        tipo: 'ENTRADA_INVALIDA',
        error: 'El nombre no puede estar vacío o contener solo espacios.',
        esperado: 'String de 1 a 60 caracteres.'
      };
    }

    if (limpio.length > 60) {
      return {
        ok: false,
        tipo: 'ENTRADA_INVALIDA',
        error: `El nombre excede el máximo de 60 caracteres (se recibió ${limpio.length}).`,
        esperado: 'String de 1 a 60 caracteres.'
      };
    }

    return { ok: true, nombre: limpio };
  }

  /**
   * Valida que el precio sea un número entero entre 1 y PRECIO_MAXIMO.
   * Rechaza strings, null, boolean, NaN, Infinity y decimales.
   *
   * Mensajes por regla (CA2):
   *   - precio ausente → "El precio base es obligatorio."
   *   - no numérico    → "El precio base debe ser un número."
   *   - con decimales  → "El precio base debe ser un entero (pesos chilenos sin decimales)."
   *   - ≤ 0            → "El precio base debe ser mayor o igual a 1."
   *   - > máximo       → "El precio base no puede superar ..."
   *
   * @param {*} precioBase
   * @returns {{ ok: true, precioBase: number } | { ok: false, tipo: string, error: string, esperado: string }}
   */
  _validarPrecio(precioBase) {
    // ── Precio ausente o vacío ──
    if (precioBase === undefined || precioBase === null || precioBase === '') {
      return {
        ok: false,
        tipo: 'ENTRADA_INVALIDA',
        error: 'El precio base es obligatorio.',
        esperado: `Entero entre 1 y ${PRECIO_MAXIMO}.`
      };
    }

    // ── No numérico (string, boolean, objeto, NaN, Infinity) ──
    if (typeof precioBase !== 'number' || Number.isNaN(precioBase) || !Number.isFinite(precioBase)) {
      return {
        ok: false,
        tipo: 'ENTRADA_INVALIDA',
        error: 'El precio base debe ser un número.',
        esperado: `Entero entre 1 y ${PRECIO_MAXIMO}.`
      };
    }

    // ── Decimales (REF-16: pesos chilenos sin decimales) ──
    if (!Number.isInteger(precioBase)) {
      return {
        ok: false,
        tipo: 'ENTRADA_INVALIDA',
        error: 'El precio base debe ser un entero (pesos chilenos sin decimales).',
        esperado: `Entero entre 1 y ${PRECIO_MAXIMO}.`
      };
    }

    // ── Menor o igual a 0 ──
    if (precioBase <= 0) {
      return {
        ok: false,
        tipo: 'ENTRADA_INVALIDA',
        error: 'El precio base debe ser mayor o igual a 1.',
        esperado: `Entero entre 1 y ${PRECIO_MAXIMO}.`
      };
    }

    // ── Mayor al máximo ──
    if (precioBase > PRECIO_MAXIMO) {
      return {
        ok: false,
        tipo: 'ENTRADA_INVALIDA',
        error: `El precio base no puede superar ${PRECIO_MAXIMO} CLP.`,
        esperado: `Entero entre 1 y ${PRECIO_MAXIMO}.`
      };
    }

    return { ok: true, precioBase };
  }

  /**
   * Valida el parámetro :id de la URL con regex estricta.
   * Rechaza "1e1", "0x5", " 5", "1.5", "-1", "abc", "0".
   * @param {string} id
   * @returns {{ ok: true, id: number } | { ok: false, tipo: string, error: string }}
   */
  _validarId(id) {
    if (!/^[1-9]\d*$/.test(id)) {
      return {
        ok: false,
        tipo: 'ENTRADA_INVALIDA',
        error: `El id "${id}" no es válido. Debe ser un entero positivo.`,
        esperado: 'Entero positivo (ej. 1, 2, 3).'
      };
    }

    return { ok: true, id: Number(id) };
  }

  // ─── caso de uso: crear ítem (CA1) ─────────────────────────────────────────

  /**
   * Crea un nuevo ítem del menú con nombre y precio base.
   *
   * Precondiciones:
   *   1. nombre es un string no vacío de 1 a 60 caracteres (tras trim).
   *   2. precioBase es un entero entre 1 y PRECIO_MAXIMO.
   *   3. No existe otro ítem con el mismo nombre (sin distinguir mayúsculas ni espacios extremos).
   *
   * Postcondiciones:
   *   1. El ítem queda registrado con id autoincremental y disponible = true.
   *   2. Se emite 'menu_actualizado' con { accion: 'creado', item }.
   *   3. El invariante del catálogo se mantiene.
   *
   * @param {object} datos - { nombre: string, precioBase: number }
   * @returns {{ ok: true, item: object } | { ok: false, tipo: string, error: string }}
   */
  crearItem(datos) {
    // ── Validación de entrada ──────────────────────────────────────────
    if (!datos || typeof datos !== 'object') {
      return {
        ok: false,
        tipo: 'ENTRADA_INVALIDA',
        error: 'El cuerpo de la petición es obligatorio y debe ser un objeto JSON.'
      };
    }

    const validNombre = this._validarNombre(datos.nombre);
    if (!validNombre.ok) return validNombre;

    const validPrecio = this._validarPrecio(datos.precioBase);
    if (!validPrecio.ok) return validPrecio;

    // ── Regla de negocio: nombre duplicado ─────────────────────────────
    const existente = this.menuItems.buscarPorNombre(validNombre.nombre);
    if (existente) {
      return {
        ok: false,
        tipo: 'DUPLICADO',
        error: `Ya existe un ítem con el nombre "${existente.nombre}".`
      };
    }

    // ── Procesamiento ──────────────────────────────────────────────────
    const nuevoItem = {
      nombre: validNombre.nombre,
      precioBase: validPrecio.precioBase,
      disponible: true
    };

    const guardado = this.menuItems.guardar(nuevoItem);

    // ── Invariante (aserción interna) ──────────────────────────────────
    verificarConsistenciaMenu(this.menuItems, PRECIO_MAXIMO);

    // ── Notificación en tiempo real ────────────────────────────────────
    this.notificador.emitir('menu_actualizado', { accion: 'creado', item: guardado });

    return { ok: true, item: guardado };
  }

  // ─── caso de uso: editar ítem (CA3 / CA4) ──────────────────────────────────

  /**
   * Edita el nombre y/o precioBase de un ítem existente.
   *
   * Precondiciones:
   *   1. id es un entero positivo y el ítem existe (CA4: si no existe → NO_ENCONTRADO).
   *   2. Al menos un campo editable (nombre o precioBase) está presente.
   *   3. Si se envía nombre, cumple las mismas reglas que en crearItem.
   *   4. Si se envía precioBase, cumple las mismas reglas que en crearItem.
   *   5. Si se cambia el nombre, no debe duplicar el de OTRO ítem.
   *
   * Postcondiciones:
   *   1. El ítem queda actualizado con los nuevos valores.
   *   2. Se emite 'menu_actualizado' con { accion: 'editado', item }.
   *   3. El invariante del catálogo se mantiene.
   *
   * Nota: editar el precio solo afecta al catálogo; no modifica pedidos previos.
   *
   * @param {string} id - Id del ítem (viene como string desde la URL)
   * @param {object} datos - { nombre?: string, precioBase?: number }
   * @returns {{ ok: true, item: object } | { ok: false, tipo: string, error: string }}
   */
  editarItem(id, datos) {
    // ── Validación de id ───────────────────────────────────────────────
    const validId = this._validarId(id);
    if (!validId.ok) return validId;

    // ── Validación de body ─────────────────────────────────────────────
    if (!datos || typeof datos !== 'object') {
      return {
        ok: false,
        tipo: 'ENTRADA_INVALIDA',
        error: 'El cuerpo de la petición es obligatorio y debe ser un objeto JSON.'
      };
    }

    // ── Al menos un campo editable ─────────────────────────────────────
    const tieneNombre = datos.nombre !== undefined;
    const tienePrecio = datos.precioBase !== undefined;

    if (!tieneNombre && !tienePrecio) {
      return {
        ok: false,
        tipo: 'ENTRADA_INVALIDA',
        error: 'Debe enviar al menos un campo editable: nombre o precioBase.'
      };
    }

    // ── Validar campos proporcionados ──────────────────────────────────
    let nombreLimpio;
    if (tieneNombre) {
      const validNombre = this._validarNombre(datos.nombre);
      if (!validNombre.ok) return validNombre;
      nombreLimpio = validNombre.nombre;
    }

    if (tienePrecio) {
      const validPrecio = this._validarPrecio(datos.precioBase);
      if (!validPrecio.ok) return validPrecio;
    }

    // ── Validación de existencia (CA4) ─────────────────────────────────
    const item = this.menuItems.obtener(validId.id);
    if (!item) {
      return {
        ok: false,
        tipo: 'NO_ENCONTRADO',
        error: `No existe un ítem con id ${validId.id}.`
      };
    }

    // ── Nombre duplicado (solo si cambia y es de OTRO ítem) ────────────
    if (tieneNombre) {
      const existente = this.menuItems.buscarPorNombre(nombreLimpio);
      if (existente && existente.id !== validId.id) {
        return {
          ok: false,
          tipo: 'DUPLICADO',
          error: `Ya existe un ítem con el nombre "${existente.nombre}".`
        };
      }
    }

    // ── Procesamiento ──────────────────────────────────────────────────
    if (tieneNombre) item.nombre = nombreLimpio;
    if (tienePrecio) item.precioBase = datos.precioBase;

    const guardado = this.menuItems.guardar(item);

    // ── Invariante (aserción interna) ──────────────────────────────────
    verificarConsistenciaMenu(this.menuItems, PRECIO_MAXIMO);

    // ── Notificación en tiempo real ────────────────────────────────────
    this.notificador.emitir('menu_actualizado', { accion: 'editado', item: guardado });

    return { ok: true, item: guardado };
  }

  // ─── consultas de solo lectura ─────────────────────────────────────────────

  /**
   * Obtiene un ítem por id.
   * @param {string} id
   * @returns {{ ok: true, item: object } | { ok: false, tipo: string, error: string }}
   */
  obtenerItem(id) {
    const validId = this._validarId(id);
    if (!validId.ok) return validId;

    const item = this.menuItems.obtener(validId.id);
    if (!item) {
      return {
        ok: false,
        tipo: 'NO_ENCONTRADO',
        error: `No existe un ítem con id ${validId.id}.`
      };
    }

    return { ok: true, item };
  }

  /**
   * Lista todos los ítems del menú.
   * @returns {{ ok: true, items: object[] }}
   */
  listarItems() {
    return { ok: true, items: this.menuItems.listar() };
  }
}

module.exports = { MenuItemService, PRECIO_MAXIMO };
