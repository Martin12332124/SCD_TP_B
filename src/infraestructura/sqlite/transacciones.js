// src/infraestructura/sqlite/transacciones.js
// Atomicidad de los casos de uso (REF-09) sin modificar los servicios del dominio.
//
// Un caso de uso como confirmarPedido o trasladarPedido hace varias escrituras
// seguidas. Si el servidor se cae entre una y otra, la base quedaría a medias
// (ej. un pedido en dos mesas). Para evitarlo, cada método de escritura de los
// servicios se ejecuta dentro de una transacción de SQLite: o se guardan todas
// sus escrituras, o ninguna.
//
// Además, los eventos de tiempo real se retienen hasta el COMMIT: así ningún
// cliente se entera de un cambio que todavía no está guardado, o que se deshizo.

/**
 * Notificador que retiene los eventos mientras hay una transacción abierta
 * y los publica, en el mismo orden, cuando la transacción se confirma.
 * Fuera de una transacción emite de inmediato.
 */
class NotificadorTransaccional {
  /** @param {{ emitir: Function }} notificador - Notificador real (ej. SocketNotificador) */
  constructor(notificador) {
    this._notificador = notificador;
    this._pendientes = null;
  }

  emitir(evento, datos) {
    if (this._pendientes) {
      this._pendientes.push({ evento, datos });
    } else {
      this._notificador.emitir(evento, datos);
    }
  }

  /** Empieza a retener eventos. */
  retener() {
    this._pendientes = [];
  }

  /** Cantidad de eventos retenidos (para descartar solo los de una transacción anidada). */
  marca() {
    return this._pendientes ? this._pendientes.length : 0;
  }

  /** Descarta los eventos retenidos desde la marca indicada. */
  descartarDesde(marca) {
    if (this._pendientes) this._pendientes.length = marca;
  }

  /** Deja de retener y publica los eventos retenidos. */
  publicar() {
    const pendientes = this._pendientes || [];
    this._pendientes = null;
    for (const { evento, datos } of pendientes) {
      this._notificador.emitir(evento, datos);
    }
  }

  /** Deja de retener y descarta todos los eventos retenidos. */
  descartar() {
    this._pendientes = null;
  }
}

/**
 * Reemplaza los métodos indicados del servicio por versiones que se ejecutan
 * dentro de una transacción.
 *
 * - Si el método termina bien: COMMIT y luego se publican sus eventos.
 * - Si lanza un error: ROLLBACK (no queda ninguna de sus escrituras), se descartan
 *   sus eventos y el error se propaga igual que antes.
 * - Si un método envuelto llama a otro (confirmarPedido → actualizarEstado), el
 *   interno corre como transacción anidada (SAVEPOINT) dentro de la externa.
 *
 * @param {import('better-sqlite3').Database} db - La conexión que comparten los repositorios
 * @param {NotificadorTransaccional} notificador - El mismo que se inyectó al servicio
 * @param {object} servicio - Instancia del servicio de dominio
 * @param {string[]} metodos - Nombres de los métodos que escriben
 */
function envolverEnTransaccion(db, notificador, servicio, metodos) {
  for (const nombre of metodos) {
    const enTransaccion = db.transaction(servicio[nombre].bind(servicio));

    servicio[nombre] = (...args) => {
      if (db.inTransaction) {
        // Anidada: si falla, se descartan solo los eventos que emitió ella.
        const marca = notificador.marca();
        try {
          return enTransaccion(...args);
        } catch (error) {
          notificador.descartarDesde(marca);
          throw error;
        }
      }

      notificador.retener();
      let resultado;
      try {
        resultado = enTransaccion(...args);
      } catch (error) {
        notificador.descartar();
        throw error;
      }
      notificador.publicar();
      return resultado;
    };
  }
}

module.exports = { NotificadorTransaccional, envolverEnTransaccion };
