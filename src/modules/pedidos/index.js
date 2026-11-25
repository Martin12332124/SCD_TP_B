const pedidoService = require('./pedido.service');
const { PedidosSQLite } = require('./pedido.repository.sqlite');
const { crearPedidosRouter } = require('./pedido.router');
const { registrarHandlersPedido } = require('./pedido.socket.handlers');

module.exports = {
  ...pedidoService,
  PedidosSQLite,
  crearPedidosRouter,
  registrarHandlersPedido
};
