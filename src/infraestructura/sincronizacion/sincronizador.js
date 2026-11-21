// src/infraestructura/sincronizacion/sincronizador.js
// Mantiene la réplica de Supabase al día y trae las órdenes del buzón.
//
// El servidor local es la autoridad: la nube es un espejo. Por eso:
//   - Local → nube: se sube el estado COMPLETO (no los cambios). Si una subida se pierde
//     porque no hay internet, la siguiente la corrige sola: no hay nada que "reproducir".
//   - Nube → local: la web no escribe datos, deja órdenes. Se aplican aquí, en orden de id,
//     con los mismos servicios de dominio que usa el POS.
//   - Sin internet: cada intento falla en silencio (un aviso al cortarse y otro al volver)
//     y se reintenta cada `intervaloMs`. El POS no se entera: nunca espera a la nube.
//
// No conoce Supabase ni el dominio: recibe un `cliente` (subirEstado, obtenerOrdenesPendientes,
// marcarOrden, suscribirOrdenes), una función que lee el estado local y otra que aplica
// una orden. Así se prueba con dobles, sin red.

/**
 * Envuelve una tarea asíncrona para que nunca corra dos veces a la vez.
 * Si la piden mientras corre, se anota y corre una vez más al terminar (no una por pedido):
 * diez confirmaciones seguidas durante una subida lenta generan UNA subida extra, no diez.
 * La tarea devuelve false para indicar que falló y que no vale la pena repetirla ya.
 */
function tareaSinSolapamiento(tarea) {
  let enCurso = null;
  let otraVez = false;
  return function ejecutar() {
    if (enCurso) {
      otraVez = true;
      return enCurso;
    }
    enCurso = (async () => {
      try {
        do {
          otraVez = false;
          if ((await tarea()) === false) otraVez = false;
        } while (otraVez);
      } finally {
        enCurso = null;
      }
    })();
    return enCurso;
  };
}

class Sincronizador {
  /**
   * @param {object} deps
   * @param {object} deps.cliente - Puerto hacia la nube (ver cliente-supabase.js)
   * @param {() => object} deps.leerEstado - Foto del estado local (ver estado-local.js)
   * @param {(orden: object) => { estado: string, resultado: object }} deps.aplicarOrden
   * @param {number} [deps.intervaloMs=30000] - Cada cuánto se sube el estado y se revisa el
   *   buzón aunque no haya avisos (respaldo de Realtime y reintento sin internet)
   * @param {number} [deps.esperaMs=300] - Pausa tras un cambio antes de subir, para juntar
   *   en una sola subida las transacciones que llegan seguidas
   * @param {() => string} [deps.reloj]
   * @param {{ log: Function, warn: Function }} [deps.consola]
   */
  constructor({
    cliente,
    leerEstado,
    aplicarOrden,
    intervaloMs = 30000,
    esperaMs = 300,
    reloj = () => new Date().toISOString(),
    consola = console
  }) {
    if (!cliente) throw new Error('Dependencia requerida: cliente');
    if (!leerEstado) throw new Error('Dependencia requerida: leerEstado');
    if (!aplicarOrden) throw new Error('Dependencia requerida: aplicarOrden');
    this._cliente = cliente;
    this._leerEstado = leerEstado;
    this._aplicarOrden = aplicarOrden;
    this._intervaloMs = intervaloMs;
    this._esperaMs = esperaMs;
    this._reloj = reloj;
    this._consola = consola;

    /** Hora (ISO) de la última subida exitosa; null si todavía no hay ninguna. */
    this.ultimaSincronizacion = null;
    /** null = aún no se intenta; true/false = resultado del último contacto con la nube. */
    this.enLinea = null;

    this._intervalo = null;
    this._espera = null;
    this._cancelarSuscripcion = null;

    this.subirEstado = tareaSinSolapamiento(() => this._subirUnaVez());
    this.procesarOrdenes = tareaSinSolapamiento(() => this._procesarUnaVez());
  }

  /**
   * Empieza a sincronizar: escucha el buzón (Realtime), programa el ciclo de respaldo y
   * hace un primer ciclo (pone al día la nube con lo que pasó mientras el servidor estuvo
   * apagado). Devuelve la promesa de ese primer ciclo.
   */
  iniciar() {
    if (this._intervalo) return Promise.resolve();
    this._intervalo = setInterval(() => this.ciclo(), this._intervaloMs);
    this._intervalo.unref?.();
    try {
      this._cancelarSuscripcion = this._cliente.suscribirOrdenes(() => this.procesarOrdenes());
    } catch (error) {
      // Sin Realtime igual funciona: el ciclo revisa el buzón cada intervaloMs.
      this._consola.warn(`[SYNC] No se pudo escuchar el buzón en tiempo real: ${error.message}`);
    }
    return this.ciclo();
  }

  /** Detiene temporizadores y la suscripción (apagado del servidor y tests). */
  detener() {
    clearInterval(this._intervalo);
    clearTimeout(this._espera);
    this._intervalo = null;
    this._espera = null;
    if (this._cancelarSuscripcion) {
      try {
        this._cancelarSuscripcion();
      } catch {
        // Apagando: si la nube no responde, no importa.
      }
      this._cancelarSuscripcion = null;
    }
  }

  /** Un ciclo completo: primero aplica las órdenes pendientes y luego sube el estado. */
  async ciclo() {
    await this.procesarOrdenes();
    await this.subirEstado();
  }

  /**
   * Avisa que hubo una transacción confirmada. La subida se hace un instante después
   * (esperaMs) y no en el acto: así no se bloquea al caso de uso que acaba de terminar
   * y varias transacciones seguidas viajan en una sola subida.
   */
  marcarCambio() {
    clearTimeout(this._espera);
    this._espera = setTimeout(() => {
      this._espera = null;
      this.subirEstado();
    }, this._esperaMs);
    this._espera.unref?.();
  }

  /** Para mostrar o registrar en qué está la sincronización. */
  estado() {
    return { enLinea: this.enLinea, ultimaSincronizacion: this.ultimaSincronizacion };
  }

  async _subirUnaVez() {
    try {
      await this._cliente.subirEstado(this._leerEstado());
    } catch (error) {
      this._sinConexion(error);
      return false;
    }
    this.ultimaSincronizacion = this._reloj();
    this._conConexion();
    return true;
  }

  async _procesarUnaVez() {
    let ordenes;
    try {
      ordenes = await this._cliente.obtenerOrdenesPendientes();
    } catch (error) {
      this._sinConexion(error);
      return false;
    }

    for (const orden of ordenes) {
      // Aplicar es local y síncrono: no depende de internet.
      const { estado, resultado } = this._aplicarOrden(orden);
      if (estado === 'rechazada') {
        this._consola.warn(
          `[SYNC] Orden ${orden.id} (${orden.tipo}) rechazada: ${resultado.tipo} ${resultado.error}`
        );
      }
      try {
        await this._cliente.marcarOrden(orden.id, estado, resultado);
      } catch (error) {
        // Se cortó a la mitad: el resto espera al próximo ciclo. Esta orden ya quedó en el
        // registro local, así que al reintentar solo se reenvía su resultado.
        this._sinConexion(error);
        return false;
      }
    }
    this._conConexion();
    return true;
  }

  _sinConexion(error) {
    if (this.enLinea !== false) {
      const segundos = Math.round(this._intervaloMs / 1000);
      this._consola.warn(
        `[SYNC] Sin conexión con Supabase (${error.message}). El local sigue funcionando; ` +
          `se reintenta cada ${segundos} s.`
      );
    }
    this.enLinea = false;
  }

  _conConexion() {
    if (this.enLinea === false) {
      this._consola.log('[SYNC] Conexión con Supabase restablecida.');
    } else if (this.enLinea === null) {
      this._consola.log('[SYNC] Sincronizando con Supabase.');
    }
    this.enLinea = true;
  }
}

/**
 * Notificador que, además de emitir el evento, avisa que hubo un cambio.
 * Va debajo del NotificadorTransaccional: este solo deja pasar los eventos después del
 * COMMIT, así que cada aviso significa "hay una transacción confirmada que subir".
 */
class NotificadorConAviso {
  /**
   * @param {{ emitir: Function }} notificador - El notificador real (SocketNotificador)
   * @param {(evento: string) => void} alEmitir
   */
  constructor(notificador, alEmitir) {
    this._notificador = notificador;
    this._alEmitir = alEmitir;
  }

  emitir(evento, datos) {
    try {
      this._notificador.emitir(evento, datos);
    } finally {
      this._alEmitir(evento);
    }
  }
}

module.exports = { Sincronizador, NotificadorConAviso, tareaSinSolapamiento };
