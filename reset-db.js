/**
 * reset-db.js — Limpia el estado operativo de la base de datos sin borrar el menú.
 *
 * Uso:
 *   node reset-db.js          → limpia pedidos y libera mesas (modo suave)
 *   node reset-db.js --full   → borra TODO y recrea desde cero (menú incluido)
 *
 * Ejecutar con el servidor DETENIDO.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'restaurante.db');
const modo = process.argv.includes('--full') ? 'full' : 'soft';

if (!fs.existsSync(DB_PATH)) {
  console.log('❌ No se encontró restaurante.db. Nada que limpiar.');
  process.exit(0);
}

const db = new Database(DB_PATH);
db.pragma('foreign_keys = OFF');

if (modo === 'full') {
  // ── Modo FULL: borrar la BD completa ────────────────────────────────────────
  console.log('\n🗑️  Modo FULL: borrando toda la base de datos...');
  db.close();
  fs.unlinkSync(DB_PATH);
  console.log('✅ restaurante.db eliminado.');
  console.log('   La próxima vez que levantes el servidor se recreará con los datos de ejemplo.\n');
} else {
  // ── Modo SOFT: limpiar pedidos y liberar mesas, conservar menú e ingredientes ─
  console.log('\n🧹 Modo SOFT: limpiando pedidos y liberando mesas...');

  const resetSoft = db.transaction(() => {
    // 1. Borrar ventas del día
    const ventas = db.prepare('DELETE FROM ventas_dia').run();
    console.log(`   · ventas_dia:    ${ventas.changes} filas eliminadas`);

    // 2. Borrar ítems de pedidos (CASCADE los elimina con los pedidos,
    //    pero lo hacemos explícito para claridad)
    const items = db.prepare('DELETE FROM pedido_items').run();
    console.log(`   · pedido_items:  ${items.changes} filas eliminadas`);

    // 3. Borrar pedidos
    const pedidos = db.prepare('DELETE FROM pedidos').run();
    console.log(`   · pedidos:       ${pedidos.changes} filas eliminadas`);

    // 4. Liberar todas las mesas
    const mesas = db.prepare("UPDATE mesas SET estado = 'libre'").run();
    console.log(`   · mesas:         ${mesas.changes} mesa(s) liberadas`);

    // 5. Resetear autoincrement de pedidos y ventas
    db.prepare(
      "DELETE FROM sqlite_sequence WHERE name IN ('pedidos','pedido_items','ventas_dia')"
    ).run();
  });

  resetSoft();
  db.pragma('foreign_keys = ON');
  db.close();

  console.log('\n✅ Base de datos limpia. Menú, ingredientes y modificadores conservados.');
  console.log('   Podés levantar el servidor normalmente.\n');
}
