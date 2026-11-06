-- Base de datos de la guía del hotel (Supabase / Postgres).
-- Ya está aplicada en el proyecto sruzrnhbyosnoqdkhric. Sirve para rehacerla en otro proyecto:
-- pegar en el SQL Editor de Supabase y ejecutar; después definir la clave (ver README).
--
-- Cómo funciona:
--   * public.contenido: una sola fila con todo el contenido. Cualquiera la puede LEER
--     (la guía de los huéspedes); nadie puede escribirla directo.
--   * Para cambiar algo hay que pasar por public.guardar_contenido(clave, contenido), que
--     verifica la clave del dueño (guardada como hash bcrypt en private.admin), valida el
--     contenido y archiva la versión anterior (anillo de 20 versiones en private.historial).
--   * Los intentos de clave fallidos se frenan: 8 por minuto y por IP.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.contenido (
  id int primary key check (id = 1),
  data jsonb not null,
  actualizado timestamptz not null default now()
);
alter table public.contenido enable row level security;
create policy "lectura publica" on public.contenido
  for select to anon, authenticated using (true);
revoke all on public.contenido from anon, authenticated;
grant select on public.contenido to anon, authenticated;

create table private.historial (id bigserial primary key, data jsonb not null, guardado timestamptz not null default now());
create table private.admin (id int primary key check (id = 1), hash text not null);
create table private.intentos (id bigserial primary key, ip text not null, at timestamptz not null default now());
create index on private.intentos (ip, at);

-- Sesiones por dispositivo: después de poner la clave una vez, el celular recibe un código al azar (sd_ + 64 letras y números) que
-- vale 60 días de uso. En la base solo queda su huella (sha256), nunca el código ni la clave. Se pueden cerrar (revocada_en);
-- nada se borra.
create table if not exists private.sesiones (
  id bigint generated always as identity primary key,
  token_hash text not null unique,
  rol text not null check (rol in ('admin', 'recepcion')),
  etiqueta text,
  creado timestamptz not null default now(),
  ultimo_uso timestamptz not null default now(),
  vence timestamptz not null,
  revocada_en timestamptz
);
alter table private.sesiones enable row level security;
create sequence private.hist_seq;
alter table private.historial enable row level security;
alter table private.admin enable row level security;
alter table private.intentos enable row level security;

-- IP de quien llama, para los frenos de intentos. Cloudflare (cf-connecting-ip) y el gateway de Supabase
-- (sb-forwarded-for) la escriben ellos y el cliente no la puede cambiar. El primer valor de x-forwarded-for
-- lo escribe cualquiera (el proxy agrega la IP real al final), así que solo se usa el último. Las IPv6 se
-- agrupan por /64 (una persona tiene miles de direcciones dentro de su /64).
create or replace function private.ip_actual()
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  h json;
  v text;
begin
  begin
    h := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json;
  exception when others then
    h := '{}'::json;
  end;
  v := coalesce(nullif(btrim(h ->> 'cf-connecting-ip'), ''), nullif(btrim(h ->> 'sb-forwarded-for'), ''),
                nullif(btrim(reverse(split_part(reverse(coalesce(h ->> 'x-forwarded-for', '')), ',', 1))), ''));
  if v is null then
    return 'desconocida';
  end if;
  v := regexp_replace(v, '^::ffff:', '', 'i');
  if position(':' in v) > 0 then
    begin
      v := host(network(set_masklen(v::inet, 64)));
    exception when others then
      null;
    end;
  end if;
  return left(v, 45);
end;
$$;
revoke all on function private.ip_actual() from public, anon, authenticated;

-- Rol de una sesión de dispositivo vigente (o null). Cada vez que se usa después de un día, se renueva por 60 días más.
create or replace function private.sesion_activa(p_token text, p_roles text[])
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_hash text;
  v_rol text;
  v_uso timestamptz;
begin
  if p_token is null or p_token !~ '^sd_[0-9a-f]{64}$' then
    return null;
  end if;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');
  select s.rol, s.ultimo_uso into v_rol, v_uso from private.sesiones s
   where s.token_hash = v_hash and s.revocada_en is null and s.vence > now() and s.rol = any (p_roles);
  if v_rol is null then
    return null;
  end if;
  if v_uso < now() - interval '1 day' then
    update private.sesiones set ultimo_uso = now(), vence = now() + interval '60 days' where token_hash = v_hash;
  end if;
  return v_rol;
end;
$$;
revoke all on function private.sesion_activa(text, text[]) from public, anon, authenticated;

-- Solo la clave del dueño (sin sesiones de dispositivo). La usan las acciones que no se pueden hacer con un celular que quedó abierto.
create or replace function private.comprobar_clave_estricta(p_clave text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_ip text;
begin
  v_ip := private.ip_actual();
  if (select count(*) from private.intentos where ip = v_ip and at > now() - interval '1 minute') >= 8 then
    return 'demasiados_intentos';
  end if;
  if p_clave is null or not exists (select 1 from private.admin a where a.hash = extensions.crypt(p_clave, a.hash)) then
    insert into private.intentos (ip) values (v_ip);
    return 'clave_incorrecta';
  end if;
  return 'ok';
end;
$$;
revoke all on function private.comprobar_clave_estricta(text) from public, anon, authenticated;

-- La clave del dueño o una sesión de dispositivo de admin: la usan todas las pantallas del dueño.
create or replace function private.comprobar_clave(p_clave text)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if p_clave ~ '^sd_[0-9a-f]{64}$' then
    return case when private.sesion_activa(p_clave, array['admin']) is not null then 'ok' else 'clave_incorrecta' end;
  end if;
  return private.comprobar_clave_estricta(p_clave);
end;
$$;
revoke all on function private.comprobar_clave(text) from public, anon, authenticated;

create or replace function public.verificar_clave(p_clave text)
returns json language plpgsql security definer set search_path = '' as $$
declare r text;
begin
  r := private.comprobar_clave(p_clave);
  return json_build_object('ok', r = 'ok', 'error', case when r = 'ok' then null else r end);
end;
$$;

create or replace function public.guardar_contenido(p_clave text, p_data jsonb)
returns json language plpgsql security definer set search_path = '' as $$
declare
  r text;
  v_ahora timestamptz := now();
  v_slot int;
  v_bloques text[] := array['hotel','menu','checkin','wifi','habitacion','instalaciones','normas','comer','hacer','compras','emergencias','preguntas','checkout','resena'];
begin
  r := private.comprobar_clave(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  if p_data is null
     or jsonb_typeof(p_data) <> 'object'
     or length(p_data::text) > 500000
     or exists (select 1 from unnest(v_bloques) b where jsonb_typeof(p_data -> b) is distinct from 'object') then
    return json_build_object('ok', false, 'error', 'contenido_invalido');
  end if;
  v_slot := (nextval('private.hist_seq') % 20)::int + 1;
  insert into private.historial (id, data, guardado)
    select v_slot, c.data, v_ahora from public.contenido c where c.id = 1
    on conflict (id) do update set data = excluded.data, guardado = excluded.guardado;
  insert into public.contenido (id, data, actualizado) values (1, p_data, v_ahora)
    on conflict (id) do update set data = excluded.data, actualizado = excluded.actualizado;
  return json_build_object('ok', true, 'actualizado', v_ahora);
end;
$$;

create or replace function public.cambiar_clave(p_actual text, p_nueva text)
returns json language plpgsql security definer set search_path = '' as $$
declare r text;
begin
  r := private.comprobar_clave_estricta(p_actual);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  if p_nueva is null or length(p_nueva) < 10 then
    return json_build_object('ok', false, 'error', 'clave_corta');
  end if;
  update private.admin set hash = extensions.crypt(p_nueva, extensions.gen_salt('bf')) where id = 1;
  update private.sesiones set revocada_en = now() where rol = 'admin' and revocada_en is null;
  return json_build_object('ok', true);
end;
$$;

-- Qué rol tiene una sesión de dispositivo (para abrir la pantalla que corresponde sin pedir la clave otra vez).
create or replace function public.sesion_estado(p_token text)
returns json language plpgsql security definer set search_path = '' as $$
declare v_rol text;
begin
  v_rol := private.sesion_activa(p_token, array['admin', 'recepcion']);
  return json_build_object('ok', v_rol is not null, 'rol', v_rol);
end;
$$;

-- Cierra la sesión de este dispositivo (el botón "Salir"). No borra nada: la marca como cerrada.
create or replace function public.sesion_cerrar(p_token text)
returns json language plpgsql security definer set search_path = '' as $$
begin
  if p_token ~ '^sd_[0-9a-f]{64}$' then
    update private.sesiones set revocada_en = now()
     where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and revocada_en is null;
  end if;
  return json_build_object('ok', true);
end;
$$;

-- Los dispositivos con sesión abierta (del más reciente al más viejo). "actual" marca el que está pidiendo la lista.
create or replace function public.admin_sesiones(p_clave text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  r text;
  v_hash text;
begin
  r := private.comprobar_clave(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  v_hash := case when p_clave ~ '^sd_[0-9a-f]{64}$' then encode(extensions.digest(p_clave, 'sha256'), 'hex') end;
  return json_build_object('ok', true, 'sesiones', coalesce((
    select json_agg(json_build_object('id', s.id, 'rol', s.rol, 'etiqueta', s.etiqueta, 'creado', s.creado,
                                      'ultimo_uso', s.ultimo_uso, 'actual', s.token_hash = v_hash) order by s.ultimo_uso desc, s.id desc)
      from private.sesiones s where s.revocada_en is null and s.vence > now()), '[]'::json));
end;
$$;

-- Cierra la sesión de un dispositivo (p_id) o la de todos los demás (sin p_id). El dispositivo que lo pide se queda adentro.
create or replace function public.admin_sesion_cerrar(p_clave text, p_id bigint default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  r text;
  v_hash text;
begin
  r := private.comprobar_clave(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  v_hash := case when p_clave ~ '^sd_[0-9a-f]{64}$' then encode(extensions.digest(p_clave, 'sha256'), 'hex') end;
  update private.sesiones set revocada_en = now()
   where revocada_en is null and (p_id is null or id = p_id) and token_hash is distinct from v_hash;
  return json_build_object('ok', true);
end;
$$;

revoke all on function public.verificar_clave(text) from public, anon, authenticated;
revoke all on function public.guardar_contenido(text, jsonb) from public, anon, authenticated;
revoke all on function public.cambiar_clave(text, text) from public, anon, authenticated;
grant execute on function public.verificar_clave(text) to anon, authenticated;
grant execute on function public.guardar_contenido(text, jsonb) to anon, authenticated;
grant execute on function public.cambiar_clave(text, text) to anon, authenticated;
revoke all on function public.sesion_estado(text) from public, anon, authenticated;
revoke all on function public.sesion_cerrar(text) from public, anon, authenticated;
revoke all on function public.admin_sesiones(text) from public, anon, authenticated;
revoke all on function public.admin_sesion_cerrar(text, bigint) from public, anon, authenticated;
grant execute on function public.sesion_estado(text) to anon, authenticated;
grant execute on function public.sesion_cerrar(text) to anon, authenticated;
grant execute on function public.admin_sesiones(text) to anon, authenticated;
grant execute on function public.admin_sesion_cerrar(text, bigint) to anon, authenticated;

-- Clave inicial del dueño (cambiá 'TU-CLAVE' antes de ejecutar). Después se cambia desde el panel.
-- insert into private.admin (id, hash) values (1, extensions.crypt('TU-CLAVE', extensions.gen_salt('bf')));
