const express = require('express');
const router = express.Router();
const db = require('../database');

const UNIDADES_VALIDAS = ['g', 'cc', 'ml', 'unidad'];

// GET /api/ingredientes — Listar todos
router.get('/', (req, res) => {
  try {
    const ingredientes = db.prepare('SELECT * FROM ingredientes ORDER BY nombre').all();
    res.json(ingredientes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ingredientes/:id
router.get('/:id', (req, res) => {
  try {
    const ing = db.prepare('SELECT * FROM ingredientes WHERE id = ?').get(req.params.id);
    if (!ing) return res.status(404).json({ error: 'Ingrediente no encontrado.' });
    res.json(ing);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ingredientes — Crear ingrediente
router.post('/', (req, res) => {
  const { nombre, unidad, stock } = req.body;
  if (!nombre || !unidad) {
    return res.status(400).json({ error: 'nombre y unidad son obligatorios.' });
  }
  if (!UNIDADES_VALIDAS.includes(unidad)) {
    return res
      .status(400)
      .json({ error: `unidad inválida. Valores: ${UNIDADES_VALIDAS.join(', ')}.` });
  }
  const stockInicial = stock !== undefined ? parseFloat(stock) : 0;
  if (isNaN(stockInicial) || stockInicial < 0) {
    return res.status(400).json({ error: 'El stock debe ser un número positivo.' });
  }
  try {
    const resultado = db
      .prepare('INSERT INTO ingredientes (nombre, unidad, stock) VALUES (?, ?, ?)')
      .run(nombre, unidad, stockInicial);
    res.status(201).json({ id: resultado.lastInsertRowid, nombre, unidad, stock: stockInicial });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: `Ya existe un ingrediente llamado "${nombre}".` });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/ingredientes/:id — Actualizar nombre, unidad o stock
router.put('/:id', (req, res) => {
  const { nombre, unidad, stock } = req.body;
  if (unidad && !UNIDADES_VALIDAS.includes(unidad)) {
    return res
      .status(400)
      .json({ error: `unidad inválida. Valores: ${UNIDADES_VALIDAS.join(', ')}.` });
  }
  try {
    const resultado = db
      .prepare(
        `UPDATE ingredientes
         SET nombre = COALESCE(?, nombre),
             unidad = COALESCE(?, unidad),
             stock  = COALESCE(?, stock)
         WHERE id = ?`
      )
      .run(
        nombre || null,
        unidad || null,
        stock !== undefined ? parseFloat(stock) : null,
        req.params.id
      );
    if (resultado.changes === 0)
      return res.status(404).json({ error: 'Ingrediente no encontrado.' });
    res.json({ mensaje: 'Ingrediente actualizado correctamente.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/ingredientes/:id
router.delete('/:id', (req, res) => {
  try {
    const resultado = db.prepare('DELETE FROM ingredientes WHERE id = ?').run(req.params.id);
    if (resultado.changes === 0)
      return res.status(404).json({ error: 'Ingrediente no encontrado.' });
    res.json({ mensaje: 'Ingrediente eliminado correctamente.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
