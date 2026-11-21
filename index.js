// index.js
// Punto de entrada del servidor.
// Usa la función crearApp() que inyecta las dependencias de producción.

const { crearApp } = require('./src/app');
const { RUTA_POR_DEFECTO } = require('./src/infraestructura/sqlite/conexion');
const { crearClienteSupabase } = require('./src/infraestructura/sincronizacion/cliente-supabase');

// Inicio de sesión: sin JWT_SECRET el servidor NO arranca. La alternativa (arrancar sin
// login, o con un secreto por defecto escrito en el código) dejaría el POS abierto.
// 32 caracteres = 256 bits, lo recomendado para firmar con HS256.
const { JWT_SECRET, USUARIOS_INICIALES } = process.env;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error(
    'Falta JWT_SECRET en el .env (mínimo 32 caracteres). Arranca con "npm start", que es lo\n' +
      'que lee el .env. Para generar un secreto:\n' +
      "  node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\""
  );
  process.exit(1);
}

// Archivo de la base de datos: configurable con la variable de entorno DB_PATH.
const rutaDb = process.env.DB_PATH || RUTA_POR_DEFECTO;

// Réplica en la nube: solo si el .env trae las dos variables. Si falta alguna, el
// servidor funciona 100 % local, como siempre. (npm start carga el .env con --env-file.)
const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
const sincronizacion =
  SUPABASE_URL && SUPABASE_SECRET_KEY
    ? { cliente: crearClienteSupabase({ url: SUPABASE_URL, llaveSecreta: SUPABASE_SECRET_KEY }) }
    : null;

const { server, io, db, sincronizador, usuarioService } = crearApp({
  rutaDb,
  sincronizacion,
  autenticacion: { secreto: JWT_SECRET }
});

const PORT = process.env.PORT || 3000;

async function arrancar() {
  // Usuarios iniciales: solo si la tabla está vacía (el primer arranque).
  const iniciales = await usuarioService.crearUsuariosIniciales(USUARIOS_INICIALES);
  if (!iniciales.ok) {
    console.error(`No se pudieron crear los usuarios iniciales: ${iniciales.error}`);
    process.exit(1);
  }
  if (usuarioService.usuarios.contar() === 0) {
    console.error(
      'No hay usuarios: define USUARIOS_INICIALES en el .env (usuario:contraseña,...).'
    );
    process.exit(1);
  }
  if (iniciales.creados > 0) console.log(`Usuarios iniciales creados: ${iniciales.creados}`);

  server.listen(PORT, () => {
    console.log(`=============================================`);
    console.log(` Servidor Restaurante corriendo en el puerto ${PORT}`);
    console.log(` Base de datos: ${rutaDb}`);
    console.log(
      ` Nube (Supabase): ${sincronizador ? 'activada' : 'desactivada (sin SUPABASE_URL ni SUPABASE_SECRET_KEY)'}`
    );
    console.log(`=============================================`);
    if (sincronizador) sincronizador.iniciar();
  });
}

arrancar();

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
