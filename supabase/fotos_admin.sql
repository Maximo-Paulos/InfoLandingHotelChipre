-- Fotos del documento: el dueño las carga a mano, agrega otra y quita las que no se ven (se suma al check-in que ya está en la base).
-- Es SOLO LO NUEVO de checkin.sql, listo para pegar en el SQL Editor de Supabase de una base que ya tiene el check-in y los medios
-- de pago (medios_pago.sql, que va antes que este). (Para una base nueva alcanza con schema.sql + checkin.sql, que ya lo incluye todo.)
--
-- Qué hace:
--   * Crea la lista de fotos de cada huésped (antes cada uno tenía una sola) y pasa a ella las fotos que ya estaban cargadas.
--   * Suma 3 funciones para que el dueño vea las fotos de un huésped, suba una nueva y quite o vuelva a poner una.
--   * Ajusta 4 funciones (checkin_enviar, checkin_foto_registrar, recepcion_estado, admin_huespedes). No cambia ninguna firma:
--     la guía y el script de Drive que ya están publicados siguen andando igual (NO hay que tocar el script de Google).
--   * No borra nada: ningún dato se elimina. "Quitar" una foto solo la oculta de la lista y se puede volver a poner.
-- Se puede ejecutar más de una vez sin problema.

-- ---------------------------------------------------------------- fotos del documento
-- Las fotos de cada huésped: la que mandó él al hacer el check-in y las que sube el dueño después. La imagen NO se guarda acá:
-- está en la carpeta de Drive; en la base quedan el id del archivo y su nombre.
-- NUNCA se borran: "quitar" una foto la saca de la lista (activa = false) pero la fila y el archivo de Drive quedan, y el dueño
-- puede volver a ponerla.
create table if not exists private.checkin_fotos (
  id bigint generated always as identity primary key,
  checkin_id bigint not null references private.checkins (id),
  foto_id text not null,
  nombre text,
  origen text not null default 'huesped' check (origen in ('huesped', 'admin')),
  creado timestamptz not null default now(),
  activa boolean not null default true,
  quitada_en timestamptz,
  quitada_por text
);
create unique index if not exists checkin_fotos_uq on private.checkin_fotos (checkin_id, foto_id);
create index if not exists checkin_fotos_checkin_idx on private.checkin_fotos (checkin_id, id);
alter table private.checkin_fotos enable row level security;

-- Permiso de pocos minutos para que el dueño suba una foto a un huésped que ya está cargado (lo pide admin_foto_permiso).
create table if not exists private.foto_permisos (
  ref text primary key check (ref ~ '^[0-9a-f]{32}$'),
  checkin_id bigint not null references private.checkins (id),
  vence timestamptz not null,
  usos int not null default 0,
  creado timestamptz not null default now()
);
alter table private.foto_permisos enable row level security;

-- Las fotos que ya estaban (la que mandó cada huésped) pasan a la lista nueva. Se puede repetir: no duplica ni vuelve a poner
-- una foto que el dueño ya quitó.
insert into private.checkin_fotos (checkin_id, foto_id, nombre, origen, creado)
  select k.id, k.foto_id, k.foto_nombre, 'huesped', k.creado
    from private.checkins k
   where k.foto_id is not null
     and not exists (select 1 from private.checkin_fotos f where f.checkin_id = k.id and f.foto_id = k.foto_id);

-- ---------------------------------------------------------------- funciones

-- Las fotos que se muestran de un huésped (solo las activas), de la más vieja a la más nueva.
create or replace function private.fotos_activas(p_checkin bigint)
returns json language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object('id', f.id, 'foto_id', f.foto_id, 'nombre', f.nombre, 'origen', f.origen) order by f.id), '[]'::json)
    from private.checkin_fotos f where f.checkin_id = p_checkin and f.activa;
$$;

-- Todas las fotos de un huésped, también las quitadas (lo que ve el dueño).
create or replace function private.fotos_lista(p_checkin bigint)
returns json language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object('id', f.id, 'foto_id', f.foto_id, 'nombre', f.nombre, 'origen', f.origen,
                                             'creado', f.creado, 'activa', f.activa, 'quitada_en', f.quitada_en) order by f.id), '[]'::json)
    from private.checkin_fotos f where f.checkin_id = p_checkin;
$$;

-- Guarda el formulario del huésped (una vez por sesión).
create or replace function public.checkin_enviar(p_token text, p_datos jsonb, p_idioma text, p_acepta boolean)
returns json language plpgsql security definer set search_path = '' as $$
declare
  cfg private.checkin_config;
  s private.checkin_sesiones;
  v_hash text;
  v jsonb;
  v_id bigint;
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
            jsonb_build_object('aceptado', true, 'version', 1, 'en', now()), s.foto_id, s.foto_nombre)
    returning id into v_id;
  if s.foto_id is not null then
    insert into private.checkin_fotos (checkin_id, foto_id, nombre, origen) values (v_id, s.foto_id, s.foto_nombre, 'huesped');
  end if;
  update private.checkin_sesiones set usada = true where token_hash = v_hash;
  return json_build_object('ok', true);
end;
$$;

-- Lo llama el script de Drive después de guardar la foto, con la clave que comparte con la base.
create or replace function public.checkin_foto_registrar(p_secreto text, p_ref text, p_foto_id text, p_nombre text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  cfg private.checkin_config;
  v_ck bigint;
  v_foto bigint;
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
  -- Foto que sube el dueño a un huésped que ya está cargado: viene con el permiso que dio admin_foto_permiso.
  update private.foto_permisos set usos = usos + 1
   where ref = p_ref and vence > now() and usos < 3
  returning checkin_id into v_ck;
  if found then
    insert into private.checkin_fotos (checkin_id, foto_id, nombre, origen) values (v_ck, p_foto_id, p_nombre, 'admin')
      on conflict (checkin_id, foto_id) do nothing
      returning id into v_foto;
    if v_foto is not null then
      perform private.auditar('admin', 'foto_agregada', v_ck, jsonb_build_object('foto', v_foto));
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
    select k.id, k.creado, k.habitacion, k.datos,
           (select f.foto_id from private.checkin_fotos f where f.checkin_id = k.id and f.activa order by f.id limit 1) as foto_id,
           (select f.nombre from private.checkin_fotos f where f.checkin_id = k.id and f.activa order by f.id limit 1) as foto_nombre,
           private.fotos_activas(k.id) as fotos,
           k.medio_pago_id, m.nombre as medio_pago,
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
      select k.id, k.creado, k.habitacion, k.datos,
             (select f.foto_id from private.checkin_fotos f where f.checkin_id = k.id and f.activa order by f.id limit 1) as foto_id,
             (select f.nombre from private.checkin_fotos f where f.checkin_id = k.id and f.activa order by f.id limit 1) as foto_nombre,
             private.fotos_activas(k.id) as fotos,
             k.editado_en, k.editado_por,
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

-- Todas las fotos de un huésped (también las quitadas) y si hay un Drive conectado para subir más.
create or replace function public.admin_fotos(p_clave text, p_id bigint)
returns json language plpgsql security definer set search_path = '' as $$
declare
  r text;
  cfg private.checkin_config;
begin
  r := private.comprobar_clave(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  if not exists (select 1 from private.checkins where id = p_id) then
    return json_build_object('ok', false, 'error', 'no_existe');
  end if;
  select * into cfg from private.checkin_config where id = 1;
  return json_build_object('ok', true, 'fotos', private.fotos_lista(p_id), 'drive', cfg.foto_url is not null);
end;
$$;

-- Permiso firmado de 10 minutos para subir una foto a este huésped con el mismo script de Drive que usan los huéspedes.
-- La foto sale del celular o la compu del dueño directo al script; el script la guarda en la carpeta y avisa a la base
-- (checkin_foto_registrar), que la anota en la lista de este huésped.
create or replace function public.admin_foto_permiso(p_clave text, p_id bigint)
returns json language plpgsql security definer set search_path = '' as $$
declare
  r text;
  cfg private.checkin_config;
  v_ref text;
  v_vence timestamptz;
begin
  r := private.comprobar_clave(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  if not exists (select 1 from private.checkins where id = p_id) then
    return json_build_object('ok', false, 'error', 'no_existe');
  end if;
  select * into cfg from private.checkin_config where id = 1;
  if cfg.foto_url is null then
    return json_build_object('ok', false, 'error', 'sin_drive');
  end if;
  if (select count(*) from private.checkin_fotos where checkin_id = p_id and activa) >= 10 then
    return json_build_object('ok', false, 'error', 'limite_fotos');
  end if;
  v_ref := encode(extensions.gen_random_bytes(16), 'hex');
  v_vence := now() + interval '10 minutes';
  insert into private.foto_permisos (ref, checkin_id, vence) values (v_ref, p_id, v_vence);
  return json_build_object('ok', true, 'url', cfg.foto_url, 'ticket', private.ticket_foto(v_ref, v_vence, cfg.foto_secreto), 'vence_seg', 600);
end;
$$;

-- Quita una foto de la lista (p_quitar = true) o la vuelve a poner (false). NO borra nada: la fila y el archivo de Drive quedan.
create or replace function public.admin_foto_quitar(p_clave text, p_foto bigint, p_quitar boolean default true)
returns json language plpgsql security definer set search_path = '' as $$
declare
  r text;
  f private.checkin_fotos;
  v_quitar boolean;
begin
  r := private.comprobar_clave(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  select * into f from private.checkin_fotos where id = p_foto for update;
  if not found then
    return json_build_object('ok', false, 'error', 'no_existe');
  end if;
  v_quitar := coalesce(p_quitar, true);
  if v_quitar and f.activa then
    update private.checkin_fotos set activa = false, quitada_en = now(), quitada_por = 'admin' where id = f.id;
    perform private.auditar('admin', 'foto_quitada', f.checkin_id, jsonb_build_object('foto', f.id));
  elsif not v_quitar and not f.activa then
    if (select count(*) from private.checkin_fotos where checkin_id = f.checkin_id and activa) >= 10 then
      return json_build_object('ok', false, 'error', 'limite_fotos');
    end if;
    update private.checkin_fotos set activa = true, quitada_en = null, quitada_por = null where id = f.id;
    perform private.auditar('admin', 'foto_repuesta', f.checkin_id, jsonb_build_object('foto', f.id));
  end if;
  return json_build_object('ok', true, 'fotos', private.fotos_lista(f.checkin_id));
end;
$$;

-- ---------------------------------------------------------------- permisos

revoke all on function private.fotos_activas(bigint) from public, anon, authenticated;
revoke all on function private.fotos_lista(bigint) from public, anon, authenticated;
revoke all on function public.checkin_enviar(text, jsonb, text, boolean) from public, anon, authenticated;
revoke all on function public.checkin_foto_registrar(text, text, text, text) from public, anon, authenticated;
revoke all on function public.recepcion_estado(text) from public, anon, authenticated;
revoke all on function public.admin_huespedes(text, text, int, bigint) from public, anon, authenticated;
revoke all on function public.admin_fotos(text, bigint) from public, anon, authenticated;
revoke all on function public.admin_foto_permiso(text, bigint) from public, anon, authenticated;
revoke all on function public.admin_foto_quitar(text, bigint, boolean) from public, anon, authenticated;

grant execute on function public.checkin_enviar(text, jsonb, text, boolean) to anon, authenticated;
grant execute on function public.checkin_foto_registrar(text, text, text, text) to anon, authenticated;
grant execute on function public.recepcion_estado(text) to anon, authenticated;
grant execute on function public.admin_huespedes(text, text, int, bigint) to anon, authenticated;
grant execute on function public.admin_fotos(text, bigint) to anon, authenticated;
grant execute on function public.admin_foto_permiso(text, bigint) to anon, authenticated;
grant execute on function public.admin_foto_quitar(text, bigint, boolean) to anon, authenticated;

-- Avisa a la API que hay funciones nuevas (si no, tarda unos minutos en verlas).
notify pgrst, 'reload schema';
