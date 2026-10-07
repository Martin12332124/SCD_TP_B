// test/integracion.test.js
// Tests de integración: PedidoService + repositorios reales + notificador espía.
// Verifican el flujo completo sin Socket.io real.

const { PedidoService } = require('../src/dominio/pedido.service');
const { PedidosEnMemoria, MesasEnMemoria } = require('../src/infraestructura/repositorios');
const { NotificadorEspia } = require('./doubles');

describe('Integración: flujo completo de pedido', () => {
  let servicio, pedidos, mesas, notificador;

  beforeEach(() => {
    pedidos = new PedidosEnMemoria();
    mesas = new MesasEnMemoria(10);
    notificador = new NotificadorEspia();
    servicio = new PedidoService({ pedidos, mesas, notificador });
  });

  test('ciclo completo: Recibido → En Cocina → Listo para una mesa', () => {
    const r1 = servicio.actualizarEstado({ mesa: 'Mesa 5', estado: 'Recibido 📝' });
    expect(r1.ok).toBe(true);
    expect(mesas.obtener('Mesa 5').estado).toBe('ocupada');

    const r2 = servicio.actualizarEstado({ mesa: 'Mesa 5', estado: 'En Cocina 🍳' });
    expect(r2.ok).toBe(true);

    const r3 = servicio.actualizarEstado({ mesa: 'Mesa 5', estado: 'Listo 🍽️' });
    expect(r3.ok).toBe(true);
    expect(mesas.obtener('Mesa 5').estado).toBe('libre');
    expect(pedidos.obtener('Mesa 5')).toBeNull();

    // Se emitieron 3 cambio_estado_pedido
    expect(notificador.eventosDe('cambio_estado_pedido')).toHaveLength(3);
  });

  test('múltiples mesas funcionan de forma independiente', () => {
    servicio.actualizarEstado({ mesa: 'Mesa 1', estado: 'Recibido 📝' });
    servicio.actualizarEstado({ mesa: 'Mesa 2', estado: 'Recibido 📝' });

    const r = servicio.actualizarEstado({ mesa: 'Mesa 1', estado: 'En Cocina 🍳' });
    expect(r.ok).toBe(true);

    // Mesa 2 sigue en Recibido: no puede saltar a Listo
    const r2 = servicio.actualizarEstado({ mesa: 'Mesa 2', estado: 'Listo 🍽️' });
    expect(r2.ok).toBe(false);
    expect(r2.tipo).toBe('ESTADO_NO_PERMITIDO');
  });

  test('después de Listo se puede iniciar un nuevo pedido en la misma mesa', () => {
    servicio.actualizarEstado({ mesa: 'Mesa 7', estado: 'Recibido 📝' });
    servicio.actualizarEstado({ mesa: 'Mesa 7', estado: 'En Cocina 🍳' });
    servicio.actualizarEstado({ mesa: 'Mesa 7', estado: 'Listo 🍽️' });

    const r = servicio.actualizarEstado({ mesa: 'Mesa 7', estado: 'Recibido 📝' });
    expect(r.ok).toBe(true);
    expect(mesas.obtener('Mesa 7').estado).toBe('ocupada');
  });

  test('caso inválido extra: mesa como número no tumba el servidor', () => {
    const r = servicio.actualizarEstado({ mesa: 5 });
    expect(r.ok).toBe(false);
    expect(r.tipo).toBe('ENTRADA_INVALIDA');
  });
});
