// src/infraestructura/sqlite/conexion.js
// Abre la base de datos SQLite local (ADR-03), aplica la configuración y crea el esquema.

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const ESQUEMA = fs.readFileSync(path.join(__dirname, 'esquema.sql'), 'utf8');

/** Ruta por defecto del archivo: <raíz del repo>/data/restaurante.db (no depende del cwd). */
const RUTA_POR_DEFECTO = path.join(__dirname, '..', '..', '..', 'data', 'restaurante.db');

/**
 * Abre (o crea) la base de datos en `ruta` y la deja lista para usar.
 *
 * Configuración:
 *   - journal_mode = WAL: las escrituras van a un archivo -wal; una escritura
 *     cortada a la mitad no corrompe la base y las lecturas no bloquean escrituras.
 *   - synchronous = FULL: cada commit espera a que el disco lo confirme, así un
 *     corte de luz no pierde comandas ya confirmadas (REF-09).
 *   - foreign_keys = ON: SQLite ignora las claves foráneas si no se activan.
 *   - busy_timeout = 5000: si otro programa (ej. DB Browser) bloquea la base,
 *     espera hasta 5 s en vez de fallar al instante.
 *
 * @param {string} [ruta] - Ruta del archivo .db, o ':memory:' para una base en memoria.
 * @returns {import('better-sqlite3').Database}
 */
function abrirBaseDeDatos(ruta = RUTA_POR_DEFECTO) {
  if (ruta !== ':memory:') {
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
  }

  const db = new Database(ruta);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(ESQUEMA);
  migrar(db);
  return db;
}

/**
 * Migraciones aditivas para bases creadas con una versión anterior del esquema.
 * CREATE TABLE IF NOT EXISTS no agrega columnas a una tabla que ya existe, así que
 * cada columna nueva se agrega aquí solo si falta. Nunca se borran tablas ni datos.
 *
 * - pedidos.estado_desde: hora en que el pedido pasó a su estado actual. Los pedidos
 *   que ya existían quedan con NULL (no se sabe desde cuándo están en ese estado).
 */
function migrar(db) {
  const columnas = db
    .prepare('PRAGMA table_info(pedidos)')
    .all()
    .map((c) => c.name);
  if (!columnas.includes('estado_desde')) {
    db.exec('ALTER TABLE pedidos ADD COLUMN estado_desde TEXT');
  }
}

module.exports = { abrirBaseDeDatos, RUTA_POR_DEFECTO };
