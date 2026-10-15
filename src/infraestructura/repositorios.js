// src/infraestructura/repositorios.js
// Repositorios en memoria para pedidos y mesas.
// Implementación de producción usada por el servidor real.

/**
 * Repositorio de pedidos en memoria.
 * Almacena pedidos vigentes indexados por identificador de mesa (e.g. "Mesa 3").
 */
class PedidosEnMemoria {
  constructor() {
    this._pedidos = {};
  }

  obtener(mesa) {
    return this._pedidos[mesa] || null;
  }

  guardar(mesa, pedido) {
    this._pedidos[mesa] = pedido;
  }

  eliminar(mesa) {
    delete this._pedidos[mesa];
  }

  todos() {
    return { ...this._pedidos };
  }
}

/**
 * Repositorio de mesas en memoria.
 * Por defecto crea 10 mesas, todas en estado "libre".
 */
class MesasEnMemoria {
  constructor(cantidad = 10) {
    this._mesas = [];
    for (let i = 1; i <= cantidad; i++) {
      this._mesas.push({ id: `Mesa ${i}`, numero: i, estado: 'libre' });
    }
  }

  obtener(mesaId) {
    return this._mesas.find((m) => m.id === mesaId) || null;
  }

  ocupar(mesaId) {
    const mesa = this._mesas.find((m) => m.id === mesaId);
    if (mesa) mesa.estado = 'ocupada';
  }

  liberar(mesaId) {
    const mesa = this._mesas.find((m) => m.id === mesaId);
    if (mesa) mesa.estado = 'libre';
  }

  listar() {
    return this._mesas.map((m) => ({ ...m }));
  }
}

/**
 * Repositorio de ítems del menú en memoria.
 * Almacena ítems con id autoincremental, nombre, precioBase y disponible.
 * Acepta una semilla opcional para inicializar con datos de producción o test.
 */
class MenuItemsEnMemoria {
  constructor(semilla = []) {
    this._items = new Map();
    this._siguienteId = 1;

    for (const item of semilla) {
      this._items.set(item.id, { ...item });
      if (item.id >= this._siguienteId) {
        this._siguienteId = item.id + 1;
      }
    }
  }

  obtener(id) {
    return this._items.get(id) ? { ...this._items.get(id) } : null;
  }

  /**
   * Busca un ítem por nombre (sin distinción de mayúsculas ni espacios extremos).
   * @param {string} nombre
   * @returns {object|null}
   */
  buscarPorNombre(nombre) {
    const normalizado = nombre.trim().toLowerCase();
    for (const item of this._items.values()) {
      if (item.nombre.trim().toLowerCase() === normalizado) {
        return { ...item };
      }
    }
    return null;
  }

  /**
   * Guarda un ítem. Si no tiene id, asigna uno autoincremental.
   * @param {object} item
   * @returns {object} El ítem guardado (con id asignado si era nuevo).
   */
  guardar(item) {
    if (!item.id) {
      item.id = this._siguienteId++;
    }
    this._items.set(item.id, { ...item });
    return { ...item };
  }

  listar() {
    return Array.from(this._items.values()).map((item) => ({ ...item }));
  }
}

module.exports = { PedidosEnMemoria, MesasEnMemoria, MenuItemsEnMemoria };
