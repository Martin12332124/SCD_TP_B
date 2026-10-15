// src/presentacion/menu-items.router.js
// Router Express para la API REST de gestión de ítems del menú (US-07).
//
// Rutas expuestas:
//   POST /api/menu-items         → crea un ítem nuevo
//   PUT  /api/menu-items/:id     → edita nombre y/o precioBase de un ítem existente
//   GET  /api/menu-items         → lista todos los ítems
//   GET  /api/menu-items/:id     → obtiene un ítem por id
//
// Cada ruta delega la lógica al MenuItemService y traduce su resultado
// a la respuesta HTTP correspondiente (código de estado + cuerpo JSON).

const { Router } = require('express');

/**
 * Crea y devuelve el router de ítems del menú con el servicio inyectado.
 *
 * @param {{ menuItemService: import('../dominio/menu-item.service').MenuItemService }} deps
 * @returns {Router}
 */
function crearMenuItemsRouter({ menuItemService }) {
  const router = Router();

  // ── Tabla de mapeo: tipo de error → código HTTP ──────────────────────────
  const HTTP_STATUS = {
    ENTRADA_INVALIDA: 400,
    NO_ENCONTRADO: 404,
    DUPLICADO: 409
  };

  /**
   * POST /api/menu-items
   *
   * Crea un nuevo ítem del menú con nombre y precioBase.
   *
   * Respuestas:
   *   201 Created      { ok: true,  item: { id, nombre, precioBase, disponible } }
   *   400 Bad Request  { ok: false, tipo: "ENTRADA_INVALIDA", error: "..." }
   *   409 Conflict     { ok: false, tipo: "DUPLICADO", error: "..." }
   */
  router.post('/', (req, res) => {
    const resultado = menuItemService.crearItem(req.body);

    if (resultado.ok) {
      return res.status(201).json(resultado);
    }

    const status = HTTP_STATUS[resultado.tipo] ?? 500;
    return res.status(status).json(resultado);
  });

  /**
   * PUT /api/menu-items/:id
   *
   * Edita nombre y/o precioBase de un ítem existente.
   *
   * Respuestas:
   *   200 OK           { ok: true,  item: { id, nombre, precioBase, disponible } }
   *   400 Bad Request  { ok: false, tipo: "ENTRADA_INVALIDA", error: "..." }
   *   404 Not Found    { ok: false, tipo: "NO_ENCONTRADO", error: "..." }
   *   409 Conflict     { ok: false, tipo: "DUPLICADO", error: "..." }
   */
  router.put('/:id', (req, res) => {
    const resultado = menuItemService.editarItem(req.params.id, req.body);

    if (resultado.ok) {
      return res.status(200).json(resultado);
    }

    const status = HTTP_STATUS[resultado.tipo] ?? 500;
    return res.status(status).json(resultado);
  });

  /**
   * GET /api/menu-items
   *
   * Lista todos los ítems del menú.
   *
   * Respuestas:
   *   200 OK  { ok: true, items: [...] }
   */
  router.get('/', (req, res) => {
    const resultado = menuItemService.listarItems();
    return res.status(200).json(resultado);
  });

  /**
   * GET /api/menu-items/:id
   *
   * Obtiene un ítem por id.
   *
   * Respuestas:
   *   200 OK           { ok: true,  item: { id, nombre, precioBase, disponible } }
   *   400 Bad Request  { ok: false, tipo: "ENTRADA_INVALIDA", error: "..." }
   *   404 Not Found    { ok: false, tipo: "NO_ENCONTRADO", error: "..." }
   */
  router.get('/:id', (req, res) => {
    const resultado = menuItemService.obtenerItem(req.params.id);

    if (resultado.ok) {
      return res.status(200).json(resultado);
    }

    const status = HTTP_STATUS[resultado.tipo] ?? 500;
    return res.status(status).json(resultado);
  });

  return router;
}

module.exports = { crearMenuItemsRouter };
