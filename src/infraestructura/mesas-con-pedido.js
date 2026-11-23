// src/infraestructura/mesas-con-pedido.js
// Decorador del repositorio de mesas: a cada mesa que devuelve le agrega el
// estado de su pedido vigente, en el campo `estadoPedido`
// ("Recibido 📝", "En Cocina 🍳", "Listo 🍽️" o null si no tiene pedido), y la hora
// en que el pedido pasó a ese estado, en `pedidoDesde` (ISO 8601, o null si no se sabe).
//
// Para qué: el mapa de mesas del frontend muestra en qué va el pedido de cada mesa.
// Sin este campo tendría que pedir el pedido de cada mesa por separado.
//
// Por qué un decorador: los servicios emiten 'estado_mesas' con mesas.listar().
// Al inyectarles este objeto en vez del repositorio directo, el campo viaja en
// la API REST y en el evento sin modificar los servicios ni los repositorios.
// Funciona igual sobre el repositorio en memoria y sobre el de SQLite.

class MesasConEstadoPedido {
  /**
   * @param {object} mesas   - Repositorio de mesas (obtener, listar, ocupar, liberar, agregar, eliminar)
   * @param {object} pedidos - Repositorio de pedidos (obtener, todos)
   */
  constructor(mesas, pedidos) {
    if (!mesas) throw new Error('Dependencia requerida: mesas');
    if (!pedidos) throw new Error('Dependencia requerida: pedidos');
    this._mesas = mesas;
    this._pedidos = pedidos;
  }

  /** Copia de la mesa con el estado de su pedido y desde cuándo (null si no tiene). */
  _conPedido(mesa, pedido) {
    return {
      ...mesa,
      estadoPedido: pedido ? pedido.estado : null,
      pedidoDesde: (pedido && pedido.estadoDesde) || null
    };
  }

  obtener(mesaId) {
    const mesa = this._mesas.obtener(mesaId);
    return mesa ? this._conPedido(mesa, this._pedidos.obtener(mesaId)) : null;
  }

  listar() {
    const pedidos = this._pedidos.todos();
    return this._mesas.listar().map((mesa) => this._conPedido(mesa, pedidos[mesa.id]));
  }

  ocupar(mesaId) {
    this._mesas.ocupar(mesaId);
  }

  liberar(mesaId) {
    this._mesas.liberar(mesaId);
  }

  agregar(numero) {
    return this._conPedido(this._mesas.agregar(numero), null);
  }

  eliminar(mesaId) {
    this._mesas.eliminar(mesaId);
  }
}

module.exports = { MesasConEstadoPedido };
