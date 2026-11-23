// test/sincronizacion.test.js
// Pruebas del sistema híbrido: réplica local → nube y buzón de órdenes nube → local.
// Supabase se reemplaza por NubeEnMemoria (test/doble-nube.js): no hay red.

const { crearApp } = require('../src/app');
const { abrirBaseDeDatos } = require('../src/infraestructura/sqlite/conexion');
const { leerEstadoLocal } = require('../src/infraestructura/sincronizacion/estado-local');
const { RegistroOrdenesSQLite } = require('../src/infraestructura/sincronizacion/registro-ordenes');
const {
  Sincronizador,
  NotificadorConAviso,
  tareaSinSolapamiento
} = require('../src/infraestructura/sincronizacion/sincronizador');
const {
  AplicadorOrdenes,
  TIPOS_DE_ORDEN,
  VENCIMIENTO_ORDEN_MS
} = require('../src/presentacion/ordenes-nube');
const { NubeEnMemoria, consolaEspia, esperar } = require('./doble-nube');

const PIZZA = { id: 1, cantidad: 2 };

/** crearApp con la sincronización conectada a una nube en memoria. */
function crearAppConNube({ esperaMs = 5 } = {}) {
  const nube = new NubeEnMemoria();
  const consola = consolaEspia();
  const ctx = crearApp({
    sincronizacion: { cliente: nube, esperaMs, intervaloMs: 60000, consola }
  });
  return { ...ctx, nube, consola };
}

function cerrar(ctx) {
  if (ctx.sincronizador) ctx.sincronizador.detener();
  ctx.io.close();
  ctx.db.close();
}

// ─────────────────────────────────────────────────────────────────────────────
describe('crearApp sin sincronización (sin .env)', () => {
  test('no crea sincronizador ni la tabla ordenes_aplicadas', () => {
    const ctx = crearApp();
    const tablas = ctx.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((t) => t.name);
    expect(ctx.sincronizador).toBeNull();
    expect(tablas).not.toContain('ordenes_aplicadas');
    cerrar(ctx);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('leerEstadoLocal', () => {
  test('devuelve las cuatro tablas con columnas de base de datos y booleanos reales', () => {
    const ctx = crearApp();
    ctx.mesaEstadoService.abrirMesa('1');
    ctx.pedidoService.confirmarPedido({ mesa: 'Mesa 1', items: [PIZZA] });

    const estado = leerEstadoLocal(ctx.db);

    expect(Object.keys(estado).sort()).toEqual(['menu_items', 'mesas', 'pedido_items', 'pedidos']);
    expect(estado.mesas).toHaveLength(10);
    expect(estado.mesas[0]).toEqual({ id: 'Mesa 1', numero: 1, estado: 'ocupada' });
    expect(estado.menu_items[0]).toEqual({
      id: 1,
      nombre: 'Pizza Margarita',
      precio_base: 8500,
      disponible: true
    });
    expect(estado.pedidos).toEqual([
      { mesa_id: 'Mesa 1', estado: 'En Cocina 🍳', estado_desde: expect.any(String) }
    ]);
    expect(estado.pedido_items).toEqual([
      {
        mesa_id: 'Mesa 1',
        posicion: 0,
        item_id: 1,
        nombre: 'Pizza Margarita',
        precio_base: 8500,
        cantidad: 2
      }
    ]);
    cerrar(ctx);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('RegistroOrdenesSQLite', () => {
  test('guarda y recupera el resultado de una orden; desconocida → null', () => {
    const db = abrirBaseDeDatos(':memory:');
    const registro = new RegistroOrdenesSQLite(db, () => '2026-11-21T12:00:00.000Z');
    expect(registro.obtener(7)).toBeNull();

    registro.guardar(7, 'aplicada', { ok: true, mesa: 'Mesa 1' });

    expect(registro.obtener(7)).toEqual({
      id: 7,
      estado: 'aplicada',
      resultado: { ok: true, mesa: 'Mesa 1' }
    });
    db.close();
  });

  test('crear el registro dos veces sobre la misma base no falla ni borra datos', () => {
    const db = abrirBaseDeDatos(':memory:');
    new RegistroOrdenesSQLite(db).guardar(1, 'rechazada', { ok: false });
    expect(new RegistroOrdenesSQLite(db).obtener(1).estado).toBe('rechazada');
    db.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('AplicadorOrdenes', () => {
  let ctx;
  beforeEach(() => {
    ctx = crearAppConNube();
  });
  afterEach(() => cerrar(ctx));

  const aplicar = (id, tipo, payload) => ctx.sincronizador._aplicarOrden({ id, tipo, payload });

  test('exige sus dependencias', () => {
    expect(() => new AplicadorOrdenes({ registro: {} })).toThrow('servicios');
    expect(() => new AplicadorOrdenes({ servicios: {} })).toThrow('registro');
  });

  test('cada tipo de orden llama al mismo caso de uso que REST y Socket.IO', () => {
    expect(aplicar(1, 'abrir_mesa', { numero: 1 })).toEqual({
      estado: 'aplicada',
      resultado: { ok: true, mesa: 'Mesa 1', estado: 'ocupada' }
    });
    expect(aplicar(2, 'confirmar_pedido', { mesa: 'Mesa 1', items: [PIZZA] }).estado).toBe(
      'aplicada'
    );
    expect(ctx.pedidos.obtener('Mesa 1').estado).toBe('En Cocina 🍳');

    expect(aplicar(3, 'actualizar_estado', { mesa: 'Mesa 1', estado: 'Listo 🍽️' }).estado).toBe(
      'aplicada'
    );
    expect(aplicar(4, 'trasladar_pedido', { origen: 1, destino: 2 }).estado).toBe('aplicada');
    expect(ctx.pedidos.obtener('Mesa 2').estado).toBe('Listo 🍽️');

    expect(aplicar(5, 'cerrar_mesa', { numero: 2 }).estado).toBe('aplicada');
    expect(aplicar(6, 'agregar_mesa', { numero: 11 }).estado).toBe('aplicada');
    expect(aplicar(7, 'quitar_mesa', { numero: 11 }).estado).toBe('aplicada');
    expect(ctx.mesas.obtener('Mesa 11')).toBeNull();
    expect(Object.keys(TIPOS_DE_ORDEN)).toHaveLength(7);
  });

  test('una orden que el dominio rechaza queda rechazada con su motivo', () => {
    const r = aplicar(1, 'confirmar_pedido', { mesa: 'Mesa 1', items: [{ id: 1, cantidad: 0 }] });
    expect(r.estado).toBe('rechazada');
    expect(r.resultado).toMatchObject({ ok: false, tipo: 'ENTRADA_INVALIDA' });
    expect(ctx.pedidos.obtener('Mesa 1')).toBeNull();
  });

  test('tipo desconocido o payload que no es objeto → rechazada por ENTRADA_INVALIDA', () => {
    expect(aplicar(1, 'borrar_todo', {}).resultado).toMatchObject({
      ok: false,
      tipo: 'ENTRADA_INVALIDA',
      error: expect.stringContaining('borrar_todo')
    });
    expect(aplicar(2, 'toString', {}).estado).toBe('rechazada');
    expect(aplicar(3, 'abrir_mesa', null).resultado.tipo).toBe('ENTRADA_INVALIDA');
    expect(aplicar(4, 'abrir_mesa', [1]).resultado.tipo).toBe('ENTRADA_INVALIDA');
  });

  test('la misma orden aplicada dos veces se ejecuta una sola vez (idempotencia)', () => {
    const primera = aplicar(1, 'confirmar_pedido', { mesa: 'Mesa 1', items: [PIZZA] });
    const segunda = aplicar(1, 'confirmar_pedido', { mesa: 'Mesa 1', items: [PIZZA] });

    expect(segunda).toEqual(primera);
    expect(ctx.pedidos.obtener('Mesa 1').items).toEqual([
      { id: 1, nombre: 'Pizza Margarita', precioBase: 8500, cantidad: 2 }
    ]);
  });

  test('si el caso de uso lanza, no queda nada a medias y la orden se rechaza como ERROR_INTERNO', () => {
    ctx.mesaEstadoService.abrirMesa('1');
    const original = ctx.pedidos.guardar.bind(ctx.pedidos);
    let llamadas = 0;
    // Falla la segunda escritura del caso de uso: la primera debe deshacerse.
    ctx.pedidos.guardar = (...args) => {
      if (++llamadas === 2) throw new Error('disco lleno');
      return original(...args);
    };

    const r = aplicar(9, 'confirmar_pedido', { mesa: 'Mesa 1', items: [PIZZA] });

    expect(r).toEqual({
      estado: 'rechazada',
      resultado: { ok: false, tipo: 'ERROR_INTERNO', error: 'disco lleno' }
    });
    expect(ctx.pedidos.obtener('Mesa 1')).toBeNull(); // ROLLBACK
    // Quedó registrada: al reintentar no se vuelve a ejecutar.
    ctx.pedidos.guardar = original;
    expect(aplicar(9, 'confirmar_pedido', { mesa: 'Mesa 1', items: [PIZZA] })).toEqual(r);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Sincronizador: local → nube', () => {
  let ctx;
  afterEach(() => cerrar(ctx));

  test('un pedido confirmado en local llega a la nube por sí solo', async () => {
    ctx = crearAppConNube();
    ctx.mesaEstadoService.abrirMesa('3');
    ctx.pedidoService.confirmarPedido({ mesa: 'Mesa 3', items: [PIZZA] });

    await esperar();

    expect(ctx.nube.estado.pedidos).toEqual([
      expect.objectContaining({ mesa_id: 'Mesa 3', estado: 'En Cocina 🍳' })
    ]);
    expect(ctx.sincronizador.ultimaSincronizacion).toEqual(expect.any(String));
    expect(ctx.sincronizador.estado()).toMatchObject({ enLinea: true });
  });

  test('varias transacciones seguidas viajan en una sola subida', async () => {
    ctx = crearAppConNube({ esperaMs: 20 });
    for (let n = 1; n <= 5; n++) ctx.mesaEstadoService.abrirMesa(String(n));

    await esperar(60);

    expect(ctx.nube.subidas).toBe(1);
    expect(ctx.nube.estado.mesas.filter((m) => m.estado === 'ocupada')).toHaveLength(5);
  });

  test('una operación rechazada no escribe nada y no provoca subida', async () => {
    ctx = crearAppConNube();
    ctx.mesaEstadoService.abrirMesa('99');
    await esperar();
    expect(ctx.nube.subidas).toBe(0);
  });

  test('iniciar pone al día la nube aunque no haya cambios nuevos', async () => {
    ctx = crearAppConNube();
    await ctx.sincronizador.iniciar();
    expect(ctx.nube.estado.mesas).toHaveLength(10);
    expect(ctx.consola.mensajes).toContainEqual(['log', '[SYNC] Sincronizando con Supabase.']);
    // Iniciar dos veces no duplica temporizadores ni suscripciones.
    await ctx.sincronizador.iniciar();
    expect(ctx.nube.subidas).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Sincronizador: buzón de órdenes nube → local', () => {
  let ctx;
  afterEach(() => cerrar(ctx));

  test('una orden insertada en la nube se aplica en local y queda marcada', async () => {
    ctx = crearAppConNube();
    await ctx.sincronizador.iniciar();

    const orden = ctx.nube.insertarOrden('abrir_mesa', { numero: 4 }); // aviso de Realtime
    await esperar();

    expect(ctx.mesas.obtener('Mesa 4').estado).toBe('ocupada');
    expect(orden).toMatchObject({ estado: 'aplicada', resultado: { ok: true } });
    // ...y el cambio vuelve a subir a la nube.
    expect(ctx.nube.estado.mesas.find((m) => m.id === 'Mesa 4').estado).toBe('ocupada');
  });

  test('las órdenes se aplican en orden de id', async () => {
    ctx = crearAppConNube();
    // Sin suscripción (no se llamó iniciar): se acumulan y se procesan juntas.
    const confirmar = ctx.nube.insertarOrden('confirmar_pedido', {
      mesa: 'Mesa 1',
      items: [PIZZA]
    });
    const abrir = ctx.nube.insertarOrden('abrir_mesa', { numero: 1 });

    await ctx.sincronizador.procesarOrdenes();

    // confirmar_pedido no exige mesa abierta: al ir primero, la ocupa,
    // y por eso abrir_mesa (que va después) se rechaza.
    expect(confirmar.estado).toBe('aplicada');
    expect(abrir).toMatchObject({
      estado: 'rechazada',
      resultado: { tipo: 'ESTADO_NO_PERMITIDO' }
    });
    expect(ctx.consola.mensajes).toContainEqual([
      'warn',
      expect.stringContaining('Orden 2 (abrir_mesa) rechazada: ESTADO_NO_PERMITIDO')
    ]);
  });

  test('los eventos de Socket.IO de una orden salen después del COMMIT', async () => {
    ctx = crearAppConNube();
    const emitidos = [];
    const emitirOriginal = ctx.io.emit.bind(ctx.io);
    ctx.io.emit = (evento, datos) => {
      // En el momento de emitir, el cambio ya debe estar guardado.
      emitidos.push({ evento, enTransaccion: ctx.db.inTransaction });
      return emitirOriginal(evento, datos);
    };
    ctx.nube.insertarOrden('abrir_mesa', { numero: 5 });

    await ctx.sincronizador.procesarOrdenes();

    expect(emitidos).toEqual([{ evento: 'estado_mesas', enTransaccion: false }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Corte de internet y reconexión', () => {
  let ctx;
  afterEach(() => cerrar(ctx));

  test('sin internet el local sigue funcionando; al volver, la nube se pone al día sola', async () => {
    ctx = crearAppConNube();
    await ctx.sincronizador.iniciar();
    expect(ctx.nube.estado.pedidos).toEqual([]);

    // 1. Se corta internet.
    ctx.nube.sinInternet = true;

    // 2. El POS sigue trabajando normal: las operaciones locales no dependen de la nube.
    expect(ctx.mesaEstadoService.abrirMesa('6').ok).toBe(true);
    expect(ctx.pedidoService.confirmarPedido({ mesa: 'Mesa 6', items: [PIZZA] }).ok).toBe(true);
    await esperar();
    await ctx.sincronizador.ciclo(); // el reintento de cada 30 s también falla

    // 3. La web dejó una orden mientras tanto: llega a Supabase, pero el aviso de
    //    Realtime no le llega al local, que sigue sin internet.
    const orden = ctx.nube.insertarOrden('abrir_mesa', { numero: 7 });

    // La nube quedó con la foto vieja, la orden sigue pendiente y hubo UN solo aviso.
    expect(ctx.nube.estado.pedidos).toEqual([]);
    expect(orden.estado).toBe('pendiente');
    expect(ctx.sincronizador.enLinea).toBe(false);
    const avisos = ctx.consola.mensajes.filter(([tipo]) => tipo === 'warn');
    expect(avisos).toHaveLength(1);
    expect(avisos[0][1]).toContain('Sin conexión con Supabase (fetch failed)');

    // 4. Vuelve internet: el siguiente ciclo aplica la orden y sube todo.
    ctx.nube.sinInternet = false;
    await ctx.sincronizador.ciclo();
    await esperar();

    expect(orden.estado).toBe('aplicada');
    expect(ctx.nube.estado.pedidos.map((p) => p.mesa_id)).toEqual(['Mesa 6']);
    expect(ctx.nube.estado.mesas.filter((m) => m.estado === 'ocupada').map((m) => m.id)).toEqual([
      'Mesa 6',
      'Mesa 7'
    ]);
    expect(ctx.sincronizador.enLinea).toBe(true);
    expect(ctx.consola.mensajes).toContainEqual([
      'log',
      '[SYNC] Conexión con Supabase restablecida.'
    ]);
  });

  test('si se corta entre aplicar una orden y marcarla, al volver no se aplica dos veces', async () => {
    ctx = crearAppConNube();
    ctx.mesaEstadoService.abrirMesa('1');
    const orden = ctx.nube.insertarOrden('confirmar_pedido', { mesa: 'Mesa 1', items: [PIZZA] });
    ctx.nube.fallarMarcarDespuesDe = 0; // se aplica en local, pero el aviso a Supabase falla

    await ctx.sincronizador.procesarOrdenes();
    expect(orden.estado).toBe('pendiente');
    expect(ctx.pedidos.obtener('Mesa 1').items[0].cantidad).toBe(2);

    ctx.nube.fallarMarcarDespuesDe = null; // vuelve internet
    await ctx.sincronizador.procesarOrdenes();

    expect(orden.estado).toBe('aplicada');
    expect(ctx.pedidos.obtener('Mesa 1').items[0].cantidad).toBe(2); // no 4
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Órdenes vencidas: una orden que esperó demasiado se rechaza, no se aplica.
describe('Órdenes vencidas (ORDEN_VENCIDA)', () => {
  let ctx;
  beforeEach(() => {
    ctx = crearAppConNube();
  });
  afterEach(() => cerrar(ctx));

  /** Aplicador con un reloj monótono controlado por el test (ms). */
  function aplicadorConReloj(reloj) {
    return new AplicadorOrdenes({
      servicios: {
        pedidoService: ctx.pedidoService,
        mesaService: ctx.mesaService,
        mesaEstadoService: ctx.mesaEstadoService,
        mesaConfiguracionService: ctx.mesaConfiguracionService
      },
      registro: new RegistroOrdenesSQLite(ctx.db),
      relojMonotono: () => reloj.ahora
    });
  }

  test('el vencimiento es menor que la espera de la web (10 s < 15 s): ver nube.js del frontend', () => {
    expect(VENCIMIENTO_ORDEN_MS).toBe(10000);
  });

  test('una orden vieja se rechaza con ORDEN_VENCIDA y un motivo legible, sin ejecutarse', () => {
    const aplicador = aplicadorConReloj({ ahora: 0 });
    const { estado, resultado } = aplicador.aplicar({
      id: 501,
      tipo: 'abrir_mesa',
      payload: { numero: 1 },
      edadMs: 3 * 3600 * 1000, // 3 horas en el buzón
      leidaEn: 0
    });

    expect(estado).toBe('rechazada');
    expect(resultado).toMatchObject({ ok: false, tipo: 'ORDEN_VENCIDA' });
    expect(resultado.error).toContain('10 s');
    expect(resultado.error).toContain('sin aplicarse');
    // No se ejecutó: la mesa sigue libre, y la decisión quedó en el registro.
    expect(ctx.mesas.obtener('Mesa 1').estado).toBe('libre');
    expect(new RegistroOrdenesSQLite(ctx.db).obtener(501).estado).toBe('rechazada');
  });

  test('en el límite exacto ya está vencida; un instante antes todavía se aplica', () => {
    const aplicador = aplicadorConReloj({ ahora: 0 });
    const justo = aplicador.aplicar({
      id: 502,
      tipo: 'abrir_mesa',
      payload: { numero: 1 },
      edadMs: VENCIMIENTO_ORDEN_MS,
      leidaEn: 0
    });
    expect(justo.resultado.tipo).toBe('ORDEN_VENCIDA');

    const antes = aplicador.aplicar({
      id: 503,
      tipo: 'abrir_mesa',
      payload: { numero: 1 },
      edadMs: VENCIMIENTO_ORDEN_MS - 1,
      leidaEn: 0
    });
    expect(antes.estado).toBe('aplicada');
  });

  test('el tiempo que pasa entre leer el lote y aplicar la orden cuenta (reloj monótono)', () => {
    const reloj = { ahora: 1000 };
    const aplicador = aplicadorConReloj(reloj);
    // Edad al leer: 4 s. Se aplica 7 s después (el aviso de la orden anterior tardó): 11 s.
    reloj.ahora = 8000;
    const { resultado } = aplicador.aplicar({
      id: 504,
      tipo: 'abrir_mesa',
      payload: { numero: 1 },
      edadMs: 4000,
      leidaEn: 1000
    });
    expect(resultado.tipo).toBe('ORDEN_VENCIDA');
    expect(ctx.mesas.obtener('Mesa 1').estado).toBe('libre');
  });

  test('una orden aplicada a tiempo cuyo aviso se perdió se reenvía como aplicada, no como vencida', () => {
    const reloj = { ahora: 0 };
    const aplicador = aplicadorConReloj(reloj);
    const joven = { id: 505, tipo: 'abrir_mesa', payload: { numero: 1 }, edadMs: 100, leidaEn: 0 };
    expect(aplicador.aplicar(joven).estado).toBe('aplicada');

    // Reintento horas después (ya "vieja"): manda el registro, no el vencimiento.
    const reintento = aplicador.aplicar({ ...joven, edadMs: 5 * 3600 * 1000 });
    expect(reintento.estado).toBe('aplicada');
    expect(reintento.resultado.ok).toBe(true);
  });

  test('sin edad medida por la base no se puede juzgar: no se rechaza', () => {
    const aplicador = aplicadorConReloj({ ahora: 0 });
    const r = aplicador.aplicar({ id: 506, tipo: 'abrir_mesa', payload: { numero: 1 } });
    expect(r.estado).toBe('aplicada');
  });

  test('tras un corte largo, las órdenes que esperaron se rechazan en la nube y no cambian nada', async () => {
    await ctx.sincronizador.iniciar();
    ctx.nube.sinInternet = true;

    // La web dejó dos órdenes antes de que el local se desconectara del todo...
    const vieja1 = ctx.nube.insertarOrden('abrir_mesa', { numero: 2 });
    const vieja2 = ctx.nube.insertarOrden('confirmar_pedido', { mesa: 'Mesa 2', items: [PIZZA] });
    // ...y el local vuelve 2 horas después.
    ctx.nube.avanzar(2 * 3600 * 1000);
    const reciente = ctx.nube.insertarOrden('abrir_mesa', { numero: 3 });
    ctx.nube.sinInternet = false;

    await ctx.sincronizador.ciclo();
    await esperar();

    expect(vieja1.estado).toBe('rechazada');
    expect(vieja1.resultado.tipo).toBe('ORDEN_VENCIDA');
    expect(vieja2.estado).toBe('rechazada');
    expect(vieja2.resultado.tipo).toBe('ORDEN_VENCIDA');
    // La reciente sí se aplica, en su orden de id.
    expect(reciente.estado).toBe('aplicada');
    expect(ctx.mesas.obtener('Mesa 2').estado).toBe('libre');
    expect(ctx.pedidos.obtener('Mesa 2')).toBeNull();
    expect(ctx.mesas.obtener('Mesa 3').estado).toBe('ocupada');
    // Cada rechazo deja una línea en la consola del servidor.
    expect(
      ctx.consola.mensajes.filter(([, m]) => String(m).includes('ORDEN_VENCIDA'))
    ).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Sincronizador: piezas internas', () => {
  test('exige sus dependencias', () => {
    const base = { cliente: {}, leerEstado: () => ({}), aplicarOrden: () => ({}) };
    expect(() => new Sincronizador({ ...base, cliente: null })).toThrow('cliente');
    expect(() => new Sincronizador({ ...base, leerEstado: null })).toThrow('leerEstado');
    expect(() => new Sincronizador({ ...base, aplicarOrden: null })).toThrow('aplicarOrden');
  });

  test('si Realtime no se puede suscribir, igual inicia (queda el sondeo de respaldo)', async () => {
    const nube = new NubeEnMemoria();
    nube.suscribirOrdenes = () => {
      throw new Error('websocket no disponible');
    };
    const consola = consolaEspia();
    const s = new Sincronizador({
      cliente: nube,
      leerEstado: () => ({ mesas: [] }),
      aplicarOrden: () => ({ estado: 'aplicada', resultado: { ok: true } }),
      consola
    });
    await s.iniciar();
    expect(nube.subidas).toBe(1);
    expect(consola.mensajes[0]).toEqual([
      'warn',
      '[SYNC] No se pudo escuchar el buzón en tiempo real: websocket no disponible'
    ]);
    s.detener();
  });

  test('detener cancela la suscripción y tolera que la cancelación falle', async () => {
    const nube = new NubeEnMemoria();
    const s = new Sincronizador({
      cliente: nube,
      leerEstado: () => ({}),
      aplicarOrden: () => ({}),
      consola: consolaEspia()
    });
    await s.iniciar();
    expect(nube._alAviso).not.toBeNull();
    s.detener();
    expect(nube._alAviso).toBeNull();

    nube.suscribirOrdenes = () => () => {
      throw new Error('sin red');
    };
    await s.iniciar();
    expect(() => s.detener()).not.toThrow();
    s.detener(); // detener dos veces no falla
  });

  test('tareaSinSolapamiento: pedidos durante una ejecución generan una sola repetición', async () => {
    let ejecuciones = 0;
    let liberar;
    const tarea = tareaSinSolapamiento(async () => {
      ejecuciones++;
      if (ejecuciones === 1) await new Promise((r) => (liberar = r));
    });

    const primera = tarea();
    tarea();
    tarea();
    tarea();
    liberar();
    await primera;

    expect(ejecuciones).toBe(2);
  });

  test('tareaSinSolapamiento: si la tarea falla (false) no se repite aunque se haya pedido', async () => {
    let ejecuciones = 0;
    let liberar;
    const tarea = tareaSinSolapamiento(async () => {
      ejecuciones++;
      await new Promise((r) => (liberar = r));
      return false;
    });
    const primera = tarea();
    tarea();
    liberar();
    await primera;
    expect(ejecuciones).toBe(1);
  });

  test('NotificadorConAviso emite y avisa, incluso si el emisor real falla', () => {
    const avisos = [];
    const emitidos = [];
    const n = new NotificadorConAviso({ emitir: (e, d) => emitidos.push([e, d]) }, (e) =>
      avisos.push(e)
    );
    n.emitir('estado_mesas', [1]);
    expect(emitidos).toEqual([['estado_mesas', [1]]]);
    expect(avisos).toEqual(['estado_mesas']);

    const caido = new NotificadorConAviso(
      {
        emitir: () => {
          throw new Error('socket caído');
        }
      },
      (e) => avisos.push(e)
    );
    expect(() => caido.emitir('x')).toThrow('socket caído');
    expect(avisos).toEqual(['estado_mesas', 'x']);
  });
});
