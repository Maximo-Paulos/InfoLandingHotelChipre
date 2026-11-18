-- Reservas (estadías) del check-in: habitación + monto cobrado + huéspedes, y año de nacimiento del huésped.
-- Va DESPUÉS de schema.sql y checkin.sql (en una base nueva y en una que ya tiene el check-in). Solo agrega y reemplaza funciones; no borra nada
-- y se puede ejecutar más de una vez.
--
-- Cómo funciona:
--   * Recepción abre una RESERVA antes de dar el código: habitación, monto, moneda (ARS/USD), medio de pago y fecha del cobro.
--     Sin eso no hay código. Todos los check-ins que se hagan con los códigos de esa reserva quedan en la misma estadía.
--   * La reserva se cierra sola a los `reserva_min` minutos (configurable) o cuando recepción toca «Terminar». Para otra habitación
--     se abre otra reserva.
--   * `monto` es el VALOR TOTAL de la habitación. Si el huésped dejó una seña antes, recepción carga además cuánto pagó en el hotel
--     (`pago_hotel`): la seña es la diferencia (monto - pago_hotel) y, si se sabe, la fecha en que se cobró (`fecha_sena`). Sin seña,
--     pago_hotel = monto. Todo va en la misma moneda. Así la tarifa promedio es la real, no solo lo que se cobró en el hotel.
--   * El monto se guarda en su moneda original con sus fechas: para las estadísticas cada parte se pasa a dólar oficial de SU día
--     (la seña con la fecha de la seña, el resto con la fecha_cobro = el día del hotel).
--   * Los check-ins viejos quedan «sin reserva» y el dueño los puede asignar a una.
--   * El huésped además informa su año de nacimiento (para la edad promedio).
--   * Cada reserva lleva la CANTIDAD DE NOCHES (con eso se saca la tarifa por noche y el ticket promedio), su CANAL DE VENTA y su
--     CATEGORÍA de habitación. Las dos listas las edita el dueño (private.catalogo). Un canal «sin cobro» (obra social) no lleva monto: se
--     factura aparte, así que cuenta en habitaciones, noches, edades y países, pero no en cobros ni en tarifas.
--   * Las reservas que ya existían quedan con canal «Directo» (cuentan como siempre), sin categoría y sin noches (se completan al corregirlas).

-- ---------------------------------------------------------------- tablas

alter table private.checkin_config add column if not exists reserva_min int not null default 10 check (reserva_min between 1 and 120);

create table if not exists private.estadias (
  id bigint generated always as identity primary key,
  creado timestamptz not null default now(),
  habitacion text not null check (length(habitacion) between 1 and 12),
  monto numeric(14, 2) not null check (monto >= 0),
  moneda text not null check (moneda in ('ARS', 'USD')),
  medio_pago_id int not null references private.medios_pago (id),
  fecha_cobro date not null,
  cargado_por text not null,
  editado_en timestamptz,
  editado_por text
);
alter table private.estadias enable row level security;
-- Lo que se pagó en el hotel y la fecha de la seña (si la hubo). Las reservas que ya estaban se cobraron enteras en el hotel.
alter table private.estadias add column if not exists pago_hotel numeric(14, 2);
alter table private.estadias add column if not exists fecha_sena date;
update private.estadias set pago_hotel = monto where pago_hotel is null;
alter table private.estadias alter column pago_hotel set not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'estadias_pago_hotel_ck' and conrelid = 'private.estadias'::regclass) then
    alter table private.estadias add constraint estadias_pago_hotel_ck check (pago_hotel >= 0 and pago_hotel <= monto);
  end if;
end $$;
alter table private.checkins add column if not exists estadia_id bigint references private.estadias (id);
alter table private.checkin_sesiones add column if not exists estadia_id bigint;
-- La reserva abierta de cada persona del equipo (0 = el dueño): su código solo sirve mientras dure.
alter table private.codigos_usuario add column if not exists estadia_id bigint;
alter table private.codigos_usuario add column if not exists estadia_vence timestamptz;
create index if not exists checkins_estadia_idx on private.checkins (estadia_id);

-- ---------------------------------------------------------------- noches, canal de venta y categoría

-- Dos listas que edita el dueño: las categorías de habitación (Single, Doble...) y los canales de venta (Directo, Obra social...).
-- Igual que los medios de pago, NADA se borra: «quitar» una opción solo la saca de lo que se ofrece, y las reservas que ya la tenían la siguen mostrando.
--   cobra = false: las reservas de ese canal (obra social) no llevan monto, se facturan aparte.
--   es_base: el canal que reciben las reservas de antes («Directo»): no se puede quitar ni dejar de cobrar.
create table if not exists private.catalogo (
  id int generated always as identity primary key,
  tipo text not null check (tipo in ('categoria', 'canal')),
  nombre text not null check (length(btrim(nombre)) between 1 and 40),
  orden int not null default 0,
  activo boolean not null default true,
  es_base boolean not null default false,
  cobra boolean not null default true,
  creado timestamptz not null default now()
);
create unique index if not exists catalogo_nombre_uq on private.catalogo (tipo, lower(btrim(nombre)));
create unique index if not exists catalogo_base_uq on private.catalogo (tipo) where es_base;
alter table private.catalogo enable row level security;
-- Las opciones de arranque (el dueño las cambia después): solo si todavía no hay ninguna de ese tipo, así repetir este archivo no las vuelve a crear.
insert into private.catalogo (tipo, nombre, orden, es_base, cobra)
  select 'canal', x.nombre, x.orden, x.base, x.cobra
    from (values ('Directo', 1, true, true), ('Obra social', 2, false, false), ('Agencia', 3, false, true), ('Online', 4, false, true)) as x (nombre, orden, base, cobra)
   where not exists (select 1 from private.catalogo where tipo = 'canal');
insert into private.catalogo (tipo, nombre, orden)
  select 'categoria', x.nombre, x.orden
    from (values ('Single', 1), ('Doble', 2), ('Triple', 3), ('Cuádruple', 4)) as x (nombre, orden)
   where not exists (select 1 from private.catalogo where tipo = 'categoria');

alter table private.estadias add column if not exists noches int check (noches between 1 and 365);
alter table private.estadias add column if not exists canal_id int references private.catalogo (id);
alter table private.estadias add column if not exists categoria_id int references private.catalogo (id);
-- Las reservas de antes son del canal «Directo» (con su monto, como siempre). Sin noches ni categoría hasta que alguien las corrija.
update private.estadias set canal_id = (select id from private.catalogo where tipo = 'canal' and es_base) where canal_id is null;
alter table private.estadias alter column canal_id set not null;

-- ---------------------------------------------------------------- ayudas

-- Las firmas de antes (se reemplazan por las de abajo: la seña, y después las noches, el canal y la categoría como datos opcionales).
drop function if exists private.estadia_validar(text, numeric, text, int, date, int);
drop function if exists public.recepcion_reserva_nueva(text, text, numeric, text, int, date);
drop function if exists private.estadia_editar(text, boolean, bigint, text, numeric, text, int, date);
drop function if exists public.recepcion_estadia_editar(text, bigint, text, numeric, text, int, date);
drop function if exists public.admin_estadia_editar(text, bigint, text, numeric, text, int, date);
drop function if exists private.estadia_validar(text, numeric, text, int, date, int, numeric, date);
drop function if exists public.recepcion_reserva_nueva(text, text, numeric, text, int, date, numeric, date);
drop function if exists private.estadia_editar(text, boolean, bigint, text, numeric, text, int, date, numeric, date);
drop function if exists public.recepcion_estadia_editar(text, bigint, text, numeric, text, int, date, numeric, date);
drop function if exists public.admin_estadia_editar(text, bigint, text, numeric, text, int, date, numeric, date);

-- Año de nacimiento: se suma a la revisión de los datos del huésped (opcional acá; checkin_enviar lo exige).
create or replace function private.validar_huesped(p_datos jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_nombre text; v_apellido text; v_email text; v_tel text; v_nac text; v_loc text; v_dom text; v_tipo text; v_num text; v_anio text;
  v_err text[] := array[]::text[];
  v_datos jsonb;
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
  v_anio     := btrim(coalesce(p_datos ->> 'anio_nac', ''));

  if v_nombre !~ '^[[:alpha:]][[:alpha:] .''-]{1,59}$' then v_err := array_append(v_err, 'nombre'); end if;
  if v_apellido !~ '^[[:alpha:]][[:alpha:] .''-]{1,59}$' then v_err := array_append(v_err, 'apellido'); end if;
  if length(v_email) > 120 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$' then v_err := array_append(v_err, 'email'); end if;
  if v_tel !~ '^\+[1-9][0-9]{7,14}$' then v_err := array_append(v_err, 'telefono'); end if;
  if v_nac !~ '^[[:alpha:]][[:alpha:] .,''()-]{1,59}$' then v_err := array_append(v_err, 'nacionalidad'); end if;
  if v_loc !~ '^[[:alnum:]][^[:cntrl:]<>]{1,79}$' then v_err := array_append(v_err, 'localidad'); end if;
  if v_dom !~ '^[[:alnum:]][^[:cntrl:]<>]{4,119}$' then v_err := array_append(v_err, 'domicilio'); end if;
  if v_anio <> '' and (v_anio !~ '^[12][0-9]{3}$' or v_anio::int not between 1900 and extract(year from now())::int) then
    v_err := array_append(v_err, 'anio_nac');
  end if;

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
  v_datos := jsonb_build_object(
    'nombre', v_nombre, 'apellido', v_apellido, 'email', v_email, 'telefono', v_tel,
    'nacionalidad', v_nac, 'localidad', v_loc, 'domicilio', v_dom, 'doc_tipo', v_tipo, 'doc_numero', v_num);
  if v_anio <> '' then
    v_datos := v_datos || jsonb_build_object('anio_nac', v_anio::int);
  end if;
  return jsonb_build_object('ok', true, 'datos', v_datos);
end;
$$;

-- La reserva como la ven las pantallas. p_edicion_min = null para el dueño (siempre puede editar).
create or replace function private.estadia_json(p_id bigint, p_edicion_min int default null)
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'id', e.id, 'habitacion', e.habitacion, 'monto', e.monto, 'moneda', e.moneda, 'pago_hotel', e.pago_hotel, 'fecha_sena', e.fecha_sena,
    'noches', e.noches, 'canal_id', e.canal_id, 'canal', ca.nombre, 'canal_cobra', ca.cobra, 'categoria_id', e.categoria_id, 'categoria', cg.nombre,
    'medio_pago_id', e.medio_pago_id, 'medio_pago', m.nombre, 'fecha_cobro', e.fecha_cobro,
    'cargado_por', e.cargado_por, 'creado', e.creado,
    'editable_seg', case when p_edicion_min is null then null
                         else greatest(0, floor(extract(epoch from (e.creado + make_interval(mins => p_edicion_min) - now()))))::int end)
    from private.estadias e
    join private.medios_pago m on m.id = e.medio_pago_id
    join private.catalogo ca on ca.id = e.canal_id
    left join private.catalogo cg on cg.id = e.categoria_id
   where e.id = p_id;
$$;

-- Revisa los datos de una reserva. Devuelve { ok, habitacion, monto, moneda, medio, pago, fecha_sena, noches, canal, categoria } o { ok:false, campos:[...] }.
--   p_pago: lo pagado en el hotel (null = todo el monto, sin seña) · p_fecha_sena: cuándo se cobró la seña (opcional; sin seña se ignora)
--   p_actual: la reserva tal como está hoy (al corregirla; null al abrirla). Sirve para aceptar el medio, el canal o la categoría que ya tenía aunque se hayan quitado de la lista.
--   Un canal que no cobra (obra social) deja el monto en 0 (en pesos y con el medio «base»): no se factura acá, así que lo que mande la pantalla se ignora.
--   La categoría es obligatoria al abrir una reserva (mientras haya alguna en la lista) y al corregir una que ya la tenía.
create or replace function private.estadia_validar(p_hab text, p_monto numeric, p_moneda text, p_medio int, p_fecha date, p_pago numeric, p_fecha_sena date, p_noches int, p_canal int, p_categoria int, p_actual private.estadias default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_err text[] := array[]::text[];
  h text := private.habitacion_normal(p_hab);
  ca private.catalogo;
  v_cobra boolean := true;
  v_monto numeric := p_monto;
  v_moneda text := p_moneda;
  v_medio int := p_medio;
  v_pago numeric := coalesce(p_pago, p_monto);
  v_sena_fecha date := null;
  v_cat int := null;
begin
  if h is null or not private.habitacion_ok(h) then v_err := array_append(v_err, 'habitacion'); end if;
  if p_noches is null or p_noches not between 1 and 365 then v_err := array_append(v_err, 'noches'); end if;
  select * into ca from private.catalogo where id = p_canal and tipo = 'canal' and (activo or id = p_actual.canal_id);
  if not found then
    v_err := array_append(v_err, 'canal');
  else
    v_cobra := ca.cobra;
  end if;
  if p_categoria is null then
    if exists (select 1 from private.catalogo where tipo = 'categoria' and activo) and (p_actual.id is null or p_actual.categoria_id is not null) then
      v_err := array_append(v_err, 'categoria');
    end if;
  elsif exists (select 1 from private.catalogo where id = p_categoria and tipo = 'categoria' and (activo or id = p_actual.categoria_id)) then
    v_cat := p_categoria;
  else
    v_err := array_append(v_err, 'categoria');
  end if;
  if p_fecha is null or p_fecha not between current_date - 366 and current_date + 1 then v_err := array_append(v_err, 'fecha_cobro'); end if;
  if not v_cobra then
    v_monto := 0;
    v_moneda := 'ARS';
    v_pago := 0;
    select id into v_medio from private.medios_pago where es_base;
  else
    if p_monto is null or p_monto < 0 or p_monto >= 1e12 then v_err := array_append(v_err, 'monto'); end if;
    if p_moneda is null or p_moneda not in ('ARS', 'USD') then v_err := array_append(v_err, 'moneda'); end if;
    if p_medio is null or not (exists (select 1 from private.medios_pago where id = p_medio and activo) or coalesce(p_medio = p_actual.medio_pago_id, false)) then
      v_err := array_append(v_err, 'medio_pago');
    end if;
    -- Lo pagado en el hotel no puede ser más que el total (la seña es lo que falta para llegar al total).
    if p_monto is not null and (v_pago is null or v_pago < 0 or v_pago > p_monto) then v_err := array_append(v_err, 'pago_hotel'); end if;
    if p_fecha_sena is not null and p_monto is not null and v_pago is not null and p_monto - v_pago > 0 then
      if p_fecha_sena < current_date - 800 or (p_fecha is not null and p_fecha_sena > p_fecha) then
        v_err := array_append(v_err, 'fecha_sena');
      else
        v_sena_fecha := p_fecha_sena;
      end if;
    end if;
  end if;
  if array_length(v_err, 1) is not null then
    return jsonb_build_object('ok', false, 'campos', to_jsonb(v_err));
  end if;
  return jsonb_build_object('ok', true, 'habitacion', h, 'monto', v_monto, 'moneda', v_moneda, 'medio', v_medio, 'pago', v_pago,
                            'fecha_sena', v_sena_fecha, 'noches', p_noches, 'canal', p_canal, 'categoria', v_cat);
end;
$$;

-- ---------------------------------------------------------------- huésped

-- Igual que antes, pero el código solo sirve mientras su dueño tenga una reserva abierta, y la sesión lleva esa reserva.
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
  select k.* into c from private.codigos_usuario k
   where length(v_cod) = 6 and (k.codigo = v_cod or k.prev_codigo = v_cod)
     and k.estadia_id is not null and k.estadia_vence > now()
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
  v_alias := case when c.usuario_id = 0 then 'Dueño' else (select u.alias from private.usuarios u where u.id = c.usuario_id) end;
  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  v_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');
  v_vence := now() + make_interval(mins => cfg.sesion_min);
  insert into private.checkin_sesiones (token_hash, grupo, vence, habilitado_por, estadia_id) values (v_hash, v_grupo, v_vence, v_alias, c.estadia_id);
  return json_build_object('ok', true, 'token', v_token, 'vence_seg', cfg.sesion_min * 60,
                           'foto', private.foto_info(cfg, v_hash, v_vence, false));
end;
$$;

-- Igual que antes, más: el año de nacimiento es obligatorio y el huésped queda en la reserva de su código (con su habitación y medio de pago).
create or replace function public.checkin_enviar(p_token text, p_datos jsonb, p_idioma text, p_acepta boolean)
returns json language plpgsql security definer set search_path = '' as $$
declare
  cfg private.checkin_config;
  s private.checkin_sesiones;
  e private.estadias;
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
  if (v -> 'datos' -> 'anio_nac') is null then
    return json_build_object('ok', false, 'error', 'datos_invalidos', 'campos', jsonb_build_array('anio_nac'));
  end if;
  if cfg.foto_modo = 'obligatoria' and cfg.foto_url is not null and s.foto_id is null then
    return json_build_object('ok', false, 'error', 'foto_requerida');
  end if;
  select * into e from private.estadias where id = s.estadia_id;
  insert into private.checkins (grupo, idioma, datos, consentimiento, foto_id, foto_nombre, habilitado_por, estadia_id, habitacion, medio_pago_id)
    values (s.grupo, left(regexp_replace(coalesce(p_idioma, ''), '[^A-Za-z-]', '', 'g'), 10), v -> 'datos',
            jsonb_build_object('aceptado', true, 'version', 1, 'en', now()), s.foto_id, s.foto_nombre, s.habilitado_por,
            e.id, e.habitacion, coalesce(e.medio_pago_id, 6))
    returning id into v_id;
  if s.foto_id is not null then
    insert into private.checkin_fotos (checkin_id, foto_id, nombre, origen) values (v_id, s.foto_id, s.foto_nombre, 'huesped');
  end if;
  update private.checkin_sesiones set usada = true where token_hash = v_hash;
  return json_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------- recepción

-- Lo que consulta la pantalla de recepción: la reserva abierta (con su código, solo si hay una), los huéspedes de los últimos días
-- (cada uno con su reserva) y los medios de pago.
create or replace function public.recepcion_estado(p_clave text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  r text;
  cfg private.checkin_config;
  c private.codigos_usuario;
  v_actor jsonb;
  v_uid bigint;
  v_lista json;
  v_config json;
  v_medios json;
  v_categorias json;
  v_canales json;
  v_reserva json := null;
  v_codigo json := null;
begin
  r := private.comprobar_recepcion(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  v_actor := private.actor(p_clave);
  v_uid := (v_actor ->> 'id')::bigint;
  select * into cfg from private.checkin_config where id = 1;
  select coalesce(json_agg(row_to_json(t) order by t.creado desc), '[]'::json) into v_lista from (
    select k.id, k.creado, k.habitacion, k.datos, k.habilitado_por,
           (select f.foto_id from private.checkin_fotos f where f.checkin_id = k.id and f.activa order by f.id limit 1) as foto_id,
           (select f.nombre from private.checkin_fotos f where f.checkin_id = k.id and f.activa order by f.id limit 1) as foto_nombre,
           private.fotos_activas(k.id) as fotos,
           k.medio_pago_id, m.nombre as medio_pago,
           k.estadia_id,
           case when k.estadia_id is null then null else private.estadia_json(k.estadia_id, case when cfg.edicion_activa then cfg.edicion_min else 0 end) end as estadia,
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
                                'codigo_seg', cfg.codigo_seg, 'dias', cfg.dias_recepcion, 'reserva_min', cfg.reserva_min);
  select coalesce(json_agg(json_build_object('id', m.id, 'nombre', m.nombre) order by m.es_base, m.orden, m.id), '[]'::json)
    into v_medios from private.medios_pago m where m.activo;
  select coalesce(json_agg(json_build_object('id', k.id, 'nombre', k.nombre) order by k.orden, k.id), '[]'::json)
    into v_categorias from private.catalogo k where k.tipo = 'categoria' and k.activo;
  select coalesce(json_agg(json_build_object('id', k.id, 'nombre', k.nombre, 'cobra', k.cobra, 'base', k.es_base) order by k.orden, k.id), '[]'::json)
    into v_canales from private.catalogo k where k.tipo = 'canal' and k.activo;
  if not cfg.activo then
    return json_build_object('ok', true, 'activo', false, 'codigo', null, 'reserva', null, 'quien', v_actor ->> 'alias', 'config', v_config, 'huespedes', v_lista, 'medios_pago', v_medios,
      'categorias', v_categorias, 'canales', v_canales);
  end if;
  select * into c from private.codigos_usuario where usuario_id = v_uid;
  if found and c.estadia_id is not null and c.estadia_vence > now() then
    c := private.codigo_usuario(v_uid, false);
    v_codigo := json_build_object('valor', c.codigo,
                                  'vence_seg', greatest(0, ceil(extract(epoch from (c.vence - now()))))::int,
                                  'usos', c.usos, 'usos_max', c.usos_max);
    v_reserva := json_build_object('estadia', private.estadia_json(c.estadia_id),
      'vence_seg', greatest(0, ceil(extract(epoch from (c.estadia_vence - now()))))::int,
      'huespedes', (select coalesce(json_agg(json_build_object('id', k.id, 'nombre', k.datos ->> 'nombre', 'apellido', k.datos ->> 'apellido') order by k.id), '[]'::json)
                      from private.checkins k where k.estadia_id = c.estadia_id));
  end if;
  return json_build_object('ok', true, 'activo', true, 'quien', v_actor ->> 'alias', 'codigo', v_codigo, 'reserva', v_reserva,
    'config', v_config, 'huespedes', v_lista, 'medios_pago', v_medios, 'categorias', v_categorias, 'canales', v_canales);
end;
$$;

-- Abre una reserva nueva y deja a esta persona con su primer código. Cierra la que tuviera abierta.
create or replace function public.recepcion_reserva_nueva(p_clave text, p_habitacion text, p_monto numeric, p_moneda text, p_medio_pago int, p_fecha date, p_pago_hotel numeric default null, p_fecha_sena date default null, p_noches int default null, p_canal int default null, p_categoria int default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  r text;
  cfg private.checkin_config;
  v_actor jsonb;
  v_uid bigint;
  v jsonb;
  v_id bigint;
begin
  r := private.comprobar_recepcion(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  select * into cfg from private.checkin_config where id = 1;
  if not cfg.activo then
    return json_build_object('ok', false, 'error', 'no_disponible');
  end if;
  v := private.estadia_validar(p_habitacion, p_monto, p_moneda, p_medio_pago, p_fecha, p_pago_hotel, p_fecha_sena, p_noches, p_canal, p_categoria);
  if not (v ->> 'ok')::boolean then
    return json_build_object('ok', false, 'error', 'datos_invalidos', 'campos', v -> 'campos');
  end if;
  v_actor := private.actor(p_clave);
  v_uid := (v_actor ->> 'id')::bigint;
  insert into private.estadias (habitacion, monto, moneda, medio_pago_id, fecha_cobro, cargado_por, pago_hotel, fecha_sena, noches, canal_id, categoria_id)
    values (v ->> 'habitacion', (v ->> 'monto')::numeric, v ->> 'moneda', (v ->> 'medio')::int, p_fecha, v_actor ->> 'alias', (v ->> 'pago')::numeric, (v ->> 'fecha_sena')::date,
            (v ->> 'noches')::int, (v ->> 'canal')::int, (v ->> 'categoria')::int) returning id into v_id;
  perform private.codigo_usuario(v_uid, true);
  update private.codigos_usuario set estadia_id = v_id, estadia_vence = now() + make_interval(mins => cfg.reserva_min) where usuario_id = v_uid;
  perform private.auditar('recepcion', 'reserva_nueva', null, jsonb_build_object('estadia', v_id, 'alias', v_actor ->> 'alias'));
  return json_build_object('ok', true, 'id', v_id);
end;
$$;

-- Cierra la reserva abierta (los códigos dejan de servir) o, con p_extender, le da otros `reserva_min` minutos.
create or replace function public.recepcion_reserva_cerrar(p_clave text, p_extender boolean default false)
returns json language plpgsql security definer set search_path = '' as $$
declare
  r text;
  cfg private.checkin_config;
  v_uid bigint;
begin
  r := private.comprobar_recepcion(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  select * into cfg from private.checkin_config where id = 1;
  v_uid := (private.actor(p_clave) ->> 'id')::bigint;
  if coalesce(p_extender, false) then
    update private.codigos_usuario set estadia_vence = now() + make_interval(mins => cfg.reserva_min)
     where usuario_id = v_uid and estadia_id is not null and estadia_vence > now();
  else
    update private.codigos_usuario set estadia_vence = now() where usuario_id = v_uid and estadia_vence > now();
  end if;
  return json_build_object('ok', true);
end;
$$;

-- Corrige una reserva. Recepción solo durante la ventana de edición; el dueño siempre. La habitación y el medio de pago pasan a
-- todos los huéspedes de la reserva. Todo queda en la auditoría.
create or replace function private.estadia_editar(p_quien text, p_dueno boolean, p_id bigint, p_habitacion text, p_monto numeric, p_moneda text, p_medio_pago int, p_fecha date, p_pago_hotel numeric default null, p_fecha_sena date default null, p_noches int default null, p_canal int default null, p_categoria int default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  cfg private.checkin_config;
  e private.estadias;
  v jsonb;
  v_cambios text[] := array[]::text[];
begin
  select * into cfg from private.checkin_config where id = 1;
  select * into e from private.estadias where id = p_id for update;
  if not found then
    return json_build_object('ok', false, 'error', 'no_existe');
  end if;
  if not p_dueno and (not cfg.edicion_activa or now() > e.creado + make_interval(mins => cfg.edicion_min)) then
    return json_build_object('ok', false, 'error', 'fuera_de_tiempo');
  end if;
  v := private.estadia_validar(p_habitacion, p_monto, p_moneda, p_medio_pago, p_fecha, p_pago_hotel, p_fecha_sena, p_noches, p_canal, p_categoria, e);
  if not (v ->> 'ok')::boolean then
    return json_build_object('ok', false, 'error', 'datos_invalidos', 'campos', v -> 'campos');
  end if;
  if (v ->> 'habitacion') <> e.habitacion then v_cambios := array_append(v_cambios, 'habitacion'); end if;
  if (v ->> 'monto')::numeric <> e.monto then v_cambios := array_append(v_cambios, 'monto'); end if;
  if (v ->> 'moneda') <> e.moneda then v_cambios := array_append(v_cambios, 'moneda'); end if;
  if (v ->> 'medio')::int <> e.medio_pago_id then v_cambios := array_append(v_cambios, 'medio_pago'); end if;
  if p_fecha <> e.fecha_cobro then v_cambios := array_append(v_cambios, 'fecha_cobro'); end if;
  if (v ->> 'pago')::numeric <> e.pago_hotel then v_cambios := array_append(v_cambios, 'pago_hotel'); end if;
  if (v ->> 'fecha_sena')::date is distinct from e.fecha_sena then v_cambios := array_append(v_cambios, 'fecha_sena'); end if;
  if (v ->> 'noches')::int is distinct from e.noches then v_cambios := array_append(v_cambios, 'noches'); end if;
  if (v ->> 'canal')::int <> e.canal_id then v_cambios := array_append(v_cambios, 'canal'); end if;
  if (v ->> 'categoria')::int is distinct from e.categoria_id then v_cambios := array_append(v_cambios, 'categoria'); end if;
  if array_length(v_cambios, 1) is not null then
    update private.estadias set habitacion = v ->> 'habitacion', monto = (v ->> 'monto')::numeric, moneda = v ->> 'moneda', medio_pago_id = (v ->> 'medio')::int,
           fecha_cobro = p_fecha, pago_hotel = (v ->> 'pago')::numeric, fecha_sena = (v ->> 'fecha_sena')::date,
           noches = (v ->> 'noches')::int, canal_id = (v ->> 'canal')::int, categoria_id = (v ->> 'categoria')::int,
           editado_en = now(), editado_por = p_quien where id = p_id;
    update private.checkins set habitacion = v ->> 'habitacion', medio_pago_id = (v ->> 'medio')::int where estadia_id = p_id;
    perform private.auditar(case when p_dueno then 'admin' else 'recepcion' end, 'estadia_editar', null,
      jsonb_build_object('estadia', p_id, 'campos', to_jsonb(v_cambios), 'por', p_quien));
  end if;
  return json_build_object('ok', true);
end;
$$;

create or replace function public.recepcion_estadia_editar(p_clave text, p_id bigint, p_habitacion text, p_monto numeric, p_moneda text, p_medio_pago int, p_fecha date, p_pago_hotel numeric default null, p_fecha_sena date default null, p_noches int default null, p_canal int default null, p_categoria int default null)
returns json language plpgsql security definer set search_path = '' as $$
declare r text;
begin
  r := private.comprobar_recepcion(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  return private.estadia_editar(private.actor(p_clave) ->> 'alias', coalesce((private.actor(p_clave) ->> 'dueno')::boolean, false),
                                p_id, p_habitacion, p_monto, p_moneda, p_medio_pago, p_fecha, p_pago_hotel, p_fecha_sena, p_noches, p_canal, p_categoria);
end;
$$;

-- ---------------------------------------------------------------- dueño

create or replace function public.admin_estadia_editar(p_clave text, p_id bigint, p_habitacion text, p_monto numeric, p_moneda text, p_medio_pago int, p_fecha date, p_pago_hotel numeric default null, p_fecha_sena date default null, p_noches int default null, p_canal int default null, p_categoria int default null)
returns json language plpgsql security definer set search_path = '' as $$
declare r text;
begin
  r := private.comprobar_clave(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  return private.estadia_editar(coalesce(private.actor(p_clave) ->> 'alias', 'Dueño'), true, p_id, p_habitacion, p_monto, p_moneda, p_medio_pago, p_fecha, p_pago_hotel, p_fecha_sena, p_noches, p_canal, p_categoria);
end;
$$;

-- Las categorías de habitación y los canales de venta: el dueño los ve todos (también los quitados) y guarda cada lista completa.
create or replace function private.catalogo_lista(p_tipo text)
returns json language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object('id', c.id, 'nombre', c.nombre, 'activo', c.activo, 'base', c.es_base, 'cobra', c.cobra,
           'usos', (select count(*)::int from private.estadias e where case c.tipo when 'canal' then e.canal_id else e.categoria_id end = c.id)) order by c.orden, c.id), '[]'::json)
    from private.catalogo c where c.tipo = p_tipo;
$$;

create or replace function public.admin_catalogos(p_clave text)
returns json language plpgsql security definer set search_path = '' as $$
declare r text;
begin
  r := private.comprobar_clave(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  return json_build_object('ok', true, 'categorias', private.catalogo_lista('categoria'), 'canales', private.catalogo_lista('canal'));
end;
$$;

-- Guarda una lista completa (p_tipo = 'categoria' o 'canal'), en el orden en que viene. NADA se borra: para quitar una opción se manda "activo": false.
--   p_lista: [{"id": 3, "nombre": "Doble", "activo": true, "cobra": true}, {"id": null, "nombre": "Suite", "activo": true}, ...]
--   «cobra» (solo canales): false = las reservas de ese canal no llevan monto (se facturan aparte). No se puede cambiar si el canal ya tiene reservas.
create or replace function public.admin_catalogo_guardar(p_clave text, p_tipo text, p_lista jsonb)
returns json language plpgsql security definer set search_path = '' as $$
declare
  r text;
  it jsonb;
  c private.catalogo;
  i int := 0;
  v_nombre text;
  v_activo boolean;
  v_cobra boolean;
  v_vistos text[] := array[]::text[];
  v_ids int[] := array[]::int[];
  v_nombres text[] := array[]::text[];
begin
  r := private.comprobar_clave(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  if p_tipo is null or p_tipo not in ('categoria', 'canal') or p_lista is null or jsonb_typeof(p_lista) <> 'array'
     or jsonb_array_length(p_lista) not between (case when p_tipo = 'canal' then 1 else 0 end) and 60 then
    return json_build_object('ok', false, 'error', 'lista_invalida');
  end if;
  lock table private.catalogo in share row exclusive mode;

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
    if ((it -> 'activo') is not null and jsonb_typeof(it -> 'activo') <> 'boolean') or ((it -> 'cobra') is not null and jsonb_typeof(it -> 'cobra') <> 'boolean') then
      return json_build_object('ok', false, 'error', 'lista_invalida');
    end if;
    if nullif(it ->> 'id', '') is not null then
      if (it ->> 'id') !~ '^[0-9]{1,9}$' or (it ->> 'id')::int = any(v_ids) then
        return json_build_object('ok', false, 'error', 'lista_invalida');
      end if;
      v_ids := array_append(v_ids, (it ->> 'id')::int);
      select * into c from private.catalogo where id = (it ->> 'id')::int and tipo = p_tipo;
      if not found then
        return json_build_object('ok', false, 'error', 'no_existe');
      end if;
      v_cobra := case when p_tipo = 'canal' then coalesce((it ->> 'cobra')::boolean, c.cobra) else true end;
      if c.es_base and (coalesce((it ->> 'activo')::boolean, true) = false or not v_cobra) then
        return json_build_object('ok', false, 'error', 'base_obligatoria');
      end if;
      if v_cobra <> c.cobra and exists (select 1 from private.estadias where canal_id = c.id) then
        return json_build_object('ok', false, 'error', 'canal_en_uso', 'nombre', c.nombre);
      end if;
    end if;
  end loop;

  i := 0;
  for it in select e from jsonb_array_elements(p_lista) e loop
    i := i + 1;
    v_nombre := btrim(regexp_replace(coalesce(it ->> 'nombre', ''), '\s+', ' ', 'g'));
    v_activo := coalesce((it ->> 'activo')::boolean, true);
    if nullif(it ->> 'id', '') is not null then
      update private.catalogo set nombre = v_nombre, orden = i, activo = (es_base or v_activo),
             cobra = case when p_tipo = 'canal' then coalesce((it ->> 'cobra')::boolean, cobra) else true end
       where id = (it ->> 'id')::int;
    else
      insert into private.catalogo (tipo, nombre, orden, activo, cobra)
        values (p_tipo, v_nombre, i, v_activo, case when p_tipo = 'canal' then coalesce((it ->> 'cobra')::boolean, true) else true end);
    end if;
    v_nombres := array_append(v_nombres, v_nombre);
  end loop;
  perform private.auditar('admin', 'catalogo', null, jsonb_build_object('tipo', p_tipo, 'nombres', to_jsonb(v_nombres)));
  return json_build_object('ok', true, 'lista', private.catalogo_lista(p_tipo));
exception when unique_violation then
  return json_build_object('ok', false, 'error', 'nombre_repetido');
end;
$$;

-- Mueve un huésped (por ejemplo uno de antes de las reservas) a una reserva: toma su habitación y su medio de pago. p_estadia null lo deja sin reserva.
create or replace function public.admin_huesped_estadia(p_clave text, p_id bigint, p_estadia bigint)
returns json language plpgsql security definer set search_path = '' as $$
declare
  r text;
  e private.estadias;
begin
  r := private.comprobar_clave(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  if not exists (select 1 from private.checkins where id = p_id) then
    return json_build_object('ok', false, 'error', 'no_existe');
  end if;
  if p_estadia is not null then
    select * into e from private.estadias where id = p_estadia;
    if not found then
      return json_build_object('ok', false, 'error', 'no_existe');
    end if;
    update private.checkins set estadia_id = e.id, habitacion = e.habitacion, medio_pago_id = e.medio_pago_id, editado_en = now(), editado_por = 'admin' where id = p_id;
  else
    update private.checkins set estadia_id = null, editado_en = now(), editado_por = 'admin' where id = p_id;
  end if;
  perform private.auditar('admin', 'huesped_estadia', p_id, jsonb_build_object('estadia', p_estadia));
  return json_build_object('ok', true);
end;
$$;

-- Minutos que dura una reserva abierta. Sin p_min devuelve el valor de hoy.
create or replace function public.admin_reserva_min(p_clave text, p_min int default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  r text;
  v int;
begin
  r := private.comprobar_clave(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  if p_min is not null then
    if p_min not between 1 and 120 then
      return json_build_object('ok', false, 'error', 'config_invalida', 'campo', 'reserva_min');
    end if;
    update private.checkin_config set reserva_min = p_min where id = 1;
    perform private.auditar('admin', 'config', null, jsonb_build_object('claves', jsonb_build_array('reserva_min')));
  end if;
  select reserva_min into v from private.checkin_config where id = 1;
  return json_build_object('ok', true, 'reserva_min', v);
end;
$$;

-- Igual que antes, más los minutos que dura una reserva abierta.
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
    'recepcion_con_clave', exists (select 1 from private.usuarios u where u.activo),
    'reserva_min', cfg.reserva_min));
end;
$$;

-- Igual que antes, con la reserva de cada huésped y las reservas sueltas (sin huéspedes) para poder asignarles check-ins viejos.
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
             k.estadia_id,
             case when k.estadia_id is null then null else private.estadia_json(k.estadia_id) end as estadia,
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

-- ---------------------------------------------------------------- estadísticas (solo el dueño)

-- Lo que necesita la pantalla de estadísticas: las reservas cobradas y los huéspedes del período, SIN datos personales
-- (ni nombre, ni documento, ni email, ni teléfono: solo si tiene o no). Las cuentas y los gráficos se arman en la pantalla.
-- El monto sigue en su moneda original con la fecha del cobro: la pantalla lo pasa a dólar oficial de ese día.
--   p_desde / p_hasta: fechas (hora argentina) · sin pasar nada, los últimos ~3 años.
--   visitas: cuántas estadías distintas tuvo esa misma persona (mismo documento) en toda la historia: 1 = vino una vez.
create or replace function public.admin_estadisticas(p_clave text, p_desde date default null, p_hasta date default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  r text;
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_desde date := coalesce(p_desde, v_hoy - 1100);
  v_hasta date := coalesce(p_hasta, v_hoy);
  v_reservas json;
  v_huespedes json;
begin
  r := private.comprobar_clave(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  if v_desde > v_hasta then
    return json_build_object('ok', false, 'error', 'datos_invalidos');
  end if;

  select coalesce(json_agg(t order by t.fecha_cobro, t.id), '[]'::json) into v_reservas
  from (
    select e.id, e.habitacion, e.monto, e.moneda, e.pago_hotel, e.fecha_sena, m.nombre as medio_pago, e.fecha_cobro, e.cargado_por,
           e.noches, ca.nombre as canal, ca.cobra as canal_cobra, cg.nombre as categoria,
           (select count(*)::int from private.checkins c where c.estadia_id = e.id) as huespedes
    from private.estadias e
    join private.medios_pago m on m.id = e.medio_pago_id
    join private.catalogo ca on ca.id = e.canal_id
    left join private.catalogo cg on cg.id = e.categoria_id
    where e.fecha_cobro between v_desde and v_hasta
    order by e.fecha_cobro desc, e.id desc
    limit 20000
  ) t;

  select coalesce(json_agg(t order by t.id), '[]'::json) into v_huespedes
  from (
    with visitas as (
      select lower(btrim(coalesce(datos->>'doc_tipo', ''))) as tipo, lower(btrim(coalesce(datos->>'doc_numero', ''))) as numero,
             count(distinct coalesce(estadia_id, -id))::int as n
      from private.checkins
      group by 1, 2
    )
    select c.id, c.estadia_id,
           (c.creado at time zone 'America/Argentina/Buenos_Aires')::date as fecha,
           extract(hour from c.creado at time zone 'America/Argentina/Buenos_Aires')::int as hora,
           nullif(btrim(c.datos->>'nacionalidad'), '') as nacionalidad,
           nullif(btrim(c.datos->>'localidad'), '') as localidad,
           nullif(c.datos->>'anio_nac', '')::int as anio_nac,
           c.datos->>'doc_tipo' as doc_tipo,
           coalesce(c.datos->>'email', '') <> '' as con_email,
           coalesce(c.datos->>'telefono', '') <> '' as con_telefono,
           c.habilitado_por as habilito,
           coalesce(v.n, 1) as visitas
    from private.checkins c
    left join private.estadias e on e.id = c.estadia_id
    left join visitas v on v.tipo = lower(btrim(coalesce(c.datos->>'doc_tipo', ''))) and v.numero = lower(btrim(coalesce(c.datos->>'doc_numero', '')))
    where case when e.id is not null then e.fecha_cobro between v_desde and v_hasta
               else (c.creado at time zone 'America/Argentina/Buenos_Aires')::date between v_desde and v_hasta end
    order by c.id desc
    limit 50000
  ) t;

  return json_build_object('ok', true, 'desde', v_desde, 'hasta', v_hasta, 'hoy', v_hoy, 'reservas', v_reservas, 'huespedes', v_huespedes);
end;
$$;

-- ---------------------------------------------------------------- permisos

revoke all on function private.estadia_json(bigint, int) from public, anon, authenticated;
revoke all on function private.estadia_validar(text, numeric, text, int, date, numeric, date, int, int, int, private.estadias) from public, anon, authenticated;
revoke all on function private.estadia_editar(text, boolean, bigint, text, numeric, text, int, date, numeric, date, int, int, int) from public, anon, authenticated;
revoke all on function private.validar_huesped(jsonb) from public, anon, authenticated;
revoke all on function private.catalogo_lista(text) from public, anon, authenticated;
revoke all on function public.recepcion_reserva_nueva(text, text, numeric, text, int, date, numeric, date, int, int, int) from public, anon, authenticated;
revoke all on function public.recepcion_reserva_cerrar(text, boolean) from public, anon, authenticated;
revoke all on function public.recepcion_estadia_editar(text, bigint, text, numeric, text, int, date, numeric, date, int, int, int) from public, anon, authenticated;
revoke all on function public.admin_estadia_editar(text, bigint, text, numeric, text, int, date, numeric, date, int, int, int) from public, anon, authenticated;
revoke all on function public.admin_huesped_estadia(text, bigint, bigint) from public, anon, authenticated;
revoke all on function public.admin_reserva_min(text, int) from public, anon, authenticated;
grant execute on function public.recepcion_reserva_nueva(text, text, numeric, text, int, date, numeric, date, int, int, int) to anon, authenticated;
grant execute on function public.recepcion_reserva_cerrar(text, boolean) to anon, authenticated;
grant execute on function public.recepcion_estadia_editar(text, bigint, text, numeric, text, int, date, numeric, date, int, int, int) to anon, authenticated;
grant execute on function public.admin_estadia_editar(text, bigint, text, numeric, text, int, date, numeric, date, int, int, int) to anon, authenticated;
grant execute on function public.admin_huesped_estadia(text, bigint, bigint) to anon, authenticated;
grant execute on function public.admin_reserva_min(text, int) to anon, authenticated;
revoke all on function public.admin_estadisticas(text, date, date) from public, anon, authenticated;
grant execute on function public.admin_estadisticas(text, date, date) to anon, authenticated;
revoke all on function public.admin_catalogos(text) from public, anon, authenticated;
revoke all on function public.admin_catalogo_guardar(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.admin_catalogos(text) to anon, authenticated;
grant execute on function public.admin_catalogo_guardar(text, text, jsonb) to anon, authenticated;
