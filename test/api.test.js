// test/api.test.js
// Pruebas de la API REST (routers de mesas y menú) a través de crearApp().
// Levanta el servidor real en un puerto libre y usa fetch (incluido en Node 20),
// por lo que no requiere dependencias nuevas.

const { crearAppConSesion } = require('./sesion');
const { SocketNotificador } = require('../src/infraestructura/notificador');

let ctx;
let base;

beforeEach(async () => {
  ctx = crearAppConSesion();
  await new Promise((resolve) => ctx.server.listen(0, resolve));
  base = `http://127.0.0.1:${ctx.server.address().port}`;
});

afterEach(async () => {
  await ctx.io.close(); // también cierra el servidor HTTP asociado
});

async function llamar(metodo, ruta, cuerpo) {
  const opciones = {
    method: metodo,
    headers: ctx.cabeceras({ 'Content-Type': 'application/json' })
  };
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

describe('API de mesas: estado del pedido en la lista', () => {
  test('GET /api/mesas incluye estadoPedido: null en las mesas sin pedido', async () => {
    const { mesas } = (await llamar('GET', '/api/mesas')).json;
    expect(mesas[0]).toEqual({
      id: 'Mesa 1',
      numero: 1,
      estado: 'libre',
      estadoPedido: null,
      pedidoDesde: null
    });
    expect(mesas.every((m) => m.estadoPedido === null)).toBe(true);
  });

  test('GET /api/mesas y GET /api/mesas/:numero reflejan el estado del pedido vigente', async () => {
    ctx.pedidoService.actualizarEstado({ mesa: 'Mesa 2', estado: 'Recibido 📝' });
    ctx.pedidoService.confirmarPedido({ mesa: 'Mesa 5', items: [{ id: 1, cantidad: 1 }] });

    const { mesas } = (await llamar('GET', '/api/mesas')).json;
    expect(mesas.find((m) => m.numero === 2)).toMatchObject({
      estado: 'ocupada',
      estadoPedido: 'Recibido 📝'
    });
    expect(mesas.find((m) => m.numero === 5).estadoPedido).toBe('En Cocina 🍳');
    expect(mesas.find((m) => m.numero === 1).estadoPedido).toBeNull();

    const una = (await llamar('GET', '/api/mesas/5')).json.mesa;
    expect(una).toEqual({
      id: 'Mesa 5',
      numero: 5,
      estado: 'ocupada',
      estadoPedido: 'En Cocina 🍳',
      pedidoDesde: expect.any(String)
    });
  });
});

describe('API de mesas: pedido "Listo 🍽️" y liberar la mesa', () => {
  test('GET /api/mesas/:numero/pedido valida entradas y mesa inexistente', async () => {
    expect((await llamar('GET', '/api/mesas/abc/pedido')).status).toBe(400);

    const ausente = await llamar('GET', '/api/mesas/11/pedido');
    expect(ausente.status).toBe(404);
    expect(ausente.json.tipo).toBe('NO_ENCONTRADO');
  });

  test('con el pedido Listo, la mesa sigue ocupada y la lista lo refleja', async () => {
    ctx.pedidoService.confirmarPedido({ mesa: 'Mesa 2', items: [{ id: 1, cantidad: 1 }] });
    ctx.pedidoService.actualizarEstado({ mesa: 'Mesa 2', estado: 'Listo 🍽️' });

    const mesa = (await llamar('GET', '/api/mesas/2')).json.mesa;
    expect(mesa).toMatchObject({ estado: 'ocupada', estadoPedido: 'Listo 🍽️' });

    const resumen = (await llamar('GET', '/api/mesas/2/pedido')).json;
    expect(resumen.estado).toBe('Listo 🍽️');
    expect(resumen.total).toBe(8500);
  });

  test('POST /cerrar con el pedido Listo responde 200, cierra el pedido y libera la mesa', async () => {
    ctx.pedidoService.confirmarPedido({ mesa: 'Mesa 2', items: [{ id: 1, cantidad: 1 }] });
    ctx.pedidoService.actualizarEstado({ mesa: 'Mesa 2', estado: 'Listo 🍽️' });

    const r = await llamar('POST', '/api/mesas/2/cerrar');
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true, mesa: 'Mesa 2', estado: 'libre' });

    const mesa = (await llamar('GET', '/api/mesas/2')).json.mesa;
    expect(mesa).toMatchObject({ estado: 'libre', estadoPedido: null });
    expect((await llamar('GET', '/api/mesas/2/pedido')).json.items).toEqual([]);
  });

  test('POST /cerrar con el pedido En Cocina sigue respondiendo 409 (PEDIDO_ACTIVO)', async () => {
    ctx.pedidoService.confirmarPedido({ mesa: 'Mesa 2', items: [{ id: 1, cantidad: 1 }] });
    const r = await llamar('POST', '/api/mesas/2/cerrar');
    expect(r.status).toBe(409);
    expect(r.json.tipo).toBe('PEDIDO_ACTIVO');
  });
});

describe('API de configuración de mesas (agregar y quitar)', () => {
  test('POST /api/mesas sin cuerpo agrega la mesa siguiente y responde 201', async () => {
    const r = await llamar('POST', '/api/mesas');
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({
      ok: true,
      mesa: { id: 'Mesa 11', numero: 11, estado: 'libre' }
    });
    expect((await llamar('GET', '/api/mesas')).json.mesas).toHaveLength(11);
  });

  test('POST /api/mesas con número agrega esa mesa y la lista queda ordenada', async () => {
    const r = await llamar('POST', '/api/mesas', { numero: 20 });
    expect(r.status).toBe(201);
    expect(r.json.mesa).toMatchObject({ id: 'Mesa 20', numero: 20 });
    const { mesas } = (await llamar('GET', '/api/mesas')).json;
    expect(mesas.map((m) => m.numero)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20]);
  });

  test('POST rechaza un número inválido (400) y uno repetido (409)', async () => {
    const invalido = await llamar('POST', '/api/mesas', { numero: 'abc' });
    expect(invalido.status).toBe(400);
    expect(invalido.json.tipo).toBe('ENTRADA_INVALIDA');

    const fueraDeRango = await llamar('POST', '/api/mesas', { numero: 100 });
    expect(fueraDeRango.status).toBe(400);

    const repetido = await llamar('POST', '/api/mesas', { numero: 3 });
    expect(repetido.status).toBe(409);
    expect(repetido.json).toEqual({ ok: false, tipo: 'DUPLICADO', error: 'La mesa 3 ya existe.' });
    expect((await llamar('GET', '/api/mesas')).json.mesas).toHaveLength(10);
  });

  test('POST sin número con la mesa 99 ya creada responde 409 (LIMITE_ALCANZADO)', async () => {
    await llamar('POST', '/api/mesas', { numero: 99 });
    const r = await llamar('POST', '/api/mesas');
    expect(r.status).toBe(409);
    expect(r.json.tipo).toBe('LIMITE_ALCANZADO');
  });

  test('una mesa agregada funciona como cualquier otra (se puede abrir)', async () => {
    await llamar('POST', '/api/mesas');
    const r = await llamar('POST', '/api/mesas/11/abrir');
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true, mesa: 'Mesa 11', estado: 'ocupada' });
  });

  test('DELETE /api/mesas/:numero quita una mesa libre y responde 200', async () => {
    const r = await llamar('DELETE', '/api/mesas/10');
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true, mesa: 'Mesa 10' });
    expect((await llamar('GET', '/api/mesas/10')).status).toBe(404);
    expect((await llamar('GET', '/api/mesas')).json.mesas).toHaveLength(9);
  });

  test('DELETE responde 400 si el número es inválido y 404 si la mesa no existe', async () => {
    expect((await llamar('DELETE', '/api/mesas/abc')).status).toBe(400);
    expect((await llamar('DELETE', '/api/mesas/0')).status).toBe(400);
    expect((await llamar('DELETE', '/api/mesas/11')).status).toBe(404);
  });

  test('DELETE de una mesa ocupada responde 409 y la mesa sigue existiendo', async () => {
    await llamar('POST', '/api/mesas/4/abrir');
    const r = await llamar('DELETE', '/api/mesas/4');
    expect(r.status).toBe(409);
    expect(r.json.tipo).toBe('ESTADO_NO_PERMITIDO');
    expect(r.json.error).toMatch(/está ocupada/);
    expect(ctx.mesas.obtener('Mesa 4')).not.toBeNull();
  });

  test('DELETE de una mesa con pedido vigente responde 409 (PEDIDO_ACTIVO)', async () => {
    // Caso defensivo: pedido guardado sobre una mesa que figura libre
    ctx.pedidos.guardar('Mesa 6', { mesa: 'Mesa 6', estado: 'En Cocina 🍳' });
    const r = await llamar('DELETE', '/api/mesas/6');
    expect(r.status).toBe(409);
    expect(r.json.tipo).toBe('PEDIDO_ACTIVO');
    expect(ctx.mesas.obtener('Mesa 6')).not.toBeNull();
  });

  test('si falla a mitad, agregar una mesa no deja nada guardado (transacción)', async () => {
    // La mesa se inserta y luego falla la lectura para el evento: debe deshacerse.
    jest.spyOn(ctx.mesas, 'listar').mockImplementationOnce(() => {
      throw new Error('fallo de lectura');
    });
    const r = await llamar('POST', '/api/mesas', { numero: 30 });
    expect(r.status).toBe(500);
    expect(ctx.mesas.obtener('Mesa 30')).toBeNull();
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