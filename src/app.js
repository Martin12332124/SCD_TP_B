// src/app.js
// Configuración de la aplicación Express + Socket.io
// Usa PedidoService con dependencias explícitas y persistencia en SQLite.

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const { PedidoService } = require('./dominio/pedido.service');
const { MesaService } = require('./dominio/mesa.service');
const { MesaEstadoService } = require('./dominio/mesa-estado.service');
const { MenuItemService } = require('./dominio/menu-item.service');
const { abrirBaseDeDatos } = require('./infraestructura/sqlite/conexion');
const {
  PedidosSQLite,
  MesasSQLite,
  MenuItemsSQLite
} = require('./infraestructura/sqlite/repositorios-sqlite');
const {
  NotificadorTransaccional,
  envolverEnTransaccion
} = require('./infraestructura/sqlite/transacciones');
const { SocketNotificador } = require('./infraestructura/notificador');
const { crearMesasRouter } = require('./presentacion/mesas.router');
const { crearMenuItemsRouter } = require('./presentacion/menu-items.router');
const { registrarHandlersSocket } = require('./presentacion/socket.handlers');

/**
 * Crea la aplicación con sus dependencias.
 * @param {object} [opciones]
 * @param {string} [opciones.rutaDb=':memory:'] - Archivo SQLite. Por defecto una base en
 *   memoria, nueva en cada llamada (así los tests parten limpios); index.js pasa la ruta real.
 */
function crearApp({ rutaDb = ':memory:' } = {}) {
  const app = express();
  const server = http.createServer(app);

  const io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  // CORS para la API REST (el frontend corre en otro origen, p. ej. Vite :5173)
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.use(express.json());

  // ── Instancias de producción (inyección de dependencias) ──────────
  // Los tres repositorios comparten la misma conexión para que una transacción los abarque.
  const db = abrirBaseDeDatos(rutaDb);
  const pedidos = new PedidosSQLite(db);
  const mesas = new MesasSQLite(db, 10); // 10 mesas iniciales, solo si la tabla está vacía
  // La semilla del menú solo se inserta si la tabla está vacía.
  const menuItems = new MenuItemsSQLite(db, [
    { id: 1, nombre: 'Pizza Margarita', precioBase: 8500, disponible: true },
    { id: 2, nombre: 'Coca-Cola 500 ml', precioBase: 2000, disponible: true },
    { id: 3, nombre: 'Ensalada César', precioBase: 6500, disponible: true }
  ]);
  // Retiene los eventos hasta que la transacción del caso de uso se confirma (REF-09).
  const notificador = new NotificadorTransaccional(new SocketNotificador(io));

  const pedidoService = new PedidoService({ pedidos, mesas, notificador, menuItems });
  const mesaService = new MesaService({ pedidos, mesas, notificador });
  const mesaEstadoService = new MesaEstadoService({ pedidos, mesas, notificador });
  const menuItemService = new MenuItemService({ menuItems, notificador });

  // Cada caso de uso que escribe corre en una transacción: se guarda completo o nada.
  envolverEnTransaccion(db, notificador, pedidoService, ['actualizarEstado', 'confirmarPedido']);
  envolverEnTransaccion(db, notificador, mesaService, ['trasladarPedido']);
  envolverEnTransaccion(db, notificador, mesaEstadoService, ['abrirMesa', 'cerrarMesa']);
  envolverEnTransaccion(db, notificador, menuItemService, [
    'crearItem',
    'editarItem',
    'cambiarDisponibilidad'
  ]);

  // ── API REST (US-08, US-09): gestión de estado de mesas ──────────────
  app.use('/api/mesas', crearMesasRouter({ mesaEstadoService, mesas, pedidoService }));

  // ── API REST (US-07): gestión de ítems del menú ───────────────────
  app.use('/api/menu-items', crearMenuItemsRouter({ menuItemService }));

  // Ruta básica de prueba
  app.get('/', (req, res) => {
    res.send('Servidor del Sistema de Pedidos del Restaurante operativo.');
  });

// ── Socket.io: comunicación en tiempo real (ver presentacion/socket.handlers.js)
  registrarHandlersSocket(io, { pedidoService, mesaService, mesas });


  // ── Middleware de errores de Express 5 (DESPUÉS de montar rutas) ───
  // Captura JSON malformado y errores internos; devuelve JSON, no HTML.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    // JSON malformado en el body (SyntaxError de express.json())
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({
        ok: false,
        tipo: 'ENTRADA_INVALIDA',
        error: 'El cuerpo de la petición no es un JSON válido.'
      });
    }

    // Cualquier otro error
    return res.status(500).json({
      ok: false,
      tipo: 'ERROR_INTERNO',
      error: err.message
    });
  });

  return {
    app,
    server,
    io,
    db,
    pedidoService,
    mesaService,
    mesaEstadoService,
    menuItemService,
    pedidos,
    mesas,
    menuItems
  };
}

module.exports = { crearApp };
