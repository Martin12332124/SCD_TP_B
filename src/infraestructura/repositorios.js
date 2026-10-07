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

module.exports = { PedidosEnMemoria, MesasEnMemoria };
