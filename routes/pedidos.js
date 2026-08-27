const express = require('express');
const router = express.Router();
const db = require('../database');

// Máquina de estados unidireccional (según documento de definición)
const TRANSICIONES_VALIDAS = {
  'Pedido en Espera': ['En Cocina', 'Anulado'],
  'En Cocina':        ['Pedido Servido'],
  'Pedido Servido':   [],
  'Anulado':          [],
};

/**
 * Construye el array de pedidos activos con sus ítems a partir de una consulta plana.
 * Agrupa por pedido para evitar N+1 queries.
 */
function cargarPedidosConItems(condicionSQL = "p.estado IN ('Pedido en Espera', 'En Cocina')") {
  const filas = db.prepare(`
    SELECT p.id, p.mesa_id, m.numero AS numero_mesa, p.estado, p.en_cocina_desde, p.created_at,
           pi.id AS item_id, pi.menu_item_id, pi.cantidad, pi.notas,
           mi.nombre AS nombre_item, mi.precio
    FROM pedidos p
    JOIN mesas m ON p.mesa_id = m.id
    LEFT JOIN pedido_items pi ON pi.pedido_id = p.id
    LEFT JOIN menu_items mi ON pi.menu_item_id = mi.id
    WHERE ${condicionSQL}
    ORDER BY p.created_at ASC, pi.id ASC
  `).all();

  const mapa = new Map();
  filas.forEach((fila) => {
    if (!mapa.has(fila.id)) {
      mapa.set(fila.id, {
        id:              fila.id,
        mesa_id:         fila.mesa_id,
        numero_mesa:     fila.numero_mesa,
        estado:          fila.estado,
        en_cocina_desde: fila.en_cocina_desde,
        created_at:      fila.created_at,
        items:           [],
      });
    }
    if (fila.item_id) {
      mapa.get(fila.id).items.push({
        id:          fila.item_id,
        menu_item_id: fila.menu_item_id,
        nombre:      fila.nombre_item,
        precio:      fila.precio,
        cantidad:    fila.cantidad,
        notas:       fila.notas,
      });
    }
  });
  return [...mapa.values()];
}

// ─────────────────────────────────────────────────────────────
// GET /api/pedidos — Pedidos activos (Pedido en Espera + En Cocina)
// ─────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  try {
    res.json(cargarPedidosConItems());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/pedidos/:id — Un pedido con sus ítems
// ─────────────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  try {
    const [pedido] = cargarPedidosConItems(`p.id = ${parseInt(req.params.id)}`);
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado.' });
    res.json(pedido);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/pedidos — Crear comanda
// Body: { mesa_id: number, items: [{ menu_item_id, cantidad, notas }] }
// ─────────────────────────────────────────────────────────────
router.post('/', (req, res) => {
  const { mesa_id, items } = req.body;

  if (!mesa_id || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Requerido: mesa_id y al menos un ítem en items[].' });
  }

  const mesa = db.prepare('SELECT * FROM mesas WHERE id = ?').get(mesa_id);
  if (!mesa) return res.status(404).json({ error: `Mesa con id ${mesa_id} no encontrada.` });

  // Validar cada ítem
  for (const item of items) {
    if (!item.menu_item_id || !item.cantidad || item.cantidad < 1) {
      return res.status(400).json({ error: 'Cada ítem debe tener menu_item_id y cantidad >= 1.' });
    }
    const menuItem = db.prepare('SELECT id FROM menu_items WHERE id = ? AND activo = 1').get(item.menu_item_id);
    if (!menuItem) {
      return res.status(400).json({ error: `Ítem de menú con id ${item.menu_item_id} no existe o está inactivo.` });
    }
  }

  try {
    let pedidoId;
    const crearPedido = db.transaction(() => {
      const resultado = db.prepare(
        "INSERT INTO pedidos (mesa_id, estado) VALUES (?, 'Pedido en Espera')"
      ).run(mesa_id);
      pedidoId = resultado.lastInsertRowid;

      const insItem = db.prepare(
        'INSERT INTO pedido_items (pedido_id, menu_item_id, cantidad, notas) VALUES (?,?,?,?)'
      );
      items.forEach((i) => insItem.run(pedidoId, i.menu_item_id, i.cantidad, i.notas || null));
    });
    crearPedido();

    // Retornar el pedido completo con sus ítems
    const [pedidoCreado] = cargarPedidosConItems(`p.id = ${pedidoId}`);

    // Emitir evento WebSocket a todos los clientes (KDS, otros mozos)
    const io = req.app.get('io');
    if (io) io.emit('nuevo_pedido', pedidoCreado);

    res.status(201).json(pedidoCreado);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// PUT /api/pedidos/:id/estado — Cambiar estado (máquina de estados)
// Body: { estado: string }
// ─────────────────────────────────────────────────────────────
router.put('/:id/estado', (req, res) => {
  const { estado: nuevoEstado } = req.body;
  const pedidoId = parseInt(req.params.id);

  if (!nuevoEstado) {
    return res.status(400).json({ error: 'Se requiere el campo estado.' });
  }

  const pedido = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId);
  if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado.' });

  const transicionesPermitidas = TRANSICIONES_VALIDAS[pedido.estado] || [];
  if (!transicionesPermitidas.includes(nuevoEstado)) {
    return res.status(422).json({
      error: `Transición inválida: "${pedido.estado}" → "${nuevoEstado}". Permitidas: ${transicionesPermitidas.join(', ') || 'ninguna (estado terminal)'}`,
    });
  }

  try {
    const ahora = new Date().toISOString();
    const enCocinaDesde = nuevoEstado === 'En Cocina' ? ahora : pedido.en_cocina_desde;

    db.prepare('UPDATE pedidos SET estado = ?, en_cocina_desde = ? WHERE id = ?')
      .run(nuevoEstado, enCocinaDesde, pedidoId);

    // Sincronizar estado de la mesa
    const mesa = db.prepare('SELECT numero FROM mesas WHERE id = ?').get(pedido.mesa_id);
    if (nuevoEstado === 'En Cocina') {
      db.prepare("UPDATE mesas SET estado = 'ocupada' WHERE id = ?").run(pedido.mesa_id);
    } else if (nuevoEstado === 'Pedido Servido' || nuevoEstado === 'Anulado') {
      db.prepare("UPDATE mesas SET estado = 'libre' WHERE id = ?").run(pedido.mesa_id);
    }

    // Emitir eventos WebSocket
    const io = req.app.get('io');
    if (io) {
      const payload = {
        pedido_id:       pedidoId,
        mesa_id:         pedido.mesa_id,
        mesa:            `Mesa ${mesa.numero}`,
        numero_mesa:     mesa.numero,
        estado:          nuevoEstado,
        en_cocina_desde: enCocinaDesde,
      };
      io.emit('cambio_estado_pedido', payload);

      // Emitir estado actualizado de todas las mesas
      const mesasActualizadas = db.prepare('SELECT * FROM mesas ORDER BY numero ASC').all();
      io.emit('estado_mesas', mesasActualizadas);
    }

    res.json({ mensaje: `Estado actualizado a "${nuevoEstado}" correctamente.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// DELETE /api/pedidos/:id — Anular pedido (solo desde "Pedido en Espera")
// ─────────────────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  const pedidoId = parseInt(req.params.id);
  const pedido = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId);

  if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado.' });

  if (pedido.estado !== 'Pedido en Espera') {
    return res.status(422).json({
      error: `Solo se pueden anular pedidos en estado "Pedido en Espera". Estado actual: "${pedido.estado}".`,
    });
  }

  try {
    // Usar la máquina de estados en lugar de DELETE físico (para trazabilidad)
    db.prepare("UPDATE pedidos SET estado = 'Anulado' WHERE id = ?").run(pedidoId);

    const io = req.app.get('io');
    const mesa = db.prepare('SELECT numero FROM mesas WHERE id = ?').get(pedido.mesa_id);
    if (io) {
      io.emit('cambio_estado_pedido', {
        pedido_id:   pedidoId,
        mesa_id:     pedido.mesa_id,
        mesa:        `Mesa ${mesa.numero}`,
        numero_mesa: mesa.numero,
        estado:      'Anulado',
      });
    }

    res.json({ mensaje: 'Pedido anulado correctamente.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.cargarPedidosConItems = cargarPedidosConItems;
