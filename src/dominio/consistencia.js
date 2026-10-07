// src/dominio/consistencia.js
// Invariante del sistema: una mesa ocupada tiene exactamente un pedido vigente
// y todo pedido vigente está sobre una mesa ocupada.

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

  // 1. Toda mesa ocupada debe tener exactamente un pedido vigente
  for (const m of todasMesas) {
    if (m.estado === 'ocupada') {
      const pedido = pedidos.obtener(m.id);
      if (!pedido) {
        throw new Error(
          `Invariante rota: Mesa ${m.id} está ocupada pero no tiene pedido vigente.`
        );
      }
    }
  }

  // 2. Todo pedido vigente debe estar en una mesa ocupada
  for (const [mesaId, pedido] of Object.entries(todosPedidos)) {
    const mesaInfo = todasMesas.find((m) => m.id === mesaId);
    if (!mesaInfo || mesaInfo.estado !== 'ocupada') {
      throw new Error(
        `Invariante rota: Pedido vigente en ${mesaId} pero la mesa no está ocupada.`
      );
    }
  }
}

module.exports = { verificarConsistenciaMesasPedidos };
