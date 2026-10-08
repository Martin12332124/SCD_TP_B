// src/app.js
// Configuración de la aplicación Express + Socket.io
// Usa PedidoService con dependencias explícitas.

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const { PedidoService } = require('./dominio/pedido.service');
const { MesaService } = require('./dominio/mesa.service');
const { PedidosEnMemoria, MesasEnMemoria } = require('./infraestructura/repositorios');
const { SocketNotificador } = require('./infraestructura/notificador');

function crearApp() {
  const app = express();
  const server = http.createServer(app);

  const io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  app.use(express.json());

  // ── Instancias de producción (inyección de dependencias) ──────────
  const pedidos = new PedidosEnMemoria();
  const mesas = new MesasEnMemoria(10);
  const notificador = new SocketNotificador(io);

  const pedidoService = new PedidoService({ pedidos, mesas, notificador });
  const mesaService = new MesaService({ pedidos, mesas, notificador });

  // Ruta básica de prueba
  app.get('/', (req, res) => {
    res.send('Servidor del Sistema de Pedidos del Restaurante operativo.');
  });

  // ── Socket.io: comunicación en tiempo real ────────────────────────
  io.on('connection', (socket) => {
    console.log(`[SOCKET] Nuevo cliente conectado. ID: ${socket.id}`);

    // Enviar estado inicial de mesas al cliente que se conecta
    socket.emit('estado_mesas', mesas.listar());

    // Recibir actualización de pedido desde el frontend
    socket.on('actualizar_pedido', (datos) => {
      console.log('\n[SOCKET] Intento de actualización de pedido:', datos);

      try {
        const resultado = pedidoService.actualizarEstado(datos);

        if (resultado.ok) {
          console.log(`✅ VALIDADO: ${resultado.mesa} → ${resultado.estado}`);
          // Responder al emisor con confirmación
          socket.emit('respuesta_pedido', resultado);
        } else {
          console.error(`❌ RECHAZADO [${resultado.tipo}]: ${resultado.error}`);
          socket.emit('respuesta_pedido', resultado);
        }
      } catch (error) {
        // Dependencia no disponible: propagar el error sin ocultar
        console.error(`💥 ERROR INTERNO: ${error.message}`);
        socket.emit('respuesta_pedido', {
          ok: false,
          tipo: 'ERROR_INTERNO',
          error: error.message
        });
      }
    });

    socket.on('disconnect', () => {
      console.log(`[SOCKET] Cliente desconectado. ID: ${socket.id}`);
    });

    // ── Operación 3 (US-05): Traslado de pedido entre mesas ──────────
    socket.on('trasladar_pedido', (datos) => {
      console.log('\n[SOCKET] Intento de traslado de pedido:', datos);

      try {
        const resultado = mesaService.trasladarPedido(datos);

        if (resultado.ok) {
          console.log(
            `✅ TRASLADO OK: ${resultado.origen} → ${resultado.destino} (${resultado.estado})`
          );
          socket.emit('respuesta_traslado', resultado);
        } else {
          console.error(`❌ TRASLADO RECHAZADO [${resultado.tipo}]: ${resultado.error}`);
          socket.emit('respuesta_traslado', resultado);
        }
      } catch (error) {
        // Dependencia no disponible: propagar el error sin ocultar
        console.error(`💥 ERROR INTERNO EN TRASLADO: ${error.message}`);
        socket.emit('respuesta_traslado', {
          ok: false,
          tipo: 'ERROR_INTERNO',
          error: error.message
        });
      }
    });
  });

  return { app, server, io, pedidoService, mesaService, pedidos, mesas };
}

module.exports = { crearApp };
