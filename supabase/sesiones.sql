-- Ingreso con sesión de dispositivo: el personal pone la clave una vez y el celular queda con la sesión abierta (60 días de uso).
-- Es SOLO LO NUEVO de schema.sql y checkin.sql, listo para pegar en el SQL Editor de Supabase de una base que ya tiene el check-in
-- (medios_pago.sql, fotos_admin.sql y fotos_recepcion.sql van antes que este). Para una base nueva alcanza con schema.sql + checkin.sql.
--
-- Qué hace:
--   * Crea la tabla de sesiones (solo guarda la huella del código de cada dispositivo, nunca la clave).
--   * Suma 5 funciones: sesion_entrar, sesion_estado, sesion_cerrar, admin_sesiones y admin_sesion_cerrar.
--   * Ajusta 4 funciones sin cambiar ninguna firma: comprobar_clave y comprobar_recepcion aceptan también el código de dispositivo,
--     cambiar_clave sigue pidiendo la clave de verdad (un celular que quedó abierto no puede cambiarla) y cierra las demás sesiones,
--     y admin_checkin_clave_recepcion cierra las sesiones de recepción. Las pantallas que ya están publicadas siguen andando igual.
--   * No quita ningún dato: cerrar una sesión solo la marca como cerrada.
-- Se puede ejecutar más de una vez sin problema.

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

create or replace function private.comprobar_recepcion(p_clave text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_hash text;
begin
  -- Sesión de dispositivo (la de recepción o la del dueño, que también puede entrar a recepción).
  if p_clave ~ '^sd_[0-9a-f]{64}$' then
    return case when private.sesion_activa(p_clave, array['admin', 'recepcion']) is not null then 'ok' else 'clave_incorrecta' end;
  end if;
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
  update private.sesiones set revocada_en = now() where rol = 'recepcion' and revocada_en is null;
  perform private.auditar('admin', 'clave_recepcion', null, null);
  return json_build_object('ok', true);
end;
$$;

-- Una sola pantalla de ingreso para todo el personal: la clave del dueño abre su panel y la de recepción abre recepción.
-- Devuelve un código de dispositivo (válido 60 días de uso) para que no haya que escribir la clave de nuevo.
create or replace function public.sesion_entrar(p_clave text, p_etiqueta text default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ip text;
  v_hash text;
  v_rol text;
  v_token text;
begin
  v_ip := 'ses|' || private.ip_actual();
  if (select count(*) from private.intentos where ip = v_ip and at > now() - interval '1 minute') >= 8 then
    return json_build_object('ok', false, 'error', 'demasiados_intentos');
  end if;
  if p_clave is not null and length(p_clave) between 1 and 200 then
    if exists (select 1 from private.admin a where a.hash = extensions.crypt(p_clave, a.hash)) then
      v_rol := 'admin';
    else
      select hash_recepcion into v_hash from private.checkin_config where id = 1;
      if v_hash is not null and extensions.crypt(p_clave, v_hash) = v_hash then
        v_rol := 'recepcion';
      end if;
    end if;
  end if;
  if v_rol is null then
    insert into private.intentos (ip) values (v_ip);
    return json_build_object('ok', false, 'error', 'clave_incorrecta');
  end if;
  v_token := 'sd_' || encode(extensions.gen_random_bytes(32), 'hex');
  insert into private.sesiones (token_hash, rol, etiqueta, vence)
    values (encode(extensions.digest(v_token, 'sha256'), 'hex'), v_rol, nullif(left(btrim(coalesce(p_etiqueta, '')), 60), ''), now() + interval '60 days');
  perform private.auditar(v_rol, 'sesion_abierta', null, null);
  return json_build_object('ok', true, 'rol', v_rol, 'token', v_token);
end;
$$;

revoke all on function private.sesion_activa(text, text[]) from public, anon, authenticated;
revoke all on function private.comprobar_clave_estricta(text) from public, anon, authenticated;
revoke all on function public.sesion_estado(text) from public, anon, authenticated;
revoke all on function public.sesion_cerrar(text) from public, anon, authenticated;
revoke all on function public.admin_sesiones(text) from public, anon, authenticated;
revoke all on function public.admin_sesion_cerrar(text, bigint) from public, anon, authenticated;
revoke all on function public.sesion_entrar(text, text) from public, anon, authenticated;

grant execute on function public.sesion_estado(text) to anon, authenticated;
grant execute on function public.sesion_cerrar(text) to anon, authenticated;
grant execute on function public.admin_sesiones(text) to anon, authenticated;
grant execute on function public.admin_sesion_cerrar(text, bigint) to anon, authenticated;
grant execute on function public.sesion_entrar(text, text) to anon, authenticated;

-- Avisa a la API que hay funciones nuevas (si no, tarda unos minutos en verlas).
notify pgrst, 'reload schema';
