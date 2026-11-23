// src/infraestructura/sincronizacion/registro-ordenes.js
// Registro local de las órdenes de la nube que ya se aplicaron.
//
// Por qué existe: aplicar una orden tiene dos pasos en dos lugares distintos:
//   1. aplicarla en la base local (SQLite), y
//   2. avisarle a Supabase el resultado (estado 'aplicada' o 'rechazada').
// Si internet se corta entre 1 y 2, en Supabase la orden sigue 'pendiente' y al volver
// la conexión se aplicaría otra vez (ej. una ronda de pizzas duplicada en cocina).
// Este registro se escribe en la MISMA transacción que la orden (paso 1), así que si la
// orden quedó aplicada, el registro también. Al reintentar, se reenvía el resultado
// guardado en vez de volver a aplicarla.
//
// La tabla se crea aquí y no en esquema.sql: solo existe si la sincronización está
// activa, y sin .env la base local queda exactamente igual que antes.

const CREAR_TABLA = `
CREATE TABLE IF NOT EXISTS ordenes_aplicadas (
  id          INTEGER PRIMARY KEY,  -- el mismo id de ordenes_pendientes en Supabase
  estado      TEXT    NOT NULL CHECK (estado IN ('aplicada', 'rechazada')),
  resultado   TEXT    NOT NULL,     -- JSON con la respuesta del servicio de dominio
  aplicada_en TEXT    NOT NULL      -- ISO 8601 (UTC)
)`;

class RegistroOrdenesSQLite {
  /**
   * @param {import('better-sqlite3').Database} db - La misma conexión de los repositorios,
   *   para que el registro entre en la transacción de la orden.
   * @param {() => string} [reloj]
   */
  constructor(db, reloj = () => new Date().toISOString()) {
    db.exec(CREAR_TABLA);
    this._reloj = reloj;
    this._sql = {
      obtener: db.prepare('SELECT id, estado, resultado FROM ordenes_aplicadas WHERE id = ?'),
      guardar: db.prepare(
        'INSERT INTO ordenes_aplicadas (id, estado, resultado, aplicada_en) VALUES (?, ?, ?, ?)'
      )
    };
  }

  /**
   * @param {number} id
   * @returns {{ id: number, estado: string, resultado: object } | null}
   */
  obtener(id) {
    const fila = this._sql.obtener.get(id);
    return fila ? { ...fila, resultado: JSON.parse(fila.resultado) } : null;
  }

  /**
   * @param {number} id
   * @param {'aplicada'|'rechazada'} estado
   * @param {object} resultado
   */
  guardar(id, estado, resultado) {
    this._sql.guardar.run(id, estado, JSON.stringify(resultado), this._reloj());
  }
}

module.exports = { RegistroOrdenesSQLite };
