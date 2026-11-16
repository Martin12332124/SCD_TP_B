-- src/infraestructura/sqlite/esquema.sql
-- Esquema de la base de datos local (ADR-03). Se ejecuta en cada arranque:
-- CREATE TABLE IF NOT EXISTS no toca las tablas que ya existen ni sus datos.
-- Si el esquema cambia, ver "Puntos frágiles" en docs/persistencia-sqlite.md.

-- Mesas del restaurante. id conserva el formato del dominio: 'Mesa N'.
CREATE TABLE IF NOT EXISTS mesas (
  id     TEXT    PRIMARY KEY,
  numero INTEGER NOT NULL UNIQUE,
  estado TEXT    NOT NULL CHECK (estado IN ('libre', 'ocupada'))
);

-- Ítems del menú. id es alias de rowid, por lo que se asigna de forma autoincremental.
CREATE TABLE IF NOT EXISTS menu_items (
  id          INTEGER PRIMARY KEY,
  nombre      TEXT    NOT NULL,
  precio_base INTEGER NOT NULL,
  disponible  INTEGER NOT NULL CHECK (disponible IN (0, 1))
);

-- Pedido vigente de cada mesa (como máximo uno por mesa). El estado se guarda
-- tal cual, con su emoji (ej. 'Recibido 📝'); las reglas de estado viven en el dominio.
CREATE TABLE IF NOT EXISTS pedidos (
  mesa_id TEXT PRIMARY KEY REFERENCES mesas (id),
  estado  TEXT NOT NULL
);

-- Ítems de un pedido. nombre y precio_base son una copia del menú al momento de
-- confirmar, para que editar el menú no altere pedidos ya tomados.
-- posicion conserva el orden en que se agregaron.
CREATE TABLE IF NOT EXISTS pedido_items (
  mesa_id     TEXT    NOT NULL REFERENCES pedidos (mesa_id) ON DELETE CASCADE,
  posicion    INTEGER NOT NULL,
  item_id     INTEGER NOT NULL,
  nombre      TEXT    NOT NULL,
  precio_base INTEGER NOT NULL,
  cantidad    INTEGER NOT NULL,
  PRIMARY KEY (mesa_id, posicion)
);
