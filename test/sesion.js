// test/sesion.js
// Ayuda para los tests que usan la API REST o Socket.IO, que desde el login exigen token.
// Se fija el secreto y se firma un token directamente: así cada test no paga dos scrypt
// (crear usuario + iniciar sesión). El login de verdad se prueba en test/auth.test.js.

const { crearApp } = require('../src/app');
const { crearEmisorTokens } = require('../src/infraestructura/seguridad/tokens');

// Secreto solo para tests, generado en cada corrida (no es un valor real).
const SECRETO_PRUEBA = require('crypto').randomBytes(32).toString('base64');

/** crearApp con un token válido para el usuario "prueba" en ctx.token. */
function crearAppConSesion(opciones = {}) {
  const ctx = crearApp({ ...opciones, autenticacion: { secreto: SECRETO_PRUEBA } });
  return { ...ctx, token: crearEmisorTokens(SECRETO_PRUEBA).firmar('prueba') };
}

module.exports = { crearAppConSesion, SECRETO_PRUEBA };
