const express = require('express');
const router = express.Router();
const db = require('../database');

const TIPOS_VALIDOS = ['alergia', 'exclusion', 'coccion'];

// GET /api/modificadores — Listar todos
router.get('/', (req, res) => {
  try {
    const mods = db.prepare('SELECT * FROM modificadores ORDER BY tipo, nombre').all();
    res.json(mods);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/modificadores/:id
router.get('/:id', (req, res) => {
  try {
    const mod = db.prepare('SELECT * FROM modificadores WHERE id = ?').get(req.params.id);
    if (!mod) return res.status(404).json({ error: 'Modificador no encontrado.' });
    res.json(mod);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/modificadores — Crear modificador
router.post('/', (req, res) => {
  const { nombre, tipo } = req.body;
  if (!nombre || !tipo) {
    return res.status(400).json({ error: 'nombre y tipo son obligatorios.' });
  }
  if (!TIPOS_VALIDOS.includes(tipo)) {
    return res.status(400).json({ error: `tipo inválido. Valores: ${TIPOS_VALIDOS.join(', ')}.` });
  }
  try {
    const resultado = db
      .prepare('INSERT INTO modificadores (nombre, tipo) VALUES (?, ?)')
      .run(nombre, tipo);
    res.status(201).json({ id: resultado.lastInsertRowid, nombre, tipo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/modificadores/:id
router.put('/:id', (req, res) => {
  const { nombre, tipo } = req.body;
  if (tipo && !TIPOS_VALIDOS.includes(tipo)) {
    return res.status(400).json({ error: `tipo inválido. Valores: ${TIPOS_VALIDOS.join(', ')}.` });
  }
  try {
    const resultado = db
      .prepare(
        'UPDATE modificadores SET nombre = COALESCE(?, nombre), tipo = COALESCE(?, tipo) WHERE id = ?'
      )
      .run(nombre || null, tipo || null, req.params.id);
    if (resultado.changes === 0)
      return res.status(404).json({ error: 'Modificador no encontrado.' });
    res.json({ mensaje: 'Modificador actualizado.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/modificadores/:id
router.delete('/:id', (req, res) => {
  try {
    const resultado = db.prepare('DELETE FROM modificadores WHERE id = ?').run(req.params.id);
    if (resultado.changes === 0)
      return res.status(404).json({ error: 'Modificador no encontrado.' });
    res.json({ mensaje: 'Modificador eliminado.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
