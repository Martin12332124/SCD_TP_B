# Historial de cambios — SCD_TP_B (Backend)

## [v3.0.0] — 2026-11-24 (Hito 3)

### Refactorización y modularización
- **Intervención 3 (PR #47):** Separación de los manejadores de Socket.IO desde `src/app.js` hacia `src/presentacion/socket.handlers.js` (`registrarHandlersSocket`), reduciendo `src/app.js` de 186 a 106 líneas en el alcance intervenido.
- Unificación de los bloques `try/catch` repetidos en el helper `responderSeguro(socket, opciones)`.
- Pruebas unitarias dedicadas en `test/socket.handlers.test.js` (4 casos: éxito, rechazo, excepción e `alExito` opcional).

### Seguridad y dependencias
- Aplicación de `npm audit fix`: actualización de `engine.io` de `6.6.9` a `6.6.13`, mitigando la vulnerabilidad alta [GHSA-2gc4-cqfq-p2gv](https://github.com/advisories/GHSA-2gc4-cqfq-p2gv) (`npm audit --omit=dev` reporta 0 vulnerabilidades en producción).

### Documentación y cierre
- Agregada sección **"Cómo extender el sistema"** en `README.md` (nuevas rutas HTTP, eventos Socket.IO, servicios de dominio y cambios en el esquema SQLite).
- Verificación completa: `npm run build`, `npm run lint` y `npm run test:ci` (**17 suites, 435/435 pruebas aprobadas**, cobertura global **97,71 % sentencias / 90,75 % ramas / 99,18 % funciones / 98,64 % líneas**).

## [v0.1.0-alpha] — 2026-11-01 (Hito 2)
- Servicios de dominio (`PedidoService`, `MesaService`, `MesaEstadoService`, `MesaConfiguracionService`, `MenuItemService`, `UsuarioService`), persistencia SQLite, autenticación JWT, API gateway y sincronización opcional con Supabase.
