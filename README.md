# Sistema de Pedidos para Restaurante (POS + KDS)

## Descripción del sistema

El Sistema de Pedidos para Restaurante (POS + KDS) coordina la toma de pedidos en el salón con su preparación en cocina. El mesero gestiona las mesas y confirma pedidos desde el POS; cocina los recibe y actualiza su estado en el KDS. El sistema es híbrido: el servidor local con SQLite es la autoridad y sigue funcionando sin internet; cuando está conectado, sincroniza una réplica con Supabase para que la web pública consulte el estado y envíe órdenes al servidor local.

Los usuarios inician sesión para acceder al sistema. No hay permisos diferenciados por rol; las acciones disponibles corresponden a las funciones implementadas de mesas y pedidos.

## Requisitos Extrafuncionales

Ver: [ReqExtrafuncionales.md](./ReqExtrafuncionales.md) — 16 requisitos clasificados, 5 de prioridad Alta.

## Entidades del Dominio

Ver: [DominioEntidades.md](./DominioEntidades.md) — 10 entidades, diagrama ER y máquina de estados del Pedido.

## Diseño Arquitectónico

Ver: [Arquitectura.md](./Arquitectura.md) — estilo, diagrama, descomposición modular y decisiones de diseño (ADR).

## Modelado y despliegue

Los diagramas UML (casos de uso, clases, secuencia y componentes) y la guía de despliegue están en el repositorio del frontend, que es donde se entrega la documentación:

- **Modelado (Entrega 3):** [docs/modelado/](https://github.com/Martin12332124/SCD_TP_F/tree/main/docs/modelado)
- **Despliegue (modo local y modo nube, y plan de escalamiento):** [docs/despliegue.md](https://github.com/Martin12332124/SCD_TP_F/blob/main/docs/despliegue.md)

## Responsabilidades del Equipo

### Entregable 1

| Integrante          | Rol                                | Ítems de la rúbrica a cargo                                |
| ------------------- | ---------------------------------- | ---------------------------------------------------------- |
| Martín Saldívar     | Desarrollador                      | 2.1 Diseño Arquitectónico                                  |
| Martín Carvallo     | Desarrollador y Historias          | 1.1 Historias de Usuario, 2.4 Entidades del dominio        |
| Claudia Medina      | Diseñadora y concepto del sistema. | 2.3 Mockups, 2.2 Diagrama de Arquitectura                  |
| Francisca Hernández | Historias y Análisis de requisitos | 1.1 Historias de Usuario                                   |
| Diego Urbano        | Coordinador                        | 1.2 Requisitos Extrafuncionales, 2.1 Diseño Arquitectónico |

### Entregable 2

| Integrante          | Rol                                          | Ítems de la rúbrica a cargo                                                |
| ------------------- | -------------------------------------------- | -------------------------------------------------------------------------- |
| Francisca Hernández | Analista de Requisitos (Refinamiento con IA) | 1.1 Mejora de Historias de Usuario con Clarita Review                      |
| Claudia Medina      | Gestión de Requisitos y Control de Cambios   | 1.1 Mejora de Historias de Usuario con Clarita Review (cambios realizados) |
| Martín Carvallo     | Desarrollador Backend (APIs)                 | 2.1 Desarrollo de una HU en backend (APIs)                                 |
| Diego Urbano        | Coordinador y Desarrollador Backend (APIs)   | 2.1 Desarrollo de una HU en backend (APIs)                                 |
| Martín Saldívar     | Ingeniero de Pruebas / QA (Thunder Client)   | 4.1 Casos de prueba para las APIs (Thunder Client)                         |

## Instalación y ejecución

## Servidor Backend

Servidor Node.js con Express y Socket.IO para el POS + KDS. La base SQLite local es la fuente de verdad: el restaurante puede seguir operando sin internet. Al configurar Supabase, el backend sincroniza una réplica y procesa las órdenes que deja la web pública.

### Cómo ejecutar
``` bash 
npm ci
npm start                 # http://localhost:3000
npm run lint
npm run build
npm run test:coverage     # pruebas + cobertura (carpeta coverage/)

```

### Persistencia de datos

Mesas, menú y pedidos se guardan en una base SQLite local (`better-sqlite3`, ADR-03), así que
sobreviven a un reinicio del servidor y no necesitan internet. Por defecto el archivo queda en
`data/restaurante.db` (se crea solo al hacer `npm start`); para usar otro archivo:
`DB_PATH=/ruta/otra.db npm start`. Para empezar de cero en desarrollo, apaga el servidor y borra
la carpeta `data/`. Cada operación se guarda en una transacción: o se guarda completa o no se
guarda nada (REF-09).

Detalles (esquema, decisiones, cómo abrir la base con DB Browser for SQLite):
[docs/persistencia-sqlite.md](docs/persistencia-sqlite.md).

### Inicio de sesión

Todo exige sesión: `POST /api/auth/login` entrega un token (JWT) que la API REST y Socket.IO
piden en cada uso. El `.env` necesita `JWT_SECRET` (sin él el servidor no arranca) y, la primera
vez, `USUARIOS_INICIALES`. Detalle en [docs/inicio-de-sesion.md](docs/inicio-de-sesion.md).

### API gateway

Toda la API (`/api/*` y Socket.IO) exige una API key de aplicación en la cabecera `x-api-key`, además
del token de sesión. Además limita las peticiones (login: 5 intentos fallidos por minuto por IP; resto: 600 por minuto
por llave) y registra cada acceso. El `.env` necesita `API_KEYS` (sin él el servidor no arranca).
Detalle, rotación de llaves y pruebas con curl en [docs/api-gateway.md](docs/api-gateway.md).

### Sincronización con la nube (opcional)

Si `.env` trae `SUPABASE_URL` y `SUPABASE_SECRET_KEY` (ver `.env.example`), el servidor mantiene una
réplica en Supabase y aplica las órdenes que deja la web pública. Sin esas variables sigue operando
en modo local, pero no sincroniza con la web pública. El esquema de Supabase está en `supabase/esquema.sql`. Detalle, cómo
configurarlo y cómo probar un corte de internet en
[docs/sincronizacion-nube.md](docs/sincronizacion-nube.md).

### Administración de mesas

La cantidad de mesas ya no es fija: se agregan con `POST /api/mesas` y se quitan con
`DELETE /api/mesas/:numero` (solo mesas libres y sin pedido, y nunca la última). Las 10 mesas
iniciales se crean únicamente la primera vez. Además, un pedido marcado "Listo 🍽️" se conserva
con la mesa ocupada hasta liberarla. Detalles: [docs/administracion-mesas.md](docs/administracion-mesas.md).

---

## REQUISITOS PREVIOS (Hacer esto antes de tocar el proyecto)

Antes de hacer nada, la computadora externa necesita tener instalado **Node.js**. Si no lo tiene, no funcionará nada.

1. Entra a la página oficial: https://nodejs.org
2. Descarga la versión que dice **LTS** (es la caja verde de la izquierda).
3. Abre el archivo descargado y dale a todo: **"Siguiente", "Siguiente", "Aceptar", "Instalar"**.
4. Cuando termine, cierra todas las ventanas.

---

## PASO A PASO PARA INSTALAR EL PROYECTO

Sigue estos pasos en orden estricto. No te saltes ninguno.

### Paso 1: Abrir la Terminal

- En **Windows**: Presiona la tecla `Windows`, escribe **PowerShell** y ábrelo.
- En **Mac**: Presiona `Cmd + Espacio`, escribe **Terminal** y ábrela.

### Paso 2: Ir a la carpeta donde quieres guardar el proyecto

Escribe el siguiente comando para moverte a la carpeta de descargas de la computadora y presiona `Enter`:

```bash
cd Downloads
```

### Paso 3: Descargar el código desde GitHub

Copia este comando exacto, pégalo en la terminal y presiona `Enter`:

```bash
git clone https://github.com/Martin12332124/SCD_TP_B.git
```

_(Esto creará automáticamente una carpeta llamada `SCD_TP_B` en las descargas)._

### Paso 4: Entrar a la carpeta del proyecto

Escribe este comando para meterte dentro de la carpeta que acabas de descargar y presiona `Enter`:

```bash
cd SCD_TP_B
```

### Paso 5: Instalar las librerías del sistema

Las librerías del proyecto NO vienen incluidas en la descarga porque son pesadas. Tienes que instalarlas ejecutando este comando exacto y presionando `Enter`:

```bash
npm install
```

```bash
npm run format
```

_Espera un par de segundos. Aparecerán muchas líneas de texto en la terminal y una barra de carga. Sabrás que terminó cuando la terminal te deje escribir comandos otra vez._

---

## CÓMO ENCENDER EL SERVIDOR

Una vez instalado todo, para prender el sistema haz lo siguiente:

1. Asegúrate de estar dentro de la carpeta del proyecto en la terminal.
2. Copia `.env.example` como `.env` y completa al menos `JWT_SECRET`, `USUARIOS_INICIALES` y `API_KEYS`
   (ver [docs/inicio-de-sesion.md](docs/inicio-de-sesion.md) y [docs/api-gateway.md](docs/api-gateway.md)).
3. Ejecuta este comando (usa `npm start` y no `node index.js`: solo `npm start` lee el `.env`):

```bash
npm start
```

### ¿Cómo sé si funcionó bien?

Si todo tuvo éxito, verás estas líneas exactas pintadas en tu terminal:

```text
=============================================
 Servidor Backend corriendo en el puerto 3000
=============================================
```

### Prueba Final en el Navegador

Para comprobar con tus propios ojos que la computadora externa está respondiendo:

1. Abre Google Chrome o cualquier navegador web.
2. En la barra de arriba donde escribes las páginas web, escribe exactamente esto:
   `http://localhost:3000`
3. Presiona `Enter`.
4. En la pantalla blanca debe aparecer el texto: **"Servidor del Sistema de Pedidos para Restaurante operativo."**

---

## CÓMO APAGAR EL SERVIDOR

Cuando termines de usarlo y quieras apagar el sistema:

1. Haz clic en la ventana de la terminal negra donde está corriendo el servidor.
2. Presiona las teclas **`Ctrl + C`** al mismo tiempo.
3. El servidor se detendrá inmediatamente.
