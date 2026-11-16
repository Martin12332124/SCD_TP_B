// index.js
// Punto de entrada del servidor.
// Usa la función crearApp() que inyecta las dependencias de producción.

const { crearApp } = require('./src/app');
const { RUTA_POR_DEFECTO } = require('./src/infraestructura/sqlite/conexion');

// Archivo de la base de datos: configurable con la variable de entorno DB_PATH.
const rutaDb = process.env.DB_PATH || RUTA_POR_DEFECTO;
const { server, io, db } = crearApp({ rutaDb });

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`=============================================`);
  console.log(` Servidor Restaurante corriendo en el puerto ${PORT}`);
  console.log(` Base de datos: ${rutaDb}`);
  console.log(`=============================================`);
});

// Apagado ordenado (Ctrl+C o señal del sistema): se cierran las conexiones y la base.
// No es necesario para no perder datos (cada commit ya está en disco), pero deja
// el archivo -wal integrado al .db.
function apagar() {
  io.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', apagar);
process.on('SIGTERM', apagar);
