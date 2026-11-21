// src/infraestructura/seguridad/tokens.js
// Emisión y verificación de JWT (jsonwebtoken) firmados con JWT_SECRET (HS256).
//
// Un JWT es un texto firmado que dice "este es el usuario X, válido hasta tal hora".
// El servidor no guarda sesiones: le basta con verificar la firma. Quien no conoce el
// secreto no puede fabricar ni modificar un token.

const jwt = require('jsonwebtoken');

/** Un turno de trabajo: al día siguiente hay que volver a iniciar sesión. */
const DURACION_POR_DEFECTO = '12h';

/**
 * @param {string} secreto - JWT_SECRET
 * @param {{ duracion?: string|number }} [opciones]
 */
function crearEmisorTokens(secreto, { duracion = DURACION_POR_DEFECTO } = {}) {
  if (!secreto) throw new Error('Se requiere un secreto para firmar los tokens');
  return {
    /** @param {string} usuario @returns {string} */
    firmar(usuario) {
      return jwt.sign({ sub: usuario }, secreto, { algorithm: 'HS256', expiresIn: duracion });
    },

    /**
     * Devuelve el usuario si el token es válido y no venció; si no, null.
     * `algorithms` fijo: rechaza tokens con alg "none" u otro algoritmo.
     * @param {string} token
     * @returns {string|null}
     */
    verificar(token) {
      try {
        const datos = jwt.verify(token, secreto, { algorithms: ['HS256'] });
        return typeof datos.sub === 'string' ? datos.sub : null;
      } catch {
        return null;
      }
    }
  };
}

module.exports = { crearEmisorTokens, DURACION_POR_DEFECTO };
