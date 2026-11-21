// src/infraestructura/sqlite/usuarios-sqlite.js
// Repositorio de usuarios en SQLite. Solo guarda el nombre y el hash de la contraseña:
// la contraseña en texto plano nunca llega a la base.
//
// La tabla se crea aquí (CREATE TABLE IF NOT EXISTS) y no en esquema.sql, igual que
// ordenes_aplicadas: esquema.sql describe las cuatro tablas del dominio del restaurante.

const CREAR_TABLA = `
CREATE TABLE IF NOT EXISTS usuarios (
  id              INTEGER PRIMARY KEY,
  nombre_usuario  TEXT    NOT NULL UNIQUE,
  hash_contrasena TEXT    NOT NULL,
  creado_en       TEXT    NOT NULL
)`;

class UsuariosSQLite {
  /**
   * @param {import('better-sqlite3').Database} db
   * @param {() => string} [reloj]
   */
  constructor(db, reloj = () => new Date().toISOString()) {
    db.exec(CREAR_TABLA);
    this._db = db;
    this._reloj = reloj;
    this._sql = {
      contar: db.prepare('SELECT COUNT(*) AS n FROM usuarios'),
      obtener: db.prepare(
        `SELECT nombre_usuario AS nombreUsuario, hash_contrasena AS hashContrasena
         FROM usuarios WHERE nombre_usuario = ?`
      ),
      crear: db.prepare(
        'INSERT INTO usuarios (nombre_usuario, hash_contrasena, creado_en) VALUES (?, ?, ?)'
      )
    };
  }

  contar() {
    return this._sql.contar.get().n;
  }

  /** @returns {{ nombreUsuario: string, hashContrasena: string } | null} */
  obtenerPorNombre(nombreUsuario) {
    return this._sql.obtener.get(nombreUsuario) || null;
  }

  /** Lanza error si el nombre ya existe (UNIQUE). */
  crear(nombreUsuario, hashContrasena) {
    this._sql.crear.run(nombreUsuario, hashContrasena, this._reloj());
  }

  /** Crea varios usuarios en una sola transacción: o todos o ninguno. */
  crearVarios(lista) {
    this._db.transaction(() => {
      for (const { nombreUsuario, hashContrasena } of lista)
        this.crear(nombreUsuario, hashContrasena);
    })();
  }
}

module.exports = { UsuariosSQLite };
