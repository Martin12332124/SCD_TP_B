// test/sesion.js
// Ayuda para los tests que usan la API REST o Socket.IO, que desde el login exigen token
// y desde el API gateway exigen además una API key (cabecera x-api-key).
// Se fija el secreto y se firma un token directamente: así cada test no paga dos scrypt
// (crear usuario + iniciar sesión). El login de verdad se prueba en test/auth.test.js.

const { crearApp } = require('../src/app');
const { crearEmisorTokens } = require('../src/infraestructura/seguridad/tokens');

// Secreto solo para tests, generado en cada corrida (no es un valor real).
const SECRETO_PRUEBA = require('crypto').randomBytes(32).toString('base64');

// Llave solo para tests, también generada en cada corrida.
const LLAVE_PRUEBA = require('crypto').randomBytes(24).toString('base64url');

// Límites holgados: los tests hacen decenas de peticiones (y varios login) desde la misma IP
// y no deben chocar con los límites reales. Los límites de verdad se prueban en gateway.test.js.
const LIMITES_HOLGADOS = {
  login: { max: 100_000 },
  general: { max: 100_000 }
};

/**
 * crearApp con un token válido para el usuario "prueba" en ctx.token y la API key de
 * pruebas en ctx.llave. `ctx.cabeceras(extra)` arma las cabeceras de una petición con ambas.
 */
function crearAppConSesion(opciones = {}) {
  const ctx = crearApp({
    ...opciones,
    autenticacion: { secreto: SECRETO_PRUEBA },
    gateway: { llaves: [{ nombre: 'pruebas', llave: LLAVE_PRUEBA }], limites: LIMITES_HOLGADOS }
  });
  const token = crearEmisorTokens(SECRETO_PRUEBA).firmar('prueba');
  return {
    ...ctx,
    token,
    llave: LLAVE_PRUEBA,
    cabeceras: (extra = {}) => ({
      'x-api-key': LLAVE_PRUEBA,
      Authorization: `Bearer ${token}`,
      ...extra
    })
  };
}

module.exports = { crearAppConSesion, SECRETO_PRUEBA, LLAVE_PRUEBA, LIMITES_HOLGADOS };
