// test/persistencia-sqlite.test.js
// Conexión SQLite: creación de carpeta, configuración (pragmas) y esquema.
// Usa una carpeta temporal para no tocar la base de desarrollo (data/).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { abrirBaseDeDatos, RUTA_POR_DEFECTO } = require('../src/infraestructura/sqlite/conexion');

let carpeta;
const abiertas = [];

/** Abre una base y la registra para cerrarla al terminar el test. */
function abrir(ruta) {
  const db = abrirBaseDeDatos(ruta);
  abiertas.push(db);
  return db;
}

beforeEach(() => {
  carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'restaurante-test-'));
});

afterEach(() => {
  while (abiertas.length) {
    const db = abiertas.pop();
    if (db.open) db.close();
  }
  fs.rmSync(carpeta, { recursive: true, force: true });
});

describe('Conexión SQLite', () => {
  test('crea la carpeta del archivo si no existe', () => {
    const ruta = path.join(carpeta, 'anidada', 'otra', 'restaurante.db');
    abrir(ruta);
    expect(fs.existsSync(ruta)).toBe(true);
  });

  test('aplica WAL, synchronous FULL, claves foráneas y busy_timeout', () => {
    const db = abrir(path.join(carpeta, 'r.db'));
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('synchronous', { simple: true })).toBe(2); // 2 = FULL
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
  });

  test('crea las cuatro tablas del esquema', () => {
    const db = abrir(':memory:');
    const tablas = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((t) => t.name);
    expect(tablas).toEqual(['menu_items', 'mesas', 'pedido_items', 'pedidos']);
  });

  test('abrir dos veces el mismo archivo no borra los datos (CREATE TABLE IF NOT EXISTS)', () => {
    const ruta = path.join(carpeta, 'r.db');
    const db1 = abrir(ruta);
    db1.prepare("INSERT INTO mesas (id, numero, estado) VALUES ('Mesa 1', 1, 'libre')").run();
    db1.close();

    const db2 = abrir(ruta);
    expect(db2.prepare('SELECT COUNT(*) AS n FROM mesas').get().n).toBe(1);
  });

  test('la ruta por defecto queda en data/restaurante.db de la raíz del repo', () => {
    expect(RUTA_POR_DEFECTO).toBe(path.join(__dirname, '..', 'data', 'restaurante.db'));
  });
});
