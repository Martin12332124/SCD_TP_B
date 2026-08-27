const express = require('express');
const router = express.Router();
const db = require('../database');

// GET /api/mesas — Listar todas las mesas
router.get('/', (req, res) => {
  try {
    const mesas = db.prepare('SELECT * FROM mesas ORDER BY numero ASC').all();
    res.json(mesas);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener mesas.', detalle: err.message });
  }
});

// GET /api/mesas/:id — Obtener una mesa por ID
router.get('/:id', (req, res) => {
  try {
    const mesa = db.prepare('SELECT * FROM mesas WHERE id = ?').get(req.params.id);
    if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada.' });
    res.json(mesa);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/mesas — Crear una nueva mesa
router.post('/', (req, res) => {
  const { numero } = req.body;
  if (!numero || isNaN(numero) || parseInt(numero) <= 0) {
    return res.status(400).json({ error: 'El número de mesa debe ser un entero positivo.' });
  }
  try {
    const resultado = db.prepare('INSERT INTO mesas (numero) VALUES (?)').run(parseInt(numero));
    res
      .status(201)
      .json({ id: resultado.lastInsertRowid, numero: parseInt(numero), estado: 'libre' });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: `Ya existe la Mesa ${numero}.` });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/mesas/:id — Actualizar estado de una mesa
router.put('/:id', (req, res) => {
  const { estado } = req.body;
  const ESTADOS_VALIDOS = ['libre', 'ocupada'];
  if (!estado || !ESTADOS_VALIDOS.includes(estado)) {
    return res
      .status(400)
      .json({ error: `Estado inválido. Valores permitidos: ${ESTADOS_VALIDOS.join(', ')}.` });
  }
  try {
    const resultado = db
      .prepare('UPDATE mesas SET estado = ? WHERE id = ?')
      .run(estado, req.params.id);
    if (resultado.changes === 0) return res.status(404).json({ error: 'Mesa no encontrada.' });
    res.json({ mensaje: 'Mesa actualizada correctamente.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/mesas/:id — Eliminar una mesa
router.delete('/:id', (req, res) => {
  try {
    const resultado = db.prepare('DELETE FROM mesas WHERE id = ?').run(req.params.id);
    if (resultado.changes === 0) return res.status(404).json({ error: 'Mesa no encontrada.' });
    res.json({ mensaje: 'Mesa eliminada correctamente.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
