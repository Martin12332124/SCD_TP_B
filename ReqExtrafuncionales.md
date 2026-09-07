# Catálogo de Requisitos Extrafuncionales
## Sistema POS & KDS para Restaurante

---

## 1. Rendimiento

| ID | Requisito | Métrica / Criterio de aceptación | Prioridad |
|----|-----------|-----------------------------------|-----------|
| RNF-01 | El envío de una comanda desde el POS debe reflejarse en el KDS en tiempo casi real. | Latencia máxima vía WebSocket: < 1 seg dentro de la LAN. | Alta |
| RNF-02 | El cambio de estado de un pedido (Azul→Verde→Morado) debe propagarse a todas las pantallas conectadas (mesero + KDS) sin refresco manual. | Actualización push automática, sin polling perceptible por el usuario. | Alta |
| RNF-03 | Los cronómetros de cocina (alertas 15/20 min) deben mantenerse precisos incluso con carga de múltiples pedidos simultáneos. | Desviación máxima del cronómetro: ± 2 seg. | Media |
| RNF-04 | El sistema debe soportar la operación simultánea de múltiples mesas/pedidos sin degradación visible. | Número esperado de mesas/pedidos concurrentes: 10. | Media |

## 2. Disponibilidad y Confiabilidad

| ID | Requisito | Métrica / Criterio de aceptación | Prioridad |
|----|-----------|-----------------------------------|-----------|--------|
| RNF-05 | La comunicación POS-KDS debe funcionar 100% vía LAN, sin depender de Internet. | Cero interrupciones de la operación núcleo (toma de pedidos, KDS) al cortar el enlace WAN, verificado en prueba de desconexión. | Crítica |
| RNF-06 | Los movimientos de inventario generados offline deben encolarse y sincronizarse con la nube al recuperar conexión, sin pérdida ni duplicación de datos. | Cola de sincronización con reintento automático; verificación de integridad post-sync. | Alta |
| RNF-07 | El servidor local debe recuperarse ante caídas sin pérdida de comandas en curso. | Estrategia de persistencia/recuperación: **[DEFINIR — ej. journaling, snapshots periódicos]**. | Alta |
| RNF-08 | Disponibilidad esperada del sistema durante horario de atención. | Objetivo de uptime: **[DEFINIR, ej. 99.5% durante horario operativo]**. | Media |

## 3. Usabilidad

| ID | Requisito | Métrica / Criterio de aceptación | Prioridad |
|----|-----------|-----------------------------------|-----------|--------|
| RNF-09 | La interfaz del KDS debe ser legible a distancia en un ambiente de cocina (ruido visual, vapor, prisa). | Tamaño de fuente y contraste mínimos: **[DEFINIR]**; validar con prueba de usuario en cocina real o simulada. | Alta |
| RNF-10 | El paso de validación obligatoria en el POS no debe añadir fricción excesiva a la toma de pedidos. | Tiempo adicional máximo aceptable por comanda: **[DEFINIR]**. | Media |
| RNF-11 | Los identificadores de mesa (Libre/Ocupada) y los colores de estado del KDS deben ser reconocibles sin necesidad de leer texto. | Uso de color + ícono/forma redundante (accesibilidad para daltonismo). | Media |
| RNF-12 | Curva de aprendizaje del personal (mesero/cocinero) debe ser mínima. | Tiempo máximo de capacitación objetivo: **[DEFINIR]**. | Media |

## 4. Seguridad

| ID | Requisito | Métrica / Criterio de aceptación | Prioridad |
|----|-----------|-----------------------------------|-----------|--------|
| RNF-13 | El acceso a las apps (POS/KDS) debe estar restringido por rol (mesero, cocinero, jefe de cocina). | Mecanismo de autenticación/autorización: **[DEFINIR — ej. PIN por empleado, login simple]**. | Alta | Doc. Definición §2 |
| RNF-14 | Dado que no se procesan pagos con tarjeta ni se integra con pasarelas, no se requiere cumplimiento PCI-DSS, pero sí protección básica de datos de ventas e inventario. | Datos sensibles (si existieran) cifrados en tránsito y reposo. | Media | Doc. Definición §3 |
| RNF-15 | Las acciones críticas (anulación de pedido, ajustes de inventario) deben quedar registradas (auditoría). | Log con usuario, timestamp y acción. | Media | — |

## 5. Mantenibilidad

| ID | Requisito | Métrica / Criterio de aceptación | Prioridad |
|----|-----------|-----------------------------------|-----------|--------|
| RNF-16 | El modelo de datos de Recetas (Platillo → Ingrediente_Platillo → Inventario) debe permitir agregar nuevos platillos/ingredientes sin cambios estructurales. | Esquema relacional documentado y versionado. | Alta | Doc. Definición §6, Fases §"Diseño del Modelo de Datos" |
| RNF-17 | El backend debe exponer un contrato de API/WebSocket documentado para facilitar el desarrollo paralelo de frontend POS y KDS. | Documentación (ej. OpenAPI/AsyncAPI) actualizada por sprint. | Alta | Fases §"Contrato API/WebSockets" |
| RNF-18 | El código debe seguir convenciones de estilo y control de versiones acordadas por el equipo. | Uso de linter, revisión de PRs, ramas por feature. | Media | — |

## 6. Compatibilidad y Portabilidad

| ID | Requisito | Métrica / Criterio de aceptación | Prioridad |
|----|-----------|-----------------------------------|-----------|--------|
| RNF-19 | El POS debe funcionar en Android e iOS (tablet o smartphone). | Pruebas en al menos una versión mínima de cada SO: **[DEFINIR, ej. Android 10+, iOS 15+]**. | Alta | Doc. Definición §3 |
| RNF-20 | El KDS debe ser responsivo para tablets, celulares y pantallas táctiles industriales. | Diseño adaptable probado en al menos 3 resoluciones distintas: **[DEFINIR rangos]**. | Alta | Doc. Definición §4 |

## 7. Escalabilidad

| ID | Requisito | Métrica / Criterio de aceptación | Prioridad |
|----|-----------|-----------------------------------|-----------|--------|
| RNF-21 | La arquitectura debe permitir, a futuro, dividir el KDS por estaciones (barra, cocina) sin rediseño mayor. | Clasificación de ítems por categoría de preparación desacoplada del envío WebSocket. | Baja (fase futura) | Doc. Definición §8, Fases §6 |
| RNF-22 | El sistema debe soportar el crecimiento en número de mesas/menú sin degradar el rendimiento. | Umbral de mesas/platillos objetivo: **[DEFINIR]**. | Baja | — |

---

## Información adicional necesaria para cerrar este catálogo

Para completar los valores marcados como **[DEFINIR]** y validar que los NFR estén bien priorizados, sería útil contar con:

1. **Historias de usuario** (a cargo de Martín Carvallo y Francisca Hernández) — muchos NFR de usabilidad y rendimiento dependen de los flujos concretos que ahí se describan (ej. cuántos pasos tiene "tomar un pedido").
2. **Tamaño objetivo del restaurante piloto**: número de mesas, pedidos/hora en hora punta, tamaño del menú — esto define las métricas de RNF-01, 03, 04, 08, 21, 22.
3. **Especificaciones mínimas de hardware/SO** que va a usar el restaurante (tablets existentes o a comprar) — para cerrar RNF-19/20.
4. **Rúbrica o formato exigido por el ramo (ISF224)** para el Entregable 1 — si el profesor pide un estándar específico (ISO 25010, IEEE 830, etc.) o una cantidad mínima de requisitos por categoría, conviene ajustar la plantilla a eso antes de que Claudia y Diego la completen.
5. **Decisión sobre autenticación de roles** (RNF-13) — aunque sea una decisión simple (PIN vs. login), es un supuesto que afecta seguridad y usabilidad.
6. **Criterios de éxito de la PoC offline-first** (Fase 0) — una vez hecha esa prueba, se pueden reemplazar RNF-05/06/07 con números reales en vez de placeholders.

Si me compartes las historias de usuario o las respuestas a estos puntos, puedo ajustar los valores concretos en lugar de los placeholders.
