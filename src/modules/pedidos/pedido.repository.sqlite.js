// Repositorio SQLite del módulo de pedidos.

/**
 * Repositorio de pedidos vigentes, indexados por mesa (ej. "Mesa 3").
 * Un pedido es { mesa, estado, estadoDesde?, items? }; items se guarda en la tabla
 * pedido_items. estadoDesde (hora del último cambio de estado) solo aparece si se guardó.
 */
class PedidosSQLite {
  /** @param {import('better-sqlite3').Database} db */
  constructor(db) {
    this._db = db;
    this._sql = {
      obtener: db.prepare('SELECT mesa_id, estado, estado_desde FROM pedidos WHERE mesa_id = ?'),
      todos: db.prepare('SELECT mesa_id, estado, estado_desde FROM pedidos ORDER BY mesa_id'),
      items: db.prepare(
        `SELECT item_id AS id, nombre, precio_base AS precioBase, cantidad
         FROM pedido_items WHERE mesa_id = ? ORDER BY posicion`
      ),
      upsert: db.prepare(
        `INSERT INTO pedidos (mesa_id, estado, estado_desde) VALUES (?, ?, ?)
         ON CONFLICT (mesa_id) DO UPDATE SET
           estado = excluded.estado,
           estado_desde = excluded.estado_desde`
      ),
      borrarItems: db.prepare('DELETE FROM pedido_items WHERE mesa_id = ?'),
      insertarItem: db.prepare(
        `INSERT INTO pedido_items (mesa_id, posicion, item_id, nombre, precio_base, cantidad)
         VALUES (?, ?, ?, ?, ?, ?)`
      ),
      eliminar: db.prepare('DELETE FROM pedidos WHERE mesa_id = ?')
    };

    this._guardar = db.transaction((mesa, pedido) => {
      this._sql.upsert.run(mesa, pedido.estado, pedido.estadoDesde ?? null);
      this._sql.borrarItems.run(mesa);
      (pedido.items || []).forEach((item, posicion) => {
        this._sql.insertarItem.run(
          mesa,
          posicion,
          item.id,
          item.nombre,
          item.precioBase,
          item.cantidad
        );
      });
    });
  }

  _armar(fila) {
    const pedido = { mesa: fila.mesa_id, estado: fila.estado };
    if (fila.estado_desde) pedido.estadoDesde = fila.estado_desde;
    const items = this._sql.items.all(fila.mesa_id);
    if (items.length > 0) pedido.items = items;
    return pedido;
  }

  obtener(mesa) {
    const fila = this._sql.obtener.get(mesa);
    return fila ? this._armar(fila) : null;
  }

  guardar(mesa, pedido) {
    this._guardar(mesa, pedido);
  }

  eliminar(mesa) {
    this._sql.eliminar.run(mesa);
  }

  todos() {
    const resultado = {};
    for (const fila of this._sql.todos.all()) {
      resultado[fila.mesa_id] = this._armar(fila);
    }
    return resultado;
  }
}

module.exports = { PedidosSQLite };
