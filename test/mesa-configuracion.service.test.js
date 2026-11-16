// test/mesa-configuracion.service.test.js
// Reglas para agregar y quitar mesas, con repositorios en memoria y notificador espía.

const {
  MesaConfiguracionService,
  NUMERO_MESA_MAXIMO
} = require('../src/dominio/mesa-configuracion.service');
const { PedidosEnMemoria, MesasEnMemoria } = require('../src/infraestructura/repositorios');
const { NotificadorEspia } = require('./doubles');

function crear(cantidad = 10) {
  const pedidos = new PedidosEnMemoria();
  const mesas = new MesasEnMemoria(cantidad);
  const notificador = new NotificadorEspia();
  const servicio = new MesaConfiguracionService({ pedidos, mesas, notificador });
  return { servicio, pedidos, mesas, notificador };
}

describe('MesaConfiguracionService: dependencias', () => {
  test.each(['pedidos', 'mesas', 'notificador'])('exige la dependencia "%s"', (faltante) => {
    const deps = {
      pedidos: new PedidosEnMemoria(),
      mesas: new MesasEnMemoria(),
      notificador: new NotificadorEspia()
    };
    delete deps[faltante];
    expect(() => new MesaConfiguracionService(deps)).toThrow(`Dependencia requerida: ${faltante}`);
  });
});

describe('MesaConfiguracionService.agregarMesa', () => {
  test.each([[undefined], [null], [{}], [{ numero: null }]])(
    'sin número (%j) agrega la mesa siguiente a la más alta',
    (datos) => {
      const { servicio, mesas } = crear();
      const r = servicio.agregarMesa(datos);
      expect(r).toEqual({ ok: true, mesa: { id: 'Mesa 11', numero: 11, estado: 'libre' } });
      expect(mesas.listar()).toHaveLength(11);
    }
  );

  test('con número agrega esa mesa, aunque deje un hueco', () => {
    const { servicio, mesas } = crear();
    const r = servicio.agregarMesa({ numero: 20 });
    expect(r.ok).toBe(true);
    expect(r.mesa).toEqual({ id: 'Mesa 20', numero: 20, estado: 'libre' });
    expect(mesas.obtener('Mesa 20').estado).toBe('libre');
  });

  test('después de un número suelto, "la siguiente" sigue al más alto', () => {
    const { servicio } = crear();
    servicio.agregarMesa({ numero: 20 });
    expect(servicio.agregarMesa().mesa.numero).toBe(21);
  });

  test('permite volver a crear una mesa que se había quitado', () => {
    const { servicio, mesas } = crear();
    servicio.quitarMesa(7);
    const r = servicio.agregarMesa({ numero: 7 });
    expect(r.ok).toBe(true);
    expect(mesas.listar().map((m) => m.numero)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  test('límite: acepta el número máximo y el 1', () => {
    const { servicio } = crear(2);
    expect(servicio.agregarMesa({ numero: NUMERO_MESA_MAXIMO }).ok).toBe(true);
    servicio.quitarMesa(1);
    expect(servicio.agregarMesa({ numero: 1 }).ok).toBe(true);
  });

  test('emite "estado_mesas" con la lista actualizada', () => {
    const { servicio, notificador } = crear();
    servicio.agregarMesa();
    const eventos = notificador.eventosDe('estado_mesas');
    expect(eventos).toHaveLength(1);
    expect(eventos[0].datos).toHaveLength(11);
    expect(eventos[0].datos[10]).toMatchObject({ id: 'Mesa 11', estado: 'libre' });
  });

  test.each([0, -1, 1.5, '12', NUMERO_MESA_MAXIMO + 1, true, NaN, {}, [5]])(
    'rechaza el número inválido %j con ENTRADA_INVALIDA',
    (numero) => {
      const { servicio, mesas, notificador } = crear();
      const r = servicio.agregarMesa({ numero });
      expect(r.ok).toBe(false);
      expect(r.tipo).toBe('ENTRADA_INVALIDA');
      expect(mesas.listar()).toHaveLength(10);
      expect(notificador.eventos).toHaveLength(0);
    }
  );

  test.each(['12', 12, true])('rechaza datos que no son un objeto (%j)', (datos) => {
    const { servicio, mesas } = crear();
    const r = servicio.agregarMesa(datos);
    expect(r.tipo).toBe('ENTRADA_INVALIDA');
    expect(mesas.listar()).toHaveLength(10);
  });

  test('rechaza un número que ya existe con DUPLICADO', () => {
    const { servicio, mesas, notificador } = crear();
    const r = servicio.agregarMesa({ numero: 3 });
    expect(r).toEqual({ ok: false, tipo: 'DUPLICADO', error: 'La mesa 3 ya existe.' });
    expect(mesas.listar()).toHaveLength(10);
    expect(notificador.eventos).toHaveLength(0);
  });

  test('sin número y con la mesa más alta ya creada responde LIMITE_ALCANZADO', () => {
    const { servicio, mesas } = crear();
    servicio.agregarMesa({ numero: NUMERO_MESA_MAXIMO });
    const r = servicio.agregarMesa();
    expect(r.ok).toBe(false);
    expect(r.tipo).toBe('LIMITE_ALCANZADO');
    expect(mesas.listar()).toHaveLength(11);
  });
});

describe('MesaConfiguracionService.quitarMesa', () => {
  test.each([4, '4'])('quita una mesa libre (número %j)', (numero) => {
    const { servicio, mesas } = crear();
    const r = servicio.quitarMesa(numero);
    expect(r).toEqual({ ok: true, mesa: 'Mesa 4' });
    expect(mesas.obtener('Mesa 4')).toBeNull();
    expect(mesas.listar()).toHaveLength(9);
  });

  test('emite "estado_mesas" sin la mesa quitada', () => {
    const { servicio, notificador } = crear();
    servicio.quitarMesa(10);
    const eventos = notificador.eventosDe('estado_mesas');
    expect(eventos).toHaveLength(1);
    expect(eventos[0].datos.map((m) => m.id)).not.toContain('Mesa 10');
  });

  test.each(['abc', '0', '-1', '1.5', '1e1', '', ' 5', '05'])(
    'rechaza el número inválido %j con ENTRADA_INVALIDA',
    (numero) => {
      const { servicio, mesas } = crear();
      const r = servicio.quitarMesa(numero);
      expect(r.ok).toBe(false);
      expect(r.tipo).toBe('ENTRADA_INVALIDA');
      expect(mesas.listar()).toHaveLength(10);
    }
  );

  test('una mesa que no existe responde NO_ENCONTRADO', () => {
    const { servicio } = crear();
    expect(servicio.quitarMesa(11)).toEqual({
      ok: false,
      tipo: 'NO_ENCONTRADO',
      error: 'La mesa 11 no existe.'
    });
  });

  test('una mesa ocupada no se puede quitar (ESTADO_NO_PERMITIDO)', () => {
    const { servicio, mesas, notificador } = crear();
    mesas.ocupar('Mesa 2');
    const r = servicio.quitarMesa(2);
    expect(r.ok).toBe(false);
    expect(r.tipo).toBe('ESTADO_NO_PERMITIDO');
    expect(r.error).toMatch(/está ocupada/);
    expect(mesas.obtener('Mesa 2')).not.toBeNull();
    expect(notificador.eventos).toHaveLength(0);
  });

  test('una mesa con pedido vigente no se puede quitar (PEDIDO_ACTIVO)', () => {
    const { servicio, mesas, pedidos } = crear();
    // Caso defensivo: un pedido sobre una mesa que figura libre
    pedidos.guardar('Mesa 5', { mesa: 'Mesa 5', estado: 'En Cocina 🍳' });
    const r = servicio.quitarMesa(5);
    expect(r.ok).toBe(false);
    expect(r.tipo).toBe('PEDIDO_ACTIVO');
    expect(r.error).toMatch(/En Cocina/);
    expect(mesas.obtener('Mesa 5')).not.toBeNull();
  });

  test('la última mesa no se puede quitar', () => {
    const { servicio, mesas } = crear(1);
    const r = servicio.quitarMesa(1);
    expect(r.ok).toBe(false);
    expect(r.tipo).toBe('ESTADO_NO_PERMITIDO');
    expect(r.error).toMatch(/última mesa/);
    expect(mesas.listar()).toHaveLength(1);
  });

  test('con dos mesas se puede quitar una, pero no la que queda', () => {
    const { servicio } = crear(2);
    expect(servicio.quitarMesa(1).ok).toBe(true);
    expect(servicio.quitarMesa(2).ok).toBe(false);
  });
});
