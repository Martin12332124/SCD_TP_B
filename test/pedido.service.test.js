// test/pedido.service.test.js
// Tests unitarios para PedidoService.actualizarEstado

const { PedidoService } = require('../src/dominio/pedido.service');
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

  test('al marcar Listo, la mesa queda libre y sin pedido', () => {
    const { servicio, mesas, pedidos } = crearServicio();
    servicio.actualizarEstado({ mesa: 'Mesa 1', estado: 'Recibido 📝' });
    servicio.actualizarEstado({ mesa: 'Mesa 1', estado: 'En Cocina 🍳' });
    servicio.actualizarEstado({ mesa: 'Mesa 1', estado: 'Listo 🍽️' });
    expect(mesas.obtener('Mesa 1').estado).toBe('libre');
    expect(pedidos.obtener('Mesa 1')).toBeNull();
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

  test('al quedar Listo el pedido se elimina y el resumen queda vacío', () => {
    const { servicio } = crearServicio();
    servicio.confirmarPedido({ mesa: 'Mesa 1', items: [PIZZA] });
    servicio.actualizarEstado({ mesa: 'Mesa 1', estado: 'Listo 🍽️' });
    expect(servicio.obtenerResumen('Mesa 1').items).toEqual([]);
  });
});
