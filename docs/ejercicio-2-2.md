# Ejercicio 2.2 — Contratos, Aserciones, Programación Defensiva y Dependencias Explícitas

## Ficha de operación 1

| Elemento | Registro del equipo |
|---|---|
| **Funcionalidad y operación** | **Funcionalidad o necesidad:** Actualización de pedidos en la cocina (US-06): el mesero o el cocinero cambia el estado del pedido de una mesa. |
| | **Clase, módulo y firma o ruta:** `SCD_TP_B · src/dominio/pedido.service.js` → `PedidoService.actualizarEstado({ mesa, estado })`; evento Socket.io `"actualizar_pedido"` (`src/app.js`). Cliente: `actualizarPedido()` en `SCD_TP_F/src/App.jsx`. |
| **Propósito** | **Resultado observable que obtiene quien usa esta operación:** Cambia el estado de una mesa (Recibido → En Cocina → Listo) y todas las pantallas conectadas lo ven al instante; si el cambio no es válido, recibe un mensaje que dice qué se esperaba. |
| **Precondiciones** | 1. `datos` es un objeto con `mesa` de formato `"Mesa N"` (N entero positivo) y `estado` igual a `Recibido 📝`, `En Cocina 🍳` o `Listo 🍽️`. |
| | 2. La mesa N existe y la transición es válida desde el estado actual del pedido de esa mesa: sin pedido → Recibido → En Cocina → Listo → (nuevo) Recibido. |
| **Postcondiciones** | 1. El pedido de esa mesa queda en el estado pedido; si es Recibido, la mesa queda "ocupada". Si es Listo, el pedido vigente se elimina y la mesa queda "libre". |
| | 2. Todos los clientes reciben una vez `"cambio_estado_pedido"` `{ mesa, estado }` (y `"estado_mesas"` si se ocupó o liberó una mesa); quien llamó recibe `{ ok: true, mesa, estado }`. |
| **Invariante** | **Regla que debe seguir siendo verdadera después de la operación:** Una mesa ocupada tiene exactamente un pedido vigente y todo pedido vigente está sobre una mesa ocupada (`verificarConsistenciaMesasPedidos`, `src/dominio/consistencia.js`). |
| **Validación defensiva** | **Entrada inválida 1:** `{ mesa: "Mesa ", estado: "Recibido 📝" }` → **Respuesta:** `ENTRADA_INVALIDA` — `"mesa no tiene un formato válido"`, esperado: `"Mesa N"` con N entero positivo. |
| | **Entrada inválida 2:** `{ mesa: "Mesa 3", estado: "Listo 🍽️" }` con la mesa en Recibido → **Respuesta:** `ESTADO_NO_PERMITIDO` — `"Transición no permitida: Recibido → Listo"`, esperado: `En Cocina 🍳`. |
| | **Extra:** `{ mesa: 5 }` (número) → `ENTRADA_INVALIDA`; antes lanzaba `TypeError` y tumbaba el servidor. |
| **Dependencia explícita** | **Colaborador y forma en que se inyecta (constructor, parámetro o interfaz):** `pedidos` y `mesas` (repositorios) y `notificador` (Gateway de Tiempo Real), por constructor: `new PedidoService({ pedidos, mesas, notificador })`. En producción: repositorios en memoria y `SocketNotificador`. Para verificar: `NotificadorEspia` (guarda los eventos), `PedidosQueFallan` o `NotificadorCaido` (`test/doubles.js`). |
| **Evidencia de ejecución** | **Caso válido y dos inválidos ejecutados.** Archivo, comando o pantalla: SCD_TP_B: `npm run evidencia` (salida guardada en `docs/evidencia-ejercicio-2-2.txt`) y `npm test` (`test/pedido.service.test.js`, `test/integracion.test.js`; **27 pruebas correctas**). |

---

## Ficha de operación 2

> ⚠️ **Pendiente** — A completar por otro compañero del equipo.

| Elemento | Registro del equipo |
|---|---|
| **Funcionalidad y operación** | Funcionalidad o necesidad: _____ |
| | Clase, módulo y firma o ruta: _____ |
| **Propósito** | Resultado observable que obtiene quien usa esta operación: _____ |
| **Precondiciones** | 1. _____ |
| | 2. _____ |
| **Postcondiciones** | 1. _____ |
| | 2. _____ |
| **Invariante** | Regla que debe seguir siendo verdadera después de la operación: _____ |
| **Validación defensiva** | Entrada inválida 1: _____ → Respuesta: _____ |
| | Entrada inválida 2: _____ → Respuesta: _____ |
| **Dependencia explícita** | Colaborador y forma en que se inyecta: _____ |
| **Evidencia de ejecución** | Caso válido y dos inválidos ejecutados: _____ |

---

## Ficha de operación 3

> ⚠️ **Pendiente** — A completar por otro compañero del equipo.

| Elemento | Registro del equipo |
|---|---|
| **Funcionalidad y operación** | Funcionalidad o necesidad: _____ |
| | Clase, módulo y firma o ruta: _____ |
| **Propósito** | Resultado observable que obtiene quien usa esta operación: _____ |
| **Precondiciones** | 1. _____ |
| | 2. _____ |
| **Postcondiciones** | 1. _____ |
| | 2. _____ |
| **Invariante** | Regla que debe seguir siendo verdadera después de la operación: _____ |
| **Validación defensiva** | Entrada inválida 1: _____ → Respuesta: _____ |
| | Entrada inválida 2: _____ → Respuesta: _____ |
| **Dependencia explícita** | Colaborador y forma en que se inyecta: _____ |
| **Evidencia de ejecución** | Caso válido y dos inválidos ejecutados: _____ |

---

## Registro de Evidencia de Ejecución

### 1. Salida de `npm run evidencia` (Casos válidos e inválidos)

Archivo generado automáticamente: `docs/evidencia-ejercicio-2-2.txt`

```text
===============================================================
  EVIDENCIA - Ejercicio 2.2: Operacion 1 (actualizarEstado)
  PedidoService con dependencias explicitas
===============================================================

--- CASO VALIDO: Ciclo completo Mesa 3 ---
1. Recibido 📝:
   Resultado: {"ok":true,"mesa":"Mesa 3","estado":"Recibido 📝"}
   Mesa 3 estado: ocupada
2. En Cocina 🍳:
   Resultado: {"ok":true,"mesa":"Mesa 3","estado":"En Cocina 🍳"}
3. Listo 🍽️:
   Resultado: {"ok":true,"mesa":"Mesa 3","estado":"Listo 🍽️"}
   Mesa 3 estado: libre
   Pedido vigente: null
   Eventos emitidos: 5

--- CASO INVALIDO 1: mesa con formato incorrecto ---
   Entrada: { mesa: "Mesa ", estado: "Recibido 📝" }
   Resultado: {"ok":false,"tipo":"ENTRADA_INVALIDA","error":"mesa no tiene un formato válido","esperado":"\"Mesa N\" con N entero positivo."}

--- CASO INVALIDO 2: transicion no permitida ---
   Entrada: { mesa: "Mesa 3", estado: "Listo 🍽️" } con mesa en Recibido
   Resultado: {"ok":false,"tipo":"ESTADO_NO_PERMITIDO","error":"Transición no permitida: Recibido 📝 → Listo 🍽️","esperado":"En Cocina 🍳"}

--- CASO EXTRA: mesa como numero (no tumba el servidor) ---
   Entrada: { mesa: 5 }
   Resultado: {"ok":false,"tipo":"ENTRADA_INVALIDA","error":"mesa no tiene un formato válido","esperado":"\"Mesa N\" con N entero positivo."}

===============================================================
  Todos los casos ejecutados sin errores no controlados.
===============================================================
```

### 2. Salida de `npm test` (Suite de pruebas automatizadas)

```text
PASS test/integracion.test.js
  Integración: flujo completo de pedido
    √ ciclo completo: Recibido → En Cocina → Listo para una mesa
    √ múltiples mesas funcionan de forma independiente
    √ después de Listo se puede iniciar un nuevo pedido en la misma mesa
    √ caso inválido extra: mesa como número no tumba el servidor

PASS test/pedido.service.test.js
  PedidoService.actualizarEstado – validación de entrada
    √ rechaza datos nulos
    √ rechaza datos undefined
    √ rechaza mesa vacía: { mesa: "Mesa ", estado: "Recibido 📝" }
    √ rechaza mesa numérica (no string): { mesa: 5 }
    √ rechaza mesa con formato "Mesa 0" (no positivo)
    √ rechaza mesa con letras: "Mesa ABC"
    √ rechaza estado no válido: "Cancelado"
    √ rechaza estado vacío
  PedidoService.actualizarEstado – transiciones de estado
    √ permite: sin pedido → Recibido 📝
    √ permite: Recibido 📝 → En Cocina 🍳
    √ permite: En Cocina 🍳 → Listo 🍽️
    √ permite ciclo completo: Listo → nuevo Recibido
    √ rechaza transición inválida: Recibido → Listo (saltarse cocina)
    √ rechaza transición inválida: sin pedido → En Cocina
    √ rechaza transición inválida: sin pedido → Listo
  PedidoService.actualizarEstado – postcondiciones
    √ al marcar Recibido, la mesa queda ocupada
    √ al marcar Listo, la mesa queda libre y sin pedido
    √ emite "cambio_estado_pedido" al actualizar
    √ emite "estado_mesas" cuando se ocupa o libera una mesa
    √ NO emite nada si la entrada es inválida
  PedidoService – dependencia no disponible
    √ propaga error si el repositorio de pedidos falla al guardar
    √ propaga error si el notificador está caído
    √ lanza error si se construye sin dependencias

Test Suites: 2 passed, 2 total
Tests:       27 passed, 27 total
Snapshots:   0 total
Time:        0.512 s
Ran all test suites.
```

---

## Identificación de la dependencia explícita

La dependencia hecha explícita es el **Notificador** (Gateway de Tiempo Real):
- **En producción**: Se utiliza `SocketNotificador` (`src/infraestructura/notificador.js`), el cual delega a la instancia real de `Socket.io` (`io.emit`).
- **Sustitución en pruebas**:
  - `NotificadorEspia` (`test/doubles.js`): Permite verificar que los eventos se emiten con los datos exactos sin levantar un servidor de sockets.
  - `NotificadorCaido` (`test/doubles.js`): Simula una falla en el canal de comunicación para certificar que el error no se silencia y se maneja adecuadamente.

Asimismo, los almacenes `pedidos` y `mesas` se inyectan en el constructor de `PedidoService`, permitiendo sustituirlos por dobles como `PedidosQueFallan` para verificar la resiliencia ante errores de persistencia.

---

## Estructura del Proyecto

### Backend (`SCD_TP_B`)

```text
SCD_TP_B/
├── index.js                          # Punto de arranque del servidor
├── package.json                      # Scripts: start, test, evidencia, format
├── src/
│   ├── app.js                        # Factory de la app e inyección de dependencias
│   ├── dominio/
│   │   ├── pedido.service.js         # Lógica central con contrato y validación defensiva
│   │   └── consistencia.js           # Verificación de invariante mesa <-> pedido
│   └── infraestructura/
│       ├── repositorios.js           # PedidosEnMemoria, MesasEnMemoria
│       └── notificador.js            # SocketNotificador (adaptador Socket.io)
├── test/
│   ├── doubles.js                    # NotificadorEspia, PedidosQueFallan, NotificadorCaido
│   ├── pedido.service.test.js        # 23 tests unitarios
│   └── integracion.test.js           # 4 tests de integración
├── scripts/
│   └── evidencia.js                  # Script de ejecución para evidencia
└── docs/
    ├── ejercicio-2-2.md              # Documento oficial con fichas y evidencias
    └── evidencia-ejercicio-2-2.txt   # Registro de consola generado
```

### Frontend (`SCD_TP_F`)

```text
SCD_TP_F/
└── src/
    └── App.jsx                       # Escucha 'respuesta_pedido' y maneja errores tipificados
```

---

## Guía de Verificación Rápida para Evaluadores

```bash
# 1. En SCD_TP_B: Ejecutar suite de pruebas (27 tests)
npm test

# 2. En SCD_TP_B: Regenerar archivo de evidencia
npm run evidencia

# 3. Levantar backend
npm start

# 4. En SCD_TP_F: Levantar frontend
npm run dev
```
