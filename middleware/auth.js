const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'scd_restaurant_secret_2026_local';

/**
 * Middleware que verifica el token JWT en el header Authorization.
 * Si es válido, agrega req.usuario = { id, username } y llama next().
 * Si es inválido o ausente, responde 401.
 */
function verificarToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Acceso denegado: se requiere autenticación.' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.usuario = { id: payload.id, username: payload.username };
    next();
  } catch (err) {
    return res
      .status(401)
      .json({ error: 'Token inválido o expirado. Por favor, iniciá sesión nuevamente.' });
  }
}

module.exports = { verificarToken, JWT_SECRET };
