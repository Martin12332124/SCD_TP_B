// src/infraestructura/sincronizacion/cliente-supabase.js
// Adaptador hacia Supabase: el único archivo que conoce @supabase/supabase-js.
// El Sincronizador solo ve estos cuatro métodos; en los tests se reemplaza por un doble.
//
// Usa la llave secreta (service_role): salta RLS y es la única que puede ejecutar la
// función sincronizar_estado y marcar órdenes. Por eso vive solo en el .env del servidor
// local y nunca llega al navegador.

/** Tiempo máximo de cada petición. Sin esto, con el cable desconectado una petición
 *  puede quedar colgada minutos y bloquear las subidas siguientes. */
const TIEMPO_MAXIMO_MS = 10000;

/**
 * fetch con tiempo máximo: corta la petición si no hay respuesta en `ms`.
 * Respeta además la señal de cancelación que traiga la petición original.
 */
function fetchConTiempoMaximo(ms, fetchBase = globalThis.fetch) {
  return (recurso, opciones = {}) => {
    const senales = [AbortSignal.timeout(ms)];
    if (opciones.signal) senales.push(opciones.signal);
    return fetchBase(recurso, { ...opciones, signal: AbortSignal.any(senales) });
  };
}

/** Convierte el { error } de supabase-js en una excepción, para que el Sincronizador la capture. */
function lanzarSiError({ data, error }, operacion) {
  if (error) throw new Error(`${operacion}: ${error.message || error}`);
  return data;
}

/**
 * @param {object} opciones
 * @param {string} opciones.url - SUPABASE_URL
 * @param {string} opciones.llaveSecreta - SUPABASE_SECRET_KEY
 * @param {Function} [opciones.crearCliente] - createClient de supabase-js (inyectable en tests)
 * @param {number} [opciones.tiempoMaximoMs]
 */
function crearClienteSupabase({
  url,
  llaveSecreta,
  crearCliente = null,
  tiempoMaximoMs = TIEMPO_MAXIMO_MS
}) {
  if (!url || !llaveSecreta) throw new Error('Faltan SUPABASE_URL o SUPABASE_SECRET_KEY');
  // require aquí y no arriba: sin .env el servidor ni siquiera carga la librería.
  const createClient = crearCliente || require('@supabase/supabase-js').createClient;
  const supabase = createClient(url, llaveSecreta, {
    // Es un servidor, no un navegador: no hay sesión de usuario que guardar ni refrescar.
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fetchConTiempoMaximo(tiempoMaximoMs) }
  });

  return {
    /** Reemplaza el espejo de la nube por la foto local, en una sola transacción de Postgres. */
    async subirEstado(estado) {
      lanzarSiError(
        await supabase.rpc('sincronizar_estado', { p_estado: estado }),
        'sincronizar_estado'
      );
    },

    /** Órdenes pendientes, de la más antigua a la más nueva (orden de llegada). */
    async obtenerOrdenesPendientes() {
      const data = lanzarSiError(
        await supabase
          .from('ordenes_pendientes')
          .select('id, tipo, payload')
          .eq('estado', 'pendiente')
          .order('id', { ascending: true })
          .limit(100),
        'leer ordenes_pendientes'
      );
      return data || [];
    },

    /** Anota el resultado. Solo toca órdenes aún pendientes: marcar dos veces no cambia nada. */
    async marcarOrden(id, estado, resultado) {
      lanzarSiError(
        await supabase
          .from('ordenes_pendientes')
          .update({ estado, resultado, procesada_en: new Date().toISOString() })
          .eq('id', id)
          .eq('estado', 'pendiente'),
        'marcar orden'
      );
    },

    /**
     * Avisa cada vez que llega una orden nueva (Supabase Realtime) y también al conectarse
     * o reconectarse el canal, para recoger las que llegaron mientras no había internet.
     * @returns {() => void} función para dejar de escuchar
     */
    suscribirOrdenes(alAviso) {
      const canal = supabase
        .channel('ordenes-pendientes')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'ordenes_pendientes' },
          () => alAviso()
        )
        .subscribe((estadoCanal) => {
          if (estadoCanal === 'SUBSCRIBED') alAviso();
        });
      return () => {
        supabase.removeChannel(canal);
      };
    }
  };
}

module.exports = { crearClienteSupabase, fetchConTiempoMaximo, TIEMPO_MAXIMO_MS };
