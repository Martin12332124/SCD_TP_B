// test/mesa.service.test.js
// Tests unitarios para MesaService.trasladarPedido (Operación 3 — US-05)

const { MesaService, DependenciaError } = require('../src/dominio/mesa.service');
const { PedidosEnMemoria, MesasEnMemoria } = require('../src/infraestructura/repositorios');
const { NotificadorEspia, PedidosQueFallan, MesasQueFallan } = require('./doubles');

/**
 * Helper: crea un contexto fresco con mesas reales, pedidos reales y notificador espía.
 * Por defecto configura Mesa 2 como ocupada con pedido "Recibido 📝" para los tests de traslado.
 */
function crearContexto({ mesaOrigenOcupada = true } = {}) {
  const pedidos = new PedidosEnMemoria();
  const mesas = new MesasEnMemoria(10);
  const notificador = new NotificadorEspia();

  // Pre-cargar pedido en Mesa 2 si se solicita
  if (mesaOrigenOcupada) {
    mesas.ocupar('Mesa 2');
    pedidos.guardar('Mesa 2', { mesa: 'Mesa 2', estado: 'En Cocina 🍳' });
  }

  const servicio = new MesaService({ pedidos, mesas, notificador });
  return { servicio, pedidos, mesas, notificador };
}

// ─── CONSTRUCCIÓN Y DEPENDENCIAS ────────────────────────────────────────────

describe('MesaService – construcción', () => {
  test('lanza error si se construye sin pedidos', () => {
    expect(
      () => new MesaService({ mesas: new MesasEnMemoria(), notificador: new NotificadorEspia() })
    ).toThrow('Dependencia requerida: pedidos');
  });

  test('lanza error si se construye sin mesas', () => {
    expect(
      () =>
        new MesaService({ pedidos: new PedidosEnMemoria(), notificador: new NotificadorEspia() })
    ).toThrow('Dependencia requerida: mesas');
  });

  test('lanza error si se construye sin notificador', () => {
    expect(
      () => new MesaService({ pedidos: new PedidosEnMemoria(), mesas: new MesasEnMemoria() })
    ).toThrow('Dependencia requerida: notificador');
  });
});

// ─── VALIDACIÓN DE ENTRADA ───────────────────────────────────────────────────

describe('MesaService.trasladarPedido – validación de entrada', () => {
  test('rechaza datos nulos', () => {
    const { servicio } = crearContexto();
    const res = servicio.trasladarPedido(null);
    expect(res.ok).toBe(false);
    expect(res.tipo).toBe('ENTRADA_INVALIDA');
  });

  test('rechaza datos undefined', () => {
    const { servicio } = crearContexto();
    const res = servicio.trasladarPedido(undefined);
    expect(res.ok).toBe(false);
    expect(res.tipo).toBe('ENTRADA_INVALIDA');
  });

  test('Entrada inválida 1 (Ficha 3): origen igual a destino { origen: 4, destino: 4 }', () => {
    const { servicio, notificador } = crearContexto();
    const res = servicio.trasladarPedido({ origen: 4, destino: 4 });

    expect(res.ok).toBe(false);
    expect(res.tipo).toBe('ENTRADA_INVALIDA');
    expect(res.error).toBe('origen y destino deben ser mesas distintas.');
    // Invariante: no se emite ningún evento ni se altera el estado
    expect(notificador.eventos).toHaveLength(0);
  });

  test('rechaza origen como string: { origen: "1", destino: 2 }', () => {
    const { servicio } = crearContexto();
    const res = servicio.trasladarPedido({ origen: '1', destino: 2 });
    expect(res.ok).toBe(false);
    expect(res.tipo).toBe('ENTRADA_INVALIDA');
    expect(res.error).toContain('"origen" debe ser un entero positivo');
  });

  test('rechaza destino como string: { origen: 1, destino: "2" }', () => {
    const { servicio } = crearContexto();
    const res = servicio.trasladarPedido({ origen: 1, destino: '2' });
    expect(res.ok).toBe(false);
    expect(res.tipo).toBe('ENTRADA_INVALIDA');
    expect(res.error).toContain('"destino" debe ser un entero positivo');
  });

  test('rechaza origen cero o negativo: { origen: 0, destino: 3 }', () => {
    const { servicio } = crearContexto();
    const res = servicio.trasladarPedido({ origen: 0, destino: 3 });
    expect(res.ok).toBe(false);
    expect(res.tipo).toBe('ENTRADA_INVALIDA');
  });

  test('rechaza destino negativo: { origen: 2, destino: -1 }', () => {
    const { servicio } = crearContexto();
    const res = servicio.trasladarPedido({ origen: 2, destino: -1 });
    expect(res.ok).toBe(false);
    expect(res.tipo).toBe('ENTRADA_INVALIDA');
  });

  test('rechaza origen decimal: { origen: 2.5, destino: 3 }', () => {
    const { servicio } = crearContexto();
    const res = servicio.trasladarPedido({ origen: 2.5, destino: 3 });
    expect(res.ok).toBe(false);
    expect(res.tipo).toBe('ENTRADA_INVALIDA');
  });
});

// ─── MESA NO ENCONTRADA ──────────────────────────────────────────────────────

describe('MesaService.trasladarPedido – mesa no encontrada', () => {
  test('rechaza mesa origen inexistente: { origen: 99, destino: 3 }', () => {
    const { servicio } = crearContexto();
    const res = servicio.trasladarPedido({ origen: 99, destino: 3 });
    expect(res.ok).toBe(false);
    expect(res.tipo).toBe('NO_ENCONTRADO');
    expect(res.error).toContain('99');
  });

  test('rechaza mesa destino inexistente: { origen: 2, destino: 99 }', () => {
    const { servicio } = crearContexto();
    const res = servicio.trasladarPedido({ origen: 2, destino: 99 });
    expect(res.ok).toBe(false);
    expect(res.tipo).toBe('NO_ENCONTRADO');
    expect(res.error).toContain('99');
  });
});

// ─── ESTADO NO PERMITIDO ─────────────────────────────────────────────────────

describe('MesaService.trasladarPedido – estado no permitido', () => {
  test('Entrada inválida 2 (Ficha 3): mesa origen libre (sin pedido): { origen: 5, destino: 9 }', () => {
    // Mesa 5 está libre (sin pedido por defecto)
    const { servicio, notificador } = crearContexto();
    const res = servicio.trasladarPedido({ origen: 5, destino: 9 });

    expect(res.ok).toBe(false);
    expect(res.tipo).toBe('ESTADO_NO_PERMITIDO');
    expect(res.error).toBe('La mesa 5 no tiene un pedido que trasladar.');
    expect(notificador.eventos).toHaveLength(0);
  });

  test('rechaza traslado cuando destino está ocupado', () => {
    const { servicio, pedidos, mesas, notificador } = crearContexto();
    // Ocupar también la Mesa 4 (destino del traslado)
    mesas.ocupar('Mesa 4');
    pedidos.guardar('Mesa 4', { mesa: 'Mesa 4', estado: 'Recibido 📝' });

    const res = servicio.trasladarPedido({ origen: 2, destino: 4 });
    expect(res.ok).toBe(false);
    expect(res.tipo).toBe('ESTADO_NO_PERMITIDO');
    expect(res.error).toContain('La mesa 4 no está disponible');
    expect(notificador.eventos).toHaveLength(0);
  });
});

// ─── CASO VÁLIDO Y POSTCONDICIONES ───────────────────────────────────────────

describe('MesaService.trasladarPedido – caso válido y postcondiciones', () => {
  test('traslada el pedido: origen queda libre, destino queda ocupado', () => {
    const { servicio, pedidos, mesas } = crearContexto();

    const res = servicio.trasladarPedido({ origen: 2, destino: 6 });

    expect(res).toEqual({ ok: true, origen: 'Mesa 2', destino: 'Mesa 6', estado: 'En Cocina 🍳' });

    // Postcondición 1: estados de mesas correctos
    expect(mesas.obtener('Mesa 2').estado).toBe('libre');
    expect(mesas.obtener('Mesa 6').estado).toBe('ocupada');

    // Postcondición 1: el pedido existe en destino, no en origen
    expect(pedidos.obtener('Mesa 2')).toBeNull();
    const pedidoDestino = pedidos.obtener('Mesa 6');
    expect(pedidoDestino).not.toBeNull();
    expect(pedidoDestino.estado).toBe('En Cocina 🍳');
    expect(pedidoDestino.mesa).toBe('Mesa 6');
  });

  test('el total de pedidos no cambia con el traslado (invariante)', () => {
    const { servicio, pedidos } = crearContexto();
    const totalAntes = Object.keys(pedidos.todos()).length;

    servicio.trasladarPedido({ origen: 2, destino: 7 });

    const totalDespues = Object.keys(pedidos.todos()).length;
    expect(totalDespues).toBe(totalAntes);
  });

  test('emite "pedido_trasladado" con origen, destino y estado', () => {
    const { servicio, notificador } = crearContexto();
    servicio.trasladarPedido({ origen: 2, destino: 6 });

    const eventos = notificador.eventosDe('pedido_trasladado');
    expect(eventos).toHaveLength(1);
    expect(eventos[0].datos).toEqual({
      origen: 'Mesa 2',
      destino: 'Mesa 6',
      estado: 'En Cocina 🍳'
    });
  });

  test('emite "estado_mesas" después del traslado', () => {
    const { servicio, notificador } = crearContexto();
    servicio.trasladarPedido({ origen: 2, destino: 6 });

    const eventosMesas = notificador.eventosDe('estado_mesas');
    expect(eventosMesas.length).toBeGreaterThanOrEqual(1);
  });

  test('NO emite nada si la entrada es inválida', () => {
    const { servicio, notificador } = crearContexto();
    servicio.trasladarPedido({ origen: 3, destino: 3 });
    expect(notificador.eventos).toHaveLength(0);
  });

  test('traslado conserva el estado del pedido original', () => {
    const { servicio, pedidos, mesas } = crearContexto();
    // Mesa 3 con estado "Recibido 📝"
    mesas.ocupar('Mesa 3');
    pedidos.guardar('Mesa 3', { mesa: 'Mesa 3', estado: 'Recibido 📝' });

    const res = servicio.trasladarPedido({ origen: 3, destino: 8 });
    expect(res.ok).toBe(true);
    expect(res.estado).toBe('Recibido 📝');
    expect(pedidos.obtener('Mesa 8').estado).toBe('Recibido 📝');
  });
});

// ─── DEPENDENCIA NO DISPONIBLE ───────────────────────────────────────────────

describe('MesaService.trasladarPedido – dependencia no disponible', () => {
  test('lanza DependenciaError si las mesas fallan al liberar/ocupar', () => {
    const pedidos = new PedidosEnMemoria();
    const mesas = new MesasQueFallan(10);
    const notificador = new NotificadorEspia();

    // Precargar pedido en Mesa 2 (usando el mapa interno directamente,
    // ya que MesasQueFallan solo falla en ocupar/liberar)
    mesas._mesas.find((m) => m.id === 'Mesa 2').estado = 'ocupada';
    pedidos.guardar('Mesa 2', { mesa: 'Mesa 2', estado: 'Recibido 📝' });

    const servicio = new MesaService({ pedidos, mesas, notificador });

    expect(() => servicio.trasladarPedido({ origen: 2, destino: 5 })).toThrow(DependenciaError);
  });

  test('DependenciaError conserva el mensaje de causa', () => {
    const pedidos = new PedidosEnMemoria();
    const mesas = new MesasQueFallan(10);
    const notificador = new NotificadorEspia();

    mesas._mesas.find((m) => m.id === 'Mesa 2').estado = 'ocupada';
    pedidos.guardar('Mesa 2', { mesa: 'Mesa 2', estado: 'Recibido 📝' });

    const servicio = new MesaService({ pedidos, mesas, notificador });

    try {
      servicio.trasladarPedido({ origen: 2, destino: 5 });
      fail('Debió lanzar error');
    } catch (err) {
      expect(err).toBeInstanceOf(DependenciaError);
      expect(err.message).toContain('Fallo al trasladar pedido');
      expect(err.causa).toBeDefined();
    }
  });
});
