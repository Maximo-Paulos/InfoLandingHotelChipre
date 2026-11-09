-- Equipo con alias y clave propia, un código de check-in por persona y "check-in habilitado por": quién dio el permiso.
-- Es SOLO LO NUEVO de schema.sql y checkin.sql, listo para pegar en el SQL Editor de Supabase de una base que ya tiene
-- sesiones.sql (medios_pago.sql, fotos_admin.sql, fotos_recepcion.sql y sesiones.sql van antes). Para una base nueva alcanza con
-- schema.sql + checkin.sql.
--
-- Qué hace:
--   * Crea la tabla del equipo (private.usuarios: alias, rol, clave encriptada) y la de códigos por persona (private.codigos_usuario).
--   * Suma las columnas "habilitado_por" (el nombre de quien dio el código, escrito tal como se llamaba ese día) a las sesiones de
--     check-in y a los check-ins, y "usuario_id" a las sesiones de dispositivo.
--   * Pasa la clave de recepción que ya existe a la primera persona del equipo, con el alias "Recepción", y deja abiertas las
--     sesiones de recepción que ya estaban: nadie tiene que volver a ingresar.
--   * Suma 2 funciones (admin_equipo y admin_equipo_guardar, solo para el dueño) y ajusta las que siguen sin cambiar ninguna firma.
--   * No quita ningún dato. Los check-ins que ya estaban quedan sin "habilitado_por" (no se sabe quién dio el código).
-- Se puede ejecutar más de una vez sin problema.

create table if not exists private.usuarios (
  id bigint generated always as identity primary key,
  alias text not null check (length(btrim(alias)) between 1 and 30),
  rol text not null check (rol in ('admin', 'recepcion')),
  hash_clave text not null,
  activo boolean not null default true,
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now()
);
create unique index if not exists usuarios_alias_uq on private.usuarios (lower(btrim(alias))) where activo;
alter table private.usuarios enable row level security;

alter table private.sesiones add column if not exists usuario_id bigint references private.usuarios (id);

create table if not exists private.codigos_usuario (
  usuario_id bigint primary key,
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
alter table private.codigos_usuario enable row level security;

alter table private.checkin_sesiones add column if not exists habilitado_por text;
alter table private.checkins add column if not exists habilitado_por text;

-- La clave de recepción de hoy pasa a ser la primera persona del equipo (solo si todavía no hay nadie) y sus sesiones abiertas
-- quedan a su nombre.
insert into private.usuarios (alias, rol, hash_clave)
  select 'Recepción', 'recepcion', c.hash_recepcion
    from private.checkin_config c
   where c.id = 1 and c.hash_recepcion is not null and not exists (select 1 from private.usuarios);
update private.sesiones
   set usuario_id = (select u.id from private.usuarios u where u.alias = 'Recepción' order by u.id limit 1)
 where rol = 'recepcion' and usuario_id is null;

create or replace function private.usuario_por_clave(p_clave text)
returns private.usuarios language plpgsql security definer set search_path = '' as $$
declare u private.usuarios;
begin
  if p_clave is null or length(p_clave) not between 1 and 200 then
    return u;
  end if;
  select * into u from private.usuarios x where x.activo and x.hash_clave = extensions.crypt(p_clave, x.hash_clave) limit 1;
  return u;
end;
$$;

create or replace function private.actor(p_clave text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s record;
  u private.usuarios;
begin
  if p_clave is null then
    return null;
  end if;
  if p_clave ~ '^sd_[0-9a-f]{64}$' then
    select x.rol, x.usuario_id, y.alias, y.activo into s
      from private.sesiones x left join private.usuarios y on y.id = x.usuario_id
     where x.token_hash = encode(extensions.digest(p_clave, 'sha256'), 'hex') and x.revocada_en is null and x.vence > now();
    if not found then
      return null;
    end if;
    if s.usuario_id is null then
      -- una sesión sin persona del equipo es la del dueño (si no es de rol admin no es de nadie)
      return case when s.rol = 'admin' then jsonb_build_object('id', 0, 'alias', 'Dueño', 'rol', 'admin', 'dueno', true) end;
    end if;
    if not s.activo then
      return null;
    end if;
    return jsonb_build_object('id', s.usuario_id, 'alias', s.alias, 'rol', s.rol, 'dueno', false);
  end if;
  if length(p_clave) between 1 and 200 and exists (select 1 from private.admin a where a.hash = extensions.crypt(p_clave, a.hash)) then
    return jsonb_build_object('id', 0, 'alias', 'Dueño', 'rol', 'admin', 'dueno', true);
  end if;
  u := private.usuario_por_clave(p_clave);
  if u.id is null then
    return null;
  end if;
  return jsonb_build_object('id', u.id, 'alias', u.alias, 'rol', u.rol, 'dueno', false);
end;
$$;

create or replace function private.comprobar_dueno(p_clave text)
returns text language plpgsql security definer set search_path = '' as $$
declare r text;
begin
  r := private.comprobar_clave(p_clave);
  if r <> 'ok' then
    return r;
  end if;
  return case when coalesce((private.actor(p_clave) ->> 'dueno')::boolean, false) then 'ok' else 'sin_permiso' end;
end;
$$;

create or replace function private.comprobar_recepcion(p_clave text)
returns text language plpgsql security definer set search_path = '' as $$
declare u private.usuarios;
begin
  -- Sesión de dispositivo (la de recepción o la del dueño, que también puede entrar a recepción).
  if p_clave ~ '^sd_[0-9a-f]{64}$' then
    return case when private.sesion_activa(p_clave, array['admin', 'recepcion']) is not null
                 and private.actor(p_clave) is not null then 'ok' else 'clave_incorrecta' end;
  end if;
  if private.limite_alcanzado('rec', 8) then
    return 'demasiados_intentos';
  end if;
  u := private.usuario_por_clave(p_clave);
  if u.id is null then
    perform private.registrar_fallo('rec');
    return 'clave_incorrecta';
  end if;
  return 'ok';
end;
$$;

create or replace function private.codigo_usuario(p_usuario bigint, p_forzar boolean default false)
returns private.codigos_usuario language plpgsql security definer set search_path = '' as $$
declare
  c private.codigos_usuario;
  cfg private.checkin_config;
  nuevo text;
  n int := 0;
begin
  select * into cfg from private.checkin_config where id = 1;
  insert into private.codigos_usuario (usuario_id) values (p_usuario) on conflict (usuario_id) do nothing;
  select * into c from private.codigos_usuario where usuario_id = p_usuario for update;
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
      exit when n > 20 or not exists (select 1 from private.codigos_usuario o where o.codigo = nuevo or o.prev_codigo = nuevo);
    end loop;
    c.grupo := nextval('private.checkin_grupo_seq');
    c.codigo := nuevo;
    c.vence := now() + make_interval(secs => cfg.codigo_seg);
    c.usos := 0;
    c.usos_max := cfg.usos_max;
    update private.codigos_usuario set
      grupo = c.grupo, codigo = c.codigo, vence = c.vence, usos = c.usos, usos_max = c.usos_max,
      prev_codigo = c.prev_codigo, prev_vence = c.prev_vence, prev_usos = c.prev_usos,
      prev_usos_max = c.prev_usos_max, prev_grupo = c.prev_grupo
    where usuario_id = p_usuario;
  end if;
  return c;
end;
$$;

create or replace function private.equipo_lista()
returns json language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object(
           'id', u.id, 'alias', u.alias, 'rol', u.rol, 'activo', u.activo, 'creado', u.creado,
           'sesiones', (select count(*)::int from private.sesiones s where s.usuario_id = u.id and s.revocada_en is null and s.vence > now()),
           'ultimo_uso', (select max(s.ultimo_uso) from private.sesiones s where s.usuario_id = u.id))
         order by u.activo desc, lower(u.alias), u.id), '[]'::json)
    from private.usuarios u;
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
  update private.sesiones set revocada_en = now() where rol = 'admin' and usuario_id is null and revocada_en is null;
  return json_build_object('ok', true);
end;
$$;

create or replace function public.sesion_estado(p_token text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_rol text;
  v_actor jsonb;
begin
  v_rol := private.sesion_activa(p_token, array['admin', 'recepcion']);
  v_actor := case when v_rol is not null then private.actor(p_token) end;
  return json_build_object('ok', v_actor is not null, 'rol', case when v_actor is not null then v_rol end,
                           'alias', v_actor ->> 'alias', 'dueno', coalesce((v_actor ->> 'dueno')::boolean, false));
end;
$$;

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
    select json_agg(json_build_object('id', s.id, 'rol', s.rol, 'alias', coalesce(u.alias, 'Dueño'), 'etiqueta', s.etiqueta, 'creado', s.creado,
                                      'ultimo_uso', s.ultimo_uso, 'actual', s.token_hash = v_hash) order by s.ultimo_uso desc, s.id desc)
      from private.sesiones s left join private.usuarios u on u.id = s.usuario_id
     where s.revocada_en is null and s.vence > now()), '[]'::json));
end;
$$;

create or replace function public.checkin_canjear(p_codigo text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  cfg private.checkin_config;
  c private.codigos_usuario;
  v_cod text;
  v_grupo bigint;
  v_alias text;
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
  -- De quién es el código: si esa persona ya no está activa, su código no sirve.
  select k.* into c from private.codigos_usuario k
   where length(v_cod) = 6 and (k.codigo = v_cod or k.prev_codigo = v_cod)
     and (k.usuario_id = 0 or exists (select 1 from private.usuarios u where u.id = k.usuario_id and u.activo))
   order by (k.codigo = v_cod) desc limit 1 for update of k;
  if found and c.codigo = v_cod and now() < c.vence + interval '10 seconds' and c.usos < c.usos_max then
    update private.codigos_usuario set usos = usos + 1 where usuario_id = c.usuario_id;
    v_grupo := c.grupo;
  elsif found and c.prev_codigo = v_cod and now() < c.prev_vence + interval '10 seconds' and c.prev_usos < c.prev_usos_max then
    update private.codigos_usuario set prev_usos = prev_usos + 1 where usuario_id = c.usuario_id;
    v_grupo := c.prev_grupo;
  else
    perform private.registrar_fallo('cod');
    return json_build_object('ok', false, 'error', 'codigo_invalido');
  end if;
  -- El nombre queda escrito tal como se llama hoy: si después le cambian el alias, este check-in sigue diciendo el de ese momento.
  v_alias := case when c.usuario_id = 0 then 'Dueño' else (select u.alias from private.usuarios u where u.id = c.usuario_id) end;
  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  v_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');
  v_vence := now() + make_interval(mins => cfg.sesion_min);
  insert into private.checkin_sesiones (token_hash, grupo, vence, habilitado_por) values (v_hash, v_grupo, v_vence, v_alias);
  return json_build_object('ok', true, 'token', v_token, 'vence_seg', cfg.sesion_min * 60,
                           'foto', private.foto_info(cfg, v_hash, v_vence, false));
end;
$$;

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
  insert into private.checkins (grupo, idioma, datos, consentimiento, foto_id, foto_nombre, habilitado_por)
    values (s.grupo, left(regexp_replace(coalesce(p_idioma, ''), '[^A-Za-z-]', '', 'g'), 10), v -> 'datos',
            jsonb_build_object('aceptado', true, 'version', 1, 'en', now()), s.foto_id, s.foto_nombre, s.habilitado_por)
    returning id into v_id;
  if s.foto_id is not null then
    insert into private.checkin_fotos (checkin_id, foto_id, nombre, origen) values (v_id, s.foto_id, s.foto_nombre, 'huesped');
  end if;
  update private.checkin_sesiones set usada = true where token_hash = v_hash;
  return json_build_object('ok', true);
end;
$$;

create or replace function public.recepcion_estado(p_clave text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  r text;
  cfg private.checkin_config;
  c private.codigos_usuario;
  v_actor jsonb;
  v_lista json;
  v_config json;
  v_medios json;
begin
  r := private.comprobar_recepcion(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  v_actor := private.actor(p_clave);
  select * into cfg from private.checkin_config where id = 1;
  select coalesce(json_agg(row_to_json(t) order by t.creado desc), '[]'::json) into v_lista from (
    select k.id, k.creado, k.habitacion, k.datos, k.habilitado_por,
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
    return json_build_object('ok', true, 'activo', false, 'codigo', null, 'quien', v_actor ->> 'alias', 'config', v_config, 'huespedes', v_lista, 'medios_pago', v_medios);
  end if;
  c := private.codigo_usuario((v_actor ->> 'id')::bigint, false);
  return json_build_object('ok', true, 'activo', true, 'quien', v_actor ->> 'alias',
    'codigo', json_build_object('valor', c.codigo,
                                'vence_seg', greatest(0, ceil(extract(epoch from (c.vence - now()))))::int,
                                'usos', c.usos, 'usos_max', c.usos_max),
    'config', v_config, 'huespedes', v_lista, 'medios_pago', v_medios);
end;
$$;

create or replace function public.recepcion_codigo_nuevo(p_clave text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  r text;
  cfg private.checkin_config;
  c private.codigos_usuario;
  v_actor jsonb;
begin
  r := private.comprobar_recepcion(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  v_actor := private.actor(p_clave);
  select * into cfg from private.checkin_config where id = 1;
  if not cfg.activo then
    return json_build_object('ok', false, 'error', 'no_disponible');
  end if;
  c := private.codigo_usuario((v_actor ->> 'id')::bigint, true);
  perform private.auditar('recepcion', 'codigo_nuevo', null, jsonb_build_object('alias', v_actor ->> 'alias'));
  return json_build_object('ok', true,
    'codigo', json_build_object('valor', c.codigo,
                                'vence_seg', greatest(0, ceil(extract(epoch from (c.vence - now()))))::int,
                                'usos', c.usos, 'usos_max', c.usos_max));
end;
$$;

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
    'recepcion_con_clave', exists (select 1 from private.usuarios u where u.activo)));
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
  -- Las claves ahora son una por persona (admin_equipo_guardar). Esta función queda solo para pantallas viejas.
  return json_build_object('ok', false, 'error', 'usar_equipo');
end;
$$;

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
      select k.id, k.creado, k.habitacion, k.datos, k.habilitado_por,
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

create or replace function public.admin_equipo(p_clave text)
returns json language plpgsql security definer set search_path = '' as $$
declare r text;
begin
  r := private.comprobar_dueno(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  return json_build_object('ok', true, 'usuarios', private.equipo_lista());
end;
$$;

create or replace function public.admin_equipo_guardar(p_clave text, p_id bigint, p_alias text, p_rol text, p_clave_usuario text, p_activo boolean default true)
returns json language plpgsql security definer set search_path = '' as $$
declare
  r text;
  u private.usuarios;
  v_alias text;
  v_rol text;
  v_activo boolean;
  v_clave boolean := nullif(p_clave_usuario, '') is not null;
  v_cambios text[] := array[]::text[];
begin
  r := private.comprobar_dueno(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  if p_id is not null then
    select * into u from private.usuarios where id = p_id for update;
    if not found then
      return json_build_object('ok', false, 'error', 'no_existe');
    end if;
  end if;
  v_alias := coalesce(nullif(btrim(coalesce(p_alias, '')), ''), u.alias);
  v_rol := coalesce(p_rol, u.rol);
  v_activo := coalesce(p_activo, u.activo, true);
  if v_alias is null or v_alias !~ '^[^[:cntrl:]]{1,30}$' then
    return json_build_object('ok', false, 'error', 'alias_invalido');
  end if;
  if v_rol is null or v_rol not in ('admin', 'recepcion') then
    return json_build_object('ok', false, 'error', 'rol_invalido');
  end if;
  if v_clave then
    if length(p_clave_usuario) < 8 or length(p_clave_usuario) > 100 then
      return json_build_object('ok', false, 'error', 'clave_corta');
    end if;
    -- una clave no puede repetirse: con ella se sabe quién entra (ni con la del dueño ni con la de alguien que ya no está)
    if exists (select 1 from private.admin a where a.hash = extensions.crypt(p_clave_usuario, a.hash))
       or exists (select 1 from private.usuarios x where x.id is distinct from p_id and x.hash_clave = extensions.crypt(p_clave_usuario, x.hash_clave)) then
      return json_build_object('ok', false, 'error', 'clave_repetida');
    end if;
  elsif p_id is null then
    return json_build_object('ok', false, 'error', 'clave_corta');
  end if;
  if v_activo and (lower(v_alias) in ('dueño', 'dueno')
                   or exists (select 1 from private.usuarios x where x.activo and x.id is distinct from p_id and lower(btrim(x.alias)) = lower(v_alias))) then
    return json_build_object('ok', false, 'error', 'alias_repetido');
  end if;
  if p_id is null then
    insert into private.usuarios (alias, rol, hash_clave, activo)
      values (v_alias, v_rol, extensions.crypt(p_clave_usuario, extensions.gen_salt('bf')), v_activo)
      returning * into u;
    perform private.auditar('admin', 'usuario_creado', null, jsonb_build_object('alias', v_alias, 'rol', v_rol));
  else
    if v_alias <> u.alias then v_cambios := array_append(v_cambios, 'alias'); end if;
    if v_rol <> u.rol then v_cambios := array_append(v_cambios, 'rol'); end if;
    if v_clave then v_cambios := array_append(v_cambios, 'clave'); end if;
    if v_activo <> u.activo then v_cambios := array_append(v_cambios, case when v_activo then 'alta' else 'baja' end); end if;
    if array_length(v_cambios, 1) is not null then
      update private.usuarios set alias = v_alias, rol = v_rol, activo = v_activo, actualizado = now(),
             hash_clave = case when v_clave then extensions.crypt(p_clave_usuario, extensions.gen_salt('bf')) else hash_clave end
       where id = u.id;
      if v_clave or v_rol <> u.rol or not v_activo then
        update private.sesiones set revocada_en = now() where usuario_id = u.id and revocada_en is null;
      end if;
      perform private.auditar('admin', 'usuario_editado', null,
        jsonb_build_object('alias', v_alias, 'antes', u.alias, 'campos', to_jsonb(v_cambios)));
    end if;
  end if;
  return json_build_object('ok', true, 'usuarios', private.equipo_lista());
end;
$$;

create or replace function public.sesion_entrar(p_clave text, p_etiqueta text default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ip text;
  v_rol text;
  v_usuario bigint;
  v_alias text;
  v_token text;
  u private.usuarios;
begin
  v_ip := 'ses|' || private.ip_actual();
  if (select count(*) from private.intentos where ip = v_ip and at > now() - interval '1 minute') >= 8 then
    return json_build_object('ok', false, 'error', 'demasiados_intentos');
  end if;
  if p_clave is not null and length(p_clave) between 1 and 200 then
    if exists (select 1 from private.admin a where a.hash = extensions.crypt(p_clave, a.hash)) then
      v_rol := 'admin';
      v_alias := 'Dueño';
    else
      u := private.usuario_por_clave(p_clave);
      if u.id is not null then
        v_rol := u.rol;
        v_usuario := u.id;
        v_alias := u.alias;
      end if;
    end if;
  end if;
  if v_rol is null then
    insert into private.intentos (ip) values (v_ip);
    return json_build_object('ok', false, 'error', 'clave_incorrecta');
  end if;
  v_token := 'sd_' || encode(extensions.gen_random_bytes(32), 'hex');
  insert into private.sesiones (token_hash, rol, etiqueta, vence, usuario_id)
    values (encode(extensions.digest(v_token, 'sha256'), 'hex'), v_rol, nullif(left(btrim(coalesce(p_etiqueta, '')), 60), ''), now() + interval '60 days', v_usuario);
  perform private.auditar(v_rol, 'sesion_abierta', null, jsonb_build_object('alias', v_alias));
  return json_build_object('ok', true, 'rol', v_rol, 'token', v_token, 'alias', v_alias, 'dueno', v_usuario is null);
end;
$$;

revoke all on function private.usuario_por_clave(text) from public, anon, authenticated;
revoke all on function private.actor(text) from public, anon, authenticated;
revoke all on function private.comprobar_dueno(text) from public, anon, authenticated;
revoke all on function private.codigo_usuario(bigint, boolean) from public, anon, authenticated;
revoke all on function private.equipo_lista() from public, anon, authenticated;
revoke all on function public.admin_equipo(text) from public, anon, authenticated;
revoke all on function public.admin_equipo_guardar(text, bigint, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.admin_equipo(text) to anon, authenticated;
grant execute on function public.admin_equipo_guardar(text, bigint, text, text, text, boolean) to anon, authenticated;

-- Avisa a la API que hay funciones nuevas (si no, tarda unos minutos en verlas).
notify pgrst, 'reload schema';
