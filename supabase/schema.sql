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

create or replace function private.comprobar_clave(p_clave text)
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
  r := private.comprobar_clave(p_actual);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  if p_nueva is null or length(p_nueva) < 10 then
    return json_build_object('ok', false, 'error', 'clave_corta');
  end if;
  update private.admin set hash = extensions.crypt(p_nueva, extensions.gen_salt('bf')) where id = 1;
  return json_build_object('ok', true);
end;
$$;

revoke all on function public.verificar_clave(text) from public, anon, authenticated;
revoke all on function public.guardar_contenido(text, jsonb) from public, anon, authenticated;
revoke all on function public.cambiar_clave(text, text) from public, anon, authenticated;
grant execute on function public.verificar_clave(text) to anon, authenticated;
grant execute on function public.guardar_contenido(text, jsonb) to anon, authenticated;
grant execute on function public.cambiar_clave(text, text) to anon, authenticated;

-- Clave inicial del dueño (cambiá 'TU-CLAVE' antes de ejecutar). Después se cambia desde el panel.
-- insert into private.admin (id, hash) values (1, extensions.crypt('TU-CLAVE', extensions.gen_salt('bf')));
