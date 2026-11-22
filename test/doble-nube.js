// test/doble-nube.js
// Doble de Supabase para probar la sincronización sin red.
// Implementa el mismo "puerto" que cliente-supabase.js (subirEstado, obtenerOrdenesPendientes,
// marcarOrden, suscribirOrdenes) guardando todo en memoria.
//
// `sinInternet = true` hace que cada llamada falle como fallaría fetch sin conexión:
// así se prueba el corte y la reconexión de forma determinista.

class NubeEnMemoria {
  constructor() {
    this.sinInternet = false;
    /** Última foto recibida (lo que "hay en Supabase"). */
    this.estado = null;
    /** Cantidad de subidas exitosas. */
    this.subidas = 0;
    /** Buzón: { id, tipo, payload, estado, resultado }. */
    this.ordenes = [];
    this._siguienteId = 1;
    this._alAviso = null;
    /** Si se define, marcarOrden falla después de N llamadas exitosas (corte a la mitad). */
    this.fallarMarcarDespuesDe = null;
    this._marcadas = 0;
    /**
     * Reloj de la "base de Supabase", en ms. Solo avanza con `avanzar`: así un test puede
     * hacer que una orden "espere horas" sin esperar de verdad.
     */
    this.relojMs = 0;
  }

  /** Pasa el tiempo en la nube (las órdenes pendientes envejecen). */
  avanzar(ms) {
    this.relojMs += ms;
  }

  _verificarRed() {
    if (this.sinInternet) throw new TypeError('fetch failed');
  }

  async subirEstado(estado) {
    this._verificarRed();
    // Copia profunda: la nube no comparte objetos con el local.
    this.estado = JSON.parse(JSON.stringify(estado));
    this.subidas++;
  }

  async obtenerOrdenesPendientes() {
    this._verificarRed();
    return this.ordenes
      .filter((o) => o.estado === 'pendiente')
      .sort((a, b) => a.id - b.id)
      .map(({ id, tipo, payload, creadaMs }) => ({
        id,
        tipo,
        payload,
        // Como el cliente real: la edad la mide la "base", y `leidaEn` es el reloj monótono
        // del local en el instante de la consulta.
        edadMs: this.relojMs - creadaMs,
        leidaEn: performance.now()
      }));
  }

  async marcarOrden(id, estado, resultado) {
    this._verificarRed();
    if (this.fallarMarcarDespuesDe !== null && this._marcadas >= this.fallarMarcarDespuesDe) {
      throw new TypeError('fetch failed');
    }
    this._marcadas++;
    const orden = this.ordenes.find((o) => o.id === id && o.estado === 'pendiente');
    if (orden) Object.assign(orden, { estado, resultado });
  }

  suscribirOrdenes(alAviso) {
    this._alAviso = alAviso;
    return () => {
      this._alAviso = null;
    };
  }

  /** Lo que haría la web pública: dejar una orden en el buzón (funciona aunque el local esté sin internet). */
  insertarOrden(tipo, payload) {
    const orden = {
      id: this._siguienteId++,
      tipo,
      payload,
      estado: 'pendiente',
      resultado: null,
      creadaMs: this.relojMs
    };
    this.ordenes.push(orden);
    // Realtime solo llega si el local tiene internet.
    if (this._alAviso && !this.sinInternet) this._alAviso();
    return orden;
  }
}

/** Consola silenciosa que guarda los mensajes, para no ensuciar la salida de Jest. */
function consolaEspia() {
  const mensajes = [];
  return {
    mensajes,
    log: (m) => mensajes.push(['log', m]),
    warn: (m) => mensajes.push(['warn', m])
  };
}

/** Espera a que terminen los temporizadores cortos y las promesas pendientes. */
const esperar = (ms = 30) => new Promise((r) => setTimeout(r, ms));

module.exports = { NubeEnMemoria, consolaEspia, esperar };
