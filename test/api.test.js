// test/api.test.js
// Pruebas de la API REST (routers de mesas y menú) a través de crearApp().
// Levanta el servidor real en un puerto libre y usa fetch (incluido en Node 20),
// por lo que no requiere dependencias nuevas.

const { crearApp } = require('../src/app');
const { SocketNotificador } = require('../src/infraestructura/notificador');

let ctx;
let base;

beforeEach(async () => {
  ctx = crearApp();
  await new Promise((resolve) => ctx.server.listen(0, resolve));
  base = `http://127.0.0.1:${ctx.server.address().port}`;
});

afterEach(async () => {
  await ctx.io.close(); // también cierra el servidor HTTP asociado
});

async function llamar(metodo, ruta, cuerpo) {
  const opciones = { method: metodo, headers: { 'Content-Type': 'application/json' } };
  if (cuerpo !== undefined) opciones.body = typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo);
  const res = await fetch(base + ruta, opciones);
  return { status: res.status, json: await res.json() };
}

describe('API de mesas (US-08 y US-09)', () => {
  test('POST /abrir ocupa una mesa libre y responde 200', async () => {
    const r = await llamar('POST', '/api/mesas/1/abrir');
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true, mesa: 'Mesa 1', estado: 'ocupada' });
  });

  test('POST /abrir sobre una mesa ya ocupada responde 409 (ESTADO_NO_PERMITIDO)', async () => {
    await llamar('POST', '/api/mesas/1/abrir');
    const r = await llamar('POST', '/api/mesas/1/abrir');
    expect(r.status).toBe(409);
    expect(r.json.tipo).toBe('ESTADO_NO_PERMITIDO');
  });

  test('POST /abrir con número inválido responde 400 y con mesa inexistente 404', async () => {
    expect((await llamar('POST', '/api/mesas/abc/abrir')).status).toBe(400);
    expect((await llamar('POST', '/api/mesas/11/abrir')).status).toBe(404);
  });

  test('POST /cerrar libera una mesa ocupada sin pedido y responde 200', async () => {
    await llamar('POST', '/api/mesas/2/abrir');
    const r = await llamar('POST', '/api/mesas/2/cerrar');
    expect(r.status).toBe(200);
    expect(r.json.estado).toBe('libre');
  });

  test('REGRESIÓN US-09: POST /cerrar con pedido activo responde 409 (PEDIDO_ACTIVO)', async () => {
    await llamar('POST', '/api/mesas/3/abrir');
    ctx.pedidos.guardar('Mesa 3', { estado: 'En Espera' });
    const r = await llamar('POST', '/api/mesas/3/cerrar');
    expect(r.status).toBe(409);
    expect(r.json.tipo).toBe('PEDIDO_ACTIVO');
    expect(ctx.mesas.obtener('Mesa 3').estado).toBe('ocupada');
  });

  test('POST /cerrar sobre una mesa libre responde 409', async () => {
    expect((await llamar('POST', '/api/mesas/4/cerrar')).status).toBe(409);
  });
    test('GET /api/mesas lista las 10 mesas, todas libres al iniciar (US-08)', async () => {
    const r = await llamar('GET', '/api/mesas');
    expect(r.status).toBe(200);
    expect(r.json.mesas).toHaveLength(10);
    expect(r.json.mesas.every((m) => m.estado === 'libre')).toBe(true);
  });

  test('GET /api/mesas/:numero refleja el cambio de estado (US-08)', async () => {
    await llamar('POST', '/api/mesas/1/abrir');
    const r = await llamar('GET', '/api/mesas/1');
    expect(r.status).toBe(200);
    expect(r.json.mesa).toMatchObject({ id: 'Mesa 1', numero: 1, estado: 'ocupada' });
  });

  test('GET /api/mesas/:numero responde 400 si es inválido y 404 si no existe', async () => {
    expect((await llamar('GET', '/api/mesas/abc')).status).toBe(400);
    expect((await llamar('GET', '/api/mesas/0')).status).toBe(400);
    expect((await llamar('GET', '/api/mesas/1e1')).status).toBe(400);
    expect((await llamar('GET', '/api/mesas/11')).status).toBe(404);
  });
});

describe('API del menú (US-07)', () => {
  test('GET /api/menu-items lista los ítems iniciales', async () => {
    const r = await llamar('GET', '/api/menu-items');
    expect(r.status).toBe(200);
    expect(r.json.items).toHaveLength(3);
  });

  test('GET /api/menu-items/:id devuelve 200, 404 o 400 según el id', async () => {
    expect((await llamar('GET', '/api/menu-items/1')).status).toBe(200);
    expect((await llamar('GET', '/api/menu-items/999')).status).toBe(404);
    expect((await llamar('GET', '/api/menu-items/abc')).status).toBe(400);
  });

  test('POST crea un ítem y responde 201', async () => {
    const r = await llamar('POST', '/api/menu-items', { nombre: 'Tiramisú', precioBase: 4200 });
    expect(r.status).toBe(201);
    expect(r.json.item.disponible).toBe(true);
  });

  test('POST rechaza precio fuera de rango (400) y nombre repetido (409)', async () => {
    const malo = await llamar('POST', '/api/menu-items', { nombre: 'Caro', precioBase: 1000001 });
    expect(malo.status).toBe(400);
    const dup = await llamar('POST', '/api/menu-items', { nombre: 'pizza margarita', precioBase: 100 });
    expect(dup.status).toBe(409);
  });

  test('PUT edita el precio (200) y REGRESIÓN US-07: un id inexistente responde 404', async () => {
    const ok = await llamar('PUT', '/api/menu-items/1', { precioBase: 9000 });
    expect(ok.status).toBe(200);
    expect(ok.json.item.precioBase).toBe(9000);
    const noExiste = await llamar('PUT', '/api/menu-items/999', { precioBase: 9000 });
    expect(noExiste.status).toBe(404);
  });

  test('PUT con un nombre que ya tiene otro ítem responde 409', async () => {
    const r = await llamar('PUT', '/api/menu-items/1', { nombre: 'Coca-Cola 500 ml' });
    expect(r.status).toBe(409);
  });
});

describe('Aplicación (app.js)', () => {
  test('GET / responde que el servidor está operativo', async () => {
    const res = await fetch(base + '/');
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/operativo/);
  });

  test('un JSON malformado responde 400 en formato JSON (no HTML)', async () => {
    const r = await llamar('POST', '/api/menu-items', '{"nombre": ');
    expect(r.status).toBe(400);
    expect(r.json.tipo).toBe('ENTRADA_INVALIDA');
  });
});

describe('SocketNotificador', () => {
  test('exige una instancia de Socket.io al construirse', () => {
    expect(() => new SocketNotificador()).toThrow();
  });

  test('emitir reenvía el evento y los datos al servidor de sockets', () => {
    const io = { emit: jest.fn() };
    new SocketNotificador(io).emitir('evento_x', { a: 1 });
    expect(io.emit).toHaveBeenCalledWith('evento_x', { a: 1 });
  });
});