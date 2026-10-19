-- Check-in digital del hotel (Supabase / Postgres).
-- SOLO AGREGA tablas y funciones nuevas: no toca nada de lo que ya existe (contenido, admin, historial, intentos).
-- Para rehacerlo en otro proyecto: ejecutar primero schema.sql y después este archivo, de arriba hacia abajo.
--
-- Cómo funciona:
--   * Todo lo que guarda datos de huéspedes vive en el esquema `private`, sin acceso directo desde afuera.
--   * Se entra únicamente por funciones de `public` que verifican quién llama:
--       huésped    -> con un código de 6 números que muestra recepción (checkin_*)
--       recepción  -> con su propia clave, que solo cambia el admin general (recepcion_*)
--       admin      -> con la clave de admin de siempre (admin_checkin_*, admin_huesped*)
--   * Los intentos fallidos se frenan por IP. Nada se borra: no hay funciones para eso.
--   * La foto del documento NO se guarda acá: va a una carpeta de Drive; en la base queda solo el id y el nombre.

-- ---------------------------------------------------------------- tablas

create table if not exists private.checkin_config (
  id int primary key check (id = 1),
  activo boolean not null default false,
  codigo_seg int not null default 15 check (codigo_seg between 5 and 300),
  usos_max int not null default 3 check (usos_max between 1 and 20),
  edicion_activa boolean not null default true,
  edicion_min int not null default 10 check (edicion_min between 1 and 1440),
  dias_recepcion int not null default 3 check (dias_recepcion between 1 and 365),
  sesion_min int not null default 30 check (sesion_min between 5 and 240),
  foto_modo text not null default 'opcional' check (foto_modo in ('no', 'opcional', 'obligatoria')),
  foto_url text,
  foto_secreto text not null,
  hash_recepcion text
);
insert into private.checkin_config (id, foto_secreto)
  values (1, encode(extensions.gen_random_bytes(24), 'hex'))
  on conflict (id) do nothing;

-- Código vigente: una sola fila que se reescribe en cada rotación (no crece).
create table if not exists private.checkin_codigo (
  id int primary key check (id = 1),
  grupo bigint not null default 0,
  codigo text,
  vence timestamptz,
  usos int not null default 0,
  usos_max int not null default 3,
  prev_codigo text,
  prev_vence timestamptz,
  prev_usos int not null default 0,
  prev_usos_max int not null default 3,
  prev_grupo bigint not null default 0
);
insert into private.checkin_codigo (id) values (1) on conflict (id) do nothing;
create sequence if not exists private.checkin_grupo_seq;

-- Sesión del huésped: se obtiene al canjear el código y sirve para enviar UN formulario.
create table if not exists private.checkin_sesiones (
  token_hash text primary key,
  grupo bigint not null,
  creada timestamptz not null default now(),
  vence timestamptz not null,
  usada boolean not null default false,
  fotos int not null default 0,
  foto_id text,
  foto_nombre text
);
create index if not exists checkin_sesiones_ref_idx on private.checkin_sesiones (left(token_hash, 32));

create table if not exists private.checkins (
  id bigint generated always as identity primary key,
  creado timestamptz not null default now(),
  grupo bigint not null,
  idioma text,
  datos jsonb not null,
  consentimiento jsonb not null,
  habitacion text,
  foto_id text,
  foto_nombre text,
  editado_en timestamptz,
  editado_por text
);
create index if not exists checkins_creado_idx on private.checkins (creado desc);

create table if not exists private.checkin_auditoria (
  id bigint generated always as identity primary key,
  en timestamptz not null default now(),
  quien text not null,
  accion text not null,
  checkin_id bigint,
  detalle jsonb
);

alter table private.checkin_config enable row level security;
alter table private.checkin_codigo enable row level security;
alter table private.checkin_sesiones enable row level security;
alter table private.checkins enable row level security;
alter table private.checkin_auditoria enable row level security;

-- ---------------------------------------------------------------- medios de pago
-- Los medios de pago que recepción elige para cada huésped (efectivo, transferencia...). Los edita el dueño desde su panel.
-- NUNCA se borran: "quitar" un medio lo saca del selector (activo = false) y los huéspedes que ya lo tenían lo siguen mostrando.
-- "Otros" (es_base) es el que reciben por defecto los huéspedes nuevos y los que ya estaban cargados; no se puede quitar.
create table if not exists private.medios_pago (
  id int primary key,
  nombre text not null check (length(btrim(nombre)) between 1 and 40),
  orden int not null default 0,
  activo boolean not null default true,
  es_base boolean not null default false,
  creado timestamptz not null default now()
);
create unique index if not exists medios_pago_nombre_uq on private.medios_pago (lower(btrim(nombre)));
create unique index if not exists medios_pago_base_uq on private.medios_pago (es_base) where es_base;
create sequence if not exists private.medios_pago_seq start 7;
insert into private.medios_pago (id, nombre, orden, es_base) values
  (1, 'Efectivo', 1, false), (2, 'Transferencia', 2, false), (3, 'USD efectivo', 3, false),
  (4, 'PayPal', 4, false), (5, 'Link de pago', 5, false), (6, 'Otros', 6, true)
  on conflict (id) do nothing;
alter table private.medios_pago enable row level security;

-- Cada huésped tiene siempre un medio de pago (nunca vacío): los que ya estaban cargados quedan en "Otros"
-- (el 6 de arriba) hasta que recepción elija otro.
alter table private.checkins add column if not exists medio_pago_id int not null default 6 references private.medios_pago (id);

-- ---------------------------------------------------------------- ayudas internas

-- (private.ip_actual() está en schema.sql: la IP real de quien llama, que no se puede falsificar con x-forwarded-for)

create or replace function private.limite_alcanzado(p_tipo text, p_max int)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select count(*) from private.intentos
            where ip = p_tipo || '|' || private.ip_actual() and at > now() - interval '1 minute') >= p_max;
$$;

create or replace function private.registrar_fallo(p_tipo text)
returns void language sql security definer set search_path = '' as $$
  insert into private.intentos (ip) values (p_tipo || '|' || private.ip_actual());
$$;

create or replace function private.auditar(p_quien text, p_accion text, p_id bigint, p_detalle jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into private.checkin_auditoria (quien, accion, checkin_id, detalle) values (p_quien, p_accion, p_id, p_detalle);
$$;

create or replace function private.comprobar_recepcion(p_clave text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_hash text;
begin
  if private.limite_alcanzado('rec', 8) then
    return 'demasiados_intentos';
  end if;
  select hash_recepcion into v_hash from private.checkin_config where id = 1;
  if p_clave is null or v_hash is null or extensions.crypt(p_clave, v_hash) <> v_hash then
    perform private.registrar_fallo('rec');
    return 'clave_incorrecta';
  end if;
  return 'ok';
end;
$$;

-- Revisa y normaliza los datos del huésped. Devuelve {ok:true, datos:{...}} o {ok:false, campos:[...]}.
create or replace function private.validar_huesped(p_datos jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_nombre text; v_apellido text; v_email text; v_tel text; v_nac text; v_loc text; v_dom text; v_tipo text; v_num text;
  v_err text[] := array[]::text[];
begin
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' or length(p_datos::text) > 4000 then
    return jsonb_build_object('ok', false, 'campos', jsonb_build_array('datos'));
  end if;

  v_nombre   := btrim(regexp_replace(coalesce(p_datos ->> 'nombre', ''), '\s+', ' ', 'g'));
  v_apellido := btrim(regexp_replace(coalesce(p_datos ->> 'apellido', ''), '\s+', ' ', 'g'));
  v_email    := lower(btrim(coalesce(p_datos ->> 'email', '')));
  v_tel      := regexp_replace(coalesce(p_datos ->> 'telefono', ''), '[\s().-]', '', 'g');
  v_nac      := btrim(regexp_replace(coalesce(p_datos ->> 'nacionalidad', ''), '\s+', ' ', 'g'));
  v_loc      := btrim(regexp_replace(coalesce(p_datos ->> 'localidad', ''), '\s+', ' ', 'g'));
  v_dom      := btrim(regexp_replace(coalesce(p_datos ->> 'domicilio', ''), '\s+', ' ', 'g'));
  v_tipo     := btrim(coalesce(p_datos ->> 'doc_tipo', ''));
  v_num      := btrim(coalesce(p_datos ->> 'doc_numero', ''));

  if v_nombre !~ '^[[:alpha:]][[:alpha:] .''-]{1,59}$' then v_err := array_append(v_err, 'nombre'); end if;
  if v_apellido !~ '^[[:alpha:]][[:alpha:] .''-]{1,59}$' then v_err := array_append(v_err, 'apellido'); end if;
  if length(v_email) > 120 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$' then v_err := array_append(v_err, 'email'); end if;
  if v_tel !~ '^\+[1-9][0-9]{7,14}$' then v_err := array_append(v_err, 'telefono'); end if;
  if v_nac !~ '^[[:alpha:]][[:alpha:] .,''()-]{1,59}$' then v_err := array_append(v_err, 'nacionalidad'); end if;
  if v_loc !~ '^[[:alnum:]][^[:cntrl:]<>]{1,79}$' then v_err := array_append(v_err, 'localidad'); end if;
  if v_dom !~ '^[[:alnum:]][^[:cntrl:]<>]{4,119}$' then v_err := array_append(v_err, 'domicilio'); end if;

  if v_tipo = 'DNI' then
    v_num := regexp_replace(v_num, '[\s.-]', '', 'g');
    if v_num !~ '^[0-9]{7,8}$' then v_err := array_append(v_err, 'doc_numero'); end if;
  elsif v_tipo = 'Pasaporte' then
    v_num := upper(regexp_replace(v_num, '[\s-]', '', 'g'));
    if v_num !~ '^[A-Z0-9]{6,12}$' then v_err := array_append(v_err, 'doc_numero'); end if;
  else
    v_err := array_append(v_err, 'doc_tipo');
  end if;

  if array_length(v_err, 1) is not null then
    return jsonb_build_object('ok', false, 'campos', to_jsonb(v_err));
  end if;
  return jsonb_build_object('ok', true, 'datos', jsonb_build_object(
    'nombre', v_nombre, 'apellido', v_apellido, 'email', v_email, 'telefono', v_tel,
    'nacionalidad', v_nac, 'localidad', v_loc, 'domicilio', v_dom, 'doc_tipo', v_tipo, 'doc_numero', v_num));
end;
$$;

-- La habitación puede quedar vacía; si trae algo, 1 a 12 caracteres simples.
create or replace function private.habitacion_ok(p text)
returns boolean language sql immutable security definer set search_path = '' as $$
  select btrim(coalesce(p, '')) = '' or btrim(regexp_replace(p, '\s+', ' ', 'g')) ~ '^[[:alnum:]][[:alnum:] ._/-]{0,11}$';
$$;

create or replace function private.habitacion_normal(p text)
returns text language sql immutable security definer set search_path = '' as $$
  select nullif(btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g')), '');
$$;

-- Permiso firmado para que el script de Drive acepte una foto de este huésped (vale lo que dure la sesión).
create or replace function private.ticket_foto(p_hash text, p_vence timestamptz, p_secreto text)
returns text language sql stable security definer set search_path = '' as $$
  select left(p_hash, 32) || '.' || floor(extract(epoch from p_vence))::bigint::text || '.' ||
         encode(extensions.hmac(left(p_hash, 32) || '.' || floor(extract(epoch from p_vence))::bigint::text, p_secreto, 'sha256'), 'hex');
$$;

create or replace function private.foto_info(cfg private.checkin_config, p_hash text, p_vence timestamptz, p_listo boolean default false)
returns json language sql stable security definer set search_path = '' as $$
  select case when cfg.foto_modo <> 'no' and cfg.foto_url is not null then
    json_build_object('modo', cfg.foto_modo, 'url', cfg.foto_url, 'ticket', private.ticket_foto(p_hash, p_vence, cfg.foto_secreto), 'listo', p_listo)
  else null end;
$$;

-- El medio de pago pedido en p_datos ->> 'medio_pago' (el id). Sin dato queda el que ya tiene. Solo se puede elegir uno
-- activo, o el que el huésped ya tiene (aunque después lo hayan quitado de la lista). Devuelve null si no vale.
create or replace function private.medio_pago_elegido(p_datos jsonb, p_actual int)
returns int language plpgsql stable security definer set search_path = '' as $$
declare
  v text;
  n int;
begin
  v := nullif(btrim(coalesce(p_datos ->> 'medio_pago', '')), '');
  if v is null then
    return p_actual;
  end if;
  if v !~ '^[0-9]{1,9}$' then
    return null;
  end if;
  n := v::int;
  if n = p_actual then
    return n;
  end if;
  if exists (select 1 from private.medios_pago where id = n and activo) then
    return n;
  end if;
  return null;
end;
$$;

-- Todos los medios de pago (también los quitados) y cuántos huéspedes tiene cada uno. Es lo que ve el dueño en su panel.
create or replace function private.medios_pago_lista()
returns json language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object('id', m.id, 'nombre', m.nombre, 'activo', m.activo, 'base', m.es_base,
                                              'usos', coalesce(u.n, 0)) order by m.es_base, m.orden, m.id), '[]'::json)
    from private.medios_pago m
    left join (select medio_pago_id, count(*)::int as n from private.checkins group by medio_pago_id) u on u.medio_pago_id = m.id;
$$;

-- Devuelve el código vigente; si venció o se gastó, genera otro (y guarda el anterior unos segundos de tolerancia).
create or replace function private.codigo_vigente(p_forzar boolean default false)
returns private.checkin_codigo language plpgsql security definer set search_path = '' as $$
declare
  c private.checkin_codigo;
  cfg private.checkin_config;
  nuevo text;
  n int := 0;
begin
  select * into cfg from private.checkin_config where id = 1;
  select * into c from private.checkin_codigo where id = 1 for update;
  if p_forzar or c.codigo is null or c.vence <= now() or c.usos >= c.usos_max then
    if p_forzar or c.codigo is null then
      c.prev_codigo := null;
    else
      c.prev_codigo := c.codigo;
      c.prev_vence := c.vence;
      c.prev_usos := c.usos;
      c.prev_usos_max := c.usos_max;
      c.prev_grupo := c.grupo;
    end if;
    loop
      nuevo := lpad((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint % 1000000)::text, 6, '0');
      n := n + 1;
      exit when n > 20 or (nuevo is distinct from c.codigo and nuevo is distinct from c.prev_codigo);
    end loop;
    c.grupo := nextval('private.checkin_grupo_seq');
    c.codigo := nuevo;
    c.vence := now() + make_interval(secs => cfg.codigo_seg);
    c.usos := 0;
    c.usos_max := cfg.usos_max;
    update private.checkin_codigo set
      grupo = c.grupo, codigo = c.codigo, vence = c.vence, usos = c.usos, usos_max = c.usos_max,
      prev_codigo = c.prev_codigo, prev_vence = c.prev_vence, prev_usos = c.prev_usos,
      prev_usos_max = c.prev_usos_max, prev_grupo = c.prev_grupo
    where id = 1;
  end if;
  return c;
end;
$$;

revoke all on function private.ip_actual() from public, anon, authenticated;
revoke all on function private.limite_alcanzado(text, int) from public, anon, authenticated;
revoke all on function private.registrar_fallo(text) from public, anon, authenticated;
revoke all on function private.auditar(text, text, bigint, jsonb) from public, anon, authenticated;
revoke all on function private.comprobar_recepcion(text) from public, anon, authenticated;
revoke all on function private.validar_huesped(jsonb) from public, anon, authenticated;
revoke all on function private.habitacion_ok(text) from public, anon, authenticated;
revoke all on function private.habitacion_normal(text) from public, anon, authenticated;
revoke all on function private.ticket_foto(text, timestamptz, text) from public, anon, authenticated;
revoke all on function private.foto_info(private.checkin_config, text, timestamptz, boolean) from public, anon, authenticated;
revoke all on function private.codigo_vigente(boolean) from public, anon, authenticated;
revoke all on function private.medio_pago_elegido(jsonb, int) from public, anon, authenticated;
revoke all on function private.medios_pago_lista() from public, anon, authenticated;

-- ---------------------------------------------------------------- huésped (sin clave: entra con el código)

create or replace function public.checkin_estado()
returns json language plpgsql security definer set search_path = '' as $$
declare cfg private.checkin_config;
begin
  select * into cfg from private.checkin_config where id = 1;
  return json_build_object(
    'activo', cfg.activo,
    'foto', case when cfg.activo and cfg.foto_modo <> 'no' and cfg.foto_url is not null
                 then json_build_object('modo', cfg.foto_modo, 'url', cfg.foto_url) else null end);
end;
$$;

-- Canjea el código de 6 números por una sesión de un solo uso.
create or replace function public.checkin_canjear(p_codigo text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  cfg private.checkin_config;
  c private.checkin_codigo;
  v_cod text;
  v_grupo bigint;
  v_token text;
  v_hash text;
  v_vence timestamptz;
begin
  select * into cfg from private.checkin_config where id = 1;
  if not cfg.activo then
    return json_build_object('ok', false, 'error', 'no_disponible');
  end if;
  if private.limite_alcanzado('cod', 6) then
    return json_build_object('ok', false, 'error', 'demasiados_intentos');
  end if;
  v_cod := regexp_replace(coalesce(p_codigo, ''), '[^0-9]', '', 'g');
  select * into c from private.checkin_codigo where id = 1 for update;
  if length(v_cod) = 6 and c.codigo = v_cod and now() < c.vence + interval '10 seconds' and c.usos < c.usos_max then
    update private.checkin_codigo set usos = usos + 1 where id = 1;
    v_grupo := c.grupo;
  elsif length(v_cod) = 6 and c.prev_codigo = v_cod and now() < c.prev_vence + interval '10 seconds' and c.prev_usos < c.prev_usos_max then
    update private.checkin_codigo set prev_usos = prev_usos + 1 where id = 1;
    v_grupo := c.prev_grupo;
  else
    perform private.registrar_fallo('cod');
    return json_build_object('ok', false, 'error', 'codigo_invalido');
  end if;
  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  v_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');
  v_vence := now() + make_interval(mins => cfg.sesion_min);
  insert into private.checkin_sesiones (token_hash, grupo, vence) values (v_hash, v_grupo, v_vence);
  return json_build_object('ok', true, 'token', v_token, 'vence_seg', cfg.sesion_min * 60,
                           'foto', private.foto_info(cfg, v_hash, v_vence, false));
end;
$$;

-- Dice si la sesión sigue vigente (para retomar tras recargar) y si la foto ya quedó guardada.
create or replace function public.checkin_sesion(p_token text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  cfg private.checkin_config;
  s private.checkin_sesiones;
  v_hash text;
begin
  select * into cfg from private.checkin_config where id = 1;
  if not cfg.activo then
    return json_build_object('ok', false, 'error', 'no_disponible');
  end if;
  v_hash := encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  select * into s from private.checkin_sesiones where token_hash = v_hash;
  if not found or s.usada or s.vence <= now() then
    return json_build_object('ok', false, 'error', 'sesion_invalida');
  end if;
  return json_build_object('ok', true, 'vence_seg', ceil(extract(epoch from (s.vence - now())))::int,
                           'foto', private.foto_info(cfg, v_hash, s.vence, s.foto_id is not null));
end;
$$;

-- Guarda el formulario del huésped (una vez por sesión).
create or replace function public.checkin_enviar(p_token text, p_datos jsonb, p_idioma text, p_acepta boolean)
returns json language plpgsql security definer set search_path = '' as $$
declare
  cfg private.checkin_config;
  s private.checkin_sesiones;
  v_hash text;
  v jsonb;
begin
  select * into cfg from private.checkin_config where id = 1;
  if not cfg.activo then
    return json_build_object('ok', false, 'error', 'no_disponible');
  end if;
  v_hash := encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  select * into s from private.checkin_sesiones where token_hash = v_hash for update;
  if not found or s.usada or s.vence <= now() then
    return json_build_object('ok', false, 'error', 'sesion_invalida');
  end if;
  if p_acepta is distinct from true then
    return json_build_object('ok', false, 'error', 'consentimiento');
  end if;
  v := private.validar_huesped(p_datos);
  if not (v ->> 'ok')::boolean then
    return json_build_object('ok', false, 'error', 'datos_invalidos', 'campos', v -> 'campos');
  end if;
  if cfg.foto_modo = 'obligatoria' and cfg.foto_url is not null and s.foto_id is null then
    return json_build_object('ok', false, 'error', 'foto_requerida');
  end if;
  insert into private.checkins (grupo, idioma, datos, consentimiento, foto_id, foto_nombre)
    values (s.grupo, left(regexp_replace(coalesce(p_idioma, ''), '[^A-Za-z-]', '', 'g'), 10), v -> 'datos',
            jsonb_build_object('aceptado', true, 'version', 1, 'en', now()), s.foto_id, s.foto_nombre);
  update private.checkin_sesiones set usada = true where token_hash = v_hash;
  return json_build_object('ok', true);
end;
$$;

-- Lo llama el script de Drive después de guardar la foto, con la clave que comparte con la base.
create or replace function public.checkin_foto_registrar(p_secreto text, p_ref text, p_foto_id text, p_nombre text)
returns json language plpgsql security definer set search_path = '' as $$
declare cfg private.checkin_config;
begin
  if private.limite_alcanzado('fot', 30) then
    return json_build_object('ok', false, 'error', 'demasiados_intentos');
  end if;
  select * into cfg from private.checkin_config where id = 1;
  if p_secreto is null or cfg.foto_url is null or p_secreto <> cfg.foto_secreto then
    perform private.registrar_fallo('fot');
    return json_build_object('ok', false, 'error', 'no_autorizado');
  end if;
  if coalesce(p_ref, '') !~ '^[0-9a-f]{32}$'
     or coalesce(p_foto_id, '') !~ '^[A-Za-z0-9_-]{10,120}$'
     or length(coalesce(p_nombre, '')) not between 1 and 150 then
    return json_build_object('ok', false, 'error', 'datos_invalidos');
  end if;
  update private.checkin_sesiones
     set foto_id = p_foto_id, foto_nombre = p_nombre, fotos = fotos + 1
   where left(token_hash, 32) = p_ref and not usada and vence > now() and fotos < 3;
  if not found then
    return json_build_object('ok', false, 'error', 'sesion_invalida');
  end if;
  return json_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------- recepción (clave propia)

create or replace function public.recepcion_entrar(p_clave text)
returns json language plpgsql security definer set search_path = '' as $$
declare r text;
begin
  r := private.comprobar_recepcion(p_clave);
  return json_build_object('ok', r = 'ok', 'error', case when r = 'ok' then null else r end);
end;
$$;

-- Código vigente (se renueva solo) + huéspedes de los últimos días. Es lo que consulta la pantalla de recepción.
create or replace function public.recepcion_estado(p_clave text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  r text;
  cfg private.checkin_config;
  c private.checkin_codigo;
  v_lista json;
  v_config json;
  v_medios json;
begin
  r := private.comprobar_recepcion(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  select * into cfg from private.checkin_config where id = 1;
  select coalesce(json_agg(row_to_json(t) order by t.creado desc), '[]'::json) into v_lista from (
    select k.id, k.creado, k.habitacion, k.datos, k.foto_id, k.foto_nombre, k.medio_pago_id, m.nombre as medio_pago,
           case when cfg.edicion_activa
                then greatest(0, floor(extract(epoch from (k.creado + make_interval(mins => cfg.edicion_min) - now()))))::int
                else 0 end as editable_seg
      from private.checkins k
      join private.medios_pago m on m.id = k.medio_pago_id
     where k.creado > now() - make_interval(days => cfg.dias_recepcion)
     order by k.creado desc
     limit 200
  ) t;
  v_config := json_build_object('edicion_activa', cfg.edicion_activa, 'edicion_min', cfg.edicion_min,
                                'codigo_seg', cfg.codigo_seg, 'dias', cfg.dias_recepcion);
  select coalesce(json_agg(json_build_object('id', m.id, 'nombre', m.nombre) order by m.es_base, m.orden, m.id), '[]'::json)
    into v_medios from private.medios_pago m where m.activo;
  if not cfg.activo then
    return json_build_object('ok', true, 'activo', false, 'codigo', null, 'config', v_config, 'huespedes', v_lista, 'medios_pago', v_medios);
  end if;
  c := private.codigo_vigente(false);
  return json_build_object('ok', true, 'activo', true,
    'codigo', json_build_object('valor', c.codigo,
                                'vence_seg', greatest(0, ceil(extract(epoch from (c.vence - now()))))::int,
                                'usos', c.usos, 'usos_max', c.usos_max),
    'config', v_config, 'huespedes', v_lista, 'medios_pago', v_medios);
end;
$$;

-- Anula el código actual y genera otro ya mismo.
create or replace function public.recepcion_codigo_nuevo(p_clave text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  r text;
  cfg private.checkin_config;
  c private.checkin_codigo;
begin
  r := private.comprobar_recepcion(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  select * into cfg from private.checkin_config where id = 1;
  if not cfg.activo then
    return json_build_object('ok', false, 'error', 'no_disponible');
  end if;
  c := private.codigo_vigente(true);
  perform private.auditar('recepcion', 'codigo_nuevo', null, null);
  return json_build_object('ok', true,
    'codigo', json_build_object('valor', c.codigo,
                                'vence_seg', greatest(0, ceil(extract(epoch from (c.vence - now()))))::int,
                                'usos', c.usos, 'usos_max', c.usos_max));
end;
$$;

-- Recepción corrige los datos y/o carga la habitación, solo mientras dure la ventana de edición.
create or replace function public.recepcion_editar(p_clave text, p_id bigint, p_datos jsonb, p_habitacion text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  r text;
  cfg private.checkin_config;
  k private.checkins;
  v jsonb;
  h text;
  v_medio int;
  v_cambios text[];
begin
  r := private.comprobar_recepcion(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  select * into cfg from private.checkin_config where id = 1;
  select * into k from private.checkins where id = p_id for update;
  if not found then
    return json_build_object('ok', false, 'error', 'no_existe');
  end if;
  if not cfg.edicion_activa or now() > k.creado + make_interval(mins => cfg.edicion_min) then
    return json_build_object('ok', false, 'error', 'fuera_de_tiempo');
  end if;
  v := private.validar_huesped(p_datos);
  if not (v ->> 'ok')::boolean then
    return json_build_object('ok', false, 'error', 'datos_invalidos', 'campos', v -> 'campos');
  end if;
  v_medio := private.medio_pago_elegido(p_datos, k.medio_pago_id);
  if v_medio is null then
    return json_build_object('ok', false, 'error', 'datos_invalidos', 'campos', jsonb_build_array('medio_pago'));
  end if;
  if not private.habitacion_ok(p_habitacion) then
    return json_build_object('ok', false, 'error', 'habitacion_invalida');
  end if;
  h := private.habitacion_normal(p_habitacion);
  select coalesce(array_agg(n.key order by n.key), array[]::text[]) into v_cambios
    from jsonb_each_text(v -> 'datos') n
   where n.value is distinct from (k.datos ->> n.key);
  if h is distinct from k.habitacion then
    v_cambios := array_append(v_cambios, 'habitacion');
  end if;
  if v_medio <> k.medio_pago_id then
    v_cambios := array_append(v_cambios, 'medio_pago');
  end if;
  if array_length(v_cambios, 1) is not null then
    update private.checkins set datos = v -> 'datos', habitacion = h, medio_pago_id = v_medio, editado_en = now(), editado_por = 'recepcion' where id = p_id;
    perform private.auditar('recepcion', 'editar', p_id, jsonb_build_object('campos', to_jsonb(v_cambios)));
  end if;
  return json_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------- admin general (clave de siempre)

create or replace function public.admin_checkin_config(p_clave text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  r text;
  cfg private.checkin_config;
begin
  r := private.comprobar_clave(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  select * into cfg from private.checkin_config where id = 1;
  return json_build_object('ok', true, 'config', json_build_object(
    'activo', cfg.activo, 'codigo_seg', cfg.codigo_seg, 'usos_max', cfg.usos_max,
    'edicion_activa', cfg.edicion_activa, 'edicion_min', cfg.edicion_min, 'dias_recepcion', cfg.dias_recepcion,
    'foto_modo', cfg.foto_modo, 'foto_url', cfg.foto_url, 'foto_secreto', cfg.foto_secreto,
    'recepcion_con_clave', cfg.hash_recepcion is not null));
end;
$$;

create or replace function public.admin_checkin_config_guardar(p_clave text, p_config jsonb)
returns json language plpgsql security definer set search_path = '' as $$
declare
  r text;
begin
  r := private.comprobar_clave(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  if p_config is null or jsonb_typeof(p_config) <> 'object' then
    return json_build_object('ok', false, 'error', 'config_invalida');
  end if;
  if (p_config -> 'activo') is not null and jsonb_typeof(p_config -> 'activo') <> 'boolean' then
    return json_build_object('ok', false, 'error', 'config_invalida', 'campo', 'activo');
  end if;
  if (p_config -> 'edicion_activa') is not null and jsonb_typeof(p_config -> 'edicion_activa') <> 'boolean' then
    return json_build_object('ok', false, 'error', 'config_invalida', 'campo', 'edicion_activa');
  end if;
  if (p_config -> 'codigo_seg') is not null then
    if (p_config ->> 'codigo_seg') !~ '^[0-9]{1,3}$' then
      return json_build_object('ok', false, 'error', 'config_invalida', 'campo', 'codigo_seg');
    end if;
    if (p_config ->> 'codigo_seg')::int not between 5 and 300 then
      return json_build_object('ok', false, 'error', 'config_invalida', 'campo', 'codigo_seg');
    end if;
  end if;
  if (p_config -> 'usos_max') is not null then
    if (p_config ->> 'usos_max') !~ '^[0-9]{1,2}$' then
      return json_build_object('ok', false, 'error', 'config_invalida', 'campo', 'usos_max');
    end if;
    if (p_config ->> 'usos_max')::int not between 1 and 20 then
      return json_build_object('ok', false, 'error', 'config_invalida', 'campo', 'usos_max');
    end if;
  end if;
  if (p_config -> 'edicion_min') is not null then
    if (p_config ->> 'edicion_min') !~ '^[0-9]{1,4}$' then
      return json_build_object('ok', false, 'error', 'config_invalida', 'campo', 'edicion_min');
    end if;
    if (p_config ->> 'edicion_min')::int not between 1 and 1440 then
      return json_build_object('ok', false, 'error', 'config_invalida', 'campo', 'edicion_min');
    end if;
  end if;
  if (p_config -> 'dias_recepcion') is not null then
    if (p_config ->> 'dias_recepcion') !~ '^[0-9]{1,3}$' then
      return json_build_object('ok', false, 'error', 'config_invalida', 'campo', 'dias_recepcion');
    end if;
    if (p_config ->> 'dias_recepcion')::int not between 1 and 365 then
      return json_build_object('ok', false, 'error', 'config_invalida', 'campo', 'dias_recepcion');
    end if;
  end if;
  if (p_config -> 'foto_modo') is not null and coalesce(p_config ->> 'foto_modo', '') not in ('no', 'opcional', 'obligatoria') then
    return json_build_object('ok', false, 'error', 'config_invalida', 'campo', 'foto_modo');
  end if;
  if nullif(btrim(coalesce(p_config ->> 'foto_url', '')), '') is not null
     and btrim(p_config ->> 'foto_url') !~ '^https://script\.google\.com/(a/macros/[A-Za-z0-9.-]+|macros)/s/[A-Za-z0-9_-]+/exec$' then
    return json_build_object('ok', false, 'error', 'config_invalida', 'campo', 'foto_url');
  end if;

  update private.checkin_config set
    activo = case when (p_config -> 'activo') is not null then (p_config ->> 'activo')::boolean else activo end,
    codigo_seg = case when (p_config -> 'codigo_seg') is not null then (p_config ->> 'codigo_seg')::int else codigo_seg end,
    usos_max = case when (p_config -> 'usos_max') is not null then (p_config ->> 'usos_max')::int else usos_max end,
    edicion_activa = case when (p_config -> 'edicion_activa') is not null then (p_config ->> 'edicion_activa')::boolean else edicion_activa end,
    edicion_min = case when (p_config -> 'edicion_min') is not null then (p_config ->> 'edicion_min')::int else edicion_min end,
    dias_recepcion = case when (p_config -> 'dias_recepcion') is not null then (p_config ->> 'dias_recepcion')::int else dias_recepcion end,
    foto_modo = case when (p_config -> 'foto_modo') is not null then p_config ->> 'foto_modo' else foto_modo end,
    foto_url = case when (p_config -> 'foto_url') is null then foto_url
                    else nullif(btrim(coalesce(p_config ->> 'foto_url', '')), '') end
  where id = 1;
  perform private.auditar('admin', 'config', null,
    jsonb_build_object('claves', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(p_config) k)));
  return json_build_object('ok', true);
end;
$$;

create or replace function public.admin_checkin_clave_recepcion(p_clave text, p_nueva text)
returns json language plpgsql security definer set search_path = '' as $$
declare r text;
begin
  r := private.comprobar_clave(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  if p_nueva is null or length(p_nueva) < 8 or length(p_nueva) > 100 then
    return json_build_object('ok', false, 'error', 'clave_corta');
  end if;
  update private.checkin_config set hash_recepcion = extensions.crypt(p_nueva, extensions.gen_salt('bf')) where id = 1;
  perform private.auditar('admin', 'clave_recepcion', null, null);
  return json_build_object('ok', true);
end;
$$;

-- Todos los huéspedes, del más nuevo al más viejo, con búsqueda y "cargar más" (p_antes = id del último que ya tenés).
create or replace function public.admin_huespedes(p_clave text, p_buscar text default null, p_limite int default 50, p_antes bigint default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  r text;
  v_q text;
  v_lim int;
  v_lista json;
  v_n int;
begin
  r := private.comprobar_clave(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  v_lim := least(greatest(coalesce(p_limite, 50), 1), 200);
  v_q := nullif(btrim(coalesce(p_buscar, '')), '');
  if v_q is not null then
    -- la búsqueda ignora mayúsculas y tildes (Pérez = perez)
    v_q := translate(lower(left(v_q, 60)), 'áàâãäéèêëíìîïóòôõöúùûüñç', 'aaaaaeeeeiiiioooooouuuunc');
    v_q := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  select coalesce(json_agg(row_to_json(t) order by t.id desc) filter (where t.rn <= v_lim), '[]'::json), count(*)
    into v_lista, v_n
    from (
      select k.id, k.creado, k.habitacion, k.datos, k.foto_id, k.foto_nombre, k.editado_en, k.editado_por,
             k.medio_pago_id, m.nombre as medio_pago,
             row_number() over (order by k.id desc) as rn
        from private.checkins k
        join private.medios_pago m on m.id = k.medio_pago_id
       where (p_antes is null or k.id < p_antes)
         and (v_q is null or translate(lower(concat_ws(' ', k.datos ->> 'nombre', k.datos ->> 'apellido', k.datos ->> 'email', k.datos ->> 'telefono',
                                        k.datos ->> 'localidad', k.datos ->> 'doc_numero', k.habitacion, m.nombre)),
                                       'áàâãäéèêëíìîïóòôõöúùûüñç', 'aaaaaeeeeiiiioooooouuuunc') like v_q escape '\')
       order by k.id desc
       limit v_lim + 1
    ) t;
  return json_build_object('ok', true, 'huespedes', v_lista, 'hay_mas', v_n > v_lim);
end;
$$;

create or replace function public.admin_huesped_editar(p_clave text, p_id bigint, p_datos jsonb, p_habitacion text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  r text;
  k private.checkins;
  v jsonb;
  h text;
  v_medio int;
  v_cambios text[];
begin
  r := private.comprobar_clave(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  select * into k from private.checkins where id = p_id for update;
  if not found then
    return json_build_object('ok', false, 'error', 'no_existe');
  end if;
  v := private.validar_huesped(p_datos);
  if not (v ->> 'ok')::boolean then
    return json_build_object('ok', false, 'error', 'datos_invalidos', 'campos', v -> 'campos');
  end if;
  v_medio := private.medio_pago_elegido(p_datos, k.medio_pago_id);
  if v_medio is null then
    return json_build_object('ok', false, 'error', 'datos_invalidos', 'campos', jsonb_build_array('medio_pago'));
  end if;
  if not private.habitacion_ok(p_habitacion) then
    return json_build_object('ok', false, 'error', 'habitacion_invalida');
  end if;
  h := private.habitacion_normal(p_habitacion);
  select coalesce(array_agg(n.key order by n.key), array[]::text[]) into v_cambios
    from jsonb_each_text(v -> 'datos') n
   where n.value is distinct from (k.datos ->> n.key);
  if h is distinct from k.habitacion then
    v_cambios := array_append(v_cambios, 'habitacion');
  end if;
  if v_medio <> k.medio_pago_id then
    v_cambios := array_append(v_cambios, 'medio_pago');
  end if;
  if array_length(v_cambios, 1) is not null then
    update private.checkins set datos = v -> 'datos', habitacion = h, medio_pago_id = v_medio, editado_en = now(), editado_por = 'admin' where id = p_id;
    perform private.auditar('admin', 'editar', p_id, jsonb_build_object('campos', to_jsonb(v_cambios)));
  end if;
  return json_build_object('ok', true);
end;
$$;

create or replace function public.admin_checkin_auditoria(p_clave text, p_limite int default 40)
returns json language plpgsql security definer set search_path = '' as $$
declare
  r text;
  v_lista json;
begin
  r := private.comprobar_clave(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  select coalesce(json_agg(row_to_json(t) order by t.id desc), '[]'::json) into v_lista from (
    select a.id, a.en, a.quien, a.accion, a.checkin_id, a.detalle
      from private.checkin_auditoria a
     order by a.id desc
     limit least(greatest(coalesce(p_limite, 40), 1), 200)
  ) t;
  return json_build_object('ok', true, 'registros', v_lista);
end;
$$;

-- Los medios de pago que elige recepción: el dueño los ve todos (también los quitados, para poder volver a ponerlos).
create or replace function public.admin_medios_pago(p_clave text)
returns json language plpgsql security definer set search_path = '' as $$
declare r text;
begin
  r := private.comprobar_clave(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  return json_build_object('ok', true, 'medios', private.medios_pago_lista());
end;
$$;

-- Guarda la lista completa de medios de pago, en el orden en que vienen. NADA se borra: para quitar uno se manda
-- "activo": false (deja de ofrecerse, pero los huéspedes que ya lo tenían lo siguen mostrando). "Otros" no se puede quitar.
--   p_lista: [{"id": 3, "nombre": "USD efectivo", "activo": true}, {"id": null, "nombre": "Tarjeta", "activo": true}, ...]
create or replace function public.admin_medios_pago_guardar(p_clave text, p_lista jsonb)
returns json language plpgsql security definer set search_path = '' as $$
declare
  r text;
  it jsonb;
  m private.medios_pago;
  i int := 0;
  v_nombre text;
  v_activo boolean;
  v_vistos text[] := array[]::text[];
  v_ids int[] := array[]::int[];
  v_nombres text[] := array[]::text[];
begin
  r := private.comprobar_clave(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  if p_lista is null or jsonb_typeof(p_lista) <> 'array' or jsonb_array_length(p_lista) not between 1 and 60 then
    return json_build_object('ok', false, 'error', 'lista_invalida');
  end if;
  lock table private.medios_pago in share row exclusive mode;

  -- primero se revisa todo; recién si está bien se guarda
  for it in select e from jsonb_array_elements(p_lista) e loop
    i := i + 1;
    if jsonb_typeof(it) <> 'object' then
      return json_build_object('ok', false, 'error', 'lista_invalida');
    end if;
    v_nombre := btrim(regexp_replace(coalesce(it ->> 'nombre', ''), '\s+', ' ', 'g'));
    if v_nombre !~ '^[[:alnum:]][[:alnum:] ._/&()+,''-]{0,39}$' then
      return json_build_object('ok', false, 'error', 'nombre_invalido', 'posicion', i);
    end if;
    if lower(v_nombre) = any(v_vistos) then
      return json_build_object('ok', false, 'error', 'nombre_repetido', 'nombre', v_nombre);
    end if;
    v_vistos := array_append(v_vistos, lower(v_nombre));
    if (it -> 'activo') is not null and jsonb_typeof(it -> 'activo') <> 'boolean' then
      return json_build_object('ok', false, 'error', 'lista_invalida');
    end if;
    if nullif(it ->> 'id', '') is not null then
      if (it ->> 'id') !~ '^[0-9]{1,9}$' then
        return json_build_object('ok', false, 'error', 'lista_invalida');
      end if;
      if (it ->> 'id')::int = any(v_ids) then
        return json_build_object('ok', false, 'error', 'lista_invalida');
      end if;
      v_ids := array_append(v_ids, (it ->> 'id')::int);
      select * into m from private.medios_pago where id = (it ->> 'id')::int;
      if not found then
        return json_build_object('ok', false, 'error', 'no_existe');
      end if;
      if m.es_base and coalesce((it ->> 'activo')::boolean, true) = false then
        return json_build_object('ok', false, 'error', 'base_obligatoria');
      end if;
    end if;
  end loop;

  i := 0;
  for it in select e from jsonb_array_elements(p_lista) e loop
    i := i + 1;
    v_nombre := btrim(regexp_replace(coalesce(it ->> 'nombre', ''), '\s+', ' ', 'g'));
    v_activo := coalesce((it ->> 'activo')::boolean, true);
    if nullif(it ->> 'id', '') is not null then
      update private.medios_pago set nombre = v_nombre, orden = i, activo = (es_base or v_activo) where id = (it ->> 'id')::int;
    else
      insert into private.medios_pago (id, nombre, orden, activo) values (nextval('private.medios_pago_seq'), v_nombre, i, v_activo);
    end if;
    v_nombres := array_append(v_nombres, v_nombre);
  end loop;
  perform private.auditar('admin', 'medios_pago', null, jsonb_build_object('nombres', to_jsonb(v_nombres)));
  return json_build_object('ok', true, 'medios', private.medios_pago_lista());
exception when unique_violation then
  return json_build_object('ok', false, 'error', 'nombre_repetido');
end;
$$;

-- ---------------------------------------------------------------- permisos

revoke all on function public.checkin_estado() from public, anon, authenticated;
revoke all on function public.checkin_canjear(text) from public, anon, authenticated;
revoke all on function public.checkin_sesion(text) from public, anon, authenticated;
revoke all on function public.checkin_enviar(text, jsonb, text, boolean) from public, anon, authenticated;
revoke all on function public.checkin_foto_registrar(text, text, text, text) from public, anon, authenticated;
revoke all on function public.recepcion_entrar(text) from public, anon, authenticated;
revoke all on function public.recepcion_estado(text) from public, anon, authenticated;
revoke all on function public.recepcion_codigo_nuevo(text) from public, anon, authenticated;
revoke all on function public.recepcion_editar(text, bigint, jsonb, text) from public, anon, authenticated;
revoke all on function public.admin_checkin_config(text) from public, anon, authenticated;
revoke all on function public.admin_checkin_config_guardar(text, jsonb) from public, anon, authenticated;
revoke all on function public.admin_checkin_clave_recepcion(text, text) from public, anon, authenticated;
revoke all on function public.admin_huespedes(text, text, int, bigint) from public, anon, authenticated;
revoke all on function public.admin_huesped_editar(text, bigint, jsonb, text) from public, anon, authenticated;
revoke all on function public.admin_checkin_auditoria(text, int) from public, anon, authenticated;
revoke all on function public.admin_medios_pago(text) from public, anon, authenticated;
revoke all on function public.admin_medios_pago_guardar(text, jsonb) from public, anon, authenticated;

grant execute on function public.checkin_estado() to anon, authenticated;
grant execute on function public.checkin_canjear(text) to anon, authenticated;
grant execute on function public.checkin_sesion(text) to anon, authenticated;
grant execute on function public.checkin_enviar(text, jsonb, text, boolean) to anon, authenticated;
grant execute on function public.checkin_foto_registrar(text, text, text, text) to anon, authenticated;
grant execute on function public.recepcion_entrar(text) to anon, authenticated;
grant execute on function public.recepcion_estado(text) to anon, authenticated;
grant execute on function public.recepcion_codigo_nuevo(text) to anon, authenticated;
grant execute on function public.recepcion_editar(text, bigint, jsonb, text) to anon, authenticated;
grant execute on function public.admin_checkin_config(text) to anon, authenticated;
grant execute on function public.admin_checkin_config_guardar(text, jsonb) to anon, authenticated;
grant execute on function public.admin_checkin_clave_recepcion(text, text) to anon, authenticated;
grant execute on function public.admin_huespedes(text, text, int, bigint) to anon, authenticated;
grant execute on function public.admin_huesped_editar(text, bigint, jsonb, text) to anon, authenticated;
grant execute on function public.admin_checkin_auditoria(text, int) to anon, authenticated;
grant execute on function public.admin_medios_pago(text) to anon, authenticated;
grant execute on function public.admin_medios_pago_guardar(text, jsonb) to anon, authenticated;
