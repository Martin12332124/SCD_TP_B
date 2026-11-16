# Administración de mesas y pedido "Listo"

Rama `feat/administrar-mesas`, creada desde `dev` en `2e5210e` (con la persistencia SQLite ya
integrada). Va junto con la rama `feat/rediseno-mesas` del frontend (`SCD_TP_F`), que usa todo lo
de aquí; su documento es `docs/rediseno-mesas.md` en ese repo.

Este documento es aparte de [persistencia-sqlite.md](persistencia-sqlite.md) porque trata de
funciones nuevas de la API, no de cómo se guardan los datos. Ese documento se actualizó solo donde
describía el comportamiento anterior.

## 1. Resumen

- **Cantidad de mesas configurable.** Antes el servidor tenía siempre 10 mesas. Ahora se agregan
  y quitan por la API, el cambio se guarda en SQLite y se avisa a todos los clientes con
  `estado_mesas`.
- **Las 10 mesas iniciales se crean una sola vez.** Antes, cada arranque volvía a crear las que
  faltaran, lo que desharía cualquier mesa quitada.
- **Estado del pedido en la lista de mesas.** Cada mesa trae `estadoPedido`, para que el plano de
  sala del frontend muestre si la mesa tiene el pedido tomado, en cocina o listo.
- **"Listo 🍽️" ya no libera la mesa.** Antes, al marcar un pedido "Listo" se borraba y la mesa
  quedaba libre en el mismo paso, así que ninguna mesa podía verse "con pedido listo para servir".
  Ahora el pedido queda en "Listo" (con su cuenta) y la mesa sigue ocupada hasta liberarla. **Este
  cambio toca la lógica del dominio** y fue aprobado expresamente.

## 2. Antes y después

| Funcionalidad | Antes | Después |
| --- | --- | --- |
| Cantidad de mesas | Fija en 10 (`new MesasSQLite(db, 10)`) | 10 al crear la base; luego se cambia con `POST`/`DELETE /api/mesas` |
| Mesas iniciales | `INSERT OR IGNORE` de 1 a 10 en **cada** arranque | Solo si la tabla `mesas` está vacía |
| Lista de mesas (`GET /api/mesas`, `estado_mesas`) | `{ id, numero, estado }` | Igual, más `estadoPedido` |
| Marcar "Listo 🍽️" | Borra el pedido y libera la mesa | Conserva el pedido en Listo; la mesa sigue ocupada |
| Liberar mesa (`POST /api/mesas/:n/cerrar`) | Rechaza si hay pedido (`PEDIDO_ACTIVO`) | Rechaza si el pedido está Recibido o En Cocina; si está Listo, lo cierra y libera la mesa |
| Nueva ronda sobre un pedido Listo | La mesa ya estaba libre: pedido nuevo | Suma a la misma cuenta y vuelve a cocina |

## 3. Archivos creados, modificados y eliminados

### Creados

| Archivo | Motivo |
| --- | --- |
| `src/dominio/mesa-configuracion.service.js` | `MesaConfiguracionService`: reglas para agregar y quitar mesas. |
| `src/infraestructura/mesas-con-pedido.js` | `MesasConEstadoPedido`: decorador del repositorio de mesas que agrega `estadoPedido`. |
| `test/mesa-configuracion.service.test.js` | Reglas del servicio nuevo (42 tests). |
| `test/mesas-con-pedido.test.js` | El decorador, sobre el repositorio en memoria y sobre el de SQLite. |
| `docs/administracion-mesas.md` | Este documento. |

### Modificados

| Archivo | Cambio y motivo |
| --- | --- |
| `src/infraestructura/sqlite/repositorios-sqlite.js` | `MesasSQLite`: mesas iniciales solo con la tabla vacía; métodos `agregar(numero)` y `eliminar(mesaId)`. |
| `src/infraestructura/repositorios.js` | Los mismos dos métodos en `MesasEnMemoria`, para que ambos repositorios cumplan el mismo contrato. |
| `src/presentacion/mesas.router.js` | Rutas `POST /api/mesas` y `DELETE /api/mesas/:numero`; tipos de error `DUPLICADO` y `LIMITE_ALCANZADO` → 409. |
| `src/app.js` | Crea el servicio nuevo, lo envuelve en transacción y usa el decorador `MesasConEstadoPedido`. |
| `src/dominio/pedido.service.js` | "Listo" ya no borra el pedido ni libera la mesa. Exporta `ESTADO_LISTO`. |
| `src/dominio/mesa-estado.service.js` | `cerrarMesa` acepta una mesa con pedido Listo y cierra ese pedido al liberarla. |
| `test/repositorios.contrato.test.js`, `test/api.test.js`, `test/socket.test.js`, `test/persistencia-sqlite.test.js`, `test/mesa-estado.service.test.js`, `test/mesa.service.test.js` | Casos nuevos (sin tocar los existentes). |
| `test/pedido.service.test.js`, `test/integracion.test.js` | 3 tests que describían el "Listo" anterior (ver sección 6) y casos nuevos. |
| `docs/persistencia-sqlite.md` | Tres párrafos que describían las mesas iniciales y el "Listo" anteriores. |
| `README.md` | Sección corta "Administración de mesas" con enlace a este documento. |

### Eliminados

Ninguno. **El esquema de la base no cambia**, así que no hay migración: las bases que ya existen
funcionan tal cual.

## 4. Endpoints y eventos

### `POST /api/mesas` — agregar una mesa

Cuerpo JSON opcional. Sin `numero` se crea la siguiente a la más alta que exista.

```http
POST /api/mesas
Content-Type: application/json

{}
```
```json
201 Created
{ "ok": true, "mesa": { "id": "Mesa 11", "numero": 11, "estado": "libre", "estadoPedido": null } }
```

Con número (por ejemplo, para recuperar una mesa quitada o dejar un hueco):

```http
POST /api/mesas
Content-Type: application/json

{ "numero": 20 }
```

| Respuesta | Cuándo |
| --- | --- |
| `201` `{ ok: true, mesa }` | Se agregó |
| `400` `ENTRADA_INVALIDA` | `numero` no es un entero de 1 a 99, o el cuerpo no es un objeto |
| `409` `DUPLICADO` | Ya existe esa mesa: `{ "ok": false, "tipo": "DUPLICADO", "error": "La mesa 3 ya existe." }` |
| `409` `LIMITE_ALCANZADO` | Sin número, y la mesa 99 ya existe (no hay "siguiente") |

### `DELETE /api/mesas/:numero` — quitar una mesa

```http
DELETE /api/mesas/10
```
```json
200 OK
{ "ok": true, "mesa": "Mesa 10" }
```

| Respuesta | Cuándo |
| --- | --- |
| `200` `{ ok: true, mesa }` | Se quitó |
| `400` `ENTRADA_INVALIDA` | El número no es un entero positivo (`abc`, `0`, `1e1`, `05`…) |
| `404` `NO_ENCONTRADO` | La mesa no existe |
| `409` `ESTADO_NO_PERMITIDO` | Está ocupada (`"La mesa 4 está ocupada. Libérala antes de quitarla."`), o es la última mesa |
| `409` `PEDIDO_ACTIVO` | Tiene un pedido vigente |

### Campo nuevo `estadoPedido`

Aparece en cada mesa de `GET /api/mesas`, `GET /api/mesas/:numero` y del evento `estado_mesas`.
Vale `"Recibido 📝"`, `"En Cocina 🍳"`, `"Listo 🍽️"` o `null`:

```json
{ "id": "Mesa 5", "numero": 5, "estado": "ocupada", "estadoPedido": "En Cocina 🍳" }
```

Es un campo **nuevo**: ninguna respuesta existente cambió de forma, y un cliente que no lo conozca
simplemente lo ignora.

### Eventos de Socket.io

- `estado_mesas` se emite también al agregar y al quitar una mesa, con la lista completa (misma
  forma que siempre, más `estadoPedido`).
- Ningún evento cambia de nombre ni de forma. `cambio_estado_pedido` sigue llegando al marcar
  "Listo"; lo que cambia es que ya **no** llega un `estado_mesas` en ese momento, porque la mesa
  no cambia de estado (sigue ocupada).

## 5. Decisiones y su porqué

**Mesas iniciales solo con la tabla vacía.** `MesasSQLite` cuenta las filas al construirse. Con
cero, crea la 1 a la 10; con alguna, no toca nada. Así un reinicio no libera mesas ocupadas (eso
ya pasaba antes) ni vuelve a crear las quitadas (eso es lo nuevo).
Caso límite: si se quitaran **todas** las mesas, la tabla quedaría vacía y el siguiente arranque
crearía otra vez las 10. Por eso la regla "no se puede quitar la última mesa".

**Número de 1 a 99.** El identificador de una mesa es el texto `"Mesa N"` y todo el sistema lo
valida con `^Mesa (\d+)$`. Un número enorme se convertiría a notación exponencial (`1e+21`) y
rompería ese formato. 99 alcanza de sobra para un restaurante y es una constante
(`NUMERO_MESA_MAXIMO`) fácil de cambiar.

**Se puede elegir el número.** Además de "agregar la siguiente", se acepta un número concreto.
Cuesta poco y evita que quitar una mesa por error sea irreversible: se puede volver a crear con el
mismo número.

**Reglas al quitar.** Una mesa ocupada o con pedido vigente no se puede quitar: su pedido quedaría
huérfano. La base ya lo impediría por la clave foránea `pedidos.mesa_id → mesas.id`, pero el
servicio lo revisa antes para devolver un mensaje claro en vez de un error interno.

**Transacción y eventos.** `agregarMesa` y `quitarMesa` se envuelven con `envolverEnTransaccion`
como los demás casos de uso: si algo falla a mitad, no queda nada guardado, y `estado_mesas` se
emite solo después del commit (REF-09).

**`estadoPedido` con un decorador.** Los servicios emiten `estado_mesas` con `mesas.listar()`. En
vez de cambiar cada servicio, `app.js` les inyecta `MesasConEstadoPedido`, que envuelve al
repositorio y agrega el campo en `listar()` y `obtener()`. El campo viaja en la API y en el evento
sin modificar servicios ni repositorios. Sin él, el plano de sala tendría que pedir el pedido de
cada mesa ocupada por separado, al cargar y en cada reconexión.

**"Listo" se conserva (cambio de dominio).** `DominioEntidades.md` describe un estado "Pedido
Servido" en el que la mesa sigue ocupada hasta cerrar la cuenta; el código, en cambio, borraba el
pedido al marcarlo "Listo". Se acercó el código al modelo de dominio sin tocar la cuenta y el cobro
(US-12, fuera de alcance):
- "Listo" deja el pedido vigente, con sus ítems y su total.
- "Liberar mesa" con el pedido Listo cierra el pedido y libera la mesa. Con el pedido en Recibido o
  En Cocina se sigue rechazando con `PEDIDO_ACTIVO` (regresión US-09 intacta).
- Si los clientes piden otra ronda, `confirmarPedido` suma los ítems a la misma cuenta y el pedido
  vuelve a "En Cocina" (la transición Listo → Recibido ya existía).
- Un pedido Listo se puede trasladar a otra mesa como cualquier otro.

## 6. Resultados de los tests

Ejecutado con `npm run test:coverage` y `npm run lint`, en Node v26.7.0 / npm 11.19.0.

| | Línea base (`dev`, `2e5210e`) | Final (`feat/administrar-mesas`) |
| --- | --- | --- |
| Suites | 11 pasan | 13 pasan |
| Tests | 206 / 206 | 301 / 301 |
| Statements | 94.74 % (577/609) | 96.31 % (679/705) |
| Branches | 84.36 % (286/339) | 86.75 % (347/400) |
| Functions | 98.21 % (110/112) | 99.25 % (133/134) |
| Lines | 96.43 % (541/561) | 97.83 % (632/646) |
| Umbrales de cobertura | cumplen | cumplen |
| `npm run lint` / `npm run build` | sin problemas | sin problemas |

**Tests existentes que cambiaron** (los tres por el cambio de "Listo", aprobado):

| Archivo | Test | Antes esperaba | Ahora espera |
| --- | --- | --- | --- |
| `integracion.test.js` | ciclo completo Recibido → En Cocina → Listo | mesa libre y pedido `null` | mesa ocupada y pedido en Listo |
| `pedido.service.test.js` | al marcar Listo… | "la mesa queda libre y sin pedido" | "el pedido se conserva en Listo y la mesa sigue ocupada" |
| `pedido.service.test.js` | al quedar Listo… | "el pedido se elimina y el resumen queda vacío" | "el resumen conserva los ítems y el total" |

Todos los demás tests existentes pasan sin modificaciones.

**Verificación manual** con el servidor real (puerto 3100 y una base temporal, sin tocar
`data/`), usando el frontend nuevo: marcar Listo, trasladar el pedido listo, liberar la mesa,
quitar la mesa 10 y agregar la 20. Después se reinició el servidor: la mesa 10 no volvió, la 20
seguía, y los pedidos en Listo seguían con su mesa ocupada.

## 7. Commits

| Hash | Mensaje |
| --- | --- |
| `8ed9d0f` | fix(persistencia): crear las mesas iniciales solo cuando la tabla está vacía |
| `0e0feea` | feat(repositorios): agregar y eliminar mesas |
| `15bfaf4` | feat(mesas): servicio con las reglas para agregar y quitar mesas |
| `0efcd3a` | feat(api): endpoints para agregar y quitar mesas |
| `1bcbfcd` | feat(mesas): incluir el estado del pedido en la lista de mesas |
| `81a40b1` | feat(pedido): conservar el pedido listo hasta liberar la mesa |

Más el commit de esta documentación: `docs: documentar la administración de mesas`.

## 8. Puntos frágiles y pendientes

- **Sin autenticación (fuera de alcance).** Cualquiera que llegue a la API puede agregar o quitar
  mesas. En el frontend la pantalla está separada y pide confirmación, pero no hay roles (REF-11).
- **`npm run evidencia` cambió su salida.** `scripts/evidencia.js` marca un pedido "Listo" e
  imprime el estado de la mesa: ahora sale `ocupada` y el pedido en Listo, en vez de `libre` y
  `null`. El archivo `docs/evidencia-ejercicio-2-2.txt` quedó como estaba (es la evidencia
  entregada en su momento); si se vuelve a generar, esas tres líneas cambian.
- **Orden de integración:** este backend debe integrarse **antes** que el frontend nuevo, que
  necesita los endpoints. El frontend nuevo funciona con un backend anterior (sin `estadoPedido`
  muestra solo libre u ocupada), pero no puede agregar ni quitar mesas.
- **El CI del frontend** prueba la integración (`test-verificacion.js`) contra el backend de
  `dev`. Ese script se corrió a mano contra esta rama (puerto 3101, base temporal) y pasó completo,
  así que integrar este backend no rompe el CI del frontend.
- **Integrar las dos ramas seguidas.** Mientras el backend nuevo conviva con el frontend anterior,
  el botón "Pedido Listo" del panel de control viejo ya no libera la mesa (ahora hay que usar
  "Liberar mesa" en el detalle).
- **Restos del límite anterior:** el mensaje de `MesaEstadoService._validarNumero` todavía dice
  "ej. 1–10", y el máximo de 99 está repetido en `NUMERO_MESA_MAXIMO` del backend y del frontend.
- **Liberar una mesa con el pedido Listo borra el pedido y su cuenta sin pedir confirmación.** Es
  lo que pide la regla (la cuenta y el cobro son US-12, fuera de alcance), pero conviene tenerlo
  presente al implementar el cobro.
- **Mesas con huecos.** Si se quita la 7, la "siguiente" sigue siendo la más alta + 1; el hueco
  solo se recupera agregando la 7 con número.
- **No se probó:** varios clientes agregando la misma mesa al mismo tiempo (la clave primaria lo
  impediría y el segundo recibiría `DUPLICADO`, pero no hay un test con dos clientes simultáneos).
