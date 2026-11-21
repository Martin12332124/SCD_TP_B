# Inicio de sesión

## 1. Resumen

No se puede leer ni escribir nada sin sesión, ni en local ni en la nube. No hay roles: cualquier
usuario con sesión usa el POS y el riel de comandas.

- **Local (funciona sin internet):** tabla `usuarios` en SQLite con la contraseña hasheada con
  `crypto.scrypt`. `POST /api/auth/login` entrega un JWT firmado con `JWT_SECRET` (12 h, un turno).
  `/api/mesas` y `/api/menu-items` exigen `Authorization: Bearer <token>`; Socket.IO rechaza la
  conexión sin token (`connect_error` con mensaje `NO_AUTORIZADO`).
- **Nube:** Supabase Auth. El formulario pide "usuario" y la web lo convierte en
  `usuario@sistema.local`. Las tablas solo se leen con sesión (`authenticated`, ver
  `supabase/esquema.sql`).
- **Frontend (repo SCD_TP_F):** la misma pantalla de login en ambos modos; `api.js` decide contra
  qué se valida. Un 401, un socket rechazado o la sesión de Supabase cerrada vuelven al login.

## 2. Archivos

| Archivo | Capa | Qué hace |
| --- | --- | --- |
| `src/dominio/usuario.service.js` | Dominio | `iniciarSesion`, `verificarToken`, `crearUsuariosIniciales` y las reglas del nombre de usuario. No conoce SQLite, scrypt ni JWT: se los inyecta `app.js`. |
| `src/infraestructura/sqlite/usuarios-sqlite.js` | Infraestructura | Tabla `usuarios` (`nombre_usuario` único, `hash_contrasena`). Se crea en el constructor, como `ordenes_aplicadas`. |
| `src/infraestructura/seguridad/contrasenas.js` | Infraestructura | Hash y verificación con scrypt, sal por usuario y comparación en tiempo constante. |
| `src/infraestructura/seguridad/tokens.js` | Infraestructura | Firma y verificación de JWT (HS256 fijo). |
| `src/presentacion/auth.router.js` | Presentación | `POST /api/auth/login`. |
| `src/presentacion/autenticacion.js` | Presentación | `exigirToken` (Express) y `exigirTokenSocket` (Socket.IO). |
| `src/app.js` | Composición | Arma `UsuarioService`, monta el login, protege las rutas y el socket, y permite `Authorization` en CORS. |
| `index.js` | Arranque | Exige `JWT_SECRET` y crea los usuarios de `USUARIOS_INICIALES` si la tabla está vacía. |
| `test/auth.test.js`, `test/sesion.js` | Tests | 39 tests nuevos; `sesion.js` da un token a los tests de API y socket. |

## 3. Decisiones técnicas y su porqué

- **scrypt con sal por usuario.** Un hash rápido (SHA-256) se puede probar millones de veces por
  segundo si alguien copia el `.db`; scrypt es lento y usa memoria a propósito. La sal hace que dos
  contraseñas iguales tengan hashes distintos. Viene con Node: no hay dependencias nuevas.
- **Mismo error para usuario inexistente y contraseña mala**, y un scrypt de señuelo cuando el
  usuario no existe: ni el mensaje ni el tiempo de respuesta revelan qué nombres existen.
- **JWT sin sesiones en el servidor.** El servidor solo verifica la firma; funciona igual tras un
  reinicio. `algorithms: ['HS256']` fijo rechaza tokens con `alg: none`. Dura 12 h: un turno.
- **Sin `JWT_SECRET` el servidor no arranca.** Arrancar sin login o con un secreto escrito en el
  código dejaría el POS abierto. Se piden 32 caracteres o más (256 bits para HS256).
- **El login no se puede apagar.** `crearApp()` sin secreto usa uno aleatorio que dura lo que el
  proceso (para tests); no existe una opción "sin login".
- **Usuarios iniciales solo con la tabla vacía.** Un reinicio no recrea usuarios ni cambia
  contraseñas. `USUARIOS_INICIALES` se corta en el primer `:`, así la contraseña puede tenerlo.
- **Nombre de usuario de 3–32 caracteres `a-z 0-9 . _ -`, en minúsculas.** Es la misma regla en
  local y en la nube, y es válido como parte local de un correo (`ana@sistema.local`).
- **La tabla `usuarios` no está en `esquema.sql`.** Un test existente exige que el esquema tenga
  exactamente las cuatro tablas del restaurante.

## 4. Cómo usarlo

Agregar al `.env` (ver `.env.example`):

| Variable | Valor |
| --- | --- |
| `JWT_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `USUARIOS_INICIALES` | `usuario:contraseña,usuario2:contraseña2` (contraseña de 8 o más caracteres) |

`npm start` muestra `Usuarios iniciales creados: N` la primera vez. Para agregar usuarios después,
hay que vaciar la tabla `usuarios` (borra a todos) o agregar una ruta de administración (pendiente).

En la nube: Supabase → Authentication → Users → **Add user** con el correo `usuario@sistema.local`,
la contraseña y **Auto Confirm User** marcado.

## 5. Puntos frágiles y pendientes

- **Sin límite de intentos de login.** scrypt hace lento cada intento, pero no hay bloqueo. Lo
  puede cubrir el paso 3 (API gateway).
- **Sin renovación de token local:** a las 12 h hay que volver a entrar. El socket ya abierto
  sigue conectado hasta que se reconecte.
- **Sin pantalla para administrar usuarios** (crear, cambiar contraseña, borrar).
- **Rotar `JWT_SECRET`** invalida todas las sesiones locales: todos vuelven al login.
- **Un token sigue valiendo hasta vencer** aunque se borre el usuario.
