const express = require('express');
const router = express.Router();
const db = require('../database');

// ─────────────────────────────────────────────────────────────
// GET /api/mesas — Listar todas las mesas
// ─────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  try {
    const mesas = db.prepare('SELECT * FROM mesas ORDER BY numero ASC').all();
    res.json(mesas);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener mesas.', detalle: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/mesas/:id/cuenta — Cuenta de una mesa (todos sus pedidos con ítems y total)
// ─────────────────────────────────────────────────────────────
router.get('/:id/cuenta', (req, res) => {
  try {
    const mesaId = parseInt(req.params.id);
    const mesa = db.prepare('SELECT * FROM mesas WHERE id = ?').get(mesaId);
    if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada.' });

    // Traer todos los pedidos relevantes (excluye Anulados y Cerrados) con sus ítems
    const filas = db
      .prepare(
        `
      SELECT p.id, p.estado, p.created_at,
             pi.id AS item_id, pi.menu_item_id, pi.cantidad, pi.notas,
             mi.nombre AS nombre_item, mi.precio
      FROM pedidos p
      LEFT JOIN pedido_items pi ON pi.pedido_id = p.id
      LEFT JOIN menu_items mi ON pi.menu_item_id = mi.id
      WHERE p.mesa_id = ? AND p.estado NOT IN ('Anulado', 'Cerrado')
      ORDER BY p.created_at ASC, pi.id ASC
    `
      )
      .all(mesaId);

    // Agrupar por pedido
    const pedidosMapa = new Map();
    filas.forEach((fila) => {
      if (!pedidosMapa.has(fila.id)) {
        pedidosMapa.set(fila.id, {
          id: fila.id,
          estado: fila.estado,
          created_at: fila.created_at,
          items: [],
          subtotal: 0
        });
      }
      if (fila.item_id) {
        const subtotalItem = (fila.precio || 0) * fila.cantidad;
        pedidosMapa.get(fila.id).items.push({
          id: fila.item_id,
          menu_item_id: fila.menu_item_id,
          nombre: fila.nombre_item,
          precio: fila.precio,
          cantidad: fila.cantidad,
          notas: fila.notas,
          subtotal: subtotalItem
        });
        pedidosMapa.get(fila.id).subtotal += subtotalItem;
      }
    });

    const pedidos = [...pedidosMapa.values()];
    const total = pedidos.reduce((sum, p) => sum + p.subtotal, 0);

    res.json({ mesa, pedidos, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/mesas/:id/cerrar — Cerrar la cuenta y liberar la mesa
// ─────────────────────────────────────────────────────────────
router.post('/:id/cerrar', (req, res) => {
  try {
    const mesaId = parseInt(req.params.id);
    const mesa = db.prepare('SELECT * FROM mesas WHERE id = ?').get(mesaId);
    if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada.' });

    if (mesa.estado !== 'ocupada') {
      return res.status(422).json({ error: 'La mesa ya está libre.' });
    }

    // Verificar que no haya pedidos todavía en cocina (En Cocina o Pedido en Espera)
    const pedidosPendientes = db
      .prepare(
        "SELECT COUNT(*) as c FROM pedidos WHERE mesa_id = ? AND estado IN ('Pedido en Espera', 'En Cocina')"
      )
      .get(mesaId).c;

    if (pedidosPendientes > 0) {
      return res.status(422).json({
        error: `No se puede cerrar la mesa: hay ${pedidosPendientes} pedido(s) aún en preparación o en espera.`
      });
    }

    // ── Registrar ventas en ventas_dia (anti-duplicado por pedido_id) ──
    // Obtener los pedidos 'Pedido Servido' que aún no fueron volcados a ventas_dia
    const pedidosServidos = db
      .prepare(
        `
      SELECT p.id AS pedido_id
      FROM pedidos p
      WHERE p.mesa_id = ?
        AND p.estado = 'Pedido Servido'
        AND p.id NOT IN (SELECT DISTINCT pedido_id FROM ventas_dia WHERE pedido_id IS NOT NULL)
    `
      )
      .all(mesaId);

    const insVenta = db.prepare(`
      INSERT INTO ventas_dia (fecha, mesa_numero, menu_item_id, nombre_item, categoria, precio, cantidad, notas, pedido_id)
      VALUES (date('now'), ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const cerrarMesaTransaction = db.transaction(() => {
      // Volcar ítems a ventas_dia
      pedidosServidos.forEach(({ pedido_id }) => {
        const items = db
          .prepare(
            `
          SELECT pi.menu_item_id, mi.nombre, c.nombre AS categoria, mi.precio, pi.cantidad, pi.notas
          FROM pedido_items pi
          JOIN menu_items mi ON pi.menu_item_id = mi.id
          LEFT JOIN categorias c ON mi.categoria_id = c.id
          WHERE pi.pedido_id = ?
        `
          )
          .all(pedido_id);

        items.forEach((item) => {
          insVenta.run(
            mesa.numero,
            item.menu_item_id,
            item.nombre,
            item.categoria || null,
            item.precio,
            item.cantidad,
            item.notas || null,
            pedido_id
          );
        });

        // Pasar el pedido a estado 'Cerrado' para que desaparezca de la vista de mesa
        db.prepare("UPDATE pedidos SET estado = 'Cerrado' WHERE id = ?").run(pedido_id);
      });

      // Liberar la mesa
      db.prepare("UPDATE mesas SET estado = 'libre' WHERE id = ?").run(mesaId);
    });

    cerrarMesaTransaction();

    // Emitir actualización de mesas a todos los clientes
    const io = req.app.get('io');
    if (io) {
      const mesasActualizadas = db.prepare('SELECT * FROM mesas ORDER BY numero ASC').all();
      io.emit('estado_mesas', mesasActualizadas);
      // Notificar que las ventas del día se actualizaron
      io.emit('ventas_actualizadas', { mesa_numero: mesa.numero });
    }

    res.json({
      mensaje: `Mesa ${mesa.numero} cerrada y liberada correctamente.`,
      pedidos_cerrados: pedidosServidos.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/mesas/:id — Obtener una mesa por ID
// ─────────────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  try {
    const mesa = db.prepare('SELECT * FROM mesas WHERE id = ?').get(req.params.id);
    if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada.' });
    res.json(mesa);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/mesas — Crear una nueva mesa
// ─────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────
// PUT /api/mesas/:id — Actualizar estado de una mesa
// ─────────────────────────────────────────────────────────────
router.put('/:id', (req, res) => {
  const { estado } = req.body;
  const ESTADOS_VALIDOS = ['libre', 'ocupada'];
  if (!estado || !ESTADOS_VALIDOS.includes(estado)) {
    return res.status(400).json({
      error: `Estado inválido. Valores permitidos: ${ESTADOS_VALIDOS.join(', ')}.`
    });
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

// ─────────────────────────────────────────────────────────────
// DELETE /api/mesas/:id — Eliminar una mesa
// ─────────────────────────────────────────────────────────────
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
