-- Fotos del documento desde recepción: recepción puede AGREGAR la foto de un huésped (por ejemplo, si el huésped no la subió).
-- No puede quitarla ni cambiarla: eso sigue siendo solo del dueño. Es SOLO LO NUEVO de checkin.sql, listo para pegar en el
-- SQL Editor de Supabase de una base que ya tiene el check-in, los medios de pago y las fotos del dueño
-- (medios_pago.sql y fotos_admin.sql van antes que este). Para una base nueva alcanza con schema.sql + checkin.sql.
--
-- Qué hace:
--   * Suma 2 columnas: quién cargó cada foto (cargada_por) y para quién es cada permiso de subida (por).
--   * Suma 2 funciones para recepción: ver las fotos de un huésped y pedir permiso para agregar una.
--   * Ajusta 3 funciones (fotos_activas, fotos_lista y checkin_foto_registrar) sin cambiar ninguna firma: la guía y el
--     script de Drive que ya están publicados siguen andando igual (NO hay que tocar el script de Google).
--   * No quita ningún dato: las fotos que ya estaban quedan igual.
-- Se puede ejecutar más de una vez sin problema.

alter table private.checkin_fotos add column if not exists cargada_por text check (cargada_por in ('recepcion'));
alter table private.foto_permisos add column if not exists por text not null default 'admin' check (por in ('admin', 'recepcion'));

-- Las fotos que se muestran de un huésped (solo las activas), de la más vieja a la más nueva.
create or replace function private.fotos_activas(p_checkin bigint)
returns json language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object('id', f.id, 'foto_id', f.foto_id, 'nombre', f.nombre, 'origen', f.origen,
                                             'creado', f.creado, 'cargada_por', f.cargada_por) order by f.id), '[]'::json)
    from private.checkin_fotos f where f.checkin_id = p_checkin and f.activa;
$$;

-- Todas las fotos de un huésped, también las quitadas (lo que ve el dueño).
create or replace function private.fotos_lista(p_checkin bigint)
returns json language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object('id', f.id, 'foto_id', f.foto_id, 'nombre', f.nombre, 'origen', f.origen,
                                             'creado', f.creado, 'activa', f.activa, 'quitada_en', f.quitada_en, 'cargada_por', f.cargada_por) order by f.id), '[]'::json)
    from private.checkin_fotos f where f.checkin_id = p_checkin;
$$;

-- Lo llama el script de Drive después de guardar la foto, con la clave que comparte con la base.
create or replace function public.checkin_foto_registrar(p_secreto text, p_ref text, p_foto_id text, p_nombre text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  cfg private.checkin_config;
  v_ck bigint;
  v_foto bigint;
  v_por text;
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
  -- Foto que sube el dueño (admin_foto_permiso) o recepción (recepcion_foto_permiso) a un huésped que ya está cargado.
  update private.foto_permisos set usos = usos + 1
   where ref = p_ref and vence > now() and usos < 3
  returning checkin_id, por into v_ck, v_por;
  if found then
    insert into private.checkin_fotos (checkin_id, foto_id, nombre, origen, cargada_por)
      values (v_ck, p_foto_id, p_nombre, 'admin', case when v_por = 'recepcion' then 'recepcion' end)
      on conflict (checkin_id, foto_id) do nothing
      returning id into v_foto;
    if v_foto is not null then
      perform private.auditar(v_por, 'foto_agregada', v_ck, jsonb_build_object('foto', v_foto));
    end if;
    return json_build_object('ok', true);
  end if;
  -- Foto que manda el huésped mientras completa el formulario (todavía no es un huésped cargado).
  update private.checkin_sesiones
     set foto_id = p_foto_id, foto_nombre = p_nombre, fotos = fotos + 1
   where left(token_hash, 32) = p_ref and not usada and vence > now() and fotos < 3;
  if not found then
    return json_build_object('ok', false, 'error', 'sesion_invalida');
  end if;
  return json_build_object('ok', true);
end;
$$;

-- Fotos de un huésped para recepción: solo las que se muestran (las quitadas por el dueño no aparecen) y si hay un Drive
-- conectado para subir más. Recepción ve a los huéspedes de los últimos días, igual que en su planilla.
create or replace function public.recepcion_fotos(p_clave text, p_id bigint)
returns json language plpgsql security definer set search_path = '' as $$
declare
  r text;
  cfg private.checkin_config;
begin
  r := private.comprobar_recepcion(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  select * into cfg from private.checkin_config where id = 1;
  if not exists (select 1 from private.checkins k where k.id = p_id and k.creado > now() - make_interval(days => cfg.dias_recepcion)) then
    return json_build_object('ok', false, 'error', 'no_existe');
  end if;
  return json_build_object('ok', true, 'fotos', private.fotos_activas(p_id), 'drive', cfg.foto_url is not null);
end;
$$;

-- Permiso firmado de 10 minutos para que recepción agregue una foto del documento a este huésped (por ejemplo, cuando el huésped
-- no la subió). Es el mismo camino que usa el dueño: la foto sale directo al script de Drive y el script avisa a la base.
-- Recepción solo puede agregar: no hay ninguna función para que quite o cambie las fotos que ya están.
create or replace function public.recepcion_foto_permiso(p_clave text, p_id bigint)
returns json language plpgsql security definer set search_path = '' as $$
declare
  r text;
  cfg private.checkin_config;
  v_ref text;
  v_vence timestamptz;
begin
  r := private.comprobar_recepcion(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  select * into cfg from private.checkin_config where id = 1;
  if not exists (select 1 from private.checkins k where k.id = p_id and k.creado > now() - make_interval(days => cfg.dias_recepcion)) then
    return json_build_object('ok', false, 'error', 'no_existe');
  end if;
  if cfg.foto_url is null then
    return json_build_object('ok', false, 'error', 'sin_drive');
  end if;
  if (select count(*) from private.checkin_fotos where checkin_id = p_id and activa) >= 10 then
    return json_build_object('ok', false, 'error', 'limite_fotos');
  end if;
  v_ref := encode(extensions.gen_random_bytes(16), 'hex');
  v_vence := now() + interval '10 minutes';
  insert into private.foto_permisos (ref, checkin_id, vence, por) values (v_ref, p_id, v_vence, 'recepcion');
  return json_build_object('ok', true, 'url', cfg.foto_url, 'ticket', private.ticket_foto(v_ref, v_vence, cfg.foto_secreto), 'vence_seg', 600);
end;
$$;

revoke all on function private.fotos_activas(bigint) from public, anon, authenticated;
revoke all on function private.fotos_lista(bigint) from public, anon, authenticated;
revoke all on function public.checkin_foto_registrar(text, text, text, text) from public, anon, authenticated;
revoke all on function public.recepcion_fotos(text, bigint) from public, anon, authenticated;
revoke all on function public.recepcion_foto_permiso(text, bigint) from public, anon, authenticated;

grant execute on function public.checkin_foto_registrar(text, text, text, text) to anon, authenticated;
grant execute on function public.recepcion_fotos(text, bigint) to anon, authenticated;
grant execute on function public.recepcion_foto_permiso(text, bigint) to anon, authenticated;

-- Avisa a la API que hay funciones nuevas (si no, tarda unos minutos en verlas).
notify pgrst, 'reload schema';
