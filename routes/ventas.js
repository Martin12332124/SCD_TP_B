const express = require('express');
const router = express.Router();
const db = require('../database');

// ─────────────────────────────────────────────────────────────
// GET /api/ventas/dia — Resumen acumulado de ventas del día
// Query param opcional: ?fecha=YYYY-MM-DD (default: hoy)
// ─────────────────────────────────────────────────────────────
router.get('/dia', (req, res) => {
  try {
    const fecha = req.query.fecha || new Date().toISOString().slice(0, 10);

    // Validar formato de fecha
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return res.status(400).json({ error: 'Formato de fecha inválido. Use YYYY-MM-DD.' });
    }

    // Detalle completo de ítems vendidos en el día
    const detalle = db
      .prepare(
        `
      SELECT
        v.id,
        v.mesa_numero,
        v.menu_item_id,
        v.nombre_item,
        v.categoria,
        v.precio,
        v.cantidad,
        v.notas,
        v.pedido_id,
        v.created_at,
        (v.precio * v.cantidad) AS subtotal
      FROM ventas_dia v
      WHERE v.fecha = ?
      ORDER BY v.created_at ASC
    `
      )
      .all(fecha);

    // Agrupado por categoría
    const porCategoriaMap = new Map();
    let totalGeneral = 0;
    let totalItemsVendidos = 0;

    detalle.forEach((item) => {
      const cat = item.categoria || 'Sin categoría';
      if (!porCategoriaMap.has(cat)) {
        porCategoriaMap.set(cat, { categoria: cat, cantidad: 0, subtotal: 0 });
      }
      porCategoriaMap.get(cat).cantidad += item.cantidad;
      porCategoriaMap.get(cat).subtotal += item.subtotal;
      totalGeneral += item.subtotal;
      totalItemsVendidos += item.cantidad;
    });

    const porCategoria = [...porCategoriaMap.values()].sort((a, b) => b.subtotal - a.subtotal);

    res.json({
      fecha,
      total_general: totalGeneral,
      total_items_vendidos: totalItemsVendidos,
      por_categoria: porCategoria,
      detalle
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
