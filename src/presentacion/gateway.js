// src/presentacion/gateway.js
// API gateway mínimo del servidor local. Se monta ANTES de las rutas /api y hace tres cosas:
//   1. API key por aplicación cliente (cabecera x-api-key; en Socket.IO, el handshake).
//   2. Límite de peticiones (express-rate-limit, en memoria).
//   3. Registro de accesos de una línea por petición (nunca la llave, solo su nombre).
//
// La API key identifica a la APLICACIÓN (p. ej. "web", "cocina"); el JWT identifica al
// USUARIO. Son dos capas independientes: hacen falta las dos.

const crypto = require('crypto');
const { Router } = require('express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const API_KEY_INVALIDA = 'API_KEY_INVALIDA';
const DEMASIADAS_PETICIONES = 'DEMASIADAS_PETICIONES';
const CABECERA = 'x-api-key';
const LARGO_MINIMO_LLAVE = 16;

// Valores del diseño: login 5 intentos FALLIDOS por minuto por IP;
// resto de /api 600 por minuto por llave (todos los dispositivos del local comparten la misma).
const LIMITES_POR_DEFECTO = {
  login: { max: 5, ventanaMs: 60_000 },
  general: { max: 600, ventanaMs: 60_000 }
};

const sha256 = (texto) => crypto.createHash('sha256').update(String(texto)).digest();

/**
 * Convierte el texto de API_KEYS ("nombre:llave,nombre2:llave2") en una lista de
 * { nombre, llave }. Lanza Error con un mensaje claro si el formato no es válido: es mejor
 * que el servidor no arranque a que arranque con una llave mal escrita.
 * La llave puede contener ":" (se separa en el primero); no puede contener ",".
 */
function leerLlaves(texto) {
  const crudo = (texto ?? '').trim();
  if (!crudo) throw new Error('API_KEYS está vacía.');
  const llaves = crudo.split(',').map((entrada) => {
    const corte = entrada.indexOf(':');
    const nombre = entrada.slice(0, corte).trim();
    const llave = entrada.slice(corte + 1).trim();
    if (corte < 0 || !/^[a-z0-9._-]{1,32}$/i.test(nombre)) {
      throw new Error(
        'API_KEYS: cada entrada debe ser nombre:llave (nombre de 1–32 caracteres a-z 0-9 . _ -).'
      );
    }
    if (llave.length < LARGO_MINIMO_LLAVE) {
      throw new Error(
        `API_KEYS: la llave de "${nombre}" debe tener al menos ${LARGO_MINIMO_LLAVE} caracteres.`
      );
    }
    return { nombre, llave };
  });
  const nombres = new Set(llaves.map((l) => l.nombre));
  const valores = new Set(llaves.map((l) => l.llave));
  if (nombres.size !== llaves.length || valores.size !== llaves.length) {
    throw new Error('API_KEYS: los nombres y las llaves no pueden repetirse.');
  }
  return llaves;
}

/**
 * Busca la llave entre las configuradas. Se compara el SHA-256 de ambas con
 * timingSafeEqual (tiempo constante, y así las longitudes siempre coinciden) y se recorren
 * todas las llaves sin cortar al primer acierto.
 * @returns {string|null} nombre de la aplicación, o null si la llave no es válida
 */
function crearVerificador(llaves) {
  const huellas = llaves.map(({ nombre, llave }) => ({ nombre, huella: sha256(llave) }));
  return (presentada) => {
    if (typeof presentada !== 'string' || presentada === '') return null;
    const huella = sha256(presentada);
    let encontrada = null;
    for (const candidata of huellas) {
      if (crypto.timingSafeEqual(huella, candidata.huella)) encontrada = candidata.nombre;
    }
    return encontrada;
  };
}

const respuestaLimite = (mensaje) => ({
  ok: false,
  tipo: DEMASIADAS_PETICIONES,
  error: mensaje
});

function crearLimitador({ max, ventanaMs }, claveDe, mensaje, opciones = {}) {
  return rateLimit({
    windowMs: ventanaMs,
    limit: max,
    standardHeaders: 'draft-7', // RateLimit y Retry-After para que el cliente sepa esperar
    legacyHeaders: false,
    keyGenerator: claveDe,
    handler: (req, res) => res.status(429).json(respuestaLimite(mensaje)),
    ...opciones
  });
}

/** "2026-11-21T12:00:00.000Z web GET /api/mesas 200 12ms": una línea, sin query ni llave. */
function lineaDeAcceso({ hora, nombre, metodo, ruta, estado, ms }) {
  return `${hora.toISOString()} app=${nombre} ${metodo} ${ruta} ${estado} ${ms}ms`;
}

/**
 * @param {object} opciones
 * @param {Array<{nombre: string, llave: string}>} opciones.llaves - ver leerLlaves()
 * @param {{login?: {max, ventanaMs}, general?: {max, ventanaMs}}} [opciones.limites]
 * @param {(linea: string) => void} [opciones.registrar] - destino del registro de accesos
 *   (index.js pasa console.log; por defecto se descarta, para no ensuciar los tests)
 * @param {() => Date} [opciones.ahora] - reloj inyectable
 * @returns {{ rutas: import('express').Router, verificarSocket: Function }}
 */
function crearGateway({ llaves, limites = {}, registrar = () => {}, ahora = () => new Date() }) {
  if (!Array.isArray(llaves) || llaves.length === 0) {
    throw new Error('El gateway necesita al menos una API key.');
  }
  const buscarNombre = crearVerificador(llaves);
  const lim = {
    login: { ...LIMITES_POR_DEFECTO.login, ...limites.login },
    general: { ...LIMITES_POR_DEFECTO.general, ...limites.general }
  };

  const rutas = Router();

  // 3. Registro de accesos. Va primero para ver también los rechazos (401 y 429).
  rutas.use((req, res, next) => {
    const inicio = process.hrtime.bigint();
    res.on('finish', () => {
      registrar(
        lineaDeAcceso({
          hora: ahora(),
          nombre: req.aplicacion ?? '-',
          metodo: req.method,
          ruta: req.originalUrl.split('?')[0],
          estado: res.statusCode,
          ms: Math.round(Number(process.hrtime.bigint() - inicio) / 1e6)
        })
      );
    });
    next();
  });

  // 1. API key. También para /api/auth/login: sin llave ni siquiera se puede probar una contraseña.
  rutas.use((req, res, next) => {
    const nombre = buscarNombre(req.get(CABECERA));
    if (!nombre) {
      return res.status(401).json({
        ok: false,
        tipo: API_KEY_INVALIDA,
        error: 'Falta la API key de la aplicación o no es válida (cabecera x-api-key).'
      });
    }
    req.aplicacion = nombre;
    return next();
  });

  // 2. Límites. Después de validar la llave, para que quien no la tenga no gaste el cupo de nadie.
  // Login: por IP (protege contra adivinar contraseñas) y solo cuentan los intentos fallidos
  // (respuesta >= 400): quien entra bien varias veces seguidas no se bloquea. El resto: por aplicación.
  rutas.use(
    '/auth/login',
    crearLimitador(
      lim.login,
      (req) => ipKeyGenerator(req.ip), // agrupa las IPv6 por subred, como pide la librería
      'Demasiados intentos de inicio de sesión. Espera un minuto e inténtalo de nuevo.',
      { skipSuccessfulRequests: true }
    )
  );
  const general = crearLimitador(
    lim.general,
    (req) => req.aplicacion,
    'Demasiadas peticiones. Espera un momento e inténtalo de nuevo.'
  );
  rutas.use((req, res, next) => (req.path === '/auth/login' ? next() : general(req, res, next)));

  /**
   * Middleware de Socket.IO (io.use). El navegador no puede poner cabeceras propias en un
   * WebSocket, así que la llave se acepta en `auth: { apiKey }` o en la cabecera x-api-key.
   * Mismo mensaje de error que el REST: el cliente recibe connect_error "API_KEY_INVALIDA".
   */
  function verificarSocket(socket, next) {
    const nombre = buscarNombre(
      socket.handshake.auth?.apiKey ?? socket.handshake.headers[CABECERA]
    );
    registrar(
      lineaDeAcceso({
        hora: ahora(),
        nombre: nombre ?? '-',
        metodo: 'SOCKET',
        ruta: '/socket.io',
        estado: nombre ? 101 : 401,
        ms: 0
      })
    );
    if (!nombre) return next(new Error(API_KEY_INVALIDA));
    socket.data.aplicacion = nombre;
    return next();
  }

  return { rutas, verificarSocket };
}

module.exports = {
  crearGateway,
  leerLlaves,
  lineaDeAcceso,
  API_KEY_INVALIDA,
  DEMASIADAS_PETICIONES,
  CABECERA
};
