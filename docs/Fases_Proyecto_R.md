### **Los Primeros Grandes Pasos (Punto de Partida)**

Antes de programar pantallas o botones, necesitas establecer los cimientos del sistema distribuido:

1. **Definir el "Contrato" de la API y WebSockets:** Como el KDS necesita actualizarse en tiempo real (cronómetros y estados), una API REST tradicional no será suficiente. Debes definir desde el día uno cómo se comunicará el backend con el frontend en tiempo real (WebSockets o Server-Sent Events).  
2. **Prueba de Concepto Offline-First (LAN):** Levanta un servidor local básico en tu repositorio de backend y haz que la aplicación móvil (frontend) logre conectarse a él a través de la red Wi-Fi local (LAN). Si esto falla, nada del resto funcionará.  
3. **Diseño del Modelo de Datos (BBDD):** Diseña las tablas o colecciones principales. El modelo de "Recetas" que descuenta ingredientes exactos (gramos, cc, ml) requiere una estructura relacional muy bien pensada entre Platillo \-\> Ingrediente\_Platillo \-\> Inventario.  
4. **Mockup de la Máquina de Estados:** Crea un endpoint en el backend que simplemente cambie el estado de un pedido simulado (Azul \-\> Verde \-\> Morado) y verifica que el frontend lo refleje correctamente.

### **Hoja de Ruta del Proyecto**

Una vez superados los primeros pasos, divide el desarrollo en los siguientes sprints funcionales:

#### **Fase 1: Catálogo y Gestión de Mesas**

*El objetivo es tener la estructura básica donde interactuarán los usuarios.*

* **Backend:** Crear el CRUD (Crear, Leer, Actualizar, Borrar) para el menú, modificadores, ingredientes y configuración del salón.  
* **Frontend (POS):** Desarrollar la interfaz visual del mapa del restaurante con identificadores binarios para mesas (Libres u Ocupadas).  
* **Frontend (POS):** Crear el menú interactivo, asegurando soporte profundo para modificadores (alergias, exclusiones, términos de cocción).

#### **Fase 2: El Flujo de Creación de Comandas (POS)**

*El objetivo es blindar la toma de pedidos para eliminar el error humano.*

* **Frontend (POS):** Implementar el carrito de compras por mesa.  
* **Frontend (POS):** Programar el paso de validación obligatorio (doble check) antes de enviar la orden.  
* **Backend:** Recibir la comanda y registrarla en la base de datos con el estado inicial "Pedido en Espera" (Azul).

#### **Fase 3: El KDS y la Máquina de Estados (El Core)**

*El objetivo es estandarizar la comunicación y trazabilidad visual de la cocina.*

* **Frontend (KDS):** Desarrollar la vista de comandas mostrando solo lo esencial: Número de mesa, platillos y modificadores destacados.  
* **Backend & Frontend:** Implementar la transición al estado "En Cocina" (Verde) cuando se acepta el pedido, bloqueando desde este punto la opción de anular.  
* **Frontend (KDS):** Programar el cronómetro local en la vista de cocina.  
* **Frontend (KDS):** Implementar las alertas visuales por tiempo: Alerta 1 (Amarillo) al superar los 15 minutos, y Alerta 2 (Rojo) al superar los 20 minutos.  
* **Backend & Frontend:** Crear el gatillo de "Pedido Servido" (Morado) y programar la limpieza automática instantánea en los monitores del mesero y KDS.

#### **Fase 4: Descuento de Inventario**

*El objetivo es conectar las ventas con el stock en tiempo real.*

* **Backend:** Desarrollar el motor de cálculo que, al venderse un platillo, identifique su receta interna.  
* **Backend:** Ejecutar la resta automática de las cantidades exactas (Gramos, CC, Mililitros, Unidades) del inventario central.

#### **Fase 5: Cierre de Mesa y Facturación**

*El objetivo es gestionar la salida del cliente sin depender de pasarelas externas.*

* **Frontend (POS):** Integrar la calculadora interna para sumar el total de la mesa.  
* **Frontend (POS):** Programar la lógica matemática para dividir cuentas y el cálculo automático de sugerencia de propina.  
* **Backend:** Marcar la mesa como "Libre" nuevamente al cerrar la cuenta, reiniciando el ciclo.

#### **Fase 6: Resolución de Puntos Pendientes y Sincronización**

*El objetivo es abordar los puntos TBD (To Be Determined) y robustecer el sistema offline.*

* **Arquitectura de Sincronización:** Definir la estrategia de almacenamiento local. Si se pierde el internet, el servidor local sigue operando la red LAN, pero se debe programar una cola de tareas (Queue) que guarde los movimientos de inventario y los sincronice con la nube en cuanto regrese la conexión.  
* **Ruteo de Cocina:** Tomar la decisión sobre si usar una pantalla global o dividir el KDS por estaciones (barra vs. cocina). Si se divide, el backend necesitará clasificar cada ítem de la comanda según su categoría de preparación antes de enviarlo por WebSocket.

