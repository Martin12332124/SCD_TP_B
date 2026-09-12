# Sistema de Pedidos para Restaurante (POS + KDS)

## Descripción del sistema

El Sistema de Pedidos para Restaurante (POS + KDS) resuelve el problema de coordinación entre la toma de pedidos en el salón y su preparación en cocina. En muchos restaurantes ese proceso depende de comandas en papel o de sistemas que no se actualizan en tiempo real, lo que provoca pedidos traspapelados, platos que se preparan mal o que llegan tarde a la mesa. El sistema conecta un Punto de Venta (POS), donde el mesero toma la comanda, con una Pantalla de Cocina (KDS), donde el personal de cocina la recibe y actualiza su estado a medida que avanza la preparación, todo sincronizado en tiempo real dentro de la red local del restaurante.

Un elemento central del diseño es el paso de validación obligatoria de la comanda con el cliente antes de enviarla a cocina: el mesero confirma cada ítem, cantidad y modificador con el comensal antes de que el pedido salga hacia la cocina, para eliminar el error humano en el origen del proceso en vez de corregirlo después, cuando ya es más costoso hacerlo.

El sistema sirve a cuatro roles dentro del restaurante: el Mesero, que toma los pedidos, gestiona las mesas y cierra las cuentas; el Cocinero, que recibe y prepara las comandas desde el KDS; el JefeDeCocina, que supervisa la cocina y el inventario de ingredientes; y el Administrador, que gestiona el catálogo de menú, los usuarios del sistema y el registro de ventas del local.

## Historias de Usuario

Todas las historias están registradas como GitHub Issues en el repositorio frontend.

Las historias de usuario viven en el repositorio frontend: https://github.com/Martin12332124/SCD_TP_F/issues

| ID | Nombre | Issue |
|----|--------|-------|
| US-01 | Selector de variantes-bebida | #22 |
| US-02 | Descripción compacta del pedido | #23 |
| US-03 | Agregacion de notas a los pedidos | #24 |
| US-04 | Disponibilidad en los menus | #32 |
| US-05 | Posibilidad de cambio de clientes-mesas | #33 |
| US-06 | Actualización de pedidos en la cocina | #25 |
| US-07 | Registrar precio al crear o editar | #26 |
| US-08 | Ver mapa de mesas | #27 |
| US-09 | Abrir o cerrar una mesa | #28 |
| US-10 | Limpieza al servir un pedido | #30 |

## Requisitos Extrafuncionales

Ver: [ReqExtrafuncionales.md](./ReqExtrafuncionales.md) — 16 requisitos clasificados, 5 de prioridad Alta.

## Entidades del Dominio

Ver: [DominioEntidades.md](./DominioEntidades.md) — 10 entidades, diagrama ER y máquina de estados del Pedido.

## Mockups

<!-- TODO: reemplazar por las rutas reales una vez subidas las imágenes -->

| Mockup | Historia de usuario relacionada |
|--------|----------------------------------|
| `docs/mockups/us-01.png` | US-01 |
| `docs/mockups/us-02.png` | US-02 |
| `docs/mockups/us-03.png` | US-03 |
| `docs/mockups/us-04.png` | US-04 |
| `docs/mockups/us-05.png` | US-05 |
| `docs/mockups/us-06.png` | US-06 |
| `docs/mockups/us-07.png` | US-07 |
| `docs/mockups/us-08.png` | US-08 |
| `docs/mockups/us-09.png` | US-09 |
| `docs/mockups/us-10.png` | US-10 |

## Diseño Arquitectónico

Ver: [Arquitectura.md](./Arquitectura.md) — estilo, diagrama, descomposición modular y decisiones de diseño (ADR).

## Responsabilidades del Equipo

<!-- TODO: obligatorio completar antes de entregar, afecta la nota individual -->

| Integrante | Rol | Ítems de la rúbrica a cargo |
|------------|-----|------------------------------|
| Martín Saldívar | Desarrollador | 2.1 Diseño Arquitectónico |
| Martín Carvallo | Desarrollador y Historias | 1.1 Historias de Usuario, 2.4 Entidades del dominio |
| Claudia Medina | Diseñadora y concepto del sistema.| 2.3 Mockups, 2.2 Diagrama de Arquitectura|
| Francisca Hernández | Historias y Análisis de requisitos | 1.1 Historias de Usuario |
| Diego Urbano | Coordinador | 1.2 Requisitos Extrafuncionales, 2.1 Diseño Arquitectónico |

## Instalación y ejecución

## Servidor Backend

Este proyecto es el cerebro (Backend) en tiempo real del Sistema de Pedidos para Restaurante (POS + KDS), desarrollado con Node.js, Express y Socket.io.
Se usa Node.js con Express y Socket.io.
A continuación, tienes los pasos exactos, detallados desde cero, para descargar, instalar y encender este servidor en CUALQUIER computadora

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
2. Ejecuta este comando mágico:

```bash
node index.js
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
