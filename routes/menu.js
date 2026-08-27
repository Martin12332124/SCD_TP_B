const express = require('express');
const router = express.Router();
const db = require('../database');

// IMPORTANTE: rutas estáticas ANTES de rutas con parámetros (:id)
// para evitar que Express capture "categorias" o "completo" como un :id

// ─────────────────────────────────────────────────────────────
// GET /api/menu — Listar ítems activos (con nombre de categoría)
// ─────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  try {
    const items = db
      .prepare(
        `SELECT mi.*, c.nombre AS categoria
         FROM menu_items mi
         JOIN categorias c ON mi.categoria_id = c.id
         WHERE mi.activo = 1
         ORDER BY c.nombre, mi.nombre`
      )
      .all();
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/menu/completo — Ítems con modificadores anidados (para la vista de toma de pedido)
// ─────────────────────────────────────────────────────────────
router.get('/completo', (req, res) => {
  try {
    const items = db
      .prepare(
        `SELECT mi.id, mi.nombre, mi.descripcion, mi.precio, mi.activo,
                mi.categoria_id, c.nombre AS categoria
         FROM menu_items mi
         JOIN categorias c ON mi.categoria_id = c.id
         WHERE mi.activo = 1
         ORDER BY c.nombre, mi.nombre`
      )
      .all();

    const getMods = db.prepare(
      `SELECT m.id, m.nombre, m.tipo
       FROM modificadores m
       JOIN menu_item_modificadores mim ON m.id = mim.modificador_id
       WHERE mim.menu_item_id = ?
       ORDER BY m.tipo, m.nombre`
    );

    const resultado = items.map((item) => ({
      ...item,
      modificadores: getMods.all(item.id),
    }));

    res.json(resultado);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/menu/categorias/todas — Listar categorías
// ─────────────────────────────────────────────────────────────
router.get('/categorias/todas', (req, res) => {
  try {
    const cats = db.prepare('SELECT * FROM categorias ORDER BY nombre').all();
    res.json(cats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/menu/:id — Un ítem con sus modificadores disponibles
// ─────────────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  try {
    const item = db
      .prepare(
        `SELECT mi.*, c.nombre AS categoria
         FROM menu_items mi
         JOIN categorias c ON mi.categoria_id = c.id
         WHERE mi.id = ?`
      )
      .get(req.params.id);
    if (!item) return res.status(404).json({ error: 'Ítem no encontrado.' });

    const modificadores = db
      .prepare(
        `SELECT m.*
         FROM modificadores m
         JOIN menu_item_modificadores mim ON m.id = mim.modificador_id
         WHERE mim.menu_item_id = ?
         ORDER BY m.tipo, m.nombre`
      )
      .all(req.params.id);

    res.json({ ...item, modificadores });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/menu — Crear ítem del menú
// ─────────────────────────────────────────────────────────────
router.post('/', (req, res) => {
  const { nombre, descripcion, precio, categoria_id } = req.body;
  if (!nombre || !categoria_id || precio === undefined) {
    return res.status(400).json({ error: 'nombre, precio y categoria_id son obligatorios.' });
  }
  if (isNaN(precio) || precio < 0) {
    return res.status(400).json({ error: 'El precio debe ser un número positivo.' });
  }
  const catExiste = db.prepare('SELECT id FROM categorias WHERE id = ?').get(categoria_id);
  if (!catExiste) {
    return res.status(400).json({ error: `La categoría con id ${categoria_id} no existe.` });
  }
  try {
    const resultado = db
      .prepare('INSERT INTO menu_items (nombre, descripcion, precio, categoria_id) VALUES (?, ?, ?, ?)')
      .run(nombre, descripcion || null, parseFloat(precio), parseInt(categoria_id));
    res.status(201).json({ id: resultado.lastInsertRowid, nombre, precio, categoria_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// PUT /api/menu/:id — Actualizar ítem
// ─────────────────────────────────────────────────────────────
router.put('/:id', (req, res) => {
  const { nombre, descripcion, precio, categoria_id, activo } = req.body;
  try {
    const item = db.prepare('SELECT id FROM menu_items WHERE id = ?').get(req.params.id);
    if (!item) return res.status(404).json({ error: 'Ítem no encontrado.' });

    db.prepare(
      `UPDATE menu_items
       SET nombre = COALESCE(?, nombre),
           descripcion = COALESCE(?, descripcion),
           precio = COALESCE(?, precio),
           categoria_id = COALESCE(?, categoria_id),
           activo = COALESCE(?, activo)
       WHERE id = ?`
    ).run(
      nombre || null,
      descripcion || null,
      precio !== undefined ? parseFloat(precio) : null,
      categoria_id !== undefined ? parseInt(categoria_id) : null,
      activo !== undefined ? (activo ? 1 : 0) : null,
      req.params.id
    );
    res.json({ mensaje: 'Ítem actualizado correctamente.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// DELETE /api/menu/:id — Eliminar ítem
// ─────────────────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  try {
    const resultado = db.prepare('DELETE FROM menu_items WHERE id = ?').run(req.params.id);
    if (resultado.changes === 0) return res.status(404).json({ error: 'Ítem no encontrado.' });
    res.json({ mensaje: 'Ítem eliminado correctamente.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/menu/:id/modificadores — Asociar modificadores a un ítem
// ─────────────────────────────────────────────────────────────
router.post('/:id/modificadores', (req, res) => {
  const { modificador_ids } = req.body;
  if (!Array.isArray(modificador_ids) || modificador_ids.length === 0) {
    return res.status(400).json({ error: 'Se requiere un array de modificador_ids.' });
  }
  try {
    const insertar = db.prepare(
      'INSERT OR IGNORE INTO menu_item_modificadores (menu_item_id, modificador_id) VALUES (?, ?)'
    );
    const insertarTodos = db.transaction((ids) => {
      ids.forEach((modId) => insertar.run(parseInt(req.params.id), parseInt(modId)));
    });
    insertarTodos(modificador_ids);
    res.status(201).json({ mensaje: 'Modificadores asociados correctamente.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
