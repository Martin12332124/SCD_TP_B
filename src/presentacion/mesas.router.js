// src/presentacion/mesas.router.js
// Router Express para la API REST de gestión de estado de mesas (US-08, US-09).
//
// Rutas expuestas:
//   GET  /api/mesas                 → lista todas las mesas con su estado (US-08)
//   GET  /api/mesas/:numero         → detalle de una mesa específica (US-08 CA5)
//   POST /api/mesas/:numero/abrir   → abre (ocupa) la mesa indicada (US-09)
//   POST /api/mesas/:numero/cerrar  → cierra (libera) la mesa indicada (US-09)
//
// Cada ruta delega la lógica al MesaEstadoService y traduce su resultado
// a la respuesta HTTP correspondiente (código de estado + cuerpo JSON).

const { Router } = require('express');

/**
 * Crea y devuelve el router de mesas con el servicio inyectado.
 *
 * @param {{ mesaEstadoService: import('../dominio/mesa-estado.service').MesaEstadoService }} deps
 * @returns {Router}
 */
function crearMesasRouter({ mesaEstadoService, mesas }) {
  const router = Router();

  // ── Tabla de mapeo: tipo de error → código HTTP ──────────────────────────
  const HTTP_STATUS = {
    ENTRADA_INVALIDA: 400,
    NO_ENCONTRADO: 404,
    ESTADO_NO_PERMITIDO: 409,
    PEDIDO_ACTIVO: 409
  };

  /**
   * GET /api/mesas
   *
   * Lista todas las mesas con su estado actual (US-08 CA1 y CA2).
   * El frontend puede usar este endpoint para la carga inicial sin depender del socket.
   *
   * Respuestas:
   *   200 OK  { ok: true, mesas: [{ id, numero, estado }] }
   */
  router.get('/', (req, res) => {
    return res.status(200).json({ ok: true, mesas: mesas.listar() });
  });

  /**
   * GET /api/mesas/:numero
   *
   * Devuelve el detalle de una mesa específica: número, estado y cuenta abierta si la tiene.
   * Cubre US-08 CA5: "cuando el mesero seleccione una mesa, entonces verá su número
   * o nombre y su cuenta abierta, si la tiene."
   *
   * Respuestas:
   *   200 OK           { ok: true, mesa: { id, numero, estado } }
   *   400 Bad Request  { ok: false, tipo: "ENTRADA_INVALIDA", error: "..." }
   *   404 Not Found    { ok: false, tipo: "NO_ENCONTRADO",    error: "..." }
   */
  router.get('/:numero', (req, res) => {
    // Reusar la validación del servicio para número de mesa
    const validacion = mesaEstadoService._validarNumero(req.params.numero);
    if (!validacion.ok) {
      return res.status(HTTP_STATUS[validacion.tipo] ?? 400).json(validacion);
    }

    const mesa = mesas.obtener(validacion.mesaId);
    if (!mesa) {
      return res.status(404).json({
        ok: false,
        tipo: 'NO_ENCONTRADO',
        error: `La mesa ${req.params.numero} no existe.`
      });
    }

    return res.status(200).json({ ok: true, mesa });
  });

  /**
   * POST /api/mesas/:numero/abrir
   *
   * Abre una mesa libre → la pasa a estado "ocupada".
   *
   * Respuestas:
   *   200 OK            { ok: true,  mesa: "Mesa N", estado: "ocupada" }
   *   400 Bad Request   { ok: false, tipo: "ENTRADA_INVALIDA", error: "..." }
   *   404 Not Found     { ok: false, tipo: "NO_ENCONTRADO",    error: "..." }
   *   409 Conflict      { ok: false, tipo: "ESTADO_NO_PERMITIDO", error: "..." }
   */
  router.post('/:numero/abrir', (req, res) => {
    const resultado = mesaEstadoService.abrirMesa(req.params.numero);

    if (resultado.ok) {
      return res.status(200).json(resultado);
    }

    const status = HTTP_STATUS[resultado.tipo] ?? 500;
    return res.status(status).json(resultado);
  });

  /**
   * POST /api/mesas/:numero/cerrar
   *
   * Cierra una mesa ocupada (sin pedido activo) → la pasa a estado "libre".
   *
   * Respuestas:
   *   200 OK            { ok: true,  mesa: "Mesa N", estado: "libre" }
   *   400 Bad Request   { ok: false, tipo: "ENTRADA_INVALIDA", error: "..." }
   *   404 Not Found     { ok: false, tipo: "NO_ENCONTRADO",    error: "..." }
   *   409 Conflict      { ok: false, tipo: "ESTADO_NO_PERMITIDO" | "PEDIDO_ACTIVO", error: "..." }
   */
  router.post('/:numero/cerrar', (req, res) => {
    const resultado = mesaEstadoService.cerrarMesa(req.params.numero);

    if (resultado.ok) {
      return res.status(200).json(resultado);
    }

    const status = HTTP_STATUS[resultado.tipo] ?? 500;
    return res.status(status).json(resultado);
  });

  return router;
}

module.exports = { crearMesasRouter };
