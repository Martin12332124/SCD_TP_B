const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Configuración de Socket.io (permite conexiones desde tu Frontend)
const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

// Middleware para entender formato JSON si envías datos por HTTP
app.use(express.json());

// Ruta básica de prueba adaptada
app.get('/', (req, res) => {
    res.send('Servidor del Sistema de Pedidos del Restaurante operativo.');
});

// Lógica de comunicación en tiempo real con Socket.io
io.on('connection', (socket) => {
    console.log(`[SOCKET] Nuevo cliente conectado. ID: ${socket.id}`);

    // Recibir actualización de pedido desde el frontend
    socket.on('actualizar_pedido', (datos) => {
        console.log('\n[SOCKET] Intento de actualización de pedido:', datos);
        
        // ==========================================
        // VALIDACIÓN DE DATOS DE ENTRADA (BACKEND)
        // ==========================================

        // 1. Validar que el paquete de datos no llegue vacío
        if (!datos || !datos.mesa || !datos.estado) {
            console.error('❌ RECHAZADO: Estructura de datos incompleta.');
            return; // Detiene el proceso y no emite nada
        }

        // 2. Validar que el estado del pedido sea estrictamente uno de los permitidos
        const ESTADOS_VALIDOS = ['Recibido 📝', 'En Cocina 🍳', 'Listo 🍽️'];
        if (!ESTADOS_VALIDOS.includes(datos.estado)) {
            console.error(`❌ RECHAZADO: El estado "${datos.estado}" no está permitido en el negocio.`);
            return; // Detiene el proceso
        }

        // 3. Validar que el número de mesa sea coherente
        // Extraemos el número limpiando el texto "Mesa " que manda el frontend
        const numeroMesa = datos.mesa.replace("Mesa ", "");
        if (isNaN(numeroMesa) || parseInt(numeroMesa) <= 0) {
            console.error(`❌ RECHAZADO: "${datos.mesa}" no corresponde a un número de mesa válido.`);
            return; // Detiene el proceso
        }

        // ==========================================
        // PROCESAMIENTO (Si pasó todas las validaciones)
        // ==========================================
        console.log(`✅ VALIDADO EXITOSAMENTE: ${datos.mesa} -> ${datos.estado}`);
        
        // Enviamos los datos limpios a TODOS los clientes conectados (Mozo, Cocina, Pantallas)
        io.emit('cambio_estado_pedido', datos);
    });

    socket.on('disconnect', () => {
        console.log(`[SOCKET] Cliente desconectado. ID: ${socket.id}`);
    });
});

// Iniciar el servidor en el puerto 3000
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`=============================================`);
    console.log(` Servidor Restaurante corriendo en el puerto ${PORT}`);
    console.log(`=============================================`);
});
