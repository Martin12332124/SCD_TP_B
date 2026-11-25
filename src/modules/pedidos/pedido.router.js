const { Router } = require('express');

/**
 * Crea el endpoint REST de resumen de pedidos asociado a una mesa.
 * @param {object} deps
 * @param {object} deps.pedidoService
 * @param {object} deps.mesas
 * @param {(numero: string) => object} deps.validarNumeroMesa
 */
function crearPedidosRouter({ pedidoService = null, mesas, validarNumeroMesa }) {
  const router = Router();

  router.get('/:numero/pedido', (req, res) => {
    const validacion = validarNumeroMesa(req.params.numero);
    if (!validacion.ok) return res.status(400).json(validacion);

    if (!mesas.obtener(validacion.mesaId)) {
      return res.status(404).json({
        ok: false,
        tipo: 'NO_ENCONTRADO',
        error: `La mesa ${req.params.numero} no existe.`
      });
    }

    if (!pedidoService) {
      return res
        .status(200)
        .json({ ok: true, mesa: validacion.mesaId, estado: null, items: [], total: 0 });
    }

    return res.status(200).json(pedidoService.obtenerResumen(validacion.mesaId));
  });

  return router;
}

module.exports = { crearPedidosRouter };
