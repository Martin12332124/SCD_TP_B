# Sincronización con la nube (sistema híbrido)

## 1. Resumen

El restaurante funciona sin internet: el servidor local (este repo, con SQLite) sigue siendo la
**autoridad**. Si el `.env` trae `SUPABASE_URL` y `SUPABASE_SECRET_KEY`, además mantiene una
**réplica** en Supabase que puede leer una web pública:

- **Local → nube:** después de cada transacción confirmada (agrupando las que llegan seguidas) y
  además cada 30 s, se sube el **estado completo** (mesas, menu_items, pedidos, pedido_items). En
  Supabase, la función `sincronizar_estado` deja el espejo igual a esa foto en una sola transacción.
- **Nube → local (buzón):** la web no escribe datos; inserta una fila en `ordenes_pendientes`. El
  local se entera por Supabase Realtime (y, por si falla, revisa cada 30 s), la aplica con los
  **mismos servicios de dominio** que usan REST y Socket.IO, y marca `aplicada` o `rechazada` con el
  resultado del servicio.
- **Sin internet:** cada intento falla en silencio (un aviso en consola al cortarse y otro al volver).
  El POS no espera nunca a la nube. Al volver la conexión, el siguiente ciclo sube el estado. Las
  órdenes **no esperan en cola**: la web no deja órdenes si el local está desconectado, y el local
  **rechaza** (`ORDEN_VENCIDA`) las que lleven 10 s o más en el buzón, en vez de aplicarlas tarde.

Sin `SUPABASE_URL` y `SUPABASE_SECRET_KEY`, el servidor es 100 % local, igual que antes (el `.env`
igual necesita `JWT_SECRET` desde el login y `API_KEYS` desde el API gateway, ver
`docs/inicio-de-sesion.md` y `docs/api-gateway.md`): no se carga la librería de Supabase ni se
crea ninguna tabla nueva.

## 2. Archivos creados y modificados

### Creados

| Archivo | Motivo |
| --- | --- |
| `supabase/esquema.sql` | Tablas espejo, buzón, función `sincronizar_estado`, `GRANT`, RLS y Realtime. Se ejecuta en el SQL Editor de Supabase; se puede repetir sin perder datos. |
| `src/infraestructura/sincronizacion/sincronizador.js` | `Sincronizador`: cuándo subir y cuándo revisar el buzón, reintentos, sin solapar subidas. `NotificadorConAviso`: avisa al sincronizador cada vez que se publica un evento (= cada COMMIT). |
| `src/infraestructura/sincronizacion/cliente-supabase.js` | Único archivo que conoce `@supabase/supabase-js`. Cuatro métodos: `subirEstado`, `obtenerOrdenesPendientes`, `marcarOrden`, `suscribirOrdenes`. |
| `src/infraestructura/sincronizacion/estado-local.js` | `leerEstadoLocal(db)`: la foto de las cuatro tablas, con los mismos nombres de columnas que en Supabase. |
| `src/infraestructura/sincronizacion/registro-ordenes.js` | Tabla local `ordenes_aplicadas` (solo con sincronización activa) para no aplicar dos veces una orden. |
| `src/presentacion/ordenes-nube.js` | `AplicadorOrdenes`: traduce `{ tipo, payload }` a la llamada al servicio de dominio, como hace `socket.handlers.js` con los eventos. También rechaza las órdenes vencidas (`ORDEN_VENCIDA`). |
| `.env.example` | Nombres de las variables, sin valores. |
| `test/doble-nube.js` | `NubeEnMemoria`: doble de Supabase con un interruptor `sinInternet`. |
| `test/sincronizacion.test.js`, `test/cliente-supabase.test.js` | 36 tests nuevos (ver sección 6). |

### Modificados

| Archivo | Cambio y motivo |
| --- | --- |
| `src/app.js` | `crearApp({ rutaDb, sincronizacion = null })`. Con la opción, conecta el `NotificadorConAviso`, el aplicador de órdenes (en transacción) y crea el `Sincronizador`; lo devuelve como `sincronizador` (o `null`). No lo inicia: no hay temporizadores en los tests. |
| `index.js` | Si existen las dos variables crea el cliente, inicia la sincronización tras `listen` y la detiene al apagar. |
| `package.json` | Dependencia `@supabase/supabase-js`; `npm start` ahora es `node --env-file-if-exists=.env index.js` (Node ≥ 22.9 lee el `.env` sin la librería dotenv). |
| `.github/workflows/ci.yml` | Node 20 → 22: `@supabase/supabase-js` exige Node ≥ 22. |

## 3. Tablas en Supabase

| Tabla | Quién escribe | Quién lee (web con sesión) |
| --- | --- | --- |
| `mesas`, `menu_items`, `pedidos`, `pedido_items` | Solo el local, vía `sincronizar_estado` | Sí |
| `estado_sincronizacion` (1 fila: hora de la última subida) | Solo el local | Sí |
| `ordenes_pendientes` | Web: solo `tipo` y `payload`. Local: `estado`, `resultado`, `procesada_en` | Solo sus propias órdenes |

Tipos de orden y su payload (la misma forma que el cuerpo REST o el mensaje Socket.IO):

| `tipo` | `payload` | Caso de uso |
| --- | --- | --- |
| `abrir_mesa` / `cerrar_mesa` / `quitar_mesa` | `{ "numero": 3 }` | `MesaEstadoService` / `MesaConfiguracionService` |
| `agregar_mesa` | `{ "numero": 12 }` (opcional) | `MesaConfiguracionService.agregarMesa` |
| `confirmar_pedido` | `{ "mesa": "Mesa 3", "items": [{ "id": 1, "cantidad": 2 }] }` | `PedidoService.confirmarPedido` |
| `actualizar_estado` | `{ "mesa": "Mesa 3", "estado": "Listo 🍽️" }` | `PedidoService.actualizarEstado` |
| `trasladar_pedido` | `{ "origen": 3, "destino": 5 }` | `MesaService.trasladarPedido` |

## 4. Decisiones técnicas y su porqué

- **Subir el estado completo, no los cambios.** Si una subida se pierde por falta de internet, la
  siguiente la corrige sola; no hay una cola de cambios que reproducir en orden ni que se pueda
  corromper. Con 10–20 mesas la foto pesa pocos KB. Para varias sucursales el siguiente paso sería
  una tabla *outbox* con solo los cambios.
- **Una función de Postgres (`sincronizar_estado`) en vez de cuatro upserts y cuatro deletes por
  la API.** Una función corre en una sola transacción: la web nunca ve el espejo a medias (por
  ejemplo, un pedido trasladado que ya salió de una mesa y aún no llegó a la otra). Además, si a la
  foto le falta una tabla, la función falla en vez de interpretarlo como "vacía" y borrar la nube.
- **Solo se actualizan las filas que cambiaron** (`is distinct from`). Así Realtime avisa a la web
  solo de cambios reales y no de todas las filas cada 30 s.
- **Detectar "hubo un COMMIT" con un notificador decorador.** `NotificadorTransaccional` ya publica
  los eventos solo después del COMMIT; `NotificadorConAviso` va debajo y avisa al sincronizador. No
  se tocó ningún servicio de dominio ni `transacciones.js`. Una operación rechazada no escribe ni
  emite, así que tampoco provoca subida.
- **Esperar 300 ms antes de subir.** Junta en una sola subida las transacciones que llegan seguidas
  y nunca retrasa la respuesta al POS (la subida corre después, asíncrona).
- **Las órdenes vencen (`ORDEN_VENCIDA`).** Una orden aplicada horas después genera conflictos (la
  mesa ya cambió, el cliente se fue). El local solo aplica órdenes de **menos de 10 s**
  (`VENCIMIENTO_ORDEN_MS`); las demás quedan `rechazada` con tipo `ORDEN_VENCIDA` y un motivo legible.
  La web espera **15 s** (`ESPERA_RESULTADO_MS` en `SCD_TP_F/src/servicios/nube.js`), así que cuando
  dice "el cambio no se aplicó" el local ya no puede aplicar esa orden (10 s < 15 s; si cambias uno,
  cambia el otro). Además, la web no inserta nada si la última sincronización del local es de hace
  75 s o más.
- **La edad la mide la base, no el PC.** `ordenes_pendientes_con_edad()` (en `esquema.sql`) devuelve
  `edad_ms = clock_timestamp() - creada_en`: ambos relojes son de Postgres, así que no importa que el
  reloj del restaurante esté adelantado o atrasado. Entre leer el lote y aplicar cada orden pasa
  tiempo (el aviso a Supabase de la anterior puede tardar hasta 10 s); ese tiempo se mide con un
  reloj monótono local (`performance.now()`, que solo avanza) y se suma a la edad: la estimación
  nunca queda por debajo de la real, y en caso de duda se rechaza. El vencimiento se evalúa
  **después** de consultar `ordenes_aplicadas`: una orden aplicada a tiempo cuyo aviso se perdió se
  reenvía como `aplicada` aunque al reintentar ya sea "vieja".
- **Idempotencia de las órdenes (`ordenes_aplicadas`).** Aplicar (SQLite) y marcar (Supabase) son
  dos pasos en dos lugares. Si internet se corta entre ambos, la orden seguiría `pendiente` y se
  aplicaría dos veces. El registro local se guarda en la misma transacción que el caso de uso; al
  reintentar se reenvía el resultado guardado. Se crea fuera de `esquema.sql` para que sin `.env` la
  base quede idéntica.
- **Un error interno marca la orden como `rechazada` (`ERROR_INTERNO`).** Si no, una orden defectuosa
  se reintentaría para siempre.
- **Tiempo máximo de 10 s por petición.** Con el cable desconectado, `fetch` puede quedar esperando
  minutos; sin límite, la subida colgada impediría las siguientes.
- **Realtime + sondeo cada 30 s.** Realtime da inmediatez; el sondeo cubre cortes del websocket.
  Además, al (re)conectarse el canal se revisa el buzón.
- **Permisos.** "Grant API access automatically" está desactivado, así que el SQL da cada permiso
  explícito. Detalles importantes:
  - `revoke ... on function sincronizar_estado from public`: Postgres da `EXECUTE` a todos por
    defecto; sin esto, cualquier usuario de la web podría reescribir el espejo.
  - `grant insert (tipo, payload)`: permiso por **columna**; la web no puede poner `estado =
    'aplicada'` ni un `resultado` falso.
  - `anon` no recibe nada: sin sesión no se lee ni se escribe.
- **El aplicador está en `presentacion/`.** Es una puerta de entrada más (como REST y Socket.IO), no
  infraestructura: traduce un mensaje externo a una llamada al dominio.

## 5. Cómo usarlo

### 5.1 Preparar Supabase (una vez)

1. Supabase → **SQL Editor** → pegar `supabase/esquema.sql` completo → **Run**. (Si ya estaba
   aplicado de antes, repetirlo es seguro; hazlo **antes** de reiniciar el servidor con esta versión:
   el local ahora lee las órdenes con la función `ordenes_pendientes_con_edad()`.)
2. Comprobar en **Table Editor** que existen las 6 tablas con el candado de RLS.
3. En **Database → Publications → supabase_realtime** deben aparecer las 6 tablas.

### 5.2 Variables de entorno

Copiar `.env.example` a `.env` y completar:

| Variable | Dónde se obtiene |
| --- | --- |
| `SUPABASE_URL` | Project Settings → API → Project URL |
| `SUPABASE_SECRET_KEY` | Project Settings → API Keys → Secret keys (`sb_secret_...`) |

`npm start` debe mostrar `Nube (Supabase): activada` y luego `[SYNC] Sincronizando con Supabase.`

### 5.3 Probar local → nube y el buzón

1. Abrir una mesa y confirmar un pedido en el POS local.
2. En Supabase, **Table Editor → pedidos**: el pedido aparece en un par de segundos.
3. En el **SQL Editor**:
   ```sql
   insert into ordenes_pendientes (tipo, payload) values ('abrir_mesa', '{"numero": 5}');
   ```
   La mesa 5 se ocupa en el POS al instante.
4. `select id, tipo, estado, resultado, procesada_en from ordenes_pendientes order by id desc;`
   muestra `aplicada` y el resultado del servicio. Repetir el insert: queda `rechazada` con
   `ESTADO_NO_PERMITIDO` (la mesa ya está ocupada).

### 5.4 Probar el corte de internet y la reconexión

Conviene usar el POS en `http://localhost:5173` en el mismo PC, para que cortar el Wi-Fi no corte
también la red local con los otros dispositivos.

1. Con el servidor andando, **apagar el Wi-Fi** (o desconectar el cable de internet del router).
2. En la consola aparece **un** aviso: `[SYNC] Sin conexión con Supabase (...)`. Puede tardar hasta
   ~10–40 s, porque supabase-js reintenta las lecturas antes de rendirse.
3. Seguir operando: abrir mesas, confirmar pedidos, pasar a Listo. Todo responde igual.
4. Pasados 75 s, la web pública muestra "no está conectado" y rechaza cada cambio con el mensaje
   "No se pudo hacer el cambio: ... (desde las HH:MM)"; no se inserta ninguna orden.
5. Para ver el vencimiento, desde **otro dispositivo con internet** inserta una orden en el SQL Editor
   (por ejemplo `abrir_mesa` de una mesa libre). Queda `pendiente`.
6. **Volver a encender el Wi-Fi.** En 30 s como máximo:
   - consola: `[SYNC] Conexión con Supabase restablecida.`
   - la orden pasa a **`rechazada` con `ORDEN_VENCIDA`** (esperó más de 10 s) y la mesa **no** cambia;
   - las tablas espejo muestran todo lo hecho durante el corte;
   - `select * from estado_sincronizacion;` muestra una hora reciente.

## 6. Resultados de los tests

`npm run lint` sin errores. `npm run test:ci`: **15 suites, 347 tests** (311 anteriores + 36 nuevos),
cobertura de líneas 98,29 %. Los tests existentes no se modificaron. Lo nuevo:

- `test/sincronizacion.test.js`: sin `.env` no hay sincronizador ni tabla nueva; la foto local;
  el registro de órdenes; cada tipo de orden llama al caso de uso correcto; rechazos; idempotencia;
  rollback si el caso de uso lanza; un pedido local llega a la nube; varias transacciones en una
  subida; las órdenes en orden de id; los eventos Socket.IO salen después del COMMIT; **corte de
  internet y reconexión**; corte entre aplicar y marcar (no duplica).
- Órdenes vencidas (`test/sincronizacion.test.js`, grupo `Órdenes vencidas`, 7 tests): una orden vieja
  se rechaza con `ORDEN_VENCIDA` sin ejecutarse, el límite exacto de 10 s, el tiempo entre leer y
  aplicar (reloj monótono), que una orden ya aplicada gana sobre el vencimiento, y un corte largo con
  reconexión. `test/cliente-supabase.test.js` cambió: ahora verifica la llamada a
  `ordenes_pendientes_con_edad` (la consulta anterior ya no existe).
- `test/cliente-supabase.test.js`: con un `createClient` falso, que cada método arme la consulta
  correcta, que los `{ error }` se conviertan en excepciones y que el `fetch` corte por tiempo.

## 7. Puntos frágiles y pendientes

- **Resultado de las órdenes en la web.** Cada usuario puede leer sus propias órdenes (política
  "leer orden propia"). La web espera hasta 15 s el resultado y muestra el real (aplicada, o rechazada
  con motivo). Sin respuesta, muestra "no respondió a tiempo; el cambio no se aplicó".
- **Riesgo residual:** si el local aplica la orden a tiempo pero se corta internet justo antes de
  avisar a Supabase, la web dirá "no se aplicó" de algo que sí se aplicó (el cambio aparece en el
  espejo al volver la conexión). Lo que queda **imposible** es lo inverso: aplicar una orden después de
  que la web declaró que no se aplicó. Cerrarlo del todo exigiría que el local "reclame" cada orden en
  Supabase antes de aplicarla.
- **Realtime caído:** el local entonces ve las órdenes solo en el sondeo de 30 s; como vencen a los
  10 s, se rechazan. Es el lado seguro, pero la web fallará hasta que vuelva Realtime.
- **Reloj del navegador:** el rechazo de la web por "local desconectado" compara la hora del navegador
  con la de Supabase (igual que la franja de aviso). Es solo una compuerta de usabilidad; la garantía
  de no aplicar tarde la da el backend con el reloj de la base.
- **La web en modo nube necesita sesión** (Supabase Auth): las políticas son para `authenticated`.
- **Reloj del local:** `procesada_en` y `estado_desde` usan la hora del PC del restaurante (el vencimiento de órdenes no: lo mide la base).
- **Un solo local:** si dos servidores locales sincronizaran al mismo proyecto, cada subida borraría
  lo del otro. Para varias sucursales hace falta `sucursal_id` y subir solo cambios (outbox).
- **`tipo` está limitado con un `check` en Postgres.** Un tipo de orden nuevo requiere actualizar el
  `check` en `esquema.sql` y `TIPOS_DE_ORDEN` en `ordenes-nube.js`.
