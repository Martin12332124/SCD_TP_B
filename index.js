// index.js
// Punto de entrada del servidor.
// Usa la función crearApp() que inyecta las dependencias de producción.

const { crearApp } = require('./src/app');

const { server } = crearApp();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`=============================================`);
  console.log(` Servidor Restaurante corriendo en el puerto ${PORT}`);
  console.log(`=============================================`);
});
