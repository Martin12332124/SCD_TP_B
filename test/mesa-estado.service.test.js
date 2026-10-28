//test/mesa-estado.service.test.js
const { MesaEstadoService } = require('../src/dominio/mesa-estado.service');
const { PedidosEnMemoria, MesasEnMemoria } = require('../src/infraestructura/repositorios');

function crearEntorno() {
  const pedidos = new PedidosEnMemoria();
  const mesas = new MesasEnMemoria(10);
  const notificador = { emitir: jest.fn() };
  const servicio = new MesaEstadoService({ pedidos, mesas, notificador });
  return { pedidos, mesas, notificador, servicio };
}

describe('MesaEstadoService (US-09) - módulo crítico', () => {
  // --- Casos válidos ---
  test('abre una mesa libre: queda ocupada y notifica a las pantallas', () => {
    const { servicio, mesas, notificador } = crearEntorno();
    const r = servicio.abrirMesa('1');
    expect(r).toEqual({ ok: true, mesa: 'Mesa 1', estado: 'ocupada' });
    expect(mesas.obtener('Mesa 1').estado).toBe('ocupada');
    expect(notificador.emitir).toHaveBeenCalledTimes(1);
  });

  test('cierra una mesa ocupada sin pedido: queda libre', () => {
    const { servicio, mesas } = crearEntorno();
    servicio.abrirMesa('3');
    const r = servicio.cerrarMesa('3');
    expect(r).toEqual({ ok: true, mesa: 'Mesa 3', estado: 'libre' });
    expect(mesas.obtener('Mesa 3').estado).toBe('libre');
  });

  // --- Valores límite ---
  test('límite inferior: la mesa 1 existe y se puede abrir', () => {
    expect(crearEntorno().servicio.abrirMesa('1').ok).toBe(true);
  });

  test('límite superior: la mesa 10 existe y se puede abrir', () => {
    expect(crearEntorno().servicio.abrirMesa('10').ok).toBe(true);
  });

  test('límite fuera de rango: la mesa 11 no existe (NO_ENCONTRADO)', () => {
    const r = crearEntorno().servicio.abrirMesa('11');
    expect(r.ok).toBe(false);
    expect(r.tipo).toBe('NO_ENCONTRADO');
  });

  test('límite: la mesa 0 es entrada inválida', () => {
    const r = crearEntorno().servicio.abrirMesa('0');
    expect(r.ok).toBe(false);
    expect(r.tipo).toBe('ENTRADA_INVALIDA');
  });

  // --- Errores ---
  test.each(['abc', '1.5', '-1'])('rechaza el número de mesa "%s" (ENTRADA_INVALIDA)', (valor) => {
    const r = crearEntorno().servicio.abrirMesa(valor);
    expect(r.ok).toBe(false);
    expect(r.tipo).toBe('ENTRADA_INVALIDA');
  });

  test('no abre dos veces la misma mesa (ESTADO_NO_PERMITIDO) y no vuelve a notificar', () => {
    const { servicio, notificador } = crearEntorno();
    servicio.abrirMesa('1');
    const r = servicio.abrirMesa('1');
    expect(r.ok).toBe(false);
    expect(r.tipo).toBe('ESTADO_NO_PERMITIDO');
    expect(notificador.emitir).toHaveBeenCalledTimes(1);
  });

  test('no cierra una mesa que ya está libre (ESTADO_NO_PERMITIDO)', () => {
    const r = crearEntorno().servicio.cerrarMesa('2');
    expect(r.ok).toBe(false);
    expect(r.tipo).toBe('ESTADO_NO_PERMITIDO');
  });

  // --- Regresión: la regla de negocio más importante de la historia ---
  test('REGRESIÓN US-09: no se cierra una mesa con pedido activo (PEDIDO_ACTIVO) y sigue ocupada', () => {
    const { servicio, pedidos, mesas } = crearEntorno();
    servicio.abrirMesa('3');
    pedidos.guardar('Mesa 3', { estado: 'En Espera' });
    const r = servicio.cerrarMesa('3');
    expect(r.ok).toBe(false);
    expect(r.tipo).toBe('PEDIDO_ACTIVO');
    expect(mesas.obtener('Mesa 3').estado).toBe('ocupada');
  });

  test('cerrar una mesa inexistente devuelve NO_ENCONTRADO', () => {
    expect(crearEntorno().servicio.cerrarMesa('11').tipo).toBe('NO_ENCONTRADO');
  });

  test('exige sus dependencias al construirse', () => {
    expect(() => new MesaEstadoService({})).toThrow();
  });
});

describe('MesaEstadoService - formato estricto del número', () => {
  test.each(['1e1', '0x5', ' 5', '05'])('rechaza "%s" como número de mesa (ENTRADA_INVALIDA)', (valor) => {
    const r = crearEntorno().servicio.abrirMesa(valor);
    expect(r.ok).toBe(false);
    expect(r.tipo).toBe('ENTRADA_INVALIDA');
  });
});