# Regresión, cobertura e integración continua

## 1. Objetivo

Garantizar que el backend del sistema de pedidos del restaurante siga funcionando correctamente tras cada cambio. Para eso se dejó una base de pruebas automatizadas que:

- genera un reporte de cobertura (líneas, funciones y ramas),
- protege comportamientos críticos mediante pruebas de regresión,
- se ejecuta automáticamente en cada Pull Request junto con la construcción y el análisis estático.

## 2. Herramienta seleccionada

- **Herramienta:** Jest 30 (pruebas y cobertura integradas).
- **Instalación:** `npm install --save-dev jest` (ya versionada en `package.json`; en un clon nuevo basta con `npm ci`).
- **Ejecución de pruebas:** `npm test`
- **Ejecución con cobertura:** `npm run test:coverage`
- **Ejecución en CI:** `npm run test:ci`
- **Razón de la elección:** es la herramienta estándar para proyectos Node.js, trae el reporte de cobertura sin dependencias adicionales y permite fijar umbrales mínimos que hacen fallar el comando cuando no se cumplen.

La configuración está versionada en el bloque `"jest"` de `package.json`:

- Se mide únicamente el código propio (`src/**/*.js`, sin archivos de prueba).
- Se generan reportes `text`, `text-summary`, `lcov` y `html`.
- Se exigen umbrales mínimos (sección 6). Si no se cumplen, Jest termina con error y el CI falla.

La carpeta `coverage/` es salida generada y **no se sube al repositorio** (está en `.gitignore`). En CI se guarda como artefacto de la ejecución.

## 3. Módulos críticos y contrato

Se eligieron dos servicios de dominio porque concentran reglas de negocio cuyo incumplimiento afecta directamente la operación del restaurante.

### 3.1 `src/dominio/mesa-estado.service.js` (US-09: abrir y cerrar mesas)

**Por qué es un riesgo:** si falla la regla de cierre, una mesa podría liberarse mientras tiene un pedido en curso, y el pedido quedaría sin mesa.

**Comportamiento esperado:**

- Abrir una mesa libre la deja `ocupada` y notifica a las pantallas.
- Cerrar una mesa ocupada **sin** pedido activo la deja `libre`.

**Valores límite:**

- Mesa 1 (mínimo) y mesa 10 (máximo) son válidas.
- Mesa 0 es entrada inválida; mesa 11 no existe.

**Casos de error:**

- Número no entero o no numérico (`abc`, `1.5`, `-1`): `ENTRADA_INVALIDA`.
- Mesa inexistente: `NO_ENCONTRADO`.
- Abrir una mesa ya ocupada o cerrar una ya libre: `ESTADO_NO_PERMITIDO` (sin nueva notificación).
- Cerrar una mesa con pedido activo: `PEDIDO_ACTIVO` (la mesa sigue ocupada).
- Construir el servicio sin sus dependencias lanza un error.

### 3.2 `src/dominio/menu-item.service.js` (US-07: crear y editar ítems del menú)

**Por qué es un riesgo:** valida precios y nombres del menú. Un error permitiría precios inválidos, productos duplicados o ediciones sobre productos que no existen.

**Comportamiento esperado:**

- Crear un ítem con nombre y precio válidos lo deja disponible y notifica.
- Editar el precio o el nombre de un ítem existente actualiza el ítem.
- Obtener y listar ítems existentes.

**Valores límite:**

- Precio: entero entre 1 y 1.000.000 (se prueban 0, 1, 1.000.000 y 1.000.001).
- Nombre: hasta 60 caracteres (se prueban 60 y 61).
- Identificador del ítem: entero positivo (se prueban `0` y `1e1` como inválidos).

**Casos de error:**

- Precio negativo, decimal, texto o ausente: `ENTRADA_INVALIDA`.
- Cuerpo ausente o nombre vacío: `ENTRADA_INVALIDA`.
- Nombre repetido, sin distinguir mayúsculas, al crear o editar: `DUPLICADO`.
- Editar sin campos editables: `ENTRADA_INVALIDA`.
- Producto inexistente: `NO_ENCONTRADO`.

## 4. Pruebas implementadas

La suite completa tiene **111 pruebas en 7 archivos**, todas aprobadas y ninguna omitida ni desactivada.

- `test/mesa-estado.service.test.js` (18): módulo crítico US-09.
- `test/menu-item.service.test.js` (18): módulo crítico US-07.
- `test/api.test.js` (19): API REST de mesas y menú a través de la aplicación real (routers, `app.js` y notificador). Levanta el servidor en un puerto libre y usa `fetch`, sin dependencias nuevas.
- `test/mesa.service.test.js` (23): traslado de pedidos entre mesas (US-05).
- `test/pedido.service.test.js` (23) y `test/operacion-2.test.js` (6): actualización de estado de pedidos y validación del número de mesa.
- `test/integracion.test.js` (4): flujo completo con repositorios reales y notificador espía.

Cada módulo crítico cubre, como mínimo: 2 casos válidos, 2 de valores límite y 1 de error, con nombres que describen la conducta esperada. Las pruebas son independientes entre sí (cada una crea su propio entorno), no usan datos aleatorios y no llaman a servicios externos: el notificador se reemplaza por un doble de prueba.

## 5. Pruebas de regresión

**Condición crítica protegida (US-09):** una mesa con pedido activo no puede cerrarse. Si esta regla se rompe, se pierde el pedido en curso.

- Prueba de servicio: `REGRESIÓN US-09: no se cierra una mesa con pedido activo (PEDIDO_ACTIVO) y sigue ocupada`.
- Prueba de API: `REGRESIÓN US-09: POST /cerrar con pedido activo responde 409 (PEDIDO_ACTIVO)`.

**Condición crítica protegida (US-07):** editar un producto inexistente debe responder `NO_ENCONTRADO` y no crear datos nuevos.

- Prueba de servicio: `REGRESIÓN US-07: editar un producto inexistente devuelve NO_ENCONTRADO y no crea datos`.
- Prueba de API: `PUT edita el precio (200) y REGRESIÓN US-07: un id inexistente responde 404`.

**Verificación:** con el código actual estas pruebas aprueban junto con las otras 100 de la suite (104 de 104). La sección 8 demuestra además que la suite detecta un cambio que rompe un límite.

## 6. Cobertura

### 6.1 Metas y umbrales configurados

- Aplicación completa: 70 % líneas, 70 % funciones, 60 % ramas (y 70 % sentencias).
- Módulos críticos (`mesa-estado.service.js` y `menu-item.service.js`): 80 % líneas, 80 % funciones, 70 % ramas.

Estos valores están en `coverageThreshold` dentro de `package.json`, de modo que el CI falla si baja la cobertura.

### 6.2 Antes y después

**Antes** (CI del PR #35, 4 archivos de prueba, 56 pruebas):

- Sentencias 33 %, ramas 33,18 %, funciones 36,84 %, líneas 32,52 %.
- Los dos módulos críticos, los routers, `app.js` y `notificador.js` estaban en **0 %**. Las pruebas solo cubrían `mesa.service.js` y `pedido.service.js`.

**Después de agregar las pruebas de los módulos críticos** (6 archivos, 88 pruebas):

- Sentencias 68,75 %, ramas 76,54 %, funciones 70,17 %, líneas 69,1 %.
- Los módulos críticos pasaron de 0 % a más de 90 %, pero el global seguía bajo la meta de líneas (70 %) porque los routers y `app.js` continuaban sin pruebas.

**Después de agregar `test/api.test.js`** (7 archivos, 111 pruebas):

- Sentencias **89,51 %**, ramas **84,78 %**, funciones **93,33 %**, líneas **91,29 %**.
- `mesa-estado.service.js`: sentencias 93,02 %, ramas 8636 %, funciones 100 %, líneas 100 %.
- `menu-item.service.js`: sentencias 92,04 %, ramas 87,5 %, funciones 100 %, líneas 97,43 %.
- Routers (`mesas.router.js`, `menu-items.router.js`) y `notificador.js`: 100 % de líneas y funciones.

Ambos módulos críticos y el global superan las metas.

### 6.3 Qué riesgo redujeron las pruebas nuevas

El porcentaje por sí solo no es el resultado. Lo importante es qué dejó de estar sin comprobar:

- **Cierre de mesas (US-09):** antes, nada verificaba que una mesa con pedido activo no pudiera cerrarse ni que una mesa ya libre rechazara un segundo cierre. Un cambio accidental en esas condiciones habría pasado el CI sin que nadie lo notara.
- **Precios y nombres (US-07):** antes, ningún test comprobaba los límites de precio (1 y 1.000.000), el largo máximo del nombre (60) ni el rechazo de nombres duplicados. Esos son exactamente los lugares donde un cambio de `<=` por `<` introduce un defecto silencioso.
- **Traducción a HTTP (routers):** antes, ninguna prueba verificaba que cada tipo de error se tradujera al código correcto (400, 404 o 409), de modo que el frontend habría podido recibir un código equivocado sin que el CI lo detectara. Tampoco se comprobaba que un JSON malformado devolviera un error en JSON y no una página HTML.

### 6.4 Zonas que siguen sin cobertura

- **`src/app.js` líneas 59-113 y 136:** manejadores de eventos de Socket.io (`actualizar_pedido`, `trasladar_pedido`) y el manejo de errores internos. Probarlos exige un cliente de Socket.io, que no es dependencia del backend. Esos flujos se verifican de extremo a extremo en el CI del repositorio del frontend, que levanta este backend y se conecta por Socket.io (`test-verificacion.js`).
- **Ramas sueltas en `consistencia.js`, `consistencia-menu.js` y los repositorios:** son condiciones defensivas poco probables. El global de ramas (84,95 %) supera con holgura la meta del 60 %.

No se excluyó ningún archivo del cálculo de cobertura.

## 7. Integración continua

El flujo `.github/workflows/ci.yml` se ejecuta al hacer push y al abrir o actualizar cualquier Pull Request. Sobre el último cambio de la rama ejecuta, en este orden:

1. `npm ci`: instalación reproducible de dependencias.
2. `npm run build`: verificación de construcción (`node --check index.js`; al ser Node.js no hay compilación, se comprueba que el punto de entrada no tenga errores de sintaxis).
3. `npm run lint`: análisis estático con ESLint (`eslint.config.js`).
4. `npm run test:ci`: pruebas con cobertura y verificación de umbrales.
5. Publicación de la carpeta `coverage/` como artefacto de la ejecución.

Cualquier paso que falle hace fallar la comprobación y, con la protección de rama de la sección 7.1, bloquea el merge.

### 7.1 Protección de la rama `main`

Configuración en GitHub → Settings → Branches → regla para `main`:

- La rama main se encuentrata protegida, por lo que no se puede hacer un push directamente a ella.


## 8. Simulación de construcción rota

**Fallo controlado.** En `src/dominio/menu-item.service.js` se cambió temporalmente el límite superior de precio:

```js
const PRECIO_MAXIMO = 1_000_000;   // original
const PRECIO_MAXIMO = 500_000;     // cambio temporal para provocar el fallo
```

**Detección.** La suite falla con una sola prueba rota:
`MenuItemService (US-07) - módulo crítico › límite superior: acepta precio 1.000.000`.
Resultado: 1 prueba fallida y 103 aprobadas. El CI marca la comprobación en rojo.

**Verificación.** Tras la reparación se ejecutaron de nuevo todas las comprobaciones: construcción, lint y pruebas con cobertura. La suite vuelve a aprobar las 104 pruebas y el CI queda en verde.

## 9. Política de construcción rota

Si una validación obligatoria falla (construcción, lint, pruebas o umbrales de cobertura), la incorporación queda bloqueada y se debe:

1. localizar la causa en el log de la ejecución fallida,
2. reparar o revertir el cambio responsable,
3. volver a ejecutar la verificación completa y esperar el resultado en verde.

## 10. Cómo reproducir localmente

```bash
npm ci
npm run build
npm run lint
npm run test:coverage
```