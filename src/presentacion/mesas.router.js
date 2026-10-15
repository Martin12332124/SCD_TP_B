// src/presentacion/mesas.router.js
// Router Express para la API REST de gestión de estado de mesas (US-09).
//
// Rutas expuestas:
//   POST /api/mesas/:numero/abrir   → abre (ocupa) la mesa indicada
//   POST /api/mesas/:numero/cerrar  → cierra (libera) la mesa indicada
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
function crearMesasRouter({ mesaEstadoService }) {
  const router = Router();

  // ── Tabla de mapeo: tipo de error → código HTTP ──────────────────────────
  const HTTP_STATUS = {
    ENTRADA_INVALIDA: 400,
    NO_ENCONTRADO: 404,
    ESTADO_NO_PERMITIDO: 409,
    PEDIDO_ACTIVO: 409
  };

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
