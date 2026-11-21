-- supabase/esquema.sql
-- Réplica en la nube (Supabase, proyecto scd-tp-pos-kds) del sistema POS + KDS.
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar este archivo completo → Run.
-- Se puede ejecutar más de una vez: no borra datos ni falla si algo ya existe.
--
-- Modelo:
--   - mesas, menu_items, pedidos, pedido_items: ESPEJO de las tablas SQLite del servidor
--     local (mismos nombres de columnas). Solo las escribe el servidor local, a través de
--     la función sincronizar_estado(). La web pública solo las lee.
--   - ordenes_pendientes: BUZÓN. La web pública no modifica datos: deja aquí una orden
--     y el servidor local la aplica con sus reglas de dominio y anota el resultado.
--   - estado_sincronizacion: hora de la última subida exitosa del local (para mostrar
--     en la web qué tan actualizados están los datos si el local está sin internet).
--
-- Permisos ("Grant API access automatically" está desactivado, así que nada es accesible
-- hasta que se otorga aquí):
--   - anon (sin sesión): nada.
--   - authenticated (web pública con sesión): leer las tablas espejo y
--     estado_sincronizacion; insertar en ordenes_pendientes solo las columnas tipo y payload,
--     y leer SUS PROPIAS órdenes (para mostrar si el local las aplicó o rechazó, y por qué).
--   - service_role (llave secreta del servidor local): todo lo necesario para sincronizar.
--     service_role se salta RLS, pero igual necesita los GRANT.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Tablas espejo (mismas columnas que src/infraestructura/sqlite/esquema.sql)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.mesas (
  id     text    primary key,                 -- 'Mesa N'
  numero integer not null unique,
  estado text    not null check (estado in ('libre', 'ocupada'))
);

create table if not exists public.menu_items (
  id          integer primary key,
  nombre      text    not null,
  precio_base integer not null,
  disponible  boolean not null                -- en SQLite es 0/1
);

create table if not exists public.pedidos (
  mesa_id      text        primary key references public.mesas (id),
  estado       text        not null,          -- 'Recibido 📝' | 'En Cocina 🍳' | 'Listo 🍽️'
  estado_desde timestamptz                    -- en SQLite es texto ISO 8601
);

create table if not exists public.pedido_items (
  mesa_id     text    not null references public.pedidos (mesa_id) on delete cascade,
  posicion    integer not null,
  item_id     integer not null,
  nombre      text    not null,
  precio_base integer not null,
  cantidad    integer not null,
  primary key (mesa_id, posicion)
);

create table if not exists public.estado_sincronizacion (
  id                    smallint    primary key default 1 check (id = 1),  -- una sola fila
  ultima_sincronizacion timestamptz not null
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Buzón de órdenes (nube → local)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.ordenes_pendientes (
  id           bigint      generated always as identity primary key,  -- orden de aplicación
  tipo         text        not null check (tipo in (
                 'abrir_mesa', 'cerrar_mesa', 'agregar_mesa', 'quitar_mesa',
                 'confirmar_pedido', 'actualizar_estado', 'trasladar_pedido')),
  payload      jsonb       not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  creada_en    timestamptz not null default now(),
  creada_por   uuid        default auth.uid(),  -- usuario de Supabase Auth que la envió
  estado       text        not null default 'pendiente'
                 check (estado in ('pendiente', 'aplicada', 'rechazada')),
  resultado    jsonb,                           -- respuesta del servicio de dominio local
  procesada_en timestamptz
);

-- El servidor local busca "pendientes, por id": este índice lo hace directo.
create index if not exists ordenes_pendientes_por_estado
  on public.ordenes_pendientes (estado, id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Función de sincronización (la usa solo el servidor local)
-- ═══════════════════════════════════════════════════════════════════════════
-- Recibe la foto completa del estado local y deja el espejo igual a ella:
-- borra lo que ya no existe y hace upsert de lo demás. Todo en UNA transacción
-- (una función de Postgres siempre lo es): la web nunca ve el espejo a medias,
-- por ejemplo un pedido trasladado que ya salió de una mesa y aún no llegó a la otra.
--
-- Solo se actualizan las filas que de verdad cambiaron (is distinct from): así
-- Supabase Realtime avisa a la web solo de cambios reales, no cada 30 s de todo.

create or replace function public.sincronizar_estado(p_estado jsonb)
returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tabla text;
begin
  -- Protección: si falta una tabla en la foto, NO se interpreta como "está vacía"
  -- (eso borraría toda la nube por un error del cliente).
  foreach v_tabla in array array['mesas', 'menu_items', 'pedidos', 'pedido_items'] loop
    if jsonb_typeof(p_estado -> v_tabla) is distinct from 'array' then
      raise exception 'sincronizar_estado: falta el arreglo "%"', v_tabla;
    end if;
  end loop;

  -- 3.1 Borrar lo que ya no existe en local (hijos antes que padres, por las FK).
  delete from public.pedido_items t
  where not exists (
    select 1 from jsonb_to_recordset(p_estado -> 'pedido_items') as x (mesa_id text, posicion integer)
    where x.mesa_id = t.mesa_id and x.posicion = t.posicion);

  delete from public.pedidos t
  where not exists (
    select 1 from jsonb_to_recordset(p_estado -> 'pedidos') as x (mesa_id text)
    where x.mesa_id = t.mesa_id);

  delete from public.mesas t
  where not exists (
    select 1 from jsonb_to_recordset(p_estado -> 'mesas') as x (id text)
    where x.id = t.id);

  delete from public.menu_items t
  where not exists (
    select 1 from jsonb_to_recordset(p_estado -> 'menu_items') as x (id integer)
    where x.id = t.id);

  -- 3.2 Upsert de lo que existe (padres antes que hijos).
  insert into public.mesas as t (id, numero, estado)
  select x.id, x.numero, x.estado
  from jsonb_to_recordset(p_estado -> 'mesas') as x (id text, numero integer, estado text)
  on conflict (id) do update
    set numero = excluded.numero, estado = excluded.estado
    where (t.numero, t.estado) is distinct from (excluded.numero, excluded.estado);

  insert into public.menu_items as t (id, nombre, precio_base, disponible)
  select x.id, x.nombre, x.precio_base, x.disponible
  from jsonb_to_recordset(p_estado -> 'menu_items')
    as x (id integer, nombre text, precio_base integer, disponible boolean)
  on conflict (id) do update
    set nombre = excluded.nombre, precio_base = excluded.precio_base,
        disponible = excluded.disponible
    where (t.nombre, t.precio_base, t.disponible)
      is distinct from (excluded.nombre, excluded.precio_base, excluded.disponible);

  insert into public.pedidos as t (mesa_id, estado, estado_desde)
  select x.mesa_id, x.estado, x.estado_desde
  from jsonb_to_recordset(p_estado -> 'pedidos')
    as x (mesa_id text, estado text, estado_desde timestamptz)
  on conflict (mesa_id) do update
    set estado = excluded.estado, estado_desde = excluded.estado_desde
    where (t.estado, t.estado_desde) is distinct from (excluded.estado, excluded.estado_desde);

  insert into public.pedido_items as t (mesa_id, posicion, item_id, nombre, precio_base, cantidad)
  select x.mesa_id, x.posicion, x.item_id, x.nombre, x.precio_base, x.cantidad
  from jsonb_to_recordset(p_estado -> 'pedido_items')
    as x (mesa_id text, posicion integer, item_id integer, nombre text,
          precio_base integer, cantidad integer)
  on conflict (mesa_id, posicion) do update
    set item_id = excluded.item_id, nombre = excluded.nombre,
        precio_base = excluded.precio_base, cantidad = excluded.cantidad
    where (t.item_id, t.nombre, t.precio_base, t.cantidad)
      is distinct from (excluded.item_id, excluded.nombre, excluded.precio_base, excluded.cantidad);

  insert into public.estado_sincronizacion (id, ultima_sincronizacion)
  values (1, now())
  on conflict (id) do update set ultima_sincronizacion = excluded.ultima_sincronizacion;

  return now();
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Permisos (GRANT): qué puede tocar cada rol a través de la API
-- ═══════════════════════════════════════════════════════════════════════════

-- Partir de cero: nadie tiene nada sobre estas tablas.
revoke all on public.mesas, public.menu_items, public.pedidos, public.pedido_items,
  public.estado_sincronizacion, public.ordenes_pendientes from anon, authenticated, service_role;

-- Postgres da EXECUTE sobre las funciones nuevas a PUBLIC (todos los roles).
-- Sin este revoke, cualquier usuario de la web podría reescribir el espejo completo.
revoke all on function public.sincronizar_estado(jsonb) from public, anon, authenticated;
grant execute on function public.sincronizar_estado(jsonb) to service_role;

-- Servidor local (llave secreta).
grant select, insert, update, delete on public.mesas, public.menu_items, public.pedidos,
  public.pedido_items, public.estado_sincronizacion to service_role;
grant select, update on public.ordenes_pendientes to service_role;

-- Web pública con sesión: leer el espejo.
grant select on public.mesas, public.menu_items, public.pedidos, public.pedido_items,
  public.estado_sincronizacion to authenticated;
-- ...y dejar órdenes. GRANT por columna: solo tipo y payload. id, estado, resultado,
-- creada_en, creada_por y procesada_en los pone la base o el servidor, nunca la web.
grant insert (tipo, payload) on public.ordenes_pendientes to authenticated;
-- ...y leer sus órdenes (la política de abajo limita a las propias). Así la web recibe el
-- id al insertar y luego consulta si el local la aplicó o la rechazó, con el motivo.
grant select on public.ordenes_pendientes to authenticated;
grant usage on sequence public.ordenes_pendientes_id_seq to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. RLS (Row Level Security): qué filas ve cada rol
-- ═══════════════════════════════════════════════════════════════════════════
-- El GRANT dice "qué operación"; la política dice "sobre qué filas". Con RLS activo y
-- sin política, el resultado es "ninguna fila", aunque haya GRANT.

alter table public.mesas                 enable row level security;
alter table public.menu_items            enable row level security;
alter table public.pedidos               enable row level security;
alter table public.pedido_items          enable row level security;
alter table public.estado_sincronizacion enable row level security;
alter table public.ordenes_pendientes    enable row level security;

drop policy if exists "leer con sesion" on public.mesas;
create policy "leer con sesion" on public.mesas
  for select to authenticated using (true);

drop policy if exists "leer con sesion" on public.menu_items;
create policy "leer con sesion" on public.menu_items
  for select to authenticated using (true);

drop policy if exists "leer con sesion" on public.pedidos;
create policy "leer con sesion" on public.pedidos
  for select to authenticated using (true);

drop policy if exists "leer con sesion" on public.pedido_items;
create policy "leer con sesion" on public.pedido_items
  for select to authenticated using (true);

drop policy if exists "leer con sesion" on public.estado_sincronizacion;
create policy "leer con sesion" on public.estado_sincronizacion
  for select to authenticated using (true);

-- Insertar órdenes: solo a nombre propio (creada_por la llena auth.uid() por defecto).
drop policy if exists "enviar orden propia" on public.ordenes_pendientes;
create policy "enviar orden propia" on public.ordenes_pendientes
  for insert to authenticated
  with check (creada_por = (select auth.uid()));
-- Leer: solo las órdenes propias. Las de otros usuarios no se ven.
drop policy if exists "leer orden propia" on public.ordenes_pendientes;
create policy "leer orden propia" on public.ordenes_pendientes
  for select to authenticated
  using (creada_por = (select auth.uid()));
-- No hay políticas de update/delete para authenticated: no puede cambiar ni borrar
-- órdenes. service_role no necesita políticas (se salta RLS).

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Realtime: qué tablas avisan sus cambios
-- ═══════════════════════════════════════════════════════════════════════════
-- Espejo → la web se actualiza sola. ordenes_pendientes → el servidor local se entera
-- al instante de una orden nueva (además revisa cada 30 s por si Realtime falla).
-- Realtime respeta RLS: cada cliente recibe solo lo que puede leer.

do $$
declare
  v_tabla text;
begin
  foreach v_tabla in array array['mesas', 'menu_items', 'pedidos', 'pedido_items',
                                 'estado_sincronizacion', 'ordenes_pendientes'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_tabla
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_tabla);
    end if;
  end loop;
end;
$$;
