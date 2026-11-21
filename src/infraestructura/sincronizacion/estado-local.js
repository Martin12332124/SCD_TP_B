// src/infraestructura/sincronizacion/estado-local.js
// Lee el estado completo de la base local para subirlo a la nube.
//
// Se lee directo de las tablas, y no a través de los repositorios, porque la nube es
// un espejo de la base: las columnas se llaman igual que en SQLite y en Supabase
// (mesa_id, precio_base...). Así la función SQL de Supabase recibe filas, no objetos
// del dominio, y no hay que traducir nombres en ningún lado.

/**
 * Devuelve las cuatro tablas espejo como arreglos de filas.
 * Se lee dentro de una transacción para que la foto sea consistente: si otra escritura
 * ocurriera a la mitad, podría subirse un pedido_item sin su pedido.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {{ mesas: object[], menu_items: object[], pedidos: object[], pedido_items: object[] }}
 */
function leerEstadoLocal(db) {
  return db.transaction(() => ({
    mesas: db.prepare('SELECT id, numero, estado FROM mesas ORDER BY numero').all(),
    menu_items: db
      .prepare('SELECT id, nombre, precio_base, disponible FROM menu_items ORDER BY id')
      .all()
      // SQLite guarda los booleanos como 0/1; Postgres tiene boolean de verdad.
      .map((fila) => ({ ...fila, disponible: fila.disponible === 1 })),
    pedidos: db.prepare('SELECT mesa_id, estado, estado_desde FROM pedidos ORDER BY mesa_id').all(),
    pedido_items: db
      .prepare(
        `SELECT mesa_id, posicion, item_id, nombre, precio_base, cantidad
         FROM pedido_items ORDER BY mesa_id, posicion`
      )
      .all()
  }))();
}

module.exports = { leerEstadoLocal };
