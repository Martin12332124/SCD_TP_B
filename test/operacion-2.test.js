// test/operacion-2.test.js
// Tests unitarios y de contrato para Operación 2: Validación defensiva del número de mesa en el Backend
// Complementa la validación del frontend asegurando la segunda barrera en PedidoService.

const { PedidoService } = require('../src/dominio/pedido.service');
const { PedidosEnMemoria, MesasEnMemoria } = require('../src/infraestructura/repositorios');
const { NotificadorEspia } = require('./doubles');

function crearContexto() {
  const pedidos = new PedidosEnMemoria();
  const mesas = new MesasEnMemoria(10);
  const notificador = new NotificadorEspia();
  const servicio = new PedidoService({ pedidos, mesas, notificador });
  return { servicio, pedidos, mesas, notificador };
}

describe('Operación 2 (Ficha 2) – Segunda barrera defensiva de número de mesa (PedidoService)', () => {
  describe('Validación defensiva (Casos inválidos de Ficha 2)', () => {
    test('Entrada inválida 1: rechaza mesa 0 ("Mesa 0")', () => {
      const { servicio, notificador } = crearContexto();
      const res = servicio.actualizarEstado({ mesa: 'Mesa 0', estado: 'Recibido 📝' });

      expect(res.ok).toBe(false);
      expect(res.tipo).toBe('ENTRADA_INVALIDA');
      expect(res.error).toBe('mesa no tiene un formato válido');
      expect(res.esperado).toBe('"Mesa N" con N entero positivo.');
      // Invariante: no se emite ningún evento ni se altera el estado
      expect(notificador.eventos).toHaveLength(0);
    });

    test('Entrada inválida 2: rechaza mesa negativa ("Mesa -1")', () => {
      const { servicio, notificador } = crearContexto();
      const res = servicio.actualizarEstado({ mesa: 'Mesa -1', estado: 'Recibido 📝' });

      expect(res.ok).toBe(false);
      expect(res.tipo).toBe('ENTRADA_INVALIDA');
      expect(res.error).toBe('mesa no tiene un formato válido');
      expect(res.esperado).toBe('"Mesa N" con N entero positivo.');
      expect(notificador.eventos).toHaveLength(0);
    });

    test('Entrada inválida adicional: rechaza mesa no numérica ("Mesa abc")', () => {
      const { servicio, notificador } = crearContexto();
      const res = servicio.actualizarEstado({ mesa: 'Mesa abc', estado: 'Recibido 📝' });

      expect(res.ok).toBe(false);
      expect(res.tipo).toBe('ENTRADA_INVALIDA');
      expect(notificador.eventos).toHaveLength(0);
    });

    test('Entrada inválida adicional: rechaza mesa como número directo sin prefijo ({ mesa: 0 })', () => {
      const { servicio, notificador } = crearContexto();
      const res = servicio.actualizarEstado({ mesa: 0, estado: 'Recibido 📝' });

      expect(res.ok).toBe(false);
      expect(res.tipo).toBe('ENTRADA_INVALIDA');
      expect(notificador.eventos).toHaveLength(0);
    });
  });

  describe('Postcondiciones (Casos válidos de Ficha 2)', () => {
    test('Caso válido: procesa correctamente "Mesa 5"', () => {
      const { servicio, notificador, mesas } = crearContexto();
      const res = servicio.actualizarEstado({ mesa: 'Mesa 5', estado: 'Recibido 📝' });

      expect(res.ok).toBe(true);
      expect(res.mesa).toBe('Mesa 5');
      expect(res.estado).toBe('Recibido 📝');
      expect(mesas.obtener('Mesa 5').estado).toBe('ocupada');
      expect(notificador.eventos.length).toBeGreaterThan(0);
    });

    test('Caso válido: procesa correctamente límite inferior "Mesa 1"', () => {
      const { servicio, notificador, mesas } = crearContexto();
      const res = servicio.actualizarEstado({ mesa: 'Mesa 1', estado: 'Recibido 📝' });

      expect(res.ok).toBe(true);
      expect(res.mesa).toBe('Mesa 1');
      expect(res.estado).toBe('Recibido 📝');
      expect(mesas.obtener('Mesa 1').estado).toBe('ocupada');
    });
  });
});
