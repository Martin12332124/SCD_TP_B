# API gateway

## 1. Qué hace

Un gateway mínimo, propio, delante de toda la API del servidor local (`src/presentacion/gateway.js`). Se monta antes de las rutas `/api` y hace tres cosas:

| Función | Cómo |
| --- | --- |
| **API key por aplicación** | Cabecera `x-api-key` obligatoria en todo `/api` (también en `/api/auth/login`) y en el handshake de Socket.IO. Sin llave válida: `401` con `tipo: "API_KEY_INVALIDA"`. |
| **Límite de peticiones** | `express-rate-limit`, en memoria. Login: 5 intentos **fallidos** por minuto **por IP** (los login exitosos no cuentan). Resto de `/api`: 600 por minuto **por llave**. Al excederse: `429` con `tipo: "DEMASIADAS_PETICIONES"` y cabecera `Retry-After`. |
| **Registro de accesos** | Una línea por petición en la consola del servidor: `2026-11-21T12:00:00.000Z app=web GET /api/mesas 200 12ms`. Lleva el **nombre** de la llave, nunca la llave. Una llave inválida queda como `app=-`. |

**Dos capas distintas.** La API key identifica a la *aplicación* (`web`, `cocina`…); el JWT identifica al *usuario*. Hacen falta las dos: una llave sin sesión da `401 NO_AUTORIZADO`, y una sesión sin llave da `401 API_KEY_INVALIDA`.

**Alcance.** Es la puerta del servidor local (modo local). En modo nube el gateway es el de Supabase (sección 5). `GET /` y el preflight CORS (`OPTIONS`) no llevan llave.

## 2. Por qué así

- **Un middleware y no un servicio aparte.** Hay un solo PC servidor y debe funcionar sin internet: un proceso más (Kong, nginx) o una Edge Function de Supabase (que necesita internet) contradicen esa regla. Un `Router` de Express montado antes de `/api` se prueba con los mismos tests que el resto.
- **Varias llaves a la vez (`API_KEYS`).** Permite rotar sin cortar el servicio y saber *quién* hace cada petición (el nombre sale en el registro).
- **Sin `API_KEYS` el servidor no arranca**, igual que sin `JWT_SECRET`: arrancar abierto dejaría la API disponible para cualquier aplicación. `crearApp()` sin llaves usa una aleatoria que nadie conoce (solo para tests).
- **Comparación en tiempo constante.** Se compara el SHA-256 de la llave presentada con el de cada llave configurada (`crypto.timingSafeEqual`), sin cortar en la primera coincidencia: el tiempo de respuesta no revela cuánto de la llave se acertó.
- **La llave se valida antes que el límite**, así quien no tiene llave no gasta el cupo de nadie. El login se limita por IP porque ahí se protege contra adivinar contraseñas (solo cuentan los intentos fallidos, para no frenar a quien entra bien varias veces); el resto, por llave porque mide a cada aplicación. Los 600 por minuto los comparten todos los dispositivos del local que usen la misma llave.
- **El límite está en memoria**: se reinicia con el servidor. Basta para un solo PC; con varias sucursales habría que moverlo a un almacén compartido.
- **Sin llave en la URL ni en el registro.** La ruta se registra sin la query.

> **Una llave dentro de una SPA es visible.** `VITE_API_KEY` queda escrita en el JavaScript que baja el navegador: cualquiera con las herramientas de desarrollo la lee. No protege datos. Sirve para **identificar** a la aplicación, **limitarla** y **revocarla** (se saca de `API_KEYS`). La seguridad del usuario la da el JWT.

## 3. Configuración y rotación

**Servidor (`.env` de `SCD_TP_B`)**

```
API_KEYS=web:<llave1>,cocina:<llave2>
```

Formato `nombre:llave`, separadas por comas. Nombre de 1–32 caracteres (`a-z 0-9 . _ -`); llave de al menos 16 caracteres, sin comas. Nombres y llaves no pueden repetirse. Para generar una llave:

```
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

**Frontend (`.env` de `SCD_TP_F`, solo modo local):** `VITE_API_KEY=<una de las llaves de API_KEYS>`. Vite la escribe en el código al compilar o arrancar: tras cambiarla hay que reiniciar `npm run dev` (o volver a compilar).

**Rotar una llave sin cortar el servicio**
1. Genera una llave nueva y agrégala: `API_KEYS=web:<vieja>,web2:<nueva>`. Reinicia el servidor.
2. Pon la nueva en `VITE_API_KEY` y reinicia/recompila el frontend de cada aplicación.
3. Cuando ninguna aplicación use la vieja, quítala de `API_KEYS` y reinicia el servidor. Desde ese momento la vieja da `401`.

Si una llave se filtra, basta con el paso 3: es la revocación.

**En la nube (Supabase).** La publishable (`sb_publishable_…`, la usa la web) y la secreta (`sb_secret_…`, la usa el servidor local para sincronizar) se rotan en el panel: *Project Settings → API Keys*. La publishable de la web se actualiza en `VITE_SUPABASE_PUBLISHABLE_KEY` (panel de Netlify, y hay que volver a desplegar); la secreta, en `SUPABASE_SECRET_KEY` del `.env` del servidor.

## 4. Cómo probarlo con curl

Con el servidor en marcha (`npm start`), `LLAVE` es una de `API_KEYS` y `TOKEN` el que entrega el login:

```bash
# Sin llave → 401 API_KEY_INVALIDA
curl -i localhost:3000/api/mesas

# Login con llave (el JWT es otra capa)
curl -s -X POST localhost:3000/api/auth/login \
  -H "x-api-key: $LLAVE" -H "Content-Type: application/json" \
  -d '{"usuario":"ana","contrasena":"<contraseña>"}'

# Llave + token → 200
curl -i localhost:3000/api/mesas -H "x-api-key: $LLAVE" -H "Authorization: Bearer $TOKEN"

# Límite: el 6.º intento FALLIDO de login en un minuto → 429 DEMASIADAS_PETICIONES
for i in 1 2 3 4 5 6; do
  curl -s -o /dev/null -w "%{http_code} " -X POST localhost:3000/api/auth/login \
    -H "x-api-key: $LLAVE" -H "Content-Type: application/json" -d '{"usuario":"ana","contrasena":"mala"}'
done
```

Cada una de esas peticiones aparece en la consola del servidor con su nombre de llave. Socket.IO: la llave va en `auth: { apiKey }` (el navegador no puede poner cabeceras propias en un WebSocket); también se acepta `x-api-key` en el handshake. Sin llave, `connect_error` con mensaje `API_KEY_INVALIDA`.

Tests: `test/gateway.test.js` (llave ausente, inválida, válida, rotación con dos llaves, 429 en login y general, socket sin llave, registro sin la llave).

## 5. Comparación con el gateway de Supabase (opción a)

Supabase ya pone un gateway delante de su Data API: toda petición exige la cabecera `apikey` (publishable o secreta) y, con RLS, una sesión válida. Cada llave se crea, rota o borra en el panel.

| | Gateway propio (este documento) | Gateway de Supabase |
| --- | --- | --- |
| Dónde corre | En el servidor local; funciona sin internet | En la nube; exige internet |
| Qué protege | La API del restaurante (`/api`, Socket.IO) | La Data API, Realtime y Auth de Supabase |
| Límite de peticiones y registro | Los define el equipo (600/min por llave, login 5 fallos/min por IP, log de accesos) | Los de la plataforma |
| Rotación | Editar `API_KEYS` y reiniciar | En el panel, sin tocar código |
| Esfuerzo | Código y tests propios (`gateway.js`) | Ninguno: ya existe |

No se excluyen: se usan **juntos**. El modo local pasa por el gateway propio; el modo nube y la sincronización pasan por el de Supabase. En ambos, la llave identifica a la aplicación y el usuario se identifica con su sesión.

## 6. Límites conocidos
- Las peticiones con llave inválida no tienen límite propio (adivinar una llave de 24 bytes aleatorios es inviable, pero queda registrado como `app=-`).
- Una `VITE_API_KEY` equivocada hace que la SPA muestre el servidor como desconectado (el socket es rechazado); las peticiones REST devuelven `API_KEY_INVALIDA` sin cerrar la sesión del usuario.
- El límite está en memoria y se reinicia con el servidor.
