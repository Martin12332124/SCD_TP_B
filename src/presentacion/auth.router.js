// src/presentacion/auth.router.js
// Router Express para el inicio de sesión local.
//
// Rutas expuestas:
//   POST /api/auth/login  → { usuario, contrasena } → JWT
//
// Es la única ruta de la API que no exige token (no se puede pedir un token con un token).

const { Router } = require('express');

const HTTP_STATUS = {
  ENTRADA_INVALIDA: 400,
  CREDENCIALES_INVALIDAS: 401
};

/**
 * @param {{ usuarioService: import('../dominio/usuario.service').UsuarioService }} deps
 * @returns {Router}
 */
function crearAuthRouter({ usuarioService }) {
  const router = Router();

  /**
   * POST /api/auth/login
   *
   * Respuestas:
   *   200 OK            { ok: true, token, usuario }
   *   400 Bad Request   { ok: false, tipo: "ENTRADA_INVALIDA", error }
   *   401 Unauthorized  { ok: false, tipo: "CREDENCIALES_INVALIDAS", error }
   */
  router.post('/login', async (req, res) => {
    const resultado = await usuarioService.iniciarSesion(req.body);
    if (resultado.ok) return res.status(200).json(resultado);
    return res.status(HTTP_STATUS[resultado.tipo] ?? 500).json(resultado);
  });

  return router;
}

module.exports = { crearAuthRouter };
