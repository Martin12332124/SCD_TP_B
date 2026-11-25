const pedidoService = require('./pedido.service');
const { PedidosSQLite } = require('./pedido.repository.sqlite');
const { registrarHandlersPedido } = require('./pedido.socket.handlers');

module.exports = {
  ...pedidoService,
  PedidosSQLite,
  registrarHandlersPedido
};
