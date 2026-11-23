// src/dominio/consistencia.js
// Invariante del sistema: todo pedido vigente está sobre una mesa ocupada
// (una mesa ocupada puede no tener pedido aún, ver US-09).

/**
 * Verifica la consistencia entre el repositorio de pedidos y el de mesas.
 * Lanza un Error (aserción) si se detecta una violación del invariante.
 *
 * @param {object} pedidos - Repositorio de pedidos (debe tener .todos())
 * @param {object} mesas   - Repositorio de mesas   (debe tener .listar())
 */
function verificarConsistenciaMesasPedidos(pedidos, mesas) {
  const todosPedidos = pedidos.todos();
  const todasMesas = mesas.listar();

  // Nota (US-09): una mesa puede estar ocupada sin pedido todavía (se abrió,
  // pero aún no se toma el pedido), por lo que esa combinación es válida.

  // 2. Todo pedido vigente debe estar en una mesa ocupada
  for (const mesaId of Object.keys(todosPedidos)) {
    const mesaInfo = todasMesas.find((m) => m.id === mesaId);
    if (!mesaInfo || mesaInfo.estado !== 'ocupada') {
      throw new Error(`Invariante rota: Pedido vigente en ${mesaId} pero la mesa no está ocupada.`);
    }
  }
}

module.exports = { verificarConsistenciaMesasPedidos };