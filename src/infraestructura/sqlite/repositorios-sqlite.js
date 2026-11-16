// src/infraestructura/sqlite/repositorios-sqlite.js
// Repositorios respaldados por SQLite (better-sqlite3, síncrono).
// Mismos métodos, parámetros y valores de retorno que los de repositorios.js,
// para que los servicios del dominio no cambien. Cada lectura devuelve un objeto
// nuevo (copia defensiva): modificarlo no altera la base.
// Todas las consultas son preparadas con parámetros (nada de SQL concatenado).

/**
 * Repositorio de pedidos vigentes, indexados por mesa (ej. "Mesa 3").
 * Un pedido es { mesa, estado, items? }; items se guarda en la tabla pedido_items.
 */
class PedidosSQLite {
  /** @param {import('better-sqlite3').Database} db */
  constructor(db) {
    this._db = db;
    this._sql = {
      obtener: db.prepare('SELECT mesa_id, estado FROM pedidos WHERE mesa_id = ?'),
      todos: db.prepare('SELECT mesa_id, estado FROM pedidos ORDER BY mesa_id'),
      items: db.prepare(
        `SELECT item_id AS id, nombre, precio_base AS precioBase, cantidad
         FROM pedido_items WHERE mesa_id = ? ORDER BY posicion`
      ),
      upsert: db.prepare(
        `INSERT INTO pedidos (mesa_id, estado) VALUES (?, ?)
         ON CONFLICT (mesa_id) DO UPDATE SET estado = excluded.estado`
      ),
      borrarItems: db.prepare('DELETE FROM pedido_items WHERE mesa_id = ?'),
      insertarItem: db.prepare(
        `INSERT INTO pedido_items (mesa_id, posicion, item_id, nombre, precio_base, cantidad)
         VALUES (?, ?, ?, ?, ?, ?)`
      ),
      eliminar: db.prepare('DELETE FROM pedidos WHERE mesa_id = ?')
    };

    // Guardar toca dos tablas: se hace en una transacción para que no quede a medias.
    this._guardar = db.transaction((mesa, pedido) => {
      this._sql.upsert.run(mesa, pedido.estado);
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

  /** Arma el objeto pedido. Sin ítems no incluye la propiedad items (igual que en memoria). */
  _armar(fila) {
    const pedido = { mesa: fila.mesa_id, estado: fila.estado };
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
    // Los ítems se borran solos por ON DELETE CASCADE.
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

/**
 * Repositorio de mesas. Al construirse asegura que existan las mesas 1..cantidad,
 * sin tocar el estado de las que ya estaban (un reinicio no libera mesas ocupadas).
 */
class MesasSQLite {
  /**
   * @param {import('better-sqlite3').Database} db
   * @param {number} [cantidad=10]
   */
  constructor(db, cantidad = 10) {
    this._sql = {
      sembrar: db.prepare(
        "INSERT OR IGNORE INTO mesas (id, numero, estado) VALUES (?, ?, 'libre')"
      ),
      obtener: db.prepare('SELECT id, numero, estado FROM mesas WHERE id = ?'),
      cambiarEstado: db.prepare('UPDATE mesas SET estado = ? WHERE id = ?'),
      listar: db.prepare('SELECT id, numero, estado FROM mesas ORDER BY numero')
    };

    db.transaction(() => {
      for (let i = 1; i <= cantidad; i++) {
        this._sql.sembrar.run(`Mesa ${i}`, i);
      }
    })();
  }

  obtener(mesaId) {
    return this._sql.obtener.get(mesaId) || null;
  }

  ocupar(mesaId) {
    this._sql.cambiarEstado.run('ocupada', mesaId);
  }

  liberar(mesaId) {
    this._sql.cambiarEstado.run('libre', mesaId);
  }

  listar() {
    return this._sql.listar.all();
  }
}

/**
 * Repositorio de ítems del menú. La semilla solo se inserta si la tabla está vacía:
 * el menú es dato del administrador y un reinicio no debe pisar sus cambios.
 */
class MenuItemsSQLite {
  /**
   * @param {import('better-sqlite3').Database} db
   * @param {object[]} [semilla=[]]
   */
  constructor(db, semilla = []) {
    const columnas = 'id, nombre, precio_base AS precioBase, disponible';
    this._sql = {
      contar: db.prepare('SELECT COUNT(*) AS n FROM menu_items'),
      obtener: db.prepare(`SELECT ${columnas} FROM menu_items WHERE id = ?`),
      listar: db.prepare(`SELECT ${columnas} FROM menu_items ORDER BY id`),
      insertar: db.prepare(
        'INSERT INTO menu_items (nombre, precio_base, disponible) VALUES (?, ?, ?)'
      ),
      upsert: db.prepare(
        `INSERT INTO menu_items (id, nombre, precio_base, disponible) VALUES (?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           nombre = excluded.nombre,
           precio_base = excluded.precio_base,
           disponible = excluded.disponible`
      )
    };

    if (this._sql.contar.get().n === 0) {
      db.transaction(() => {
        for (const item of semilla) this.guardar({ ...item });
      })();
    }
  }

  /** Convierte la fila a objeto del dominio (disponible 0/1 → boolean). */
  _armar(fila) {
    return { ...fila, disponible: fila.disponible === 1 };
  }

  obtener(id) {
    // En memoria la búsqueda es por clave exacta: "1" (string) no encuentra el ítem 1.
    // SQLite sí convertiría "1" a 1, así que se rechaza explícitamente para igualar.
    if (typeof id !== 'number') return null;
    const fila = this._sql.obtener.get(id);
    return fila ? this._armar(fila) : null;
  }

  /**
   * Busca un ítem por nombre (sin distinción de mayúsculas ni espacios extremos).
   * Se compara en JS y no en SQL: LOWER() de SQLite solo entiende ASCII
   * ("CÉSAR" no coincidiría con "César").
   * @param {string} nombre
   * @returns {object|null}
   */
  buscarPorNombre(nombre) {
    const normalizado = nombre.trim().toLowerCase();
    return this.listar().find((item) => item.nombre.trim().toLowerCase() === normalizado) || null;
  }

  /**
   * Guarda un ítem. Si no tiene id, se asigna uno autoincremental
   * (y se escribe en el objeto recibido, igual que en memoria).
   * @param {object} item
   * @returns {object} El ítem guardado (con id asignado si era nuevo).
   */
  guardar(item) {
    const disponible = item.disponible ? 1 : 0;
    if (!item.id) {
      const info = this._sql.insertar.run(item.nombre, item.precioBase, disponible);
      item.id = Number(info.lastInsertRowid);
    } else {
      this._sql.upsert.run(item.id, item.nombre, item.precioBase, disponible);
    }
    return { ...item };
  }

  listar() {
    return this._sql.listar.all().map((fila) => this._armar(fila));
  }
}

module.exports = { PedidosSQLite, MesasSQLite, MenuItemsSQLite };
