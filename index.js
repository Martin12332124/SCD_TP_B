// index.js
// Punto de entrada del servidor.
// Usa la función crearApp() que inyecta las dependencias de producción.

const { crearApp } = require('./src/app');
const { RUTA_POR_DEFECTO } = require('./src/infraestructura/sqlite/conexion');
const { crearClienteSupabase } = require('./src/infraestructura/sincronizacion/cliente-supabase');

// Archivo de la base de datos: configurable con la variable de entorno DB_PATH.
const rutaDb = process.env.DB_PATH || RUTA_POR_DEFECTO;

// Réplica en la nube: solo si el .env trae las dos variables. Si falta alguna, el
// servidor funciona 100 % local, como siempre. (npm start carga el .env con --env-file.)
const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
const sincronizacion =
  SUPABASE_URL && SUPABASE_SECRET_KEY
    ? { cliente: crearClienteSupabase({ url: SUPABASE_URL, llaveSecreta: SUPABASE_SECRET_KEY }) }
    : null;

const { server, io, db, sincronizador } = crearApp({ rutaDb, sincronizacion });

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`=============================================`);
  console.log(` Servidor Restaurante corriendo en el puerto ${PORT}`);
  console.log(` Base de datos: ${rutaDb}`);
  console.log(` Nube (Supabase): ${sincronizador ? 'activada' : 'desactivada (sin .env)'}`);
  console.log(`=============================================`);
  if (sincronizador) sincronizador.iniciar();
});

// Apagado ordenado (Ctrl+C o señal del sistema): se cierran las conexiones y la base.
// No es necesario para no perder datos (cada commit ya está en disco), pero deja
// el archivo -wal integrado al .db.
function apagar() {
  if (sincronizador) sincronizador.detener();
  io.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', apagar);
process.on('SIGTERM', apagar);
