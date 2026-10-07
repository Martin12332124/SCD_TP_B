// scripts/evidencia.js
// Script de evidencia para el ejercicio 2.2
// Ejecuta un caso válido y dos inválidos, e imprime y guarda los resultados en UTF-8 estándar.
// Ejecutar: npm run evidencia

const fs = require('fs');
const path = require('path');
const { PedidoService } = require('../src/dominio/pedido.service');
const { PedidosEnMemoria, MesasEnMemoria } = require('../src/infraestructura/repositorios');
const { NotificadorEspia } = require('../test/doubles');

const pedidos = new PedidosEnMemoria();
const mesas = new MesasEnMemoria(10);
const notificador = new NotificadorEspia();
const servicio = new PedidoService({ pedidos, mesas, notificador });

const lineas = [];
function registrar(texto = '') {
  console.log(texto);
  lineas.push(texto);
}

registrar('===============================================================');
registrar('  EVIDENCIA - Ejercicio 2.2: Operacion 1 (actualizarEstado)');
registrar('  PedidoService con dependencias explicitas');
registrar('===============================================================\n');

// --- CASO VALIDO -------------------------------------------------------------
registrar('--- CASO VALIDO: Ciclo completo Mesa 3 ---');
registrar('1. Recibido 📝:');
let r = servicio.actualizarEstado({ mesa: 'Mesa 3', estado: 'Recibido 📝' });
registrar(`   Resultado: ${JSON.stringify(r)}`);
registrar(`   Mesa 3 estado: ${mesas.obtener('Mesa 3').estado}`);

registrar('2. En Cocina 🍳:');
r = servicio.actualizarEstado({ mesa: 'Mesa 3', estado: 'En Cocina 🍳' });
registrar(`   Resultado: ${JSON.stringify(r)}`);

registrar('3. Listo 🍽️:');
r = servicio.actualizarEstado({ mesa: 'Mesa 3', estado: 'Listo 🍽️' });
registrar(`   Resultado: ${JSON.stringify(r)}`);
registrar(`   Mesa 3 estado: ${mesas.obtener('Mesa 3').estado}`);
registrar(`   Pedido vigente: ${JSON.stringify(pedidos.obtener('Mesa 3'))}`);
registrar(`   Eventos emitidos: ${notificador.eventos.length}`);
registrar();

// --- CASO INVALIDO 1: formato de mesa incorrecto ----------------------------
registrar('--- CASO INVALIDO 1: mesa con formato incorrecto ---');
r = servicio.actualizarEstado({ mesa: 'Mesa ', estado: 'Recibido 📝' });
registrar('   Entrada: { mesa: "Mesa ", estado: "Recibido 📝" }');
registrar(`   Resultado: ${JSON.stringify(r)}`);
registrar();

// --- CASO INVALIDO 2: transicion de estado no permitida ---------------------
registrar('--- CASO INVALIDO 2: transicion no permitida ---');
servicio.actualizarEstado({ mesa: 'Mesa 3', estado: 'Recibido 📝' });
r = servicio.actualizarEstado({ mesa: 'Mesa 3', estado: 'Listo 🍽️' });
registrar('   Entrada: { mesa: "Mesa 3", estado: "Listo 🍽️" } con mesa en Recibido');
registrar(`   Resultado: ${JSON.stringify(r)}`);
registrar();

// --- CASO EXTRA: mesa como numero (antes lanzaba TypeError) -----------------
registrar('--- CASO EXTRA: mesa como numero (no tumba el servidor) ---');
r = servicio.actualizarEstado({ mesa: 5 });
registrar('   Entrada: { mesa: 5 }');
registrar(`   Resultado: ${JSON.stringify(r)}`);
registrar();

registrar('===============================================================');
registrar('  Todos los casos ejecutados sin errores no controlados.');
registrar('===============================================================');

// Guardar directamente en docs/evidencia-ejercicio-2-2.txt en UTF-8 puro sin BOM
const rutaDestino = path.join(__dirname, '..', 'docs', 'evidencia-ejercicio-2-2.txt');
fs.writeFileSync(rutaDestino, lineas.join('\n') + '\n', { encoding: 'utf8' });
console.log(`\n[OK] Archivo guardado correctamente en: ${rutaDestino}`);
