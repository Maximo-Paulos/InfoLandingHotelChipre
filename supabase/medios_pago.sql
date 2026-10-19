-- Medio de pago de cada huésped (se suma al check-in digital que ya está en la base).
-- Es SOLO LO NUEVO de checkin.sql, listo para pegar en el SQL Editor de Supabase de una base que ya tiene el check-in.
-- (Para una base nueva alcanza con schema.sql + checkin.sql, que ya lo incluye todo.)
--
-- Qué hace:
--   * Crea la tabla de medios de pago (Efectivo, Transferencia, USD efectivo, PayPal, Link de pago, Otros).
--   * Agrega a cada huésped su medio de pago. Los que ya estaban cargados quedan en "Otros" (nunca vacío).
--   * Ajusta 4 funciones (recepcion_estado, recepcion_editar, admin_huespedes, admin_huesped_editar) para mostrar y
--     guardar el medio de pago. Siguen andando igual con la guía actual: si no mandan medio de pago, queda el que tiene.
--   * Suma 2 funciones para que el dueño edite la lista (admin_medios_pago, admin_medios_pago_guardar).
--   * No borra nada: ningún dato se elimina y los medios "quitados" solo se ocultan.
-- Se puede ejecutar más de una vez sin problema.

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

-- ---------------------------------------------------------------- funciones

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

revoke all on function private.medio_pago_elegido(jsonb, int) from public, anon, authenticated;
revoke all on function private.medios_pago_lista() from public, anon, authenticated;
revoke all on function public.admin_medios_pago(text) from public, anon, authenticated;
revoke all on function public.admin_medios_pago_guardar(text, jsonb) from public, anon, authenticated;
grant execute on function public.admin_medios_pago(text) to anon, authenticated;
grant execute on function public.admin_medios_pago_guardar(text, jsonb) to anon, authenticated;

-- Para que la API de Supabase vea las funciones nuevas enseguida.
notify pgrst, 'reload schema';
