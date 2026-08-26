## Servidor Backend

Este proyecto es el cerebro (Backend) en tiempo real para el control de congestión, desarrollado con Node.js, Express y Socket.io.
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
4. En la pantalla blanca debe aparecer el texto: **"Servidor del Sistema de Congestión operativo."**

---

## CÓMO APAGAR EL SERVIDOR

Cuando termines de usarlo y quieras apagar el sistema:

1. Haz clic en la ventana de la terminal negra donde está corriendo el servidor.
2. Presiona las teclas **`Ctrl + C`** al mismo tiempo.
3. El servidor se detendrá inmediatamente.
