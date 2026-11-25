// test/pedido.service.test.js
// Tests unitarios para PedidoService.actualizarEstado

const { PedidoService } = require('../src/modules/pedidos');
const { PedidosEnMemoria, MesasEnMemoria } = require('../src/infraestructura/repositorios');
const { NotificadorEspia, PedidosQueFallan, NotificadorCaido } = require('./doubles');

// Helper para crear un servicio fresco con dependencias reales + notificador espía
function crearServicio() {
  const pedidos = new PedidosEnMemoria();
  const mesas = new MesasEnMemoria(10);
  const notificador = new NotificadorEspia();
  const servicio = new PedidoService({ pedidos, mesas, notificador });
  return { servicio, pedidos, mesas, notificador };
}

// ─── VALIDACIÓN DE ENTRADA ──────────────────────────────────────────────────

describe('PedidoService.actualizarEstado – validación de entrada', () => {
  test('rechaza datos nulos', () => {
    const { servicio } = crearServicio();
    const res = servicio.actualizarEstado(null);
    expect(res.ok).toBe(false);
    expect(res.tipo).toBe('ENTRADA_INVALIDA');
  });

  test('rechaza datos undefined', () => {
    const { servicio } = crearServicio();
    const res = servicio.actualizarEstado(undefined);
    expect(res.ok).toBe(false);
    expect(res.tipo).toBe('ENTRADA_INVALIDA');
  });

  test('rechaza mesa vacía: { mesa: "Mesa ", estado: "Recibido 📝" }', () => {
    const { servicio } = crearServicio();
    const res = servicio.actualizarEstado({ mesa: 'Mesa ', estado: 'Recibido 📝' });
    expect(res.ok).toBe(false);
    expect(res.tipo).toBe('ENTRADA_INVALIDA');
    expect(res.error).toContain('mesa no tiene un formato válido');
  });

  test('rechaza mesa numérica (no string): { mesa: 5 }', () => {
    const { servicio } = crearServicio();
    const res = servicio.actualizarEstado({ mesa: 5, estado: 'Recibido 📝' });
    expect(res.ok).toBe(false);
    expect(res.tipo).toBe('ENTRADA_INVALIDA');
    expect(res.error).toContain('mesa no tiene un formato válido');
  });

  test('rechaza mesa con formato "Mesa 0" (no positivo)', () => {
    const { servicio } = crearServicio();
    const res = servicio.actualizarEstado({ mesa: 'Mesa 0', estado: 'Recibido 📝' });
    expect(res.ok).toBe(false);
    expect(res.tipo).toBe('ENTRADA_INVALIDA');
  });

  test('rechaza mesa con letras: "Mesa ABC"', () => {
    const { servicio } = crearServicio();
    const res = servicio.actualizarEstado({ mesa: 'Mesa ABC', estado: 'Recibido 📝' });
    expect(res.ok).toBe(false);
    expect(res.tipo).toBe('ENTRADA_INVALIDA');
  });

  test('rechaza estado no válido: "Cancelado"', () => {
    const { servicio } = crearServicio();
    const res = servicio.actualizarEstado({ mesa: 'Mesa 1', estado: 'Cancelado' });
    expect(res.ok).toBe(false);
    expect(res.tipo).toBe('ENTRADA_INVALIDA');
    expect(res.error).toContain('no es válido');
  });

  test('rechaza estado vacío', () => {
    const { servicio } = crearServicio();
    const res = servicio.actualizarEstado({ mesa: 'Mesa 1', estado: '' });
    expect(res.ok).toBe(false);
    expect(res.tipo).toBe('ENTRADA_INVALIDA');
  });
});

// ─── TRANSICIONES DE ESTADO ─────────────────────────────────────────────────

describe('PedidoService.actualizarEstado – transiciones de estado', () => {
  test('permite: sin pedido → Recibido 📝', () => {
    const { servicio } = crearServicio();
    const res = servicio.actualizarEstado({ mesa: 'Mesa 3', estado: 'Recibido 📝' });
    expect(res).toEqual({ ok: true, mesa: 'Mesa 3', estado: 'Recibido 📝' });
  });

  test('permite: Recibido 📝 → En Cocina 🍳', () => {
    const { servicio } = crearServicio();
    servicio.actualizarEstado({ mesa: 'Mesa 3', estado: 'Recibido 📝' });
    const res = servicio.actualizarEstado({ mesa: 'Mesa 3', estado: 'En Cocina 🍳' });
    expect(res).toEqual({ ok: true, mesa: 'Mesa 3', estado: 'En Cocina 🍳' });
  });

  test('permite: En Cocina 🍳 → Listo 🍽️', () => {
    const { servicio } = crearServicio();
    servicio.actualizarEstado({ mesa: 'Mesa 3', estado: 'Recibido 📝' });
    servicio.actualizarEstado({ mesa: 'Mesa 3', estado: 'En Cocina 🍳' });
    const res = servicio.actualizarEstado({ mesa: 'Mesa 3', estado: 'Listo 🍽️' });
    expect(res).toEqual({ ok: true, mesa: 'Mesa 3', estado: 'Listo 🍽️' });
  });

  test('permite ciclo completo: Listo → nuevo Recibido', () => {
    const { servicio } = crearServicio();
    servicio.actualizarEstado({ mesa: 'Mesa 3', estado: 'Recibido 📝' });
    servicio.actualizarEstado({ mesa: 'Mesa 3', estado: 'En Cocina 🍳' });
    servicio.actualizarEstado({ mesa: 'Mesa 3', estado: 'Listo 🍽️' });
    const res = servicio.actualizarEstado({ mesa: 'Mesa 3', estado: 'Recibido 📝' });
    expect(res).toEqual({ ok: true, mesa: 'Mesa 3', estado: 'Recibido 📝' });
  });

  test('rechaza transición inválida: Recibido → Listo (saltarse cocina)', () => {
    const { servicio } = crearServicio();
    servicio.actualizarEstado({ mesa: 'Mesa 3', estado: 'Recibido 📝' });
    const res = servicio.actualizarEstado({ mesa: 'Mesa 3', estado: 'Listo 🍽️' });
    expect(res.ok).toBe(false);
    expect(res.tipo).toBe('ESTADO_NO_PERMITIDO');
    expect(res.error).toContain('Transición no permitida: Recibido');
    expect(res.esperado).toBe('En Cocina 🍳');
  });

  test('rechaza transición inválida: sin pedido → En Cocina', () => {
    const { servicio } = crearServicio();
    const res = servicio.actualizarEstado({ mesa: 'Mesa 3', estado: 'En Cocina 🍳' });
    expect(res.ok).toBe(false);
    expect(res.tipo).toBe('ESTADO_NO_PERMITIDO');
    expect(res.esperado).toBe('Recibido 📝');
  });

  test('rechaza transición inválida: sin pedido → Listo', () => {
    const { servicio } = crearServicio();
    const res = servicio.actualizarEstado({ mesa: 'Mesa 3', estado: 'Listo 🍽️' });
    expect(res.ok).toBe(false);
    expect(res.tipo).toBe('ESTADO_NO_PERMITIDO');
  });
});

// ─── POSTCONDICIONES Y NOTIFICACIONES ───────────────────────────────────────

describe('PedidoService.actualizarEstado – postcondiciones', () => {
  test('al marcar Recibido, la mesa queda ocupada', () => {
    const { servicio, mesas } = crearServicio();
    servicio.actualizarEstado({ mesa: 'Mesa 1', estado: 'Recibido 📝' });
    const mesa = mesas.obtener('Mesa 1');
    expect(mesa.estado).toBe('ocupada');
  });

  test('al marcar Listo, el pedido se conserva en Listo y la mesa sigue ocupada', () => {
    const { servicio, mesas, pedidos } = crearServicio();
    servicio.actualizarEstado({ mesa: 'Mesa 1', estado: 'Recibido 📝' });
    servicio.actualizarEstado({ mesa: 'Mesa 1', estado: 'En Cocina 🍳' });
    servicio.actualizarEstado({ mesa: 'Mesa 1', estado: 'Listo 🍽️' });
    expect(mesas.obtener('Mesa 1').estado).toBe('ocupada');
    expect(pedidos.obtener('Mesa 1')).toEqual({
      mesa: 'Mesa 1',
      estado: 'Listo 🍽️',
      estadoDesde: expect.any(String)
    });
  });

  test('marcar Listo emite cambio_estado_pedido y no vuelve a emitir estado_mesas', () => {
    const { servicio, notificador } = crearServicio();
    servicio.actualizarEstado({ mesa: 'Mesa 1', estado: 'Recibido 📝' });
    servicio.actualizarEstado({ mesa: 'Mesa 1', estado: 'En Cocina 🍳' });
    notificador.limpiar();
    servicio.actualizarEstado({ mesa: 'Mesa 1', estado: 'Listo 🍽️' });
    expect(notificador.eventosDe('cambio_estado_pedido')).toEqual([
      { evento: 'cambio_estado_pedido', datos: { mesa: 'Mesa 1', estado: 'Listo 🍽️' } }
    ]);
    // La mesa no cambió de estado (sigue ocupada), así que no hay estado_mesas
    expect(notificador.eventosDe('estado_mesas')).toHaveLength(0);
  });

  test('emite "cambio_estado_pedido" al actualizar', () => {
    const { servicio, notificador } = crearServicio();
    servicio.actualizarEstado({ mesa: 'Mesa 2', estado: 'Recibido 📝' });
    const eventos = notificador.eventosDe('cambio_estado_pedido');
    expect(eventos).toHaveLength(1);
    expect(eventos[0].datos).toEqual({ mesa: 'Mesa 2', estado: 'Recibido 📝' });
  });

  test('emite "estado_mesas" cuando se ocupa o libera una mesa', () => {
    const { servicio, notificador } = crearServicio();
    servicio.actualizarEstado({ mesa: 'Mesa 2', estado: 'Recibido 📝' });
    const eventosMesa = notificador.eventosDe('estado_mesas');
    expect(eventosMesa.length).toBeGreaterThanOrEqual(1);
  });

  test('NO emite nada si la entrada es inválida', () => {
    const { servicio, notificador } = crearServicio();
    servicio.actualizarEstado({ mesa: 'Mesa ', estado: 'Recibido 📝' });
    expect(notificador.eventos).toHaveLength(0);
  });
});

// ─── DEPENDENCIA NO DISPONIBLE ──────────────────────────────────────────────

describe('PedidoService – dependencia no disponible', () => {
  test('propaga error si el repositorio de pedidos falla al guardar', () => {
    const pedidos = new PedidosQueFallan();
    const mesas = new MesasEnMemoria(10);
    const notificador = new NotificadorEspia();
    const servicio = new PedidoService({ pedidos, mesas, notificador });

    expect(() => servicio.actualizarEstado({ mesa: 'Mesa 1', estado: 'Recibido 📝' })).toThrow(
      'Fallo simulado de persistencia'
    );
  });

  test('propaga error si el notificador está caído', () => {
    const pedidos = new PedidosEnMemoria();
    const mesas = new MesasEnMemoria(10);
    const notificador = new NotificadorCaido();
    const servicio = new PedidoService({ pedidos, mesas, notificador });

    expect(() => servicio.actualizarEstado({ mesa: 'Mesa 1', estado: 'Recibido 📝' })).toThrow(
      'Dependencia no disponible'
    );
  });

  test('lanza error si se construye sin dependencias', () => {
    expect(() => new PedidoService({})).toThrow('Dependencia requerida');
  });
});

// ─── CONFIRMAR PEDIDO (atajo directo a cocina + resumen acumulado) ──────────

const PIZZA = { id: 1, nombre: 'Pizza', precioBase: 8500, cantidad: 2 };
const COCA = { id: 2, nombre: 'Coca-Cola', precioBase: 2000, cantidad: 1 };

describe('PedidoService.confirmarPedido – atajo directo a cocina', () => {
  test('mesa sin pedido: queda En Cocina, ocupada y con sus ítems', () => {
    const { servicio, pedidos, mesas } = crearServicio();
    const res = servicio.confirmarPedido({ mesa: 'Mesa 3', items: [PIZZA, COCA] });
    expect(res.ok).toBe(true);
    expect(res.estado).toBe('En Cocina 🍳');
    expect(res.total).toBe(8500 * 2 + 2000);
    expect(pedidos.obtener('Mesa 3').items).toHaveLength(2);
    expect(mesas.obtener('Mesa 3').estado).toBe('ocupada');
  });

  test('mesa con pedido a medias en Recibido: pasa a cocina con los ítems', () => {
    const { servicio, pedidos } = crearServicio();
    servicio.actualizarEstado({ mesa: 'Mesa 3', estado: 'Recibido 📝' });
    const res = servicio.confirmarPedido({ mesa: 'Mesa 3', items: [PIZZA] });
    expect(res.ok).toBe(true);
    expect(pedidos.obtener('Mesa 3').estado).toBe('En Cocina 🍳');
  });

  test('mesa ya en cocina: acumula una nueva ronda sin cambiar el estado', () => {
    const { servicio } = crearServicio();
    servicio.confirmarPedido({ mesa: 'Mesa 3', items: [PIZZA] });
    const res = servicio.confirmarPedido({ mesa: 'Mesa 3', items: [PIZZA, COCA] });
    expect(res.ok).toBe(true);
    expect(res.estado).toBe('En Cocina 🍳');
    expect(res.items.find((i) => i.id === 1).cantidad).toBe(4);
    expect(res.items.find((i) => i.id === 2).cantidad).toBe(1);
    expect(res.total).toBe(8500 * 4 + 2000);
  });

  test('rechaza sin items, cantidades inválidas, mesa inexistente o datos inválidos', () => {
    const { servicio } = crearServicio();
    expect(servicio.confirmarPedido({ mesa: 'Mesa 3', items: [] }).tipo).toBe('ENTRADA_INVALIDA');
    expect(
      servicio.confirmarPedido({ mesa: 'Mesa 3', items: [{ ...PIZZA, cantidad: 0 }] }).tipo
    ).toBe('ENTRADA_INVALIDA');
    expect(servicio.confirmarPedido({ mesa: 'Mesa 11', items: [PIZZA] }).tipo).toBe(
      'NO_ENCONTRADO'
    );
    expect(servicio.confirmarPedido(null).tipo).toBe('ENTRADA_INVALIDA');
    expect(servicio.confirmarPedido({ mesa: 5, items: [PIZZA] }).tipo).toBe('ENTRADA_INVALIDA');
  });

  test('límites de cantidad: acepta 1 y 99, rechaza 0, 100, decimales y texto', () => {
    const { servicio } = crearServicio();
    expect(servicio.confirmarPedido({ mesa: 'Mesa 1', items: [{ ...COCA, cantidad: 1 }] }).ok).toBe(true);
    expect(servicio.confirmarPedido({ mesa: 'Mesa 2', items: [{ ...COCA, cantidad: 99 }] }).ok).toBe(true);
    for (const cantidad of [0, 100, 1.5, '3', -1, null]) {
      const res = servicio.confirmarPedido({ mesa: 'Mesa 3', items: [{ ...COCA, cantidad }] });
      expect(res.ok).toBe(false);
      expect(res.tipo).toBe('ENTRADA_INVALIDA');
      expect(res.error).toMatch(/entero de 1 a 99/);
    }
  });

  test('REGRESIÓN: una cantidad inválida no deja pedido ni ocupa la mesa', () => {
    const { servicio, pedidos, mesas } = crearServicio();
    servicio.confirmarPedido({ mesa: 'Mesa 4', items: [{ ...COCA, cantidad: 100 }] });
    expect(pedidos.obtener('Mesa 4')).toBeFalsy();
    expect(mesas.obtener('Mesa 4').estado).toBe('libre');
  });

  test('con menú inyectado: usa nombre/precio del menú y rechaza agotados e inexistentes', () => {
    const { MenuItemsEnMemoria } = require('../src/infraestructura/repositorios');
    const menuItems = new MenuItemsEnMemoria([
      { id: 1, nombre: 'Pizza', precioBase: 8500, disponible: true },
      { id: 2, nombre: 'Coca-Cola', precioBase: 2000, disponible: false }
    ]);
    const servicio = new PedidoService({
      pedidos: new PedidosEnMemoria(),
      mesas: new MesasEnMemoria(10),
      notificador: new NotificadorEspia(),
      menuItems
    });
    expect(servicio.confirmarPedido({ mesa: 'Mesa 1', items: [{ id: 2, cantidad: 1 }] }).ok).toBe(
      false
    );
    expect(servicio.confirmarPedido({ mesa: 'Mesa 1', items: [{ id: 99, cantidad: 1 }] }).tipo).toBe(
      'NO_ENCONTRADO'
    );
    const ok = servicio.confirmarPedido({ mesa: 'Mesa 1', items: [{ id: 1, cantidad: 3 }] });
    expect(ok.total).toBe(25500);
    expect(ok.items[0].nombre).toBe('Pizza');
  });
});

describe('PedidoService.obtenerResumen', () => {
  test('mesa sin pedido: resumen vacío', () => {
    const { servicio } = crearServicio();
    expect(servicio.obtenerResumen('Mesa 1')).toEqual({
      ok: true,
      mesa: 'Mesa 1',
      estado: null,
      items: [],
      total: 0
    });
  });

  test('al quedar Listo el resumen conserva los ítems y el total (la cuenta sigue abierta)', () => {
    const { servicio } = crearServicio();
    servicio.confirmarPedido({ mesa: 'Mesa 1', items: [PIZZA] });
    servicio.actualizarEstado({ mesa: 'Mesa 1', estado: 'Listo 🍽️' });
    const resumen = servicio.obtenerResumen('Mesa 1');
    expect(resumen.estado).toBe('Listo 🍽️');
    expect(resumen.items).toHaveLength(1);
    expect(resumen.total).toBe(PIZZA.precioBase * PIZZA.cantidad);
  });

  test('con el pedido Listo, una nueva ronda suma a la cuenta y vuelve a cocina', () => {
    const { servicio, mesas } = crearServicio();
    servicio.confirmarPedido({ mesa: 'Mesa 1', items: [PIZZA] });
    servicio.actualizarEstado({ mesa: 'Mesa 1', estado: 'Listo 🍽️' });

    const ronda = servicio.confirmarPedido({ mesa: 'Mesa 1', items: [PIZZA] });
    expect(ronda.ok).toBe(true);
    expect(ronda.estado).toBe('En Cocina 🍳');
    expect(ronda.items).toHaveLength(1);
    expect(ronda.items[0].cantidad).toBe(PIZZA.cantidad * 2);
    expect(ronda.total).toBe(PIZZA.precioBase * PIZZA.cantidad * 2);
    expect(mesas.obtener('Mesa 1').estado).toBe('ocupada');
  });
});

// ─── HORA DEL ÚLTIMO CAMBIO DE ESTADO (temporizadores de las comandas) ───────

describe('PedidoService: estadoDesde (hora del último cambio de estado)', () => {
  /** Reloj falso: cada llamada devuelve la hora siguiente de la lista. */
  function crearConReloj(horas) {
    const pedidos = new PedidosEnMemoria();
    const mesas = new MesasEnMemoria(10);
    const notificador = new NotificadorEspia();
    const pendientes = [...horas];
    const reloj = jest.fn(() => pendientes.shift());
    const servicio = new PedidoService({ pedidos, mesas, notificador, reloj });
    return { servicio, pedidos, reloj };
  }

  test('cada cambio de estado guarda la hora en que ocurrió', () => {
    const { servicio, pedidos } = crearConReloj([
      '2026-11-16T12:00:00.000Z',
      '2026-11-16T12:05:00.000Z',
      '2026-11-16T12:20:00.000Z'
    ]);
    servicio.actualizarEstado({ mesa: 'Mesa 3', estado: 'Recibido 📝' });
    expect(pedidos.obtener('Mesa 3').estadoDesde).toBe('2026-11-16T12:00:00.000Z');
    servicio.actualizarEstado({ mesa: 'Mesa 3', estado: 'En Cocina 🍳' });
    expect(pedidos.obtener('Mesa 3').estadoDesde).toBe('2026-11-16T12:05:00.000Z');
    servicio.actualizarEstado({ mesa: 'Mesa 3', estado: 'Listo 🍽️' });
    expect(pedidos.obtener('Mesa 3').estadoDesde).toBe('2026-11-16T12:20:00.000Z');
  });

  test('una transición rechazada no cambia la hora', () => {
    const { servicio, pedidos, reloj } = crearConReloj(['2026-11-16T12:00:00.000Z']);
    servicio.actualizarEstado({ mesa: 'Mesa 3', estado: 'Recibido 📝' });
    servicio.actualizarEstado({ mesa: 'Mesa 3', estado: 'Listo 🍽️' }); // salto no permitido
    expect(pedidos.obtener('Mesa 3').estadoDesde).toBe('2026-11-16T12:00:00.000Z');
    expect(reloj).toHaveBeenCalledTimes(1);
  });

  test('sumar productos a un pedido que ya está en cocina no reinicia su tiempo', () => {
    const { servicio, pedidos } = crearConReloj([
      '2026-11-16T12:00:00.000Z',
      '2026-11-16T12:00:01.000Z',
      '2026-11-16T12:30:00.000Z'
    ]);
    servicio.confirmarPedido({ mesa: 'Mesa 1', items: [PIZZA] });
    const enCocinaDesde = pedidos.obtener('Mesa 1').estadoDesde;
    servicio.confirmarPedido({ mesa: 'Mesa 1', items: [COCA] });
    expect(pedidos.obtener('Mesa 1').estadoDesde).toBe(enCocinaDesde);
    expect(pedidos.obtener('Mesa 1').items).toHaveLength(2);
  });

  test('sin reloj inyectado usa la hora actual en formato ISO', () => {
    const { servicio, pedidos } = crearServicio();
    const antes = Date.now();
    servicio.actualizarEstado({ mesa: 'Mesa 2', estado: 'Recibido 📝' });
    const desde = Date.parse(pedidos.obtener('Mesa 2').estadoDesde);
    expect(desde).toBeGreaterThanOrEqual(antes);
    expect(desde).toBeLessThanOrEqual(Date.now());
  });
});
