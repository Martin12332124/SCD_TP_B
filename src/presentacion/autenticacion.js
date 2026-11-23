// src/presentacion/autenticacion.js
// Exigir sesión en las dos puertas de entrada del POS: la API REST y Socket.IO.
// Ambas usan el mismo UsuarioService.verificarToken, así la regla vive en un solo lugar.

const NO_AUTORIZADO = 'NO_AUTORIZADO';

/** "Bearer abc.def.ghi" → "abc.def.ghi"; cualquier otra cosa → null. */
function tokenDeCabecera(valor) {
  const coincidencia = /^Bearer\s+(\S+)$/i.exec(valor || '');
  return coincidencia ? coincidencia[1] : null;
}

/**
 * Middleware Express: deja pasar solo peticiones con `Authorization: Bearer <token>` válido.
 * Si no, responde 401 { ok: false, tipo: "NO_AUTORIZADO", error } y la ruta no se ejecuta.
 * Guarda el usuario en req.usuario.
 */
function exigirToken(usuarioService) {
  return (req, res, next) => {
    const resultado = usuarioService.verificarToken(tokenDeCabecera(req.headers.authorization));
    if (!resultado.ok) return res.status(401).json(resultado);
    req.usuario = resultado.usuario;
    return next();
  };
}

/**
 * Middleware de Socket.IO (io.use): rechaza la conexión si el cliente no envía un token
 * válido en `auth: { token }`. El cliente recibe 'connect_error' con message "NO_AUTORIZADO"
 * y así sabe que debe volver al login (y no reintentar para siempre).
 */
function exigirTokenSocket(usuarioService) {
  return (socket, next) => {
    const resultado = usuarioService.verificarToken(socket.handshake.auth?.token);
    if (!resultado.ok) return next(new Error(NO_AUTORIZADO));
    socket.data.usuario = resultado.usuario;
    return next();
  };
}

module.exports = { exigirToken, exigirTokenSocket, tokenDeCabecera, NO_AUTORIZADO };
