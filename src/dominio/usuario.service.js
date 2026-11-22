// src/dominio/usuario.service.js
// Reglas del inicio de sesión. No conoce SQLite, scrypt ni JWT: recibe por constructor
// el repositorio, las funciones de contraseña y el emisor de tokens.
//
// Sin roles: cualquier usuario con sesión usa POS y KDS (CLAUDE.md, paso 2).

/** Nombre de usuario: 3–32 caracteres de a-z, 0-9, punto, guion o guion bajo.
 *  Es válido también como parte local de un correo: en la nube "ana" es "ana@sistema.local". */
const PATRON_USUARIO = /^[a-z0-9._-]{3,32}$/;
const LARGO_MINIMO_CONTRASENA = 8;

const CREDENCIALES_INVALIDAS = {
  ok: false,
  tipo: 'CREDENCIALES_INVALIDAS',
  // Mismo mensaje si el usuario no existe o la contraseña está mal: no se revela cuál.
  error: 'Usuario o contraseña incorrectos.'
};

/** "  Ana " → "ana". Misma regla que el frontend aplica antes de ir a Supabase Auth. */
function normalizarUsuario(texto) {
  return String(texto ?? '')
    .trim()
    .toLowerCase();
}

/**
 * Interpreta USUARIOS_INICIALES: "usuario:contraseña,usuario2:contraseña2".
 * Se corta solo en el primer ":" de cada par, así la contraseña puede contener ":".
 * @param {string} texto
 * @returns {{ ok: true, usuarios: Array<{ usuario: string, contrasena: string }> }
 *          | { ok: false, tipo: 'ENTRADA_INVALIDA', error: string }}
 */
function interpretarUsuariosIniciales(texto) {
  const usuarios = [];
  const vistos = new Set();
  const pares = String(texto ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  for (const [indice, par] of pares.entries()) {
    const corte = par.indexOf(':');
    // Nunca se incluye la contraseña en el mensaje: termina en la consola del servidor.
    const donde = `USUARIOS_INICIALES, par ${indice + 1}`;
    if (corte === -1) {
      return {
        ok: false,
        tipo: 'ENTRADA_INVALIDA',
        error: `${donde}: falta ":" (usuario:contraseña).`
      };
    }
    const usuario = normalizarUsuario(par.slice(0, corte));
    const contrasena = par.slice(corte + 1);
    if (!PATRON_USUARIO.test(usuario)) {
      return {
        ok: false,
        tipo: 'ENTRADA_INVALIDA',
        error: `${donde}: el usuario debe tener 3–32 caracteres a-z, 0-9, ".", "-" o "_".`
      };
    }
    if (contrasena.length < LARGO_MINIMO_CONTRASENA) {
      return {
        ok: false,
        tipo: 'ENTRADA_INVALIDA',
        error: `${donde} (${usuario}): la contraseña debe tener al menos ${LARGO_MINIMO_CONTRASENA} caracteres.`
      };
    }
    if (vistos.has(usuario)) {
      return {
        ok: false,
        tipo: 'ENTRADA_INVALIDA',
        error: `${donde}: el usuario "${usuario}" está repetido.`
      };
    }
    vistos.add(usuario);
    usuarios.push({ usuario, contrasena });
  }
  return { ok: true, usuarios };
}

class UsuarioService {
  /**
   * @param {object} deps
   * @param {object} deps.usuarios - repositorio (contar, obtenerPorNombre, crearVarios)
   * @param {(contrasena: string) => Promise<string>} deps.hashear
   * @param {(contrasena: string, hash: string) => Promise<boolean>} deps.verificar
   * @param {{ firmar: Function, verificar: Function }} deps.tokens
   */
  constructor({ usuarios, hashear, verificar, tokens }) {
    if (!usuarios) throw new Error('Dependencia requerida: usuarios');
    if (!hashear || !verificar) throw new Error('Dependencia requerida: hashear y verificar');
    if (!tokens) throw new Error('Dependencia requerida: tokens');
    this.usuarios = usuarios;
    this._hashear = hashear;
    this._verificar = verificar;
    this._tokens = tokens;
    this._hashSenuelo = null;
  }

  /**
   * Crea los usuarios de USUARIOS_INICIALES solo si la tabla está vacía: así un reinicio
   * no vuelve a crear usuarios ni cambia contraseñas.
   * @param {string} texto
   * @returns {Promise<{ ok: true, creados: number } | { ok: false, tipo: string, error: string }>}
   */
  async crearUsuariosIniciales(texto) {
    if (this.usuarios.contar() > 0) return { ok: true, creados: 0 };
    const interpretado = interpretarUsuariosIniciales(texto);
    if (!interpretado.ok) return interpretado;

    const lista = [];
    for (const { usuario, contrasena } of interpretado.usuarios) {
      lista.push({ nombreUsuario: usuario, hashContrasena: await this._hashear(contrasena) });
    }
    this.usuarios.crearVarios(lista);
    return { ok: true, creados: lista.length };
  }

  /**
   * @param {{ usuario: any, contrasena: any }} datos
   * @returns {Promise<{ ok: true, token: string, usuario: string }
   *          | { ok: false, tipo: string, error: string }>}
   */
  async iniciarSesion(datos) {
    const usuario = normalizarUsuario(datos?.usuario);
    const contrasena = datos?.contrasena;
    if (!usuario || typeof contrasena !== 'string' || contrasena === '') {
      return {
        ok: false,
        tipo: 'ENTRADA_INVALIDA',
        error: 'Ingresa usuario y contraseña.'
      };
    }

    const registrado = this.usuarios.obtenerPorNombre(usuario);
    if (!registrado) {
      // Se calcula igual un scrypt: así la respuesta tarda lo mismo exista o no el usuario,
      // y no se puede averiguar qué nombres existen midiendo el tiempo.
      await this._verificar(contrasena, await this._senuelo());
      return CREDENCIALES_INVALIDAS;
    }
    if (!(await this._verificar(contrasena, registrado.hashContrasena))) {
      return CREDENCIALES_INVALIDAS;
    }
    return { ok: true, token: this._tokens.firmar(usuario), usuario };
  }

  /**
   * @param {string} token
   * @returns {{ ok: true, usuario: string } | { ok: false, tipo: 'NO_AUTORIZADO', error: string }}
   */
  verificarToken(token) {
    const usuario = typeof token === 'string' && token ? this._tokens.verificar(token) : null;
    if (!usuario) {
      return {
        ok: false,
        tipo: 'NO_AUTORIZADO',
        error: 'Sesión inválida o vencida. Inicia sesión.'
      };
    }
    return { ok: true, usuario };
  }

  async _senuelo() {
    if (!this._hashSenuelo) this._hashSenuelo = await this._hashear('contrasena-senuelo');
    return this._hashSenuelo;
  }
}

module.exports = {
  UsuarioService,
  normalizarUsuario,
  interpretarUsuariosIniciales,
  PATRON_USUARIO,
  LARGO_MINIMO_CONTRASENA
};
