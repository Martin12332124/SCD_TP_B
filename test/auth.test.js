// test/auth.test.js
// Pruebas del inicio de sesión local: contraseñas (scrypt), tokens (JWT), UsuarioService,
// repositorio SQLite, POST /api/auth/login, el middleware de la API y el de Socket.IO.

const jwt = require('jsonwebtoken');
const { io: conectar } = require('socket.io-client');
const { crearApp } = require('../src/app');
const { abrirBaseDeDatos } = require('../src/infraestructura/sqlite/conexion');
const { UsuariosSQLite } = require('../src/infraestructura/sqlite/usuarios-sqlite');
const {
  hashearContrasena,
  verificarContrasena
} = require('../src/infraestructura/seguridad/contrasenas');
const { crearEmisorTokens } = require('../src/infraestructura/seguridad/tokens');
const {
  UsuarioService,
  normalizarUsuario,
  interpretarUsuariosIniciales
} = require('../src/dominio/usuario.service');
const { tokenDeCabecera } = require('../src/presentacion/autenticacion');
const { crearAppConSesion, SECRETO_PRUEBA } = require('./sesion');

// Credenciales solo de prueba (no son de ningún entorno real).
const CLAVE = 'clave-de-prueba-123';

// ─────────────────────────────────────────────────────────────────────────────
describe('contraseñas con scrypt', () => {
  test('el hash guarda parámetros y sal, y verifica solo la contraseña correcta', async () => {
    const hash = await hashearContrasena(CLAVE);
    expect(hash).toMatch(/^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(hash).not.toContain(CLAVE);
    expect(await verificarContrasena(CLAVE, hash)).toBe(true);
    expect(await verificarContrasena('otra-clave-123', hash)).toBe(false);
  });

  test('la misma contraseña produce hashes distintos (sal aleatoria)', async () => {
    expect(await hashearContrasena(CLAVE)).not.toBe(await hashearContrasena(CLAVE));
  });

  test('un hash con otro formato no verifica', async () => {
    expect(await verificarContrasena(CLAVE, 'md5$abc')).toBe(false);
    expect(await verificarContrasena(CLAVE, null)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('tokens JWT', () => {
  const tokens = crearEmisorTokens(SECRETO_PRUEBA);

  test('firma y verifica el usuario', () => {
    expect(tokens.verificar(tokens.firmar('ana'))).toBe('ana');
  });

  test('rechaza tokens de otro secreto, vencidos, alterados, sin sub o con alg none', () => {
    const otro = crearEmisorTokens('otro-secreto-de-prueba-con-32-caracteres!');
    expect(tokens.verificar(otro.firmar('ana'))).toBeNull();

    const vencido = crearEmisorTokens(SECRETO_PRUEBA, { duracion: -10 }).firmar('ana');
    expect(tokens.verificar(vencido)).toBeNull();

    const alterado = tokens.firmar('ana').slice(0, -2) + 'xx';
    expect(tokens.verificar(alterado)).toBeNull();

    expect(tokens.verificar(jwt.sign({ otro: 1 }, SECRETO_PRUEBA))).toBeNull();
    expect(tokens.verificar(jwt.sign({ sub: 'ana' }, '', { algorithm: 'none' }))).toBeNull();
    expect(tokens.verificar('basura')).toBeNull();
  });

  test('sin secreto no se puede crear el emisor', () => {
    expect(() => crearEmisorTokens('')).toThrow('secreto');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('USUARIOS_INICIALES', () => {
  test('interpreta pares usuario:contraseña, normaliza el usuario y corta en el primer ":"', () => {
    expect(interpretarUsuariosIniciales(' Ana:clave-uno-1 , cocina.1:a:b:c:d:e:f ')).toEqual({
      ok: true,
      usuarios: [
        { usuario: 'ana', contrasena: 'clave-uno-1' },
        { usuario: 'cocina.1', contrasena: 'a:b:c:d:e:f' }
      ]
    });
    expect(interpretarUsuariosIniciales('')).toEqual({ ok: true, usuarios: [] });
    expect(interpretarUsuariosIniciales(undefined)).toEqual({ ok: true, usuarios: [] });
  });

  test.each([
    ['ana', 'falta ":"'],
    ['a:clave-larga-1', 'el usuario debe tener'],
    ['ana maria:clave-larga-1', 'el usuario debe tener'],
    ['ana:corta', 'al menos 8'],
    ['ana:clave-larga-1,ANA:clave-larga-2', 'repetido']
  ])('rechaza "%s" (%s) sin mostrar la contraseña', (texto, mensaje) => {
    const r = interpretarUsuariosIniciales(texto);
    expect(r).toMatchObject({ ok: false, tipo: 'ENTRADA_INVALIDA' });
    expect(r.error).toContain(mensaje);
    expect(r.error).not.toContain('clave-larga');
  });

  test('normalizarUsuario quita espacios y pasa a minúsculas', () => {
    expect(normalizarUsuario('  Cocina ')).toBe('cocina');
    expect(normalizarUsuario(null)).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('UsuariosSQLite', () => {
  test('crea la tabla, cuenta, busca y no admite nombres repetidos', () => {
    const db = abrirBaseDeDatos(':memory:');
    const repo = new UsuariosSQLite(db, () => '2026-11-22T10:00:00.000Z');
    expect(repo.contar()).toBe(0);
    repo.crear('ana', 'hash-1');
    expect(repo.obtenerPorNombre('ana')).toEqual({
      nombreUsuario: 'ana',
      hashContrasena: 'hash-1'
    });
    expect(repo.obtenerPorNombre('nadie')).toBeNull();
    expect(() => repo.crear('ana', 'hash-2')).toThrow();
    db.close();
  });

  test('crearVarios es atómico: si uno falla no queda ninguno', () => {
    const db = abrirBaseDeDatos(':memory:');
    const repo = new UsuariosSQLite(db);
    expect(() =>
      repo.crearVarios([
        { nombreUsuario: 'ana', hashContrasena: 'h' },
        { nombreUsuario: 'ana', hashContrasena: 'h' }
      ])
    ).toThrow();
    expect(repo.contar()).toBe(0);
    db.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('UsuarioService', () => {
  let servicio;
  beforeEach(() => {
    servicio = crearApp({ autenticacion: { secreto: SECRETO_PRUEBA } }).usuarioService;
  });

  test('exige sus dependencias', () => {
    const base = { usuarios: {}, hashear: () => {}, verificar: () => {}, tokens: {} };
    expect(() => new UsuarioService({ ...base, usuarios: null })).toThrow('usuarios');
    expect(() => new UsuarioService({ ...base, hashear: null })).toThrow('hashear');
    expect(() => new UsuarioService({ ...base, tokens: null })).toThrow('tokens');
  });

  test('crea los usuarios iniciales solo si la tabla está vacía', async () => {
    expect(await servicio.crearUsuariosIniciales(`ana:${CLAVE}`)).toEqual({ ok: true, creados: 1 });
    // Segundo arranque, aunque la variable cambie: no se toca nada.
    expect(await servicio.crearUsuariosIniciales(`ana:otra-clave-99,beto:${CLAVE}`)).toEqual({
      ok: true,
      creados: 0
    });
    expect(servicio.usuarios.contar()).toBe(1);
    expect((await servicio.iniciarSesion({ usuario: 'ana', contrasena: CLAVE })).ok).toBe(true);
  });

  test('USUARIOS_INICIALES inválido no crea nada', async () => {
    expect(await servicio.crearUsuariosIniciales('ana')).toMatchObject({ ok: false });
    expect(servicio.usuarios.contar()).toBe(0);
  });

  test('inicia sesión con usuario normalizado y entrega un token válido', async () => {
    await servicio.crearUsuariosIniciales(`ana:${CLAVE}`);
    const r = await servicio.iniciarSesion({ usuario: '  ANA ', contrasena: CLAVE });
    expect(r).toEqual({ ok: true, token: expect.any(String), usuario: 'ana' });
    expect(servicio.verificarToken(r.token)).toEqual({ ok: true, usuario: 'ana' });
  });

  test('contraseña incorrecta y usuario inexistente dan el mismo error', async () => {
    await servicio.crearUsuariosIniciales(`ana:${CLAVE}`);
    const mala = await servicio.iniciarSesion({ usuario: 'ana', contrasena: 'no-es-la-clave' });
    const nadie = await servicio.iniciarSesion({ usuario: 'nadie', contrasena: CLAVE });
    expect(mala).toEqual({
      ok: false,
      tipo: 'CREDENCIALES_INVALIDAS',
      error: 'Usuario o contraseña incorrectos.'
    });
    expect(nadie).toEqual(mala);
  });

  test('con usuario inexistente igual calcula un scrypt (mismo tiempo de respuesta)', async () => {
    const verificar = jest.fn(async () => false);
    const s = new UsuarioService({
      usuarios: { obtenerPorNombre: () => null },
      hashear: async () => 'hash-senuelo',
      verificar,
      tokens: {}
    });
    await s.iniciarSesion({ usuario: 'nadie', contrasena: CLAVE });
    await s.iniciarSesion({ usuario: 'nadie', contrasena: CLAVE });
    expect(verificar).toHaveBeenCalledWith(CLAVE, 'hash-senuelo');
    expect(verificar).toHaveBeenCalledTimes(2);
  });

  test.each([
    undefined,
    null,
    {},
    { usuario: 'ana' },
    { usuario: ' ', contrasena: 'x' },
    { usuario: 'ana', contrasena: 123 }
  ])('datos incompletos (%p) → ENTRADA_INVALIDA', async (datos) => {
    expect(await servicio.iniciarSesion(datos)).toMatchObject({
      ok: false,
      tipo: 'ENTRADA_INVALIDA'
    });
  });

  test('verificarToken rechaza vacío, no texto y tokens inválidos', () => {
    for (const t of [undefined, '', 42, 'basura']) {
      expect(servicio.verificarToken(t)).toMatchObject({ ok: false, tipo: 'NO_AUTORIZADO' });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('tokenDeCabecera', () => {
  test('solo acepta "Bearer <token>"', () => {
    expect(tokenDeCabecera('Bearer abc.def')).toBe('abc.def');
    expect(tokenDeCabecera('bearer abc')).toBe('abc');
    expect(tokenDeCabecera('abc')).toBeNull();
    expect(tokenDeCabecera('Basic abc')).toBeNull();
    expect(tokenDeCabecera(undefined)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('API REST con sesión', () => {
  let ctx;
  let base;
  beforeEach(async () => {
    ctx = crearAppConSesion();
    await ctx.usuarioService.crearUsuariosIniciales(`ana:${CLAVE}`);
    await new Promise((r) => ctx.server.listen(0, r));
    base = `http://127.0.0.1:${ctx.server.address().port}`;
  });
  afterEach(async () => {
    await ctx.io.close();
  });

  const login = (cuerpo) =>
    fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ctx.llave },
      body: JSON.stringify(cuerpo)
    });

  test('POST /api/auth/login: 200 con token, 401 con clave mala, 400 sin datos', async () => {
    const ok = await login({ usuario: 'ana', contrasena: CLAVE });
    expect(ok.status).toBe(200);
    const cuerpo = await ok.json();
    expect(cuerpo).toMatchObject({ ok: true, usuario: 'ana' });

    // El token recibido sirve para la API.
    const mesas = await fetch(`${base}/api/mesas`, {
      headers: ctx.cabeceras({ Authorization: `Bearer ${cuerpo.token}` })
    });
    expect(mesas.status).toBe(200);

    const mala = await login({ usuario: 'ana', contrasena: 'otra-clave-1' });
    expect(mala.status).toBe(401);
    expect((await mala.json()).tipo).toBe('CREDENCIALES_INVALIDAS');

    expect((await login({})).status).toBe(400);
  });

  test.each(['/api/mesas', '/api/mesas/1', '/api/mesas/1/pedido', '/api/menu-items'])(
    'GET %s sin token o con token inválido → 401 NO_AUTORIZADO',
    async (ruta) => {
      const sin = await fetch(base + ruta, { headers: { 'x-api-key': ctx.llave } });
      expect(sin.status).toBe(401);
      expect(await sin.json()).toMatchObject({ ok: false, tipo: 'NO_AUTORIZADO' });

      const malo = await fetch(base + ruta, {
        headers: { 'x-api-key': ctx.llave, Authorization: 'Bearer basura' }
      });
      expect(malo.status).toBe(401);
    }
  );

  test('sin token tampoco se puede escribir: la mesa no se abre', async () => {
    const r = await fetch(`${base}/api/mesas/1/abrir`, {
      method: 'POST',
      headers: { 'x-api-key': ctx.llave }
    });
    expect(r.status).toBe(401);
    expect(ctx.mesas.obtener('Mesa 1').estado).toBe('libre');
  });

  test('GET / sigue público (lo usa la integración para saber si el servidor levantó)', async () => {
    expect((await fetch(`${base}/`)).status).toBe(200);
  });

  test('CORS permite Authorization y x-api-key (si no, el navegador bloquea el login)', async () => {
    // El preflight no lleva llave: lo responde el CORS, antes del gateway.
    const r = await fetch(`${base}/api/mesas`, { method: 'OPTIONS' });
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-headers')).toMatch(/Authorization/);
    expect(r.headers.get('access-control-allow-headers')).toMatch(/x-api-key/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Socket.IO con sesión', () => {
  let ctx;
  let url;
  const abiertos = [];
  beforeEach(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    ctx = crearAppConSesion();
    await new Promise((r) => ctx.server.listen(0, r));
    url = `http://127.0.0.1:${ctx.server.address().port}`;
  });
  afterEach(async () => {
    abiertos.splice(0).forEach((s) => s.close());
    await ctx.io.close();
    jest.restoreAllMocks();
  });

  /** Conecta y resuelve con 'conectado' o con el mensaje de connect_error. */
  function intentar(auth) {
    const socket = conectar(url, { transports: ['websocket'], reconnection: false, auth });
    abiertos.push(socket);
    return new Promise((resolve) => {
      socket.on('connect', () => resolve('conectado'));
      socket.on('connect_error', (e) => resolve(e.message));
    });
  }

  test('sin token o con token inválido la conexión se rechaza con NO_AUTORIZADO', async () => {
    const apiKey = ctx.llave;
    expect(await intentar({ apiKey })).toBe('NO_AUTORIZADO');
    expect(await intentar({ apiKey, token: 'basura' })).toBe('NO_AUTORIZADO');
    const otroSecreto = crearEmisorTokens('otro-secreto-de-prueba-con-32-caracteres!');
    expect(await intentar({ apiKey, token: otroSecreto.firmar('ana') })).toBe('NO_AUTORIZADO');
  });

  test('con token válido se conecta', async () => {
    expect(await intentar({ apiKey: ctx.llave, token: ctx.token })).toBe('conectado');
  });
});
