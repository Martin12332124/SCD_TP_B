//test/menu-item.service.test.js

const { MenuItemService, PRECIO_MAXIMO } = require('../src/dominio/menu-item.service');
const { MenuItemsEnMemoria } = require('../src/infraestructura/repositorios');

function crearEntorno() {
  const menuItems = new MenuItemsEnMemoria([
    { id: 1, nombre: 'Pizza Margarita', precioBase: 8500, disponible: true },
    { id: 2, nombre: 'Coca-Cola 500 ml', precioBase: 2000, disponible: true }
  ]);
  const notificador = { emitir: jest.fn() };
  return { menuItems, notificador, servicio: new MenuItemService({ menuItems, notificador }) };
}

describe('MenuItemService (US-07) - módulo crítico', () => {
  // --- Casos válidos ---
  test('crea un ítem con precio válido y lo deja disponible', () => {
    const { servicio, notificador } = crearEntorno();
    const r = servicio.crearItem({ nombre: 'Hamburguesa Clásica', precioBase: 5900 });
    expect(r.ok).toBe(true);
    expect(r.item.precioBase).toBe(5900);
    expect(r.item.disponible).toBe(true);
    expect(notificador.emitir).toHaveBeenCalledTimes(1);
  });

  test('edita el precio de un ítem existente', () => {
    const { servicio } = crearEntorno();
    const r = servicio.editarItem('1', { precioBase: 9500 });
    expect(r.ok).toBe(true);
    expect(r.item.precioBase).toBe(9500);
  });

  // --- Valores límite ---
  test('límite inferior: acepta precio 1', () => {
    expect(crearEntorno().servicio.crearItem({ nombre: 'Agua', precioBase: 1 }).ok).toBe(true);
  });

  test('límite superior: acepta precio 1.000.000', () => {
    expect(PRECIO_MAXIMO).toBe(1000000);
    expect(crearEntorno().servicio.crearItem({ nombre: 'Caja', precioBase: 1000000 }).ok).toBe(true);
  });

  test.each([0, 1000001])('límite: rechaza el precio %s (ENTRADA_INVALIDA)', (precio) => {
    const r = crearEntorno().servicio.crearItem({ nombre: 'Prueba', precioBase: precio });
    expect(r.ok).toBe(false);
    expect(r.tipo).toBe('ENTRADA_INVALIDA');
  });

  test('límite del nombre: acepta 60 caracteres y rechaza 61', () => {
    const { servicio } = crearEntorno();
    expect(servicio.crearItem({ nombre: 'a'.repeat(60), precioBase: 100 }).ok).toBe(true);
    const r = servicio.crearItem({ nombre: 'b'.repeat(61), precioBase: 100 });
    expect(r.ok).toBe(false);
    expect(r.tipo).toBe('ENTRADA_INVALIDA');
  });

  // --- Errores ---
  test.each([-1, 1500.5, '3500', undefined])('rechaza el precio %p (ENTRADA_INVALIDA)', (precio) => {
    const r = crearEntorno().servicio.crearItem({ nombre: 'Prueba', precioBase: precio });
    expect(r.ok).toBe(false);
    expect(r.tipo).toBe('ENTRADA_INVALIDA');
  });

  test('rechaza un cuerpo ausente o un nombre vacío', () => {
    const { servicio } = crearEntorno();
    expect(servicio.crearItem(undefined).tipo).toBe('ENTRADA_INVALIDA');
    expect(servicio.crearItem({ precioBase: 100 }).tipo).toBe('ENTRADA_INVALIDA');
  });

  test('rechaza un nombre repetido sin distinguir mayúsculas (DUPLICADO)', () => {
    const r = crearEntorno().servicio.crearItem({ nombre: 'pizza margarita', precioBase: 7000 });
    expect(r.ok).toBe(false);
    expect(r.tipo).toBe('DUPLICADO');
  });

  // --- Regresión: producto inexistente / id inválido (criterio 4 de la US-07) ---
  test('REGRESIÓN US-07: editar un producto inexistente devuelve NO_ENCONTRADO y no crea datos', () => {
    const { servicio } = crearEntorno();
    const antes = servicio.listarItems().items.length;
    const r = servicio.editarItem('999', { precioBase: 5000 });
    expect(r.ok).toBe(false);
    expect(r.tipo).toBe('NO_ENCONTRADO');
    expect(servicio.listarItems().items.length).toBe(antes);
  });

  test('un id inválido en la URL devuelve ENTRADA_INVALIDA', () => {
    const { servicio } = crearEntorno();
    expect(servicio.editarItem('0', { precioBase: 5000 }).tipo).toBe('ENTRADA_INVALIDA');
    expect(servicio.obtenerItem('1e1').tipo).toBe('ENTRADA_INVALIDA');
  });

  test('editar sin campos editables devuelve ENTRADA_INVALIDA', () => {
    expect(crearEntorno().servicio.editarItem('1', {}).tipo).toBe('ENTRADA_INVALIDA');
  });

  test('editar el nombre al de otro ítem devuelve DUPLICADO', () => {
    expect(crearEntorno().servicio.editarItem('1', { nombre: 'coca-cola 500 ml' }).tipo).toBe('DUPLICADO');
  });

  test('obtiene y lista ítems existentes', () => {
    const { servicio } = crearEntorno();
    expect(servicio.obtenerItem('2').ok).toBe(true);
    expect(servicio.listarItems().items.length).toBe(2);
  });
});
