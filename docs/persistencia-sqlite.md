# Persistencia con SQLite

## 1. Resumen

Antes, mesas, menú y pedidos vivían en memoria (`repositorios.js`) y se perdían al reiniciar el
servidor. Ahora el servidor los guarda en un archivo SQLite local (`data/restaurante.db`) usando
`better-sqlite3`, como pide **ADR-03**. La API REST y los eventos de Socket.io no cambiaron.

Además, cada caso de uso que escribe (confirmar un pedido, trasladarlo, abrir una mesa, etc.)
corre dentro de una **transacción**: o se guardan todas sus escrituras o ninguna, y los eventos de
tiempo real se envían solo después de guardar. Así un corte a la mitad no deja comandas perdidas
ni duplicadas (**REF-09**).

## 2. Archivos creados, modificados y eliminados

### Creados

| Archivo | Motivo |
| --- | --- |
| `src/infraestructura/sqlite/esquema.sql` | Las tablas (`CREATE TABLE IF NOT EXISTS`). Se ejecuta en cada arranque sin tocar los datos existentes. |
| `src/infraestructura/sqlite/conexion.js` | `abrirBaseDeDatos(ruta)`: crea la carpeta si falta, abre el archivo, aplica la configuración (pragmas) y el esquema. Exporta `RUTA_POR_DEFECTO`. |
| `src/infraestructura/sqlite/repositorios-sqlite.js` | `PedidosSQLite`, `MesasSQLite`, `MenuItemsSQLite`: mismos métodos, parámetros y retornos que los repositorios en memoria. |
| `src/infraestructura/sqlite/transacciones.js` | `envolverEnTransaccion` (cada caso de uso en una transacción) y `NotificadorTransaccional` (retiene los eventos hasta el commit). |
| `test/repositorios.contrato.test.js` | Los mismos tests contra la versión en memoria y la SQLite, más tests propios de SQLite (emojis, copias, tipos, cascada). |
| `test/persistencia-sqlite.test.js` | Conexión y pragmas, transacciones, atomicidad de `confirmarPedido` y `trasladarPedido`, y reinicio (cerrar y reabrir el mismo archivo). |
| `docs/persistencia-sqlite.md` | Este documento. |

### Modificados

| Archivo | Cambio y motivo |
| --- | --- |
| `package.json`, `package-lock.json` | Dependencia `better-sqlite3@^12.11.1` y campo `allowScripts` (ver sección 4). |
| `.gitignore` | Ignora `data/`, `*.db`, `*.db-wal`, `*.db-shm`: los datos no se suben; el esquema sí. |
| `src/app.js` | `crearApp({ rutaDb })` abre la base, crea los repositorios SQLite, envuelve los servicios en transacciones y devuelve también `db`. Sin argumentos usa una base **en memoria** nueva, por eso los tests existentes no cambiaron. |
| `index.js` | Usa `DB_PATH` o la ruta por defecto, muestra la ruta al arrancar y cierra la base al apagarse (Ctrl+C). |
| `src/infraestructura/repositorios.js` | Solo el comentario de cabecera: ya no es la implementación de producción. |
| `README.md` | Sección corta "Persistencia de datos" con enlace a este documento. |

### Eliminados

Ninguno. Los repositorios en memoria se mantienen porque los usan 6 archivos de test y
`scripts/evidencia.js`, y sirven como referencia: la suite de contrato verifica que la versión
SQLite se comporta igual.

## 3. Esquema

```
mesas (id TEXT PK, numero INTEGER UNIQUE, estado 'libre'|'ocupada')
   │ 1
   │ 0..1
pedidos (mesa_id TEXT PK → mesas.id, estado TEXT)
   │ 1
   │ 0..N   (ON DELETE CASCADE)
pedido_items (mesa_id → pedidos, posicion, item_id, nombre, precio_base, cantidad)
             PK (mesa_id, posicion)

menu_items (id INTEGER PK, nombre TEXT, precio_base INTEGER, disponible 0|1)
```

Relación con `DominioEntidades.md`:

| Tabla | Entidad | Qué se guarda hoy |
| --- | --- | --- |
| `mesas` | **Mesa** | `id` ("Mesa N"), `numero`, `estado`. Aún no se usan `capacidad` ni `ubicacion`. |
| `pedidos` | **Pedido** | Solo el pedido **vigente** de cada mesa, identificado por la mesa (el código actual no tiene id de pedido ni historial). El estado se guarda tal cual, con emoji: `Recibido 📝`, `En Cocina 🍳`. |
| `pedido_items` | **LineaDePedido** | `item_id`, `nombre`, `precio_base` (= `precioUnitario`) y `cantidad`. Nombre y precio son una **copia** del menú al confirmar: si después se cambia el precio, el pedido no cambia ("validez histórica"). `posicion` conserva el orden. |
| `menu_items` | **MenuItem** | `id`, `nombre`, `precioBase` (entero, CLP), `disponible` (0/1 en la base, `true`/`false` en JS). |

Detalles de conversión que los repositorios respetan:

- Un pedido sin ítems se lee **sin** la propiedad `items` (no `null`), igual que en memoria.
- `menuItems.guardar(item)` sin id asigna el siguiente y lo escribe en el objeto recibido.
- `buscarPorNombre` compara en JavaScript (`trim().toLowerCase()`), porque `LOWER()` de SQLite
  solo entiende ASCII ("CÉSAR" no coincidiría con "César").
- `menuItems.obtener("1")` (id como texto) devuelve `null`, igual que en memoria.
- Cada lectura devuelve un objeto nuevo: modificarlo no cambia la base.

## 4. Decisiones técnicas y su porqué

**better-sqlite3 (ADR-03, REF-08).** SQLite es un archivo local, sin servidor aparte ni
internet: cumple ADR-03 y REF-08. `better-sqlite3` es **síncrono**, así que los repositorios
mantienen exactamente los mismos métodos y los servicios no tuvieron que pasar a `async/await`.
Se descartó `node:sqlite` porque pide Node ≥ 22.5 y el CI usa Node 20. Un driver asíncrono (como
`sqlite3`) habría obligado a pasar todos los servicios a `async/await`; un ORM agrega una capa que
este esquema de cuatro tablas no necesita; y un servidor de base de datos (MySQL, PostgreSQL)
sería otro proceso que instalar y mantener en el restaurante, lo que va contra ADR-03.

**Versión 12.x.** better-sqlite3 13.x exige Node ≥ 22. La serie 12.10+ soporta de Node 20 (CI)
a Node 26. El rango `^12.11.1` no sube a la 13 por sí solo.

**`allowScripts` en `package.json`.** npm 11 bloquea por defecto los scripts de instalación de
las dependencias. better-sqlite3 necesita el suyo para descargar su binario nativo; sin
aprobarlo, `require('better-sqlite3')` falla. Se aprobó por nombre (no por versión exacta) para
que una actualización dentro de 12.x no lo vuelva a bloquear. npm 10 ignora este campo.

**Configuración de SQLite** (`conexion.js`):

| Pragma | Qué aporta |
| --- | --- |
| `journal_mode = WAL` | Las escrituras van primero a `restaurante.db-wal`. Una escritura cortada no corrompe la base y las lecturas no bloquean a las escrituras. |
| `synchronous = FULL` | Cada commit espera a que el disco lo confirme. Con `NORMAL` un corte de luz podría perder los últimos commits; para REF-09 no sirve, y con el volumen de un restaurante no se nota. |
| `foreign_keys = ON` | SQLite ignora las claves foráneas si no se activan en cada conexión. |
| `busy_timeout = 5000` | Si otro programa (DB Browser) bloquea la base, el servidor espera hasta 5 s en vez de fallar al instante. |

No se usan tablas `STRICT` porque versiones antiguas de DB Browser for SQLite no las abren.

**Atomicidad (REF-09).** Varios casos de uso escriben más de una vez. Sin transacciones, si el
servidor se cae entre dos escrituras:

- `trasladarPedido`: el pedido podría quedar en dos mesas, y la de destino libre con un pedido.
  Eso además rompe la invariante, y desde ahí cada operación fallaría.
- `actualizarEstado` a "Listo" (comportamiento de entonces): el pedido se borraba pero la mesa
  podía quedar ocupada para siempre. Hoy "Listo" ya no borra nada; ver
  [administracion-mesas.md](administracion-mesas.md).
- `confirmarPedido` (4-5 escrituras): una comanda con ítems que nunca llegó a cocina.

Solución, **sin modificar los servicios del dominio**: en `app.js`, `envolverEnTransaccion`
reemplaza cada método que escribe por una versión que lo ejecuta dentro de
`db.transaction(...)`. Si termina bien hay COMMIT; si lanza un error, ROLLBACK de todas sus
escrituras. Cuando un método llama a otro (`confirmarPedido` → `actualizarEstado`), el interno
corre como transacción anidada (SAVEPOINT). Los tres repositorios comparten una sola conexión, por
eso la transacción los abarca a todos. Si el proceso muere dentro de una transacción, SQLite la
descarta al reabrir.

`NotificadorTransaccional` retiene los eventos de Socket.io mientras la transacción está
abierta y los envía, en el mismo orden, después del commit; si hay rollback los descarta. Es lo que
dice REF-09 en `Arquitectura.md`: "se persiste en una transacción atómica antes de publicarse el
evento". Para los clientes no cambia nada: los eventos llegan en el mismo orden y antes de la
respuesta al socket.

No hay problemas de concurrencia: Node usa un solo hilo y better-sqlite3 es síncrono, así que
dos operaciones nunca se mezclan. Las transacciones protegen frente a caídas, no frente a
concurrencia.

Cambio de comportamiento (solo en errores): si algo lanza a mitad de una operación (por ejemplo,
la aserción de invariante), ahora se deshace todo; antes, en memoria, quedaban las escrituras
parciales.

**Datos iniciales.** La semilla sigue en `app.js`.
- Mesas: las 10 mesas iniciales se crean **solo si la tabla está vacía** (primer arranque). Antes
  se hacía `INSERT OR IGNORE` de Mesa 1 a Mesa 10 en cada arranque, lo que volvía a crear las
  mesas que el restaurante hubiera quitado. Ver [administracion-mesas.md](administracion-mesas.md).
- Menú: la semilla se inserta **solo si la tabla está vacía**. El menú es dato del administrador:
  si renombró o cambió un precio, reiniciar no lo pisa ni duplica ítems.

## 5. Cómo usarlo

**Instalar.** `npm install` (o `npm ci`). Requiere internet la primera vez para descargar el
binario de better-sqlite3; después el servidor funciona sin internet. Si no hay binario para tu
sistema, npm intenta compilarlo y necesita herramientas de compilación (Xcode Command Line Tools
en macOS, build-essential en Linux).

**Dónde queda el archivo.** `npm start` crea (si no existe) `data/restaurante.db` en la raíz del
repo, sin importar desde qué carpeta se ejecute. La ruta se muestra al arrancar. Mientras el
servidor corre también existen `restaurante.db-wal` y `restaurante.db-shm`; al apagarlo con Ctrl+C
se integran al `.db` y desaparecen. Ninguno se sube a git.

**Cambiar la ubicación.**

```bash
DB_PATH=/ruta/a/otra.db npm start          # macOS / Linux
$env:DB_PATH="C:\datos\otra.db"; npm start # Windows PowerShell
```

La carpeta se crea si no existe.

**Reiniciar la base desde cero (desarrollo).** Apaga el servidor y borra la carpeta `data/` (o
los tres archivos `restaurante.db*`). Al volver a arrancar se crea vacía con las 10 mesas y los 3
ítems de ejemplo.

**Abrir con DB Browser for SQLite.** File → Open Database → `data/restaurante.db`. Para solo
mirar, usa "Open Database Read Only". Ojo: **si editas algo en DB Browser, el archivo queda
bloqueado hasta que presiones "Write Changes" (o "Revert Changes")**. Mientras tanto, el
servidor espera 5 segundos en cada escritura y luego responde con error (`ERROR_INTERNO`).
Los cambios que guardes se ven de inmediato en la app, porque los repositorios leen la base en
cada consulta.

**Tests.** `crearApp()` sin argumentos usa una base en memoria, y los tests de persistencia usan
una carpeta temporal: `npm test` nunca toca `data/`.

## 6. Resultados de los tests

Ejecutado con `npm run test:coverage` (el que revisa los umbrales, igual que el CI) y
`npm run lint`, en Node v26.7.0 / npm 11.19.0.

| | Línea base (`dev`, `92d55cf`) | Final (`feat/persistencia-sqlite`) |
| --- | --- | --- |
| Suites | 9 pasan | 11 pasan |
| Tests | 145 / 145 | 206 / 206 |
| Statements | 93.45 % (471/504) | 94.74 % (577/609) |
| Branches | 83.77 % (253/302) | 84.36 % (286/339) |
| Functions | 97.46 % (77/79) | 98.21 % (110/112) |
| Lines | 95.46 % (442/463) | 96.43 % (541/561) |
| Umbrales de cobertura | cumplen | cumplen |
| `npm run lint` | sin problemas | sin problemas |
| `npm run build` | — | OK |

Los 145 tests originales pasan sin modificaciones. Los 61 nuevos son 47 de la suite de contrato
(19 contra la implementación en memoria, 19 contra SQLite y 9 solo de SQLite) y 14 de
persistencia y atomicidad.

Verificaciones manuales adicionales:

- **Instalación limpia:** clon nuevo de la rama → `npm ci`, `npm run build`, `npm run lint` y
  `npm run test:ci` (los pasos del CI) pasan con los mismos números. better-sqlite3 ya no aparece
  como script bloqueado.
- **`npm start` y apagado ordenado:** arranque sin `data/` → se crea el `.db`. Se abrió la
  Mesa 4 y se editó un precio por API, y se confirmó un pedido en la Mesa 3 por Socket.io. Luego
  Ctrl+C (salida 0, el `-wal` se integró). Al arrancar de nuevo: Mesas 3 y 4 ocupadas, el precio
  editado, 3 ítems de menú sin duplicar y el pedido de la Mesa 3 igual (`En Cocina 🍳`, total 6000).
- **`DB_PATH` y caída del proceso:** con `DB_PATH` apuntando a una carpeta anidada que no existía,
  la carpeta y el `.db` se crearon y la ruta se mostró en el banner. Se confirmó un pedido en la
  Mesa 6, se trasladó a la Mesa 7, se creó un ítem y se mató el proceso con **SIGKILL** (sin
  apagado ordenado; quedaron `-wal` y `-shm`). Al arrancar de nuevo: Mesa 6 libre y sin pedido,
  Mesa 7 ocupada con el pedido (sin duplicar) y el ítem nuevo presente.

## 7. Commits

En la rama `feat/persistencia-sqlite`, desde `dev` (`92d55cf`):

| Hash | Mensaje |
| --- | --- |
| `e01f5a7` | chore(deps): agregar better-sqlite3 12.x y aprobar su script de instalación |
| `b6e544f` | chore(gitignore): ignorar archivos de base de datos SQLite |
| `1612024` | feat(persistencia): agregar conexión SQLite con esquema y pragmas |
| `e2cd6fe` | feat(persistencia): implementar repositorios SQLite de mesas, menú y pedidos |
| `b52b2c2` | feat(persistencia): ejecutar casos de uso en transacciones y emitir eventos tras el commit |
| `85bb806` | feat(app): usar repositorios SQLite con ruta configurable por DB_PATH |

Más el commit de esta documentación: `docs: documentar la persistencia con SQLite`.

## 8. Puntos frágiles y pendientes

**Qué se probó:**
- El contrato de los tres repositorios.
- Los estados con emoji, byte a byte.
- Que un pedido sin ítems se lea sin `items`, que se conserve el orden de los ítems y que
  `disponible` sea boolean.
- Las copias defensivas, la cascada y las claves foráneas.
- Que `guardar` no deje un pedido a medias.
- Los pragmas y la creación de la carpeta.
- El rollback y los eventos retenidos (también en transacciones anidadas).
- La atomicidad de `confirmarPedido` y `trasladarPedido` ante un fallo a mitad.
- Cerrar y reabrir el mismo archivo con `crearApp`.
- Que la semilla no se duplique.
- El reinicio real con `npm start`.

**Qué no se probó:**
- Un corte de luz real, o una caída justo **en medio** de una transacción. Se probó una caída del
  proceso (SIGKILL) entre operaciones y el rollback ante errores; para lo demás se confía en la
  garantía de SQLite (WAL + `synchronous = FULL`).
- La instalación en Node 20. Solo se probó en Node 26; el CI (Node 20) lo comprobará al abrir el PR.
- La instalación sin internet o en Windows.
- El rendimiento con mucho volumen, que no aplica a un restaurante.

**Puntos frágiles y pendientes:**
- **Sin migraciones.** `CREATE TABLE IF NOT EXISTS` no modifica tablas existentes. Si se cambia
  `esquema.sql` (por ejemplo, agregar una columna), hay que borrar la base de desarrollo o escribir
  una migración (`ALTER TABLE`). Cuando el esquema empiece a cambiar seguido conviene un
  mecanismo simple con `PRAGMA user_version`.
- **Node 20 terminó su soporte en abril de 2026.** Subir el CI a Node 22 permitiría pasar a
  better-sqlite3 13.x.
- **Cantidad de mesas.** Ya no depende de `MesasSQLite(db, 10)` después del primer arranque: se
  agregan y quitan desde la API (ver [administracion-mesas.md](administracion-mesas.md)).
- **Ítems de pedido sin menú.** `PedidoService` sin `menuItems` no valida el `id` de cada ítem;
  con SQLite, un `id` vacío fallaría por `NOT NULL`. En producción siempre se inyecta el menú, así
  que no ocurre.
- **Contador de ids del menú.** En memoria, guardar un ítem con un id nuevo explícito (ej. 10) no
  mueve el contador; en SQLite el siguiente sería 11. Ningún servicio lo hace.
- **Un solo proceso.** El diseño asume un único servidor sobre el archivo (ADR-04). Dos servidores
  apuntando al mismo `.db` no están contemplados.
- **Error previo en el traslado (en memoria).** Si `mesas.ocupar` falla durante `trasladarPedido`,
  el rollback manual del servicio devuelve el pedido a la mesa de origen pero no la vuelve a ocupar:
  queda "libre" con pedido. Con SQLite lo corrige la transacción (está probado). La versión en
  memoria, que solo usan los tests, sigue igual; no se cambió el dominio por estar fuera de alcance.
- **npm 11 y otros paquetes.** `@parcel/watcher` y `unrs-resolver` (dependencias de desarrollo)
  también tienen scripts sin aprobar. No afectan a esta tarea. `npm install` además reporta
  vulnerabilidades previas (`npm audit`).
