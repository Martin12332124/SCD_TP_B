# Documento de Definición de Proyecto: Sistema POS & KDS para Restaurante

## **1\. Visión y Objetivos**

Desarrollar una plataforma integral de gestión de restaurantes compuesta por un Punto de Venta (POS) y un Sistema de Pantallas de Cocina (KDS). El objetivo principal es **eliminar el error humano** en la toma de pedidos, estandarizar la comunicación entre salón y cocina, y proveer una trazabilidad visual estricta de los tiempos de preparación, todo sin sacrificar la experiencia de atención social y humana hacia el cliente.

## **2\. Actores del Sistema**

> - **Mesero:** Encargado de la toma de pedidos, personalización de platillos, gestión de mesas y cálculo de cuentas a través de la aplicación móvil.
> - **Cocinero:** Visualiza las comandas entrantes, prepara los platillos y marca los cambios de estado en el flujo de preparación a través del monitor táctil.
> - **Jefe de Cocina:** Supervisa los tiempos de los pedidos (alertas visuales) y coordina el flujo general mediante el KDS.

## **3\. Especificaciones del POS (Frontend Salón)**

> - **Plataforma:** Aplicación Móvil compatible con Android e iOS (Tablet o Smartphone).
> - **Gestión de Mesas:** Interfaz visual con el mapa del restaurante. Las mesas deben tener identificadores visuales binarios: **Libres** u **Ocupadas**.
> - **Toma de Pedidos (Prevención de Errores):**

- Menú interactivo con soporte profundo de modificadores (alergias, exclusiones de ingredientes, términos de cocción).
- **Paso de validación obligatorio:** Antes de enviar la comanda a cocina, el sistema debe requerir que el mesero valide las especificaciones con el cliente (doble check de seguridad).

> - **Facturación (Cierre de Mesa):**

- Calculadora interna de cuentas.
- Funcionalidad para dividir la cuenta del total de la mesa.
- Cálculo automático de sugerencia de propina.
- _Nota:_ El sistema **no** procesará pagos con tarjetas directamente ni se integrará con pasarelas de pago.

## **4\. Especificaciones del KDS (Frontend Cocina)**

> - **Plataforma:** Aplicación responsiva optimizada para Tablets, Celulares y Pantallas Táctiles industriales.
> - **Visualización de Comandas:** La pantalla mostrará únicamente la información esencial para la operación: Número de Mesa, Platillos y Modificadores (alertas de alergias destacadas).

## **5\. Máquina de Estados y Trazabilidad (Reglas de Negocio)**

El sistema operará bajo una lógica estricta de estados visuales y cronómetros. El ciclo de vida de un pedido es unidireccional, con una única excepción de anulación en la etapa inicial.

| Estado                | Color en UI  | Gatillo / Condición de entrada                              | Reglas de Salida / Siguientes pasos                                                                     |
| :-------------------- | :----------- | :---------------------------------------------------------- | :------------------------------------------------------------------------------------------------------ |
| **Pedido en Espera**  | **Azul**     | El mesero envía la comanda desde el POS.                    | Pasa a _En Cocina_ o puede cambiar a _Anulado_ (único momento donde es posible cancelar).               |
| **En Cocina**         | **Verde**    | Cocina acepta/inicia el pedido. Inicia el cronómetro.       | Si demora \< 15 min, pasa a _Pedido Servido_.                                                           |
| **Alerta 1: Retraso** | **Amarillo** | El pedido lleva más de 15 minutos en el estado _En Cocina_. | El cronómetro sigue corriendo.                                                                          |
| **Alerta 2: Crítico** | **Rojo**     | El pedido lleva más de 20 minutos en el estado _En Cocina_. | Requiere atención inmediata.                                                                            |
| **Pedido Servido**    | **Morado**   | El pedido se entrega a la mesa.                             | **Limpieza automática:** El pedido se borra instantáneamente de la tablet del mesero y del monitor KDS. |

## **6\. Módulo de Inventario**

> - **Lógica de Descuento (Recetas):** Cada platillo del menú debe estar asociado a una "receta" interna. Al registrarse la venta de un platillo, el sistema descontará automáticamente las cantidades exactas de los ingredientes (Gramos, Centímetros Cúbicos, Mililitros o Unidades) del inventario central.

## **7\. Requisitos Técnicos (No Funcionales)**

> - **Tolerancia a Fallos (Offline-First):** La toma de pedidos y la comunicación POS-KDS debe funcionar mediante red local (LAN). Si el restaurante pierde conexión a Internet, la operatividad principal no debe verse interrumpida.

## **8\. Fases Posteriores y Puntos Pendientes (TBD)**

> - **Ruteo de Cocina:** Definir si los pedidos se separarán por estaciones (ej. Bebidas a barra, comida a cocina) o si existirá una única pantalla global.
> - **Sincronización de Inventario Offline:** Definir cómo se comportará la actualización del inventario en la nube cuando el sistema opere sin conexión a Internet.
