const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Configuración de Socket.io (permite conexiones desde tu futuro Frontend)
const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

// Middleware para entender formato JSON si envías datos por HTTP
app.use(express.json());

// Ruta básica de prueba
app.get('/', (req, res) => {
    res.send('Servidor del Sistema de Congestión operativo.');
});

// Lógica de comunicación en tiempo real con Socket.io
io.on('connection', (socket) => {
    console.log(`[SOCKET] Nuevo cliente conectado. ID: ${socket.id}`);

    // Ejemplo de evento: Recibir actualización de tráfico o congestión
    socket.on('actualizar_congestion', (datos) => {
        console.log('Datos de congestión recibidos:', datos);
        
        // Reenviar los datos a todos los demás usuarios conectados (Frontend)
        socket.broadcast.emit('cambio_congestion', datos);
    });

    socket.on('disconnect', () => {
        console.log(`[SOCKET] Cliente desconectado. ID: ${socket.id}`);
    });
});

// Iniciar el servidor en el puerto 3000
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`=============================================`);
    console.log(` Servidor Backend corriendo en el puerto ${PORT}`);
    console.log(`=============================================`);
});
