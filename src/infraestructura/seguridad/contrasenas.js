// src/infraestructura/seguridad/contrasenas.js
// Hash de contraseñas con scrypt (incluido en Node: crypto.scrypt, sin dependencias).
//
// Por qué scrypt y no SHA-256: un hash rápido se puede probar millones de veces por segundo
// si alguien copia la base. scrypt es lento a propósito y usa memoria, lo que encarece
// cada intento. Cada contraseña lleva su propia sal aleatoria: dos usuarios con la misma
// contraseña tienen hashes distintos y no sirven tablas precalculadas.
//
// Formato guardado: scrypt$N$r$p$sal(base64)$hash(base64). Los parámetros van en el texto
// para poder subirlos en el futuro sin invalidar los hashes antiguos.

const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);

const PARAMETROS = { N: 16384, r: 8, p: 1 };
const LARGO_HASH = 64;
const LARGO_SAL = 16;

/**
 * @param {string} contrasena
 * @returns {Promise<string>} hash en el formato descrito arriba
 */
async function hashearContrasena(contrasena) {
  const sal = crypto.randomBytes(LARGO_SAL);
  const { N, r, p } = PARAMETROS;
  const hash = await scrypt(contrasena, sal, LARGO_HASH, { N, r, p });
  return ['scrypt', N, r, p, sal.toString('base64'), hash.toString('base64')].join('$');
}

/**
 * Compara en tiempo constante (timingSafeEqual): el tiempo de respuesta no revela
 * cuántos bytes coincidieron.
 * @param {string} contrasena
 * @param {string} guardado - hash producido por hashearContrasena
 * @returns {Promise<boolean>}
 */
async function verificarContrasena(contrasena, guardado) {
  const partes = String(guardado).split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false;
  const [, N, r, p, salB64, hashB64] = partes;
  const esperado = Buffer.from(hashB64, 'base64');
  const calculado = await scrypt(contrasena, Buffer.from(salB64, 'base64'), esperado.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p)
  });
  return crypto.timingSafeEqual(calculado, esperado);
}

module.exports = { hashearContrasena, verificarContrasena };
