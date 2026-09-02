const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const db = require('./database');

const mesasRouter = require('./routes/mesas');
const menuRouter = require('./routes/menu');
const modificadoresRouter = require('./routes/modificadores');
const ingredientesRouter = require('./routes/ingredientes');
const pedidosRouter = require('./routes/pedidos');
const ventasRouter = require('./routes/ventas');
const authRouter = require('./routes/auth');
const { verificarToken } = require('./middleware/auth');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'] }
});

// Hacer io accesible a los routers para emitir eventos desde los handlers REST
app.set('io', io);

// Habilitar CORS para todas las rutas REST (necesario para fetch desde el frontend en otro puerto)
app.use(cors());
app.use(express.json());

// ============================================================
// RUTAS REST
// ============================================================

// Ruta pública: auth (login no requiere token)
app.use('/api/auth', authRouter);

// Middleware de autenticación — protege todas las rutas que siguen
app.use(verificarToken);

app.use('/api/mesas', mesasRouter);
app.use('/api/menu', menuRouter);
app.use('/api/modificadores', modificadoresRouter);
app.use('/api/ingredientes', ingredientesRouter);
app.use('/api/pedidos', pedidosRouter);
app.use('/api/ventas', ventasRouter);

app.get('/', (req, res) => {
  res.json({ mensaje: 'Servidor del Sistema de Pedidos del Restaurante operativo.' });
});

// ============================================================
// WEBSOCKETS
// ============================================================
io.on('connection', (socket) => {
  console.log(`[SOCKET] Cliente conectado: ${socket.id}`);

  // Enviar estado actual de mesas al nuevo cliente
  try {
    const mesas = db.prepare('SELECT * FROM mesas ORDER BY numero ASC').all();
    socket.emit('estado_mesas', mesas);
  } catch (err) {
    console.error('[SOCKET] Error al emitir mesas iniciales:', err.message);
  }

  // Enviar pedidos activos al nuevo cliente (para que el KDS sincronice al conectarse)
  try {
    const { cargarPedidosConItems } = require('./routes/pedidos');
    const pedidosActivos = cargarPedidosConItems();
    socket.emit('pedidos_activos', pedidosActivos);
  } catch (err) {
    console.error('[SOCKET] Error al emitir pedidos activos:', err.message);
  }

  socket.on('disconnect', () => {
    console.log(`[SOCKET] Cliente desconectado: ${socket.id}`);
  });
});

// ============================================================
// INICIAR SERVIDOR
// ============================================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`=============================================`);
  console.log(` Servidor Restaurante corriendo en el puerto ${PORT}`);
  console.log(`=============================================`);
});
