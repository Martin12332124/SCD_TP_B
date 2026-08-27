const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'restaurante.db');
const db = new Database(DB_PATH);

db.pragma('foreign_keys = ON');

// ============================================================
// TABLAS (solo si no existen)
// ============================================================

db.exec(`
  CREATE TABLE IF NOT EXISTS mesas (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    numero  INTEGER NOT NULL UNIQUE,
    estado  TEXT    NOT NULL DEFAULT 'libre' CHECK(estado IN ('libre', 'ocupada'))
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS categorias (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT    NOT NULL UNIQUE
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS ingredientes (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre  TEXT    NOT NULL UNIQUE,
    unidad  TEXT    NOT NULL CHECK(unidad IN ('g', 'cc', 'ml', 'unidad')),
    stock   REAL    NOT NULL DEFAULT 0
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS menu_items (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre       TEXT    NOT NULL,
    descripcion  TEXT,
    precio       REAL    NOT NULL DEFAULT 0,
    categoria_id INTEGER NOT NULL,
    activo       INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (categoria_id) REFERENCES categorias(id) ON DELETE RESTRICT
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS modificadores (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT    NOT NULL,
    tipo   TEXT    NOT NULL CHECK(tipo IN ('alergia', 'exclusion', 'coccion'))
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS menu_item_modificadores (
    menu_item_id   INTEGER NOT NULL,
    modificador_id INTEGER NOT NULL,
    PRIMARY KEY (menu_item_id, modificador_id),
    FOREIGN KEY (menu_item_id)   REFERENCES menu_items(id)   ON DELETE CASCADE,
    FOREIGN KEY (modificador_id) REFERENCES modificadores(id) ON DELETE CASCADE
  );
`);

// Pedidos: el ciclo de vida de una comanda
db.exec(`
  CREATE TABLE IF NOT EXISTS pedidos (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    mesa_id         INTEGER NOT NULL,
    estado          TEXT    NOT NULL DEFAULT 'Pedido en Espera'
                    CHECK(estado IN ('Pedido en Espera', 'En Cocina', 'Pedido Servido', 'Anulado')),
    en_cocina_desde DATETIME,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (mesa_id) REFERENCES mesas(id)
  );
`);

// Ítems de cada pedido (con modificadores capturados como notas de texto)
db.exec(`
  CREATE TABLE IF NOT EXISTS pedido_items (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    pedido_id    INTEGER NOT NULL,
    menu_item_id INTEGER NOT NULL,
    cantidad     INTEGER NOT NULL DEFAULT 1,
    notas        TEXT,
    FOREIGN KEY (pedido_id)    REFERENCES pedidos(id)    ON DELETE CASCADE,
    FOREIGN KEY (menu_item_id) REFERENCES menu_items(id)
  );
`);

// ============================================================
// DATOS SEMILLA
// ============================================================

const totalMesas = db.prepare('SELECT COUNT(*) as c FROM mesas').get().c;
if (totalMesas === 0) {
  const ins = db.prepare('INSERT INTO mesas (numero, estado) VALUES (?, ?)');
  for (let i = 1; i <= 10; i++) ins.run(i, 'libre');
  console.log('[DB] ✅ 10 mesas creadas.');
}

const totalCategorias = db.prepare('SELECT COUNT(*) as c FROM categorias').get().c;
if (totalCategorias === 0) {
  const cats = ['Entradas', 'Principales', 'Bebidas', 'Postres'];
  const ins = db.prepare('INSERT INTO categorias (nombre) VALUES (?)');
  cats.forEach((c) => ins.run(c));
  console.log('[DB] ✅ Categorías creadas.');
}

const totalItems = db.prepare('SELECT COUNT(*) as c FROM menu_items').get().c;
if (totalItems === 0) {
  // IDs de categorías: 1=Entradas, 2=Principales, 3=Bebidas, 4=Postres
  const seedItems = [
    { nombre: 'Provoleta a la parrilla',  descripcion: 'Queso provolone gratinado con orégano y tomate',       precio: 1800, cat: 1 },
    { nombre: 'Empanadas (x3)',           descripcion: 'Empanadas de carne cortada a cuchillo',                  precio: 1500, cat: 1 },
    { nombre: 'Tabla de fiambres',        descripcion: 'Jamón, salame, queso y aceitunas',                       precio: 2200, cat: 1 },
    { nombre: 'Bife de chorizo',          descripcion: '350g de bife madurado a la parrilla',                    precio: 4500, cat: 2 },
    { nombre: 'Milanesa napolitana',      descripcion: 'Milanesa de ternera con salsa, jamón y mozzarella',      precio: 3800, cat: 2 },
    { nombre: 'Pasta del día',            descripcion: 'Preguntá al mozo por la pasta y salsa del día',          precio: 2900, cat: 2 },
    { nombre: 'Pollo a la plancha',       descripcion: 'Pechuga de pollo con limón y papas fritas',              precio: 3200, cat: 2 },
    { nombre: 'Coca-Cola / Pepsi (500ml)',descripcion: null,                                                      precio: 900,  cat: 3 },
    { nombre: 'Cerveza (porrón)',         descripcion: 'Quilmes / Heineken / Stella Artois',                      precio: 1100, cat: 3 },
    { nombre: 'Agua mineral (500ml)',     descripcion: 'Con o sin gas',                                           precio: 700,  cat: 3 },
    { nombre: 'Flan con dulce de leche', descripcion: 'Flan casero con crema y dulce de leche',                  precio: 1200, cat: 4 },
    { nombre: 'Helado (2 bochas)',        descripcion: 'Preguntá por los sabores disponibles',                    precio: 1100, cat: 4 },
  ];
  const ins = db.prepare('INSERT INTO menu_items (nombre, descripcion, precio, categoria_id) VALUES (?,?,?,?)');
  seedItems.forEach((i) => ins.run(i.nombre, i.descripcion, i.precio, i.cat));
  console.log('[DB] ✅ Menú de ejemplo creado.');
}

const totalMods = db.prepare('SELECT COUNT(*) as c FROM modificadores').get().c;
if (totalMods === 0) {
  const seedMods = [
    // Alergias
    { nombre: '⚠️ Sin Gluten',       tipo: 'alergia'   },
    { nombre: '⚠️ Sin Lactosa',      tipo: 'alergia'   },
    { nombre: '⚠️ Alergia a Mariscos', tipo: 'alergia'  },
    // Exclusiones
    { nombre: 'Sin Cebolla',          tipo: 'exclusion' },
    { nombre: 'Sin Ajo',              tipo: 'exclusion' },
    { nombre: 'Sin Sal',              tipo: 'exclusion' },
    { nombre: 'Sin Picante',          tipo: 'exclusion' },
    // Cocción (aplican a carnes)
    { nombre: 'Jugoso',               tipo: 'coccion'   },
    { nombre: 'A punto',              tipo: 'coccion'   },
    { nombre: 'Bien cocido',          tipo: 'coccion'   },
    { nombre: 'Vuelta y vuelta',      tipo: 'coccion'   },
  ];
  const ins = db.prepare('INSERT INTO modificadores (nombre, tipo) VALUES (?,?)');
  seedMods.forEach((m) => ins.run(m.nombre, m.tipo));
  console.log('[DB] ✅ Modificadores creados.');

  // Asociar modificadores a ítems (usando IDs conocidos del seed)
  // El bife (id=4) y pollo (id=7) → cocción + exclusiones
  // Todos los platos de comida → alergias disponibles
  const assoc = db.prepare(
    'INSERT OR IGNORE INTO menu_item_modificadores (menu_item_id, modificador_id) VALUES (?,?)'
  );
  const insertarTodos = db.transaction(() => {
    // Obtener IDs reales de modificadores por nombre
    const getMod = (nombre) => db.prepare('SELECT id FROM modificadores WHERE nombre = ?').get(nombre)?.id;
    const getItem = (nombre) => db.prepare('SELECT id FROM menu_items WHERE nombre = ?').get(nombre)?.id;

    const bifId    = getItem('Bife de chorizo');
    const polloId  = getItem('Pollo a la plancha');
    const milaId   = getItem('Milanesa napolitana');
    const pastaId  = getItem('Pasta del día');
    const provoId  = getItem('Provoleta a la parrilla');
    const empaId   = getItem('Empanadas (x3)');

    const sinGluten  = getMod('⚠️ Sin Gluten');
    const sinLactosa = getMod('⚠️ Sin Lactosa');
    const sinCebolla = getMod('Sin Cebolla');
    const sinAjo     = getMod('Sin Ajo');
    const sinSal     = getMod('Sin Sal');
    const jugoso     = getMod('Jugoso');
    const aPunto     = getMod('A punto');
    const bienCoc    = getMod('Bien cocido');
    const vYv        = getMod('Vuelta y vuelta');

    // Carnes: cocción + exclusiones básicas
    [bifId, polloId].forEach((itemId) => {
      if (!itemId) return;
      [jugoso, aPunto, bienCoc, vYv, sinSal, sinCebolla, sinAjo, sinGluten].forEach((modId) => {
        if (modId) assoc.run(itemId, modId);
      });
    });
    // Milanesa: cocción + lactosa (lleva queso)
    if (milaId) {
      [jugoso, aPunto, bienCoc, sinLactosa, sinGluten].forEach((modId) => {
        if (modId) assoc.run(milaId, modId);
      });
    }
    // Pasta: exclusiones + gluten
    if (pastaId) {
      [sinCebolla, sinAjo, sinGluten, sinLactosa].forEach((modId) => {
        if (modId) assoc.run(pastaId, modId);
      });
    }
    // Provoleta: lactosa
    if (provoId && sinLactosa) assoc.run(provoId, sinLactosa);
    // Empanadas: gluten
    if (empaId && sinGluten) assoc.run(empaId, sinGluten);
  });
  insertarTodos();
  console.log('[DB] ✅ Modificadores asociados a ítems del menú.');
}

console.log(`[DB] Base de datos lista → ${DB_PATH}`);
module.exports = db;
