// test/cliente-supabase.test.js
// Pruebas del adaptador hacia Supabase sin red: createClient se reemplaza por un falso
// que anota qué consulta se armó. Se verifica que el adaptador pida lo correcto y que
// convierta los { error } de supabase-js en excepciones (así el Sincronizador las ve).

const {
  crearClienteSupabase,
  fetchConTiempoMaximo,
  TIEMPO_MAXIMO_MS
} = require('../src/infraestructura/sincronizacion/cliente-supabase');

/** Consulta encadenable falsa: anota cada método y al final resuelve con `respuesta`. */
function consultaFalsa(respuesta, llamadas) {
  const consulta = {
    then: (resolver, rechazar) => Promise.resolve(respuesta).then(resolver, rechazar)
  };
  for (const metodo of ['select', 'update', 'eq', 'order', 'limit']) {
    consulta[metodo] = (...args) => {
      llamadas.push([metodo, ...args]);
      return consulta;
    };
  }
  return consulta;
}

function supabaseFalso({ respuesta = { data: null, error: null } } = {}) {
  const llamadas = [];
  const canal = {
    on: (...args) => {
      llamadas.push(['on', ...args]);
      canal._alCambio = args[2];
      return canal;
    },
    subscribe: (alEstado) => {
      canal._alEstado = alEstado;
      return canal;
    }
  };
  const cliente = {
    rpc: (...args) => {
      llamadas.push(['rpc', ...args]);
      return Promise.resolve(respuesta);
    },
    from: (tabla) => {
      llamadas.push(['from', tabla]);
      return consultaFalsa(respuesta, llamadas);
    },
    channel: (nombre) => {
      llamadas.push(['channel', nombre]);
      return canal;
    },
    removeChannel: (c) => llamadas.push(['removeChannel', c === canal])
  };
  const crearCliente = jest.fn(() => cliente);
  return { crearCliente, llamadas, canal };
}

const crear = (falso) =>
  crearClienteSupabase({
    url: 'https://ejemplo.supabase.co',
    llaveSecreta: 'llave-de-prueba',
    crearCliente: falso.crearCliente
  });

describe('crearClienteSupabase', () => {
  test('sin URL o sin llave no crea nada', () => {
    expect(() => crearClienteSupabase({ url: '', llaveSecreta: 'x' })).toThrow('SUPABASE_URL');
    expect(() => crearClienteSupabase({ url: 'x' })).toThrow('SUPABASE_SECRET_KEY');
  });

  test('crea el cliente de servidor: sin sesión persistente y con fetch con tiempo máximo', () => {
    const falso = supabaseFalso();
    crear(falso);
    const [url, llave, opciones] = falso.crearCliente.mock.calls[0];
    expect(url).toBe('https://ejemplo.supabase.co');
    expect(llave).toBe('llave-de-prueba');
    expect(opciones.auth).toEqual({
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    });
    expect(typeof opciones.global.fetch).toBe('function');
  });

  test('subirEstado llama a la función sincronizar_estado con la foto completa', async () => {
    const falso = supabaseFalso();
    const foto = { mesas: [], menu_items: [], pedidos: [], pedido_items: [] };
    await crear(falso).subirEstado(foto);
    expect(falso.llamadas).toEqual([['rpc', 'sincronizar_estado', { p_estado: foto }]]);
  });

  test('obtenerOrdenesPendientes llama a la función de la base y agrega edadMs y leidaEn', async () => {
    const filas = [
      { id: 1, tipo: 'abrir_mesa', payload: { numero: 1 }, edad_ms: 2500 },
      { id: 2, tipo: 'cerrar_mesa', payload: { numero: 1 }, edad_ms: '40' }
    ];
    const falso = supabaseFalso({ respuesta: { data: filas, error: null } });
    const cliente = crearClienteSupabase({
      url: 'https://ejemplo.supabase.co',
      llaveSecreta: 'llave-de-prueba',
      crearCliente: falso.crearCliente,
      relojMonotono: () => 777
    });
    // La edad la mide la base (no el reloj de este PC); leidaEn es el reloj monótono local.
    expect(await cliente.obtenerOrdenesPendientes()).toEqual([
      { id: 1, tipo: 'abrir_mesa', payload: { numero: 1 }, edadMs: 2500, leidaEn: 777 },
      { id: 2, tipo: 'cerrar_mesa', payload: { numero: 1 }, edadMs: 40, leidaEn: 777 }
    ]);
    expect(falso.llamadas).toEqual([['rpc', 'ordenes_pendientes_con_edad']]);
  });

  test('obtenerOrdenesPendientes sin datos devuelve un arreglo vacío', async () => {
    expect(await crear(supabaseFalso()).obtenerOrdenesPendientes()).toEqual([]);
  });

  test('marcarOrden actualiza solo si la orden sigue pendiente', async () => {
    const falso = supabaseFalso();
    await crear(falso).marcarOrden(5, 'aplicada', { ok: true });
    expect(falso.llamadas).toEqual([
      ['from', 'ordenes_pendientes'],
      ['update', { estado: 'aplicada', resultado: { ok: true }, procesada_en: expect.any(String) }],
      ['eq', 'id', 5],
      ['eq', 'estado', 'pendiente']
    ]);
  });

  test('un { error } de Supabase se convierte en excepción', async () => {
    const falso = supabaseFalso({ respuesta: { data: null, error: { message: 'fetch failed' } } });
    const cliente = crear(falso);
    await expect(cliente.subirEstado({})).rejects.toThrow('sincronizar_estado: fetch failed');
    await expect(cliente.obtenerOrdenesPendientes()).rejects.toThrow('fetch failed');
    await expect(cliente.marcarOrden(1, 'aplicada', {})).rejects.toThrow('marcar orden');
  });

  test('suscribirOrdenes avisa con cada INSERT y al conectarse, y se puede cancelar', () => {
    const falso = supabaseFalso();
    const alAviso = jest.fn();
    const cancelar = crear(falso).suscribirOrdenes(alAviso);

    expect(falso.llamadas).toContainEqual([
      'on',
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'ordenes_pendientes' },
      expect.any(Function)
    ]);
    falso.canal._alEstado('SUBSCRIBED'); // conectó o reconectó
    falso.canal._alEstado('CHANNEL_ERROR'); // un error no avisa
    falso.canal._alCambio({ new: { id: 1 } }); // llegó una orden
    expect(alAviso).toHaveBeenCalledTimes(2);

    cancelar();
    expect(falso.llamadas).toContainEqual(['removeChannel', true]);
  });
});

describe('fetchConTiempoMaximo', () => {
  test('pasa la petición y agrega una señal de cancelación', async () => {
    const fetchBase = jest.fn(async () => 'respuesta');
    const f = fetchConTiempoMaximo(1000, fetchBase);
    expect(await f('https://x', { method: 'POST' })).toBe('respuesta');
    const [, opciones] = fetchBase.mock.calls[0];
    expect(opciones.method).toBe('POST');
    expect(opciones.signal).toBeInstanceOf(AbortSignal);
  });

  test('corta la petición si no hay respuesta a tiempo (cable desconectado)', async () => {
    const colgado = (url, { signal }) =>
      new Promise((_, rechazar) => signal.addEventListener('abort', () => rechazar(signal.reason)));
    const f = fetchConTiempoMaximo(20, colgado);
    await expect(f('https://x')).rejects.toThrow();
  });

  test('respeta la cancelación que traiga la petición original', async () => {
    const controlador = new AbortController();
    const colgado = (url, { signal }) =>
      new Promise((_, rechazar) => signal.addEventListener('abort', () => rechazar(signal.reason)));
    const promesa = fetchConTiempoMaximo(TIEMPO_MAXIMO_MS, colgado)('https://x', {
      signal: controlador.signal
    });
    controlador.abort(new Error('cancelada'));
    await expect(promesa).rejects.toThrow('cancelada');
  });
});
