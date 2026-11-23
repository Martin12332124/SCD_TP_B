// test/gateway.test.js
// API gateway (src/presentacion/gateway.js): API key por aplicación, límite de peticiones
// y registro de accesos. Se levanta la app real en un puerto libre.
// Las llaves son aleatorias en cada corrida: no hay valores reales en el repo.

const crypto = require('crypto');
const { io: conectar } = require('socket.io-client');
const { crearApp } = require('../src/app');
const { leerLlaves, lineaDeAcceso, crearGateway } = require('../src/presentacion/gateway');
const { SECRETO_PRUEBA } = require('./sesion');
const { crearEmisorTokens } = require('../src/infraestructura/seguridad/tokens');

const nuevaLlave = () => crypto.randomBytes(24).toString('base64url');
const LLAVE_WEB = nuevaLlave();
const LLAVE_COCINA = nuevaLlave();
const TOKEN = crearEmisorTokens(SECRETO_PRUEBA).firmar('prueba');

let ctx;
let base;
let lineas;
const abiertos = [];

/** App con el gateway real (límites por defecto salvo que se indiquen) y registro capturado. */
async function levantar(gateway = {}) {
  lineas = [];
  ctx = crearApp({
    autenticacion: { secreto: SECRETO_PRUEBA },
    gateway: {
      llaves: [
        { nombre: 'web', llave: LLAVE_WEB },
        { nombre: 'cocina', llave: LLAVE_COCINA }
      ],
      registrar: (linea) => lineas.push(linea),
      ...gateway
    }
  });
  await new Promise((resolve) => ctx.server.listen(0, resolve));
  base = `http://127.0.0.1:${ctx.server.address().port}`;
}

afterEach(async () => {
  abiertos.splice(0).forEach((s) => s.close());
  if (ctx) await ctx.io.close();
  ctx = null;
});

const pedir = (ruta, { llave, token = TOKEN, ...opciones } = {}) =>
  fetch(base + ruta, {
    ...opciones,
    headers: {
      ...(llave ? { 'x-api-key': llave } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
      ...opciones.headers
    }
  });

const login = (llave, cuerpo = { usuario: 'ana', contrasena: 'clave-incorrecta-1' }) =>
  pedir('/api/auth/login', { llave, token: null, method: 'POST', body: JSON.stringify(cuerpo) });

// ─────────────────────────────────────────────────────────────────────────────
describe('leerLlaves (formato de API_KEYS)', () => {
  test('lee una o varias entradas nombre:llave', () => {
    expect(leerLlaves('web:abcdefghijklmnop')).toEqual([
      { nombre: 'web', llave: 'abcdefghijklmnop' }
    ]);
    expect(leerLlaves(' web:abcdefghijklmnop , cocina:0123456789abcdef ')).toEqual([
      { nombre: 'web', llave: 'abcdefghijklmnop' },
      { nombre: 'cocina', llave: '0123456789abcdef' }
    ]);
  });

  test('la llave puede contener ":" (se corta en el primero)', () => {
    expect(leerLlaves('web:abc:def:ghi:jkl:mno')[0].llave).toBe('abc:def:ghi:jkl:mno');
  });

  test.each([
    ['vacía', ''],
    ['indefinida', undefined],
    ['sin nombre', ':abcdefghijklmnop'],
    ['sin dos puntos', 'abcdefghijklmnop'],
    ['nombre con caracteres raros', 'we b:abcdefghijklmnop'],
    ['llave corta', 'web:corta'],
    ['entrada vacía', 'web:abcdefghijklmnop,'],
    ['nombre repetido', 'web:abcdefghijklmnop,web:0123456789abcdef'],
    ['llave repetida', 'web:abcdefghijklmnop,cocina:abcdefghijklmnop']
  ])('rechaza API_KEYS %s', (_caso, texto) => {
    expect(() => leerLlaves(texto)).toThrow(/API_KEYS/);
  });

  test('el mensaje de error de una llave corta no revela la llave', () => {
    expect(() => leerLlaves('web:secreta')).toThrow(/"web"/);
    expect(() => leerLlaves('web:secreta')).not.toThrow(/secreta/);
  });

  test('crearGateway sin llaves falla (nunca arranca abierto)', () => {
    expect(() => crearGateway({ llaves: [] })).toThrow(/al menos una/);
    expect(() => crearGateway({})).toThrow(/al menos una/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('API key en la API REST', () => {
  beforeEach(() => levantar());

  test('sin llave → 401 API_KEY_INVALIDA, aunque el JWT sea válido', async () => {
    const r = await pedir('/api/mesas');
    expect(r.status).toBe(401);
    expect(await r.json()).toMatchObject({ ok: false, tipo: 'API_KEY_INVALIDA' });
  });

  test('llave inválida o de otra longitud → 401 API_KEY_INVALIDA', async () => {
    for (const llave of ['llave-equivocada', 'x', LLAVE_WEB + 'x', LLAVE_WEB.slice(1)]) {
      const r = await pedir('/api/mesas', { llave });
      expect(r.status).toBe(401);
      expect((await r.json()).tipo).toBe('API_KEY_INVALIDA');
    }
  });

  test('llave válida + JWT válido → 200', async () => {
    const r = await pedir('/api/mesas', { llave: LLAVE_WEB });
    expect(r.status).toBe(200);
  });

  test('llave válida pero sin JWT → 401 NO_AUTORIZADO: son dos capas distintas', async () => {
    const r = await pedir('/api/mesas', { llave: LLAVE_WEB, token: null });
    expect(r.status).toBe(401);
    expect((await r.json()).tipo).toBe('NO_AUTORIZADO');
  });

  test('también el login exige la llave (sin ella ni se prueba una contraseña)', async () => {
    const sin = await login(undefined);
    expect(sin.status).toBe(401);
    expect((await sin.json()).tipo).toBe('API_KEY_INVALIDA');

    const con = await login(LLAVE_WEB);
    expect(con.status).toBe(401);
    expect((await con.json()).tipo).toBe('CREDENCIALES_INVALIDAS'); // llegó al servicio de login
  });

  test('rotación: con dos llaves a la vez, las dos funcionan; al retirar una, deja de servir', async () => {
    expect((await pedir('/api/mesas', { llave: LLAVE_WEB })).status).toBe(200);
    expect((await pedir('/api/mesas', { llave: LLAVE_COCINA })).status).toBe(200);

    // "Se reinicia" el servidor con solo la llave nueva (la vieja ya se retiró del .env).
    await ctx.io.close();
    await levantar({ llaves: [{ nombre: 'cocina', llave: LLAVE_COCINA }] });
    expect((await pedir('/api/mesas', { llave: LLAVE_WEB })).status).toBe(401);
    expect((await pedir('/api/mesas', { llave: LLAVE_COCINA })).status).toBe(200);
  });

  test('una ruta de /api inexistente también pide la llave', async () => {
    expect((await pedir('/api/no-existe')).status).toBe(401);
  });

  test('el preflight CORS y la ruta raíz no llevan llave y siguen funcionando', async () => {
    expect((await fetch(`${base}/api/mesas`, { method: 'OPTIONS' })).status).toBe(204);
    expect((await fetch(`${base}/`)).status).toBe(200);
  });

  test('el rechazo lleva las cabeceras CORS (si no, el navegador no vería el 401)', async () => {
    const r = await pedir('/api/mesas');
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('límite de peticiones', () => {
  test('login: la 6.ª petición en un minuto desde la misma IP → 429 DEMASIADAS_PETICIONES', async () => {
    await levantar(); // límites por defecto: 5 por minuto
    for (let i = 1; i <= 5; i++) {
      expect((await login(LLAVE_WEB)).status).toBe(401); // contraseña mala, pero se atiende
    }
    const sexta = await login(LLAVE_WEB);
    expect(sexta.status).toBe(429);
    expect(await sexta.json()).toMatchObject({ ok: false, tipo: 'DEMASIADAS_PETICIONES' });
    expect(Number(sexta.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  test('los login exitosos no cuentan: solo frenan las contraseñas malas', async () => {
    await levantar({ limites: { login: { max: 2 } } });
    await ctx.usuarioService.crearUsuariosIniciales('ana:clave-larga-123');
    const bueno = { usuario: 'ana', contrasena: 'clave-larga-123' };
    for (let i = 0; i < 6; i++) expect((await login(LLAVE_WEB, bueno)).status).toBe(200);
    expect((await login(LLAVE_WEB)).status).toBe(401); // 1.er fallo
    expect((await login(LLAVE_WEB, bueno)).status).toBe(200); // entrar bien sigue sin contar
    expect((await login(LLAVE_WEB)).status).toBe(401); // 2.º fallo
    expect((await login(LLAVE_WEB)).status).toBe(429); // el 3.º ya no pasa
  });

  test('el límite del login es por IP: otra llave desde la misma IP comparte el cupo', async () => {
    await levantar({ limites: { login: { max: 2 } } });
    await login(LLAVE_WEB);
    await login(LLAVE_COCINA);
    expect((await login(LLAVE_WEB)).status).toBe(429);
  });

  test('quien no tiene llave no gasta el cupo de login (se rechaza antes)', async () => {
    await levantar({ limites: { login: { max: 2 } } });
    for (let i = 0; i < 5; i++) expect((await login(undefined)).status).toBe(401);
    expect((await login(LLAVE_WEB)).status).toBe(401); // sigue habiendo cupo
  });

  test('resto de /api: el límite es por llave y no por IP', async () => {
    await levantar({ limites: { general: { max: 3 } } });
    for (let i = 0; i < 3; i++)
      expect((await pedir('/api/mesas', { llave: LLAVE_WEB })).status).toBe(200);
    const excedida = await pedir('/api/mesas', { llave: LLAVE_WEB });
    expect(excedida.status).toBe(429);
    expect((await excedida.json()).tipo).toBe('DEMASIADAS_PETICIONES');
    // La otra aplicación, desde la misma IP, tiene su propio cupo.
    expect((await pedir('/api/mesas', { llave: LLAVE_COCINA })).status).toBe(200);
  });

  test('el login no gasta el cupo general ni al revés', async () => {
    await levantar({ limites: { general: { max: 1 }, login: { max: 1 } } });
    expect((await login(LLAVE_WEB)).status).toBe(401);
    expect((await pedir('/api/mesas', { llave: LLAVE_WEB })).status).toBe(200);
    expect((await login(LLAVE_WEB)).status).toBe(429);
    expect((await pedir('/api/mesas', { llave: LLAVE_WEB })).status).toBe(429);
  });

  test('el límite por defecto del resto de /api es 600 por minuto por llave', async () => {
    await levantar();
    const respuestas = [];
    for (let i = 0; i < 601; i++) {
      respuestas.push((await pedir('/api/menu-items', { llave: LLAVE_WEB })).status);
    }
    expect(respuestas.slice(0, 600).every((s) => s === 200)).toBe(true);
    expect(respuestas[600]).toBe(429);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Socket.IO: la llave en el handshake', () => {
  beforeEach(() => levantar());

  function intentar(opciones) {
    const socket = conectar(base, { reconnection: false, ...opciones });
    abiertos.push(socket);
    return new Promise((resolve) => {
      socket.on('connect', () => resolve('conectado'));
      socket.on('connect_error', (e) => resolve(e.message));
    });
  }

  test('sin llave se rechaza con API_KEY_INVALIDA, aunque el token sea válido', async () => {
    expect(await intentar({ transports: ['websocket'], auth: { token: TOKEN } })).toBe(
      'API_KEY_INVALIDA'
    );
  });

  test('con llave inválida se rechaza; con llave válida y token se conecta', async () => {
    expect(
      await intentar({
        transports: ['websocket'],
        auth: { token: TOKEN, apiKey: 'llave-mala-1234567' }
      })
    ).toBe('API_KEY_INVALIDA');
    expect(
      await intentar({ transports: ['websocket'], auth: { token: TOKEN, apiKey: LLAVE_COCINA } })
    ).toBe('conectado');
  });

  test('con llave válida pero sin token se rechaza con NO_AUTORIZADO (primero la llave, luego el usuario)', async () => {
    expect(await intentar({ transports: ['websocket'], auth: { apiKey: LLAVE_WEB } })).toBe(
      'NO_AUTORIZADO'
    );
  });

  test('la llave también se acepta en la cabecera x-api-key del handshake', async () => {
    expect(
      await intentar({
        transports: ['polling'],
        auth: { token: TOKEN },
        extraHeaders: { 'x-api-key': LLAVE_WEB }
      })
    ).toBe('conectado');
  });

  test('el handshake queda en el registro con el nombre de la llave', async () => {
    await intentar({ transports: ['websocket'], auth: { token: TOKEN, apiKey: LLAVE_COCINA } });
    await intentar({ transports: ['websocket'], auth: { token: TOKEN } });
    expect(lineas.some((l) => /app=cocina SOCKET \/socket\.io 101/.test(l))).toBe(true);
    expect(lineas.some((l) => /app=- SOCKET \/socket\.io 401/.test(l))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('registro de accesos', () => {
  beforeEach(() => levantar());

  test('una línea por petición: hora, nombre de la llave, método, ruta, estado y ms', async () => {
    await pedir('/api/mesas', { llave: LLAVE_WEB });
    await pedir('/api/mesas/1/abrir', { llave: LLAVE_COCINA, method: 'POST' });
    expect(lineas).toHaveLength(2);
    expect(lineas[0]).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z app=web GET \/api\/mesas 200 \d+ms$/
    );
    expect(lineas[1]).toMatch(/ app=cocina POST \/api\/mesas\/1\/abrir 200 \d+ms$/);
  });

  test('las peticiones rechazadas también quedan, con nombre "-" si la llave no es válida', async () => {
    await pedir('/api/mesas', { llave: 'llave-equivocada' });
    await pedir('/api/mesas');
    expect(lineas[0]).toMatch(/ app=- GET \/api\/mesas 401 \d+ms$/);
    expect(lineas[1]).toMatch(/ app=- GET \/api\/mesas 401 \d+ms$/);
  });

  test('un 429 queda registrado con el nombre de la llave', async () => {
    await ctx.io.close();
    await levantar({ limites: { general: { max: 1 } } });
    await pedir('/api/mesas', { llave: LLAVE_WEB });
    await pedir('/api/mesas', { llave: LLAVE_WEB });
    expect(lineas[1]).toMatch(/ app=web GET \/api\/mesas 429 /);
  });

  test('el registro nunca contiene la llave, ni la presentada ni las configuradas', async () => {
    await pedir('/api/mesas', { llave: LLAVE_WEB });
    await pedir('/api/mesas', { llave: LLAVE_COCINA });
    await pedir('/api/mesas', { llave: 'llave-equivocada-que-alguien-probo' });
    await login(LLAVE_WEB);
    const todo = lineas.join('\n');
    expect(todo).not.toContain(LLAVE_WEB);
    expect(todo).not.toContain(LLAVE_COCINA);
    expect(todo).not.toContain('llave-equivocada-que-alguien-probo');
    expect(todo).not.toContain(TOKEN);
  });

  test('la ruta se registra sin la query (puede traer datos que no deben quedar en el log)', async () => {
    await pedir('/api/mesas?dato=privado', { llave: LLAVE_WEB });
    expect(lineas[0]).toContain(' GET /api/mesas 200 ');
    expect(lineas[0]).not.toContain('privado');
  });

  test('lineaDeAcceso arma el formato esperado', () => {
    expect(
      lineaDeAcceso({
        hora: new Date('2026-11-21T12:00:00.000Z'),
        nombre: 'web',
        metodo: 'GET',
        ruta: '/api/mesas',
        estado: 200,
        ms: 7
      })
    ).toBe('2026-11-21T12:00:00.000Z app=web GET /api/mesas 200 7ms');
  });

  test('sin `registrar` (el valor por defecto) la app funciona y no escribe nada', async () => {
    await ctx.io.close();
    ctx = crearApp({
      autenticacion: { secreto: SECRETO_PRUEBA },
      gateway: { llaves: [{ nombre: 'web', llave: LLAVE_WEB }] }
    });
    await new Promise((resolve) => ctx.server.listen(0, resolve));
    base = `http://127.0.0.1:${ctx.server.address().port}`;
    expect((await pedir('/api/mesas', { llave: LLAVE_WEB })).status).toBe(200);
  });

  test('crearApp sin llaves usa una aleatoria: nadie entra a /api', async () => {
    await ctx.io.close();
    ctx = crearApp({ autenticacion: { secreto: SECRETO_PRUEBA } });
    await new Promise((resolve) => ctx.server.listen(0, resolve));
    base = `http://127.0.0.1:${ctx.server.address().port}`;
    expect((await pedir('/api/mesas', { llave: LLAVE_WEB })).status).toBe(401);
  });
});
