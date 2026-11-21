// src/app.js
// Configuración de la aplicación Express + Socket.io
// Usa PedidoService con dependencias explícitas y persistencia en SQLite.

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const { PedidoService } = require('./dominio/pedido.service');
const { MesaService } = require('./dominio/mesa.service');
const { MesaEstadoService } = require('./dominio/mesa-estado.service');
const { MesaConfiguracionService } = require('./dominio/mesa-configuracion.service');
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
const { MesasConEstadoPedido } = require('./infraestructura/mesas-con-pedido');
const { SocketNotificador } = require('./infraestructura/notificador');
const { crearMesasRouter } = require('./presentacion/mesas.router');
const { crearMenuItemsRouter } = require('./presentacion/menu-items.router');
const { registrarHandlersSocket } = require('./presentacion/socket.handlers');
const { AplicadorOrdenes } = require('./presentacion/ordenes-nube');
const {
  Sincronizador,
  NotificadorConAviso
} = require('./infraestructura/sincronizacion/sincronizador');
const { leerEstadoLocal } = require('./infraestructura/sincronizacion/estado-local');
const { RegistroOrdenesSQLite } = require('./infraestructura/sincronizacion/registro-ordenes');

/**
 * Crea la aplicación con sus dependencias.
 * @param {object} [opciones]
 * @param {string} [opciones.rutaDb=':memory:'] - Archivo SQLite. Por defecto una base en
 *   memoria, nueva en cada llamada (así los tests parten limpios); index.js pasa la ruta real.
 * @param {object|null} [opciones.sincronizacion=null] - Réplica en la nube (Supabase).
 *   Apagada por defecto: sin ella el sistema es 100 % local, igual que antes.
 *   Forma: { cliente, intervaloMs?, esperaMs?, consola? } (ver sincronizacion/sincronizador.js).
 *   crearApp solo la conecta; index.js la inicia con sincronizador.iniciar().
 */
function crearApp({ rutaDb = ':memory:', sincronizacion = null } = {}) {
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
  // 10 mesas iniciales, solo si la tabla está vacía. El decorador agrega a cada mesa
  // el estado de su pedido (estadoPedido), que viaja en la API y en 'estado_mesas'.
  const mesas = new MesasConEstadoPedido(new MesasSQLite(db, 10), pedidos);
  // La semilla del menú solo se inserta si la tabla está vacía.
  const menuItems = new MenuItemsSQLite(db, [
    { id: 1, nombre: 'Pizza Margarita', precioBase: 8500, disponible: true },
    { id: 2, nombre: 'Coca-Cola 500 ml', precioBase: 2000, disponible: true },
    { id: 3, nombre: 'Ensalada César', precioBase: 6500, disponible: true }
  ]);
  // Retiene los eventos hasta que la transacción del caso de uso se confirma (REF-09).
  // Con sincronización, cada evento publicado (o sea, cada COMMIT) avisa además al
  // sincronizador para que suba el estado a la nube.
  let sincronizador = null;
  const notificadorSocket = new SocketNotificador(io);
  const notificador = new NotificadorTransaccional(
    sincronizacion
      ? new NotificadorConAviso(notificadorSocket, () => sincronizador.marcarCambio())
      : notificadorSocket
  );

  const pedidoService = new PedidoService({ pedidos, mesas, notificador, menuItems });
  const mesaService = new MesaService({ pedidos, mesas, notificador });
  const mesaEstadoService = new MesaEstadoService({ pedidos, mesas, notificador });
  const mesaConfiguracionService = new MesaConfiguracionService({ pedidos, mesas, notificador });
  const menuItemService = new MenuItemService({ menuItems, notificador });

  // Cada caso de uso que escribe corre en una transacción: se guarda completo o nada.
  envolverEnTransaccion(db, notificador, pedidoService, ['actualizarEstado', 'confirmarPedido']);
  envolverEnTransaccion(db, notificador, mesaService, ['trasladarPedido']);
  envolverEnTransaccion(db, notificador, mesaEstadoService, ['abrirMesa', 'cerrarMesa']);
  envolverEnTransaccion(db, notificador, mesaConfiguracionService, ['agregarMesa', 'quitarMesa']);
  envolverEnTransaccion(db, notificador, menuItemService, [
    'crearItem',
    'editarItem',
    'cambiarDisponibilidad'
  ]);

  // ── Sincronización con la nube (opcional): local → Supabase y buzón de órdenes ──
  if (sincronizacion) {
    const aplicador = new AplicadorOrdenes({
      servicios: { pedidoService, mesaService, mesaEstadoService, mesaConfiguracionService },
      registro: new RegistroOrdenesSQLite(db)
    });
    // La orden y su registro en una sola transacción, como cualquier otro caso de uso.
    envolverEnTransaccion(db, notificador, aplicador, ['aplicarYRegistrar']);
    sincronizador = new Sincronizador({
      ...sincronizacion,
      leerEstado: () => leerEstadoLocal(db),
      aplicarOrden: (orden) => aplicador.aplicar(orden)
    });
  }

  // ── API REST (US-08, US-09): estado de mesas, y agregar o quitar mesas ──
  app.use(
    '/api/mesas',
    crearMesasRouter({ mesaEstadoService, mesas, pedidoService, mesaConfiguracionService })
  );

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
    mesaConfiguracionService,
    menuItemService,
    pedidos,
    mesas,
    menuItems,
    sincronizador
  };
}

module.exports = { crearApp };
