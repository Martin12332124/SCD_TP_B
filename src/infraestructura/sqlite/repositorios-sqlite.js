// src/infraestructura/sqlite/repositorios-sqlite.js
// Repositorios compartidos respaldados por SQLite (better-sqlite3, síncrono).
// El repositorio de pedidos pertenece a src/modules/pedidos.
// Cada lectura devuelve un objeto nuevo (copia defensiva): modificarlo no altera la base.
// Todas las consultas son preparadas con parámetros (nada de SQL concatenado).

/**
 * Repositorio de mesas. Las mesas iniciales (1..cantidad) se crean solo si la tabla
 * está vacía, es decir, la primera vez que se usa la base. En los arranques siguientes
 * no se toca nada: así un reinicio no libera mesas ocupadas ni vuelve a crear las mesas
 * que el restaurante haya quitado.
 */
class MesasSQLite {
  /**
   * @param {import('better-sqlite3').Database} db
   * @param {number} [cantidad=10] - Mesas que se crean si la tabla está vacía
   */
  constructor(db, cantidad = 10) {
    this._sql = {
      contar: db.prepare('SELECT COUNT(*) AS n FROM mesas'),
      insertar: db.prepare("INSERT INTO mesas (id, numero, estado) VALUES (?, ?, 'libre')"),
      obtener: db.prepare('SELECT id, numero, estado FROM mesas WHERE id = ?'),
      cambiarEstado: db.prepare('UPDATE mesas SET estado = ? WHERE id = ?'),
      listar: db.prepare('SELECT id, numero, estado FROM mesas ORDER BY numero'),
      eliminar: db.prepare('DELETE FROM mesas WHERE id = ?')
    };

    if (this._sql.contar.get().n === 0) {
      db.transaction(() => {
        for (let i = 1; i <= cantidad; i++) {
          this._sql.insertar.run(`Mesa ${i}`, i);
        }
      })();
    }
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

  /**
   * Agrega una mesa libre con el número indicado.
   * Lanza un error si ya existe (el id es clave primaria).
   * @param {number} numero
   * @returns {{ id: string, numero: number, estado: string }}
   */
  agregar(numero) {
    const id = `Mesa ${numero}`;
    this._sql.insertar.run(id, numero);
    return { id, numero, estado: 'libre' };
  }

  /**
   * Elimina una mesa. Si no existe, no hace nada.
   * Si la mesa tiene un pedido vigente, la clave foránea de pedidos lo impide y lanza error.
   * @param {string} mesaId
   */
  eliminar(mesaId) {
    this._sql.eliminar.run(mesaId);
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

module.exports = { MesasSQLite, MenuItemsSQLite };
