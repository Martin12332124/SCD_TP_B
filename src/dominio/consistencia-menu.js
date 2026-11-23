// src/dominio/consistencia-menu.js
// Invariante del catálogo: todo ítem del menú tiene nombre no vacío
// y precioBase entero entre 1 y PRECIO_MAXIMO.
// Archivo separado de consistencia.js para no modificar la invariante de mesas/pedidos.

/**
 * Verifica la consistencia del repositorio de ítems del menú.
 * Lanza un Error (aserción) si se detecta una violación del invariante.
 *
 * @param {object} menuItems   - Repositorio de ítems del menú (debe tener .listar())
 * @param {number} precioMaximo - Precio máximo permitido (PRECIO_MAXIMO)
 */
function verificarConsistenciaMenu(menuItems, precioMaximo) {
  const todos = menuItems.listar();

  for (const item of todos) {
    // Nombre no vacío
    if (typeof item.nombre !== 'string' || item.nombre.trim().length === 0) {
      throw new Error(
        `Invariante rota: el ítem con id ${item.id} tiene un nombre vacío o inválido.`
      );
    }

    // precioBase entero entre 1 y precioMaximo
    if (
      typeof item.precioBase !== 'number' ||
      !Number.isInteger(item.precioBase) ||
      item.precioBase < 1 ||
      item.precioBase > precioMaximo
    ) {
      throw new Error(
        `Invariante rota: el ítem "${item.nombre}" (id ${item.id}) tiene un precioBase inválido: ${item.precioBase}.`
      );
    }
  }
}

module.exports = { verificarConsistenciaMenu };
