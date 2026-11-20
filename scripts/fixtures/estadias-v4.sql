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
--
-- RESERVAS ABIERTAS (cantidad de huéspedes):
--   * Cada reserva lleva CUÁNTOS HUÉSPEDES van a hacer el check-in en la habitación (`huespedes_esperados`, obligatorio, de 1 a 12).
--   * Una reserva está ABIERTA mientras no esté anulada y falten huéspedes por registrarse. Sigue abierta aunque se apague el código
--     (a los `reserva_min` minutos): cualquiera de recepción puede volver a darle código cuando llegue el resto del grupo.
--     Cuando entra el último, se CIERRA sola (el código deja de servir) y recepción ya no la ve; solo el dueño la puede corregir,
--     y al subir la cantidad de huéspedes vuelve a estar abierta.
--   * Una reserva abierta se muestra en recepción `dias_recepcion` días (3) desde su última actividad (cuando se cargó, entró el último huésped
--     o el dueño la reabrió). Pasado ese tiempo desaparece de recepción; el dueño la sigue viendo en la caja. Nada se borra.
--   * Una reserva SIN ningún huésped no suma en nada: ni en ingresos, ni en habitaciones, ni en noches, ni en ninguna estadística.
--     Queda «en espera» (y se ve en la caja del dueño) hasta que entre alguien, o se ANULA (recepción, mientras no tenga huéspedes; el dueño
--     también la puede restaurar). Anular no borra: la fila queda, marcada, con quién y cuándo.
--   * Las reservas de antes quedan con tantos huéspedes esperados como check-ins tenían (están completas), o 1 si no tenían ninguno.

--
-- RESERVAS ANOTADAS (reservas por adelantado, las carga el dueño):
--   * El dueño (y recepción, p. ej. para el que llega de la calle sin reserva: a su nombre, con el monto) anota una reserva futura: a nombre de quién (`titular`), fecha de ingreso, noches, habitación, categoría, canal, cantidad de huéspedes,
--     los PRECIOS (en efectivo, en transferencia y, si quiere, en dólares), la SEÑA que ya pagó (en pesos, no importa cómo) y una nota.
--   * Recepción ve las llegadas de los próximos `dias_recepcion` días (y las que se pasaron hasta `dias_recepcion` días) con cuánto hay que cobrar según cómo
--     pague lo que resta. Al hacer el check-in elige cómo paga y la app arma la reserva de siempre (`estadias`) con el cobro; desde ahí sigue igual que antes
--     (código, huéspedes de a uno, se cierra sola).
--   * Una reserva anotada NO es una estadía: no suma en ninguna estadística hasta que se hace el check-in. Anular no borra: queda marcada.
--   * Anotar y corregir: el dueño y recepción. CANCELAR (y restaurar): solo el dueño.

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

-- Cuántos huéspedes van a hacer el check-in en la habitación. Las reservas de antes: tantos como check-ins tenían (quedan completas), o 1 si no tenían.
alter table private.estadias add column if not exists huespedes_esperados int;
update private.estadias e set huespedes_esperados = least(12, greatest(1, (select count(*)::int from private.checkins c where c.estadia_id = e.id)))
 where e.huespedes_esperados is null;
alter table private.estadias alter column huespedes_esperados set not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'estadias_huespedes_esperados_ck' and conrelid = 'private.estadias'::regclass) then
    alter table private.estadias add constraint estadias_huespedes_esperados_ck check (huespedes_esperados between 1 and 12);
  end if;
end $$;
-- Anular una reserva sin huéspedes (no se borra: queda marcada) y, si el dueño la reabre, desde cuándo cuenta su tiempo de vida en recepción.
alter table private.estadias add column if not exists anulada_en timestamptz;
alter table private.estadias add column if not exists anulada_por text;
alter table private.estadias add column if not exists reabierta_en timestamptz;
create index if not exists estadias_creado_idx on private.estadias (creado desc);

-- QUITAR / ELIMINAR (solo el dueño): un huésped o una reserva eliminados dejan de verse en todas las listas y de contar en todas las estadísticas, pero
-- NO se borran: la fila queda con quién y cuándo (`quitado_en`, `quitado_por`) y el dueño los puede restaurar. Es una regla del proyecto (los datos de los
-- huéspedes son un registro): borrar de verdad se hace a mano en Supabase. Toda lectura de huéspedes para mostrar o contar va por `checkins_activos`.
alter table private.checkins add column if not exists quitado_en timestamptz;
alter table private.checkins add column if not exists quitado_por text;
create or replace view private.checkins_activos as select * from private.checkins where quitado_en is null;
revoke all on private.checkins_activos from public, anon, authenticated;

-- A nombre de quién está la reserva y una nota (los trae la reserva anotada al hacer el check-in).
alter table private.estadias add column if not exists titular text;
alter table private.estadias add column if not exists nota text;


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

-- Las reservas por adelantado. precio_transferencia null = igual al efectivo · precio_usd null = se calcula con el dólar oficial · sena en pesos.
-- estadia_id: la estadía que armó recepción al hacer el check-in (la reserva anotada ya no se ve en las llegadas).
create table if not exists private.reservas_anotadas (
  id bigint generated always as identity primary key,
  creado timestamptz not null default now(),
  cargado_por text not null,
  titular text not null check (length(titular) between 1 and 60),
  fecha_ingreso date not null,
  noches int not null check (noches between 1 and 365),
  habitacion text not null check (length(habitacion) between 1 and 12),
  categoria_id int references private.catalogo (id),
  canal_id int not null references private.catalogo (id),
  huespedes_esperados int not null check (huespedes_esperados between 1 and 12),
  precio_efectivo numeric(14, 2) not null check (precio_efectivo >= 0),
  precio_transferencia numeric(14, 2) check (precio_transferencia >= 0),
  precio_usd numeric(14, 2) check (precio_usd >= 0),
  sena numeric(14, 2) not null default 0 check (sena >= 0),
  fecha_sena date,
  nota text check (length(nota) <= 500),
  editado_en timestamptz,
  editado_por text,
  cancelada_en timestamptz,
  cancelada_por text,
  estadia_id bigint references private.estadias (id)
);
alter table private.reservas_anotadas enable row level security;
create index if not exists anotadas_ingreso_idx on private.reservas_anotadas (fecha_ingreso);
create index if not exists anotadas_estadia_idx on private.reservas_anotadas (estadia_id);

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
-- ... y las de antes de la cantidad de huéspedes.
drop function if exists private.estadia_validar(text, numeric, text, int, date, numeric, date, int, int, int, private.estadias);
drop function if exists public.recepcion_reserva_nueva(text, text, numeric, text, int, date, numeric, date, int, int, int);
drop function if exists private.estadia_editar(text, boolean, bigint, text, numeric, text, int, date, numeric, date, int, int, int);
drop function if exists public.recepcion_estadia_editar(text, bigint, text, numeric, text, int, date, numeric, date, int, int, int);
drop function if exists public.admin_estadia_editar(text, bigint, text, numeric, text, int, date, numeric, date, int, int, int);

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

-- Cuándo fue lo último que pasó en una reserva: se cargó, la reabrió el dueño o entró su último huésped. Desde ahí corre el tiempo que
-- recepción la ve abierta.
create or replace function private.estadia_ultima(p_id bigint)
returns timestamptz language sql stable security definer set search_path = '' as $$
  select greatest(e.creado, coalesce(e.reabierta_en, e.creado), coalesce((select max(c.creado) from private.checkins_activos c where c.estadia_id = e.id), e.creado))
    from private.estadias e where e.id = p_id;
$$;

-- Cierra los códigos que estén mostrando esta reserva (de cualquier persona del equipo): ya no entra nadie más por ahí.
create or replace function private.estadia_cerrar_codigos(p_id bigint)
returns void language sql security definer set search_path = '' as $$
  update private.codigos_usuario set estadia_vence = now() where estadia_id = p_id and estadia_vence > now();
$$;

-- La reserva como la ven las pantallas. p_edicion_min = null para el dueño (siempre puede editar).
--   esperados: cuántos huéspedes van a hacer el check-in · con_checkin: cuántos ya lo hicieron · anulada: se descartó (no tenía huéspedes)
create or replace function private.estadia_json(p_id bigint, p_edicion_min int default null)
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'id', e.id, 'habitacion', e.habitacion, 'monto', e.monto, 'moneda', e.moneda, 'pago_hotel', e.pago_hotel, 'fecha_sena', e.fecha_sena,
    'noches', e.noches, 'canal_id', e.canal_id, 'canal', ca.nombre, 'canal_cobra', ca.cobra, 'categoria_id', e.categoria_id, 'categoria', cg.nombre,
    'medio_pago_id', e.medio_pago_id, 'medio_pago', m.nombre, 'fecha_cobro', e.fecha_cobro,
    'esperados', e.huespedes_esperados, 'con_checkin', (select count(*)::int from private.checkins_activos c where c.estadia_id = e.id), 'anulada', e.anulada_en is not null,
    'cargado_por', e.cargado_por, 'creado', e.creado, 'titular', e.titular, 'nota', e.nota,
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
--   p_huespedes: cuántos huéspedes van a hacer el check-in (1 a 12). Obligatorio al abrir una reserva; al corregirla, si no se manda se deja el que tenía.
create or replace function private.estadia_validar(p_hab text, p_monto numeric, p_moneda text, p_medio int, p_fecha date, p_pago numeric, p_fecha_sena date, p_noches int, p_canal int, p_categoria int, p_huespedes int, p_actual private.estadias default null)
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
  v_hues int := coalesce(p_huespedes, p_actual.huespedes_esperados);
begin
  if h is null or not private.habitacion_ok(h) then v_err := array_append(v_err, 'habitacion'); end if;
  if v_hues is null or v_hues not between 1 and 12 then v_err := array_append(v_err, 'huespedes'); end if;
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
                            'fecha_sena', v_sena_fecha, 'noches', p_noches, 'canal', p_canal, 'categoria', v_cat, 'huespedes', v_hues);
end;
$$;

-- La reserva anotada como la ven las pantallas. dias_para: cuántos días faltan para el ingreso (negativo = ya pasó). estado: anotada | en_curso | cancelada.
create or replace function private.anotada_json(p_id bigint)
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'id', a.id, 'titular', a.titular, 'fecha_ingreso', a.fecha_ingreso, 'noches', a.noches, 'salida', a.fecha_ingreso + a.noches,
    'dias_para', a.fecha_ingreso - (now() at time zone 'America/Argentina/Buenos_Aires')::date,
    'habitacion', a.habitacion, 'categoria_id', a.categoria_id, 'categoria', cg.nombre, 'canal_id', a.canal_id, 'canal', ca.nombre, 'canal_cobra', ca.cobra,
    'esperados', a.huespedes_esperados, 'precio_efectivo', a.precio_efectivo, 'precio_transferencia', a.precio_transferencia, 'precio_usd', a.precio_usd,
    'sena', a.sena, 'fecha_sena', a.fecha_sena, 'nota', a.nota, 'cargado_por', a.cargado_por, 'creado', a.creado,
    'estado', case when a.cancelada_en is not null then 'cancelada' when a.estadia_id is not null then 'en_curso' else 'anotada' end,
    'cancelada_por', a.cancelada_por, 'estadia_id', a.estadia_id,
    'con_checkin', case when a.estadia_id is null then 0 else (select count(*)::int from private.checkins_activos c where c.estadia_id = a.estadia_id) end)
    from private.reservas_anotadas a
    join private.catalogo ca on ca.id = a.canal_id
    left join private.catalogo cg on cg.id = a.categoria_id
   where a.id = p_id;
$$;

-- Revisa los datos de una reserva anotada. Devuelve { ok, ...valores limpios } o { ok:false, campos:[...] }.
--   Un canal que no cobra (obra social) no lleva precios ni seña (se facturan aparte): lo que mande la pantalla se ignora.
--   La seña no puede ser más que el precio más bajo (si el efectivo sale 100.000 y la transferencia 110.000, la seña llega hasta 100.000).
--   p_actual: la reserva tal como está hoy (al corregirla): acepta el canal o la categoría que ya tenía aunque el dueño los haya quitado de la lista.
create or replace function private.anotada_validar(p_titular text, p_ingreso date, p_hab text, p_noches int, p_categoria int, p_canal int, p_huespedes int,
                                                    p_efectivo numeric, p_transf numeric, p_usd numeric, p_sena numeric, p_fecha_sena date, p_nota text,
                                                    p_actual private.reservas_anotadas default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_err text[] := array[]::text[];
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  t text := btrim(regexp_replace(coalesce(p_titular, ''), '\s+', ' ', 'g'));
  h text := private.habitacion_normal(p_hab);
  n text := nullif(btrim(coalesce(p_nota, '')), '');
  ca private.catalogo;
  v_cobra boolean := true;
  v_cat int := null;
  v_ef numeric := p_efectivo;
  v_tr numeric := p_transf;
  v_us numeric := p_usd;
  v_se numeric := coalesce(p_sena, 0);
  v_fs date := null;
begin
  if length(t) not between 1 and 60 or t ~ '[[:cntrl:]]' then v_err := array_append(v_err, 'titular'); end if;
  if p_ingreso is null or p_ingreso not between v_hoy - 60 and v_hoy + 730 then v_err := array_append(v_err, 'fecha_ingreso'); end if;
  if h is null or not private.habitacion_ok(h) then v_err := array_append(v_err, 'habitacion'); end if;
  if p_noches is null or p_noches not between 1 and 365 then v_err := array_append(v_err, 'noches'); end if;
  if p_huespedes is null or p_huespedes not between 1 and 12 then v_err := array_append(v_err, 'huespedes'); end if;
  if n is not null and (length(n) > 500 or regexp_replace(n, '[\n\r\t]', ' ', 'g') ~ '[[:cntrl:]]') then v_err := array_append(v_err, 'nota'); end if;
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
  if not v_cobra then
    v_ef := 0; v_tr := null; v_us := null; v_se := 0;
  else
    if p_efectivo is null or p_efectivo <= 0 or p_efectivo >= 1e12 then v_err := array_append(v_err, 'precio_efectivo'); end if;
    if p_transf is not null and (p_transf <= 0 or p_transf >= 1e12) then v_err := array_append(v_err, 'precio_transferencia'); end if;
    if p_usd is not null and (p_usd <= 0 or p_usd >= 1e9) then v_err := array_append(v_err, 'precio_usd'); end if;
    if p_sena is not null and (p_sena < 0 or p_sena >= 1e12) then
      v_err := array_append(v_err, 'sena');
    elsif p_efectivo is not null and p_efectivo > 0 and v_se > least(p_efectivo, coalesce(p_transf, p_efectivo)) then
      v_err := array_append(v_err, 'sena');
    end if;
    if v_se > 0 and p_fecha_sena is not null then
      if p_fecha_sena not between v_hoy - 800 and v_hoy + 1 then v_err := array_append(v_err, 'fecha_sena'); else v_fs := p_fecha_sena; end if;
    end if;
  end if;
  if array_length(v_err, 1) is not null then
    return jsonb_build_object('ok', false, 'campos', to_jsonb(v_err));
  end if;
  return jsonb_build_object('ok', true, 'titular', t, 'ingreso', p_ingreso, 'habitacion', h, 'noches', p_noches, 'categoria', v_cat, 'canal', p_canal,
                            'huespedes', p_huespedes, 'efectivo', v_ef, 'transf', v_tr, 'usd', v_us, 'sena', v_se, 'fecha_sena', v_fs, 'nota', n);
end;
$$;

-- ---------------------------------------------------------------- huésped

-- ¿Sigue abierta la reserva? No está anulada y todavía faltan huéspedes por hacer el check-in.
create or replace function private.estadia_abierta(p_id bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.estadias e
     where e.id = p_id and e.anulada_en is null
       and (select count(*) from private.checkins_activos c where c.estadia_id = e.id) < e.huespedes_esperados);
$$;

-- Si a la reserva le faltan huéspedes (por ejemplo, el dueño sacó a uno), vuelve a estar abierta y su plazo de 3 días en recepción cuenta desde ahora.
create or replace function private.estadia_reabrir(p_id bigint)
returns void language sql security definer set search_path = '' as $$
  update private.estadias set reabierta_en = now() where id = p_id and anulada_en is null and private.estadia_abierta(p_id);
$$;

-- Igual que antes, pero el código solo sirve mientras su dueño tenga una reserva abierta (con lugar todavía), y la sesión lleva esa reserva.
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
     and private.estadia_abierta(k.estadia_id)
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
-- La reserva tiene un tope de huéspedes: si ya está completa (o se anuló mientras el huésped llenaba el formulario) no entra nadie más. Se mira con la
-- fila de la reserva bloqueada, así dos huéspedes que envían a la vez no se quedan con el mismo último lugar. Cuando entra el último, los códigos
-- de esa reserva se apagan solos.
create or replace function public.checkin_enviar(p_token text, p_datos jsonb, p_idioma text, p_acepta boolean)
returns json language plpgsql security definer set search_path = '' as $$
declare
  cfg private.checkin_config;
  s private.checkin_sesiones;
  e private.estadias;
  v_hash text;
  v jsonb;
  v_id bigint;
  v_n int := 0;
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
  select * into e from private.estadias where id = s.estadia_id for update;
  if found then
    if e.anulada_en is not null then
      return json_build_object('ok', false, 'error', 'reserva_cerrada');
    end if;
    select count(*)::int into v_n from private.checkins_activos where estadia_id = e.id;
    if v_n >= e.huespedes_esperados then
      return json_build_object('ok', false, 'error', 'reserva_completa');
    end if;
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
  insert into private.checkins (grupo, idioma, datos, consentimiento, foto_id, foto_nombre, habilitado_por, estadia_id, habitacion, medio_pago_id)
    values (s.grupo, left(regexp_replace(coalesce(p_idioma, ''), '[^A-Za-z-]', '', 'g'), 10), v -> 'datos',
            jsonb_build_object('aceptado', true, 'version', 1, 'en', now()), s.foto_id, s.foto_nombre, s.habilitado_por,
            e.id, e.habitacion, coalesce(e.medio_pago_id, 6))
    returning id into v_id;
  if s.foto_id is not null then
    insert into private.checkin_fotos (checkin_id, foto_id, nombre, origen) values (v_id, s.foto_id, s.foto_nombre, 'huesped');
  end if;
  update private.checkin_sesiones set usada = true where token_hash = v_hash;
  if e.id is not null and v_n + 1 >= e.huespedes_esperados then
    perform private.estadia_cerrar_codigos(e.id); -- ya entraron todos: la reserva se cierra y el código deja de servir
  end if;
  return json_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------- recepción

-- Lo que consulta la pantalla de recepción: la reserva con el código a la vista (solo si hay una), las reservas abiertas de todo el equipo
-- (las que todavía esperan huéspedes), los huéspedes de los últimos días (cada uno con su reserva) y los medios de pago.
--   reservas_abiertas: las que no se anularon y todavía no tienen a todos sus huéspedes, vistas por `dias_recepcion` días desde su última actividad.
--     Las que no tienen ningún huésped están «en espera»: no suman en ninguna estadística.
create or replace function public.recepcion_estado(p_clave text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  r text;
  cfg private.checkin_config;
  c private.codigos_usuario;
  v_actor jsonb;
  v_uid bigint;
  v_edicion int;
  v_lista json;
  v_config json;
  v_medios json;
  v_categorias json;
  v_canales json;
  v_abiertas json;
  v_llegadas json;
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
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
  v_edicion := case when coalesce((v_actor ->> 'dueno')::boolean, false) then null when cfg.edicion_activa then cfg.edicion_min else 0 end;
  select coalesce(json_agg(row_to_json(t) order by t.creado desc), '[]'::json) into v_abiertas from (
    select e.id, e.creado, private.estadia_json(e.id, v_edicion) as estadia,
           (select coalesce(json_agg(json_build_object('nombre', k.datos ->> 'nombre', 'apellido', k.datos ->> 'apellido') order by k.id), '[]'::json)
              from private.checkins_activos k where k.estadia_id = e.id) as huespedes,
           greatest(0, floor(extract(epoch from (private.estadia_ultima(e.id) + make_interval(days => cfg.dias_recepcion) - now()))))::int as quedan_seg
      from private.estadias e
     where e.anulada_en is null
       and private.estadia_abierta(e.id)
       and private.estadia_ultima(e.id) > now() - make_interval(days => cfg.dias_recepcion)
     order by e.creado desc
     limit 50
  ) t;
  -- Las reservas anotadas que llegan en los próximos días (o se pasaron hace poco) y todavía no empezaron el check-in.
  select coalesce(json_agg(private.anotada_json(t.id) order by t.fecha_ingreso, t.id), '[]'::json) into v_llegadas from (
    select a.id, a.fecha_ingreso from private.reservas_anotadas a
     where a.cancelada_en is null and a.estadia_id is null
       and a.fecha_ingreso between v_hoy - cfg.dias_recepcion and v_hoy + cfg.dias_recepcion
     order by a.fecha_ingreso, a.id limit 100
  ) t;
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
      from private.checkins_activos k
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
    return json_build_object('ok', true, 'activo', false, 'codigo', null, 'reserva', null, 'reservas_abiertas', v_abiertas, 'llegadas', v_llegadas, 'quien', v_actor ->> 'alias', 'config', v_config, 'huespedes', v_lista, 'medios_pago', v_medios,
      'categorias', v_categorias, 'canales', v_canales);
  end if;
  select * into c from private.codigos_usuario where usuario_id = v_uid;
  -- El código solo se muestra mientras la reserva siga abierta: si se completó o se anuló, vuelve la lista.
  if found and c.estadia_id is not null and c.estadia_vence > now() and private.estadia_abierta(c.estadia_id) then
    c := private.codigo_usuario(v_uid, false);
    v_codigo := json_build_object('valor', c.codigo,
                                  'vence_seg', greatest(0, ceil(extract(epoch from (c.vence - now()))))::int,
                                  'usos', c.usos, 'usos_max', c.usos_max);
    v_reserva := json_build_object('estadia', private.estadia_json(c.estadia_id, v_edicion),
      'vence_seg', greatest(0, ceil(extract(epoch from (c.estadia_vence - now()))))::int,
      'huespedes', (select coalesce(json_agg(json_build_object('id', k.id, 'nombre', k.datos ->> 'nombre', 'apellido', k.datos ->> 'apellido') order by k.id), '[]'::json)
                      from private.checkins_activos k where k.estadia_id = c.estadia_id));
  end if;
  return json_build_object('ok', true, 'activo', true, 'quien', v_actor ->> 'alias', 'codigo', v_codigo, 'reserva', v_reserva, 'reservas_abiertas', v_abiertas, 'llegadas', v_llegadas,
    'config', v_config, 'huespedes', v_lista, 'medios_pago', v_medios, 'categorias', v_categorias, 'canales', v_canales);
end;
$$;

-- Arma una reserva (estadía) y deja a quien la arma con su primer código. La usan «Nueva reserva» (sin anotar antes) y «Hacer el check-in» de una reserva
-- anotada: las dos pasan por las mismas validaciones. p_actor = private.actor(clave). Devuelve { ok, id } o { ok:false, error, campos? }.
create or replace function private.estadia_crear(p_actor jsonb, p_habitacion text, p_monto numeric, p_moneda text, p_medio_pago int, p_fecha date, p_pago_hotel numeric,
                                                  p_fecha_sena date, p_noches int, p_canal int, p_categoria int, p_huespedes int, p_titular text default null, p_nota text default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  cfg private.checkin_config;
  v jsonb;
  v_id bigint;
  v_uid bigint := (p_actor ->> 'id')::bigint;
begin
  select * into cfg from private.checkin_config where id = 1;
  -- Sin huéspedes esperados no hay reserva: p_actual es null, así que la cantidad es obligatoria.
  v := private.estadia_validar(p_habitacion, p_monto, p_moneda, p_medio_pago, p_fecha, p_pago_hotel, p_fecha_sena, p_noches, p_canal, p_categoria, p_huespedes);
  if not (v ->> 'ok')::boolean then
    return json_build_object('ok', false, 'error', 'datos_invalidos', 'campos', v -> 'campos');
  end if;
  insert into private.estadias (habitacion, monto, moneda, medio_pago_id, fecha_cobro, cargado_por, pago_hotel, fecha_sena, noches, canal_id, categoria_id, huespedes_esperados, titular, nota)
    values (v ->> 'habitacion', (v ->> 'monto')::numeric, v ->> 'moneda', (v ->> 'medio')::int, p_fecha, p_actor ->> 'alias', (v ->> 'pago')::numeric, (v ->> 'fecha_sena')::date,
            (v ->> 'noches')::int, (v ->> 'canal')::int, (v ->> 'categoria')::int, (v ->> 'huespedes')::int, nullif(btrim(p_titular), ''), nullif(btrim(p_nota), '')) returning id into v_id;
  perform private.codigo_usuario(v_uid, true);
  update private.codigos_usuario set estadia_id = v_id, estadia_vence = now() + make_interval(mins => cfg.reserva_min) where usuario_id = v_uid;
  perform private.auditar('recepcion', 'reserva_nueva', null, jsonb_build_object('estadia', v_id, 'alias', p_actor ->> 'alias'));
  return json_build_object('ok', true, 'id', v_id);
end;
$$;

-- Abre una reserva nueva (sin anotar antes) y deja a esta persona con su primer código. La reserva que tuviera a la vista no se pierde: sigue abierta,
-- en la lista de reservas abiertas, si todavía le faltan huéspedes. Todo es obligatorio, incluida la cantidad de huéspedes.
create or replace function public.recepcion_reserva_nueva(p_clave text, p_habitacion text, p_monto numeric, p_moneda text, p_medio_pago int, p_fecha date, p_pago_hotel numeric default null, p_fecha_sena date default null, p_noches int default null, p_canal int default null, p_categoria int default null, p_huespedes int default null)
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
  if not cfg.activo then
    return json_build_object('ok', false, 'error', 'no_disponible');
  end if;
  return private.estadia_crear(private.actor(p_clave), p_habitacion, p_monto, p_moneda, p_medio_pago, p_fecha, p_pago_hotel, p_fecha_sena, p_noches, p_canal, p_categoria, p_huespedes);
end;
$$;

-- Hace el check-in de una reserva anotada: recepción elige cómo paga lo que resta y la app arma la reserva con ese cobro (los mismos datos y controles que
-- «Nueva reserva»; la pantalla los trae completados con los precios anotados y se pueden corregir, por ejemplo si en el mostrador se negoció otro monto).
-- Recepción solo ve las llegadas de los últimos y próximos `dias_recepcion` días; el dueño, cualquiera. La reserva anotada queda enlazada a la estadía.
create or replace function public.recepcion_llegada_iniciar(p_clave text, p_id bigint, p_habitacion text, p_monto numeric, p_moneda text, p_medio_pago int, p_fecha date, p_pago_hotel numeric default null, p_fecha_sena date default null, p_noches int default null, p_canal int default null, p_categoria int default null, p_huespedes int default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  r text;
  cfg private.checkin_config;
  a private.reservas_anotadas;
  v_actor jsonb;
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  res json;
begin
  r := private.comprobar_recepcion(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  select * into cfg from private.checkin_config where id = 1;
  if not cfg.activo then
    return json_build_object('ok', false, 'error', 'no_disponible');
  end if;
  v_actor := private.actor(p_clave);
  select * into a from private.reservas_anotadas where id = p_id for update;
  if not found then
    return json_build_object('ok', false, 'error', 'no_existe');
  end if;
  if a.cancelada_en is not null then
    return json_build_object('ok', false, 'error', 'anotada_cancelada');
  end if;
  if a.estadia_id is not null then
    return json_build_object('ok', false, 'error', 'anotada_ya_empezo');
  end if;
  if not coalesce((v_actor ->> 'dueno')::boolean, false) and a.fecha_ingreso not between v_hoy - cfg.dias_recepcion and v_hoy + cfg.dias_recepcion then
    return json_build_object('ok', false, 'error', 'llegada_fuera_de_fecha');
  end if;
  res := private.estadia_crear(v_actor, p_habitacion, p_monto, p_moneda, p_medio_pago, p_fecha, p_pago_hotel, p_fecha_sena, p_noches, p_canal, p_categoria, p_huespedes, a.titular, a.nota);
  if not (res ->> 'ok')::boolean then
    return res;
  end if;
  update private.reservas_anotadas set estadia_id = (res ->> 'id')::bigint where id = a.id;
  perform private.auditar('recepcion', 'llegada_iniciar', null, jsonb_build_object('anotada', a.id, 'estadia', (res ->> 'id')::bigint, 'alias', v_actor ->> 'alias'));
  return res;
end;
$$;

-- Vuelve a darle código a una reserva que sigue abierta (por ejemplo, para el huésped que llegó más tarde que el resto). Cualquiera de recepción puede:
-- el check-in queda anotado como habilitado por quien da el código. Recepción solo ve las reservas de los últimos `dias_recepcion` días; el dueño, cualquiera.
create or replace function public.recepcion_reserva_abrir(p_clave text, p_id bigint)
returns json language plpgsql security definer set search_path = '' as $$
declare
  r text;
  cfg private.checkin_config;
  e private.estadias;
  v_actor jsonb;
  v_uid bigint;
begin
  r := private.comprobar_recepcion(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  select * into cfg from private.checkin_config where id = 1;
  if not cfg.activo then
    return json_build_object('ok', false, 'error', 'no_disponible');
  end if;
  v_actor := private.actor(p_clave);
  v_uid := (v_actor ->> 'id')::bigint;
  select * into e from private.estadias where id = p_id for update;
  if not found then
    return json_build_object('ok', false, 'error', 'no_existe');
  end if;
  if e.anulada_en is not null then
    return json_build_object('ok', false, 'error', 'reserva_anulada');
  end if;
  if not private.estadia_abierta(e.id) then
    return json_build_object('ok', false, 'error', 'reserva_completa');
  end if;
  if not coalesce((v_actor ->> 'dueno')::boolean, false) and private.estadia_ultima(e.id) <= now() - make_interval(days => cfg.dias_recepcion) then
    return json_build_object('ok', false, 'error', 'reserva_vencida');
  end if;
  perform private.codigo_usuario(v_uid, true); -- código nuevo: el de la reserva anterior no puede servir para esta
  update private.codigos_usuario set estadia_id = e.id, estadia_vence = now() + make_interval(mins => cfg.reserva_min) where usuario_id = v_uid;
  perform private.auditar('recepcion', 'reserva_abrir', null, jsonb_build_object('estadia', e.id, 'alias', v_actor ->> 'alias'));
  return json_build_object('ok', true, 'id', e.id);
end;
$$;

-- Apaga el código que está a la vista (los códigos dejan de servir) o, con p_extender, le da otros `reserva_min` minutos. NO cierra la reserva:
-- si todavía le faltan huéspedes sigue abierta, en la lista, para volver a darle código.
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
create or replace function private.estadia_editar(p_quien text, p_dueno boolean, p_id bigint, p_habitacion text, p_monto numeric, p_moneda text, p_medio_pago int, p_fecha date, p_pago_hotel numeric default null, p_fecha_sena date default null, p_noches int default null, p_canal int default null, p_categoria int default null, p_huespedes int default null)
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
  v := private.estadia_validar(p_habitacion, p_monto, p_moneda, p_medio_pago, p_fecha, p_pago_hotel, p_fecha_sena, p_noches, p_canal, p_categoria, p_huespedes, e);
  if not (v ->> 'ok')::boolean then
    return json_build_object('ok', false, 'error', 'datos_invalidos', 'campos', v -> 'campos');
  end if;
  if (v ->> 'huespedes')::int <> e.huespedes_esperados then v_cambios := array_append(v_cambios, 'huespedes'); end if;
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
           huespedes_esperados = (v ->> 'huespedes')::int,
           editado_en = now(), editado_por = p_quien where id = p_id;
    update private.checkins set habitacion = v ->> 'habitacion', medio_pago_id = (v ->> 'medio')::int where estadia_id = p_id;
    if (v ->> 'huespedes')::int > e.huespedes_esperados and private.estadia_abierta(p_id) then
      -- El dueño sube la cantidad de huéspedes de una reserva ya completa: vuelve a estar abierta y recepción la ve de nuevo.
      update private.estadias set reabierta_en = now() where id = p_id;
    elsif not private.estadia_abierta(p_id) then
      perform private.estadia_cerrar_codigos(p_id); -- bajó la cantidad y ya están todos: el código deja de servir
    end if;
    perform private.auditar(case when p_dueno then 'admin' else 'recepcion' end, 'estadia_editar', null,
      jsonb_build_object('estadia', p_id, 'campos', to_jsonb(v_cambios), 'por', p_quien));
  end if;
  return json_build_object('ok', true);
end;
$$;

create or replace function public.recepcion_estadia_editar(p_clave text, p_id bigint, p_habitacion text, p_monto numeric, p_moneda text, p_medio_pago int, p_fecha date, p_pago_hotel numeric default null, p_fecha_sena date default null, p_noches int default null, p_canal int default null, p_categoria int default null, p_huespedes int default null)
returns json language plpgsql security definer set search_path = '' as $$
declare r text;
begin
  r := private.comprobar_recepcion(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  return private.estadia_editar(private.actor(p_clave) ->> 'alias', coalesce((private.actor(p_clave) ->> 'dueno')::boolean, false),
                                p_id, p_habitacion, p_monto, p_moneda, p_medio_pago, p_fecha, p_pago_hotel, p_fecha_sena, p_noches, p_canal, p_categoria, p_huespedes);
end;
$$;

-- ---------------------------------------------------------------- dueño

create or replace function public.admin_estadia_editar(p_clave text, p_id bigint, p_habitacion text, p_monto numeric, p_moneda text, p_medio_pago int, p_fecha date, p_pago_hotel numeric default null, p_fecha_sena date default null, p_noches int default null, p_canal int default null, p_categoria int default null, p_huespedes int default null)
returns json language plpgsql security definer set search_path = '' as $$
declare r text;
begin
  r := private.comprobar_clave(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  return private.estadia_editar(coalesce(private.actor(p_clave) ->> 'alias', 'Dueño'), true, p_id, p_habitacion, p_monto, p_moneda, p_medio_pago, p_fecha, p_pago_hotel, p_fecha_sena, p_noches, p_canal, p_categoria, p_huespedes);
end;
$$;

-- Anula una reserva (por ejemplo, una de prueba o una a la que al final no llegó nadie), o la restaura. NO borra nada: la fila queda marcada con quién y
-- cuándo, y se puede restaurar.
--   Recepción solo anula las que ve (las abiertas de los últimos días) y solo si no tienen huéspedes: son personas registradas.
--   El dueño anula cualquiera. Si tenía huéspedes, se quitan junto con la reserva (con la misma marca de tiempo) y vuelven cuando la restaura; los que
--   ya se habían quitado antes por separado siguen quitados. Solo el dueño restaura.
create or replace function private.estadia_anular(p_quien text, p_dueno boolean, p_id bigint, p_anular boolean)
returns json language plpgsql security definer set search_path = '' as $$
declare
  cfg private.checkin_config;
  e private.estadias;
  v_n int := 0;
begin
  select * into cfg from private.checkin_config where id = 1;
  select * into e from private.estadias where id = p_id for update;
  if not found then
    return json_build_object('ok', false, 'error', 'no_existe');
  end if;
  if p_anular then
    if e.anulada_en is not null then
      return json_build_object('ok', true); -- ya estaba anulada
    end if;
    select count(*)::int into v_n from private.checkins_activos where estadia_id = e.id;
    if v_n > 0 and not p_dueno then
      return json_build_object('ok', false, 'error', 'tiene_huespedes');
    end if;
    if not p_dueno and private.estadia_ultima(e.id) <= now() - make_interval(days => cfg.dias_recepcion) then
      return json_build_object('ok', false, 'error', 'reserva_vencida');
    end if;
    update private.estadias set anulada_en = now(), anulada_por = p_quien where id = e.id;
    if v_n = 0 then
      update private.reservas_anotadas set estadia_id = null where estadia_id = e.id; -- si venía de una reserva anotada, vuelve a las llegadas (se cargó mal el cobro)
    end if;
    update private.checkins set quitado_en = now(), quitado_por = p_quien where estadia_id = e.id and quitado_en is null;
    perform private.estadia_cerrar_codigos(e.id);
    perform private.auditar(case when p_dueno then 'admin' else 'recepcion' end, 'reserva_anular', null, jsonb_build_object('estadia', e.id, 'por', p_quien, 'huespedes', v_n));
  else
    if not p_dueno then
      return json_build_object('ok', false, 'error', 'sin_permiso');
    end if;
    if e.anulada_en is not null then
      update private.checkins set quitado_en = null, quitado_por = null where estadia_id = e.id and quitado_en = e.anulada_en; -- los que se quitaron con ella
      update private.estadias set anulada_en = null, anulada_por = null, reabierta_en = now() where id = e.id;
      if not private.estadia_abierta(e.id) then
        perform private.estadia_cerrar_codigos(e.id);
      end if;
      perform private.auditar('admin', 'reserva_restaurar', null, jsonb_build_object('estadia', e.id, 'por', p_quien));
    end if;
  end if;
  return json_build_object('ok', true);
end;
$$;

create or replace function public.recepcion_reserva_anular(p_clave text, p_id bigint)
returns json language plpgsql security definer set search_path = '' as $$
declare r text;
begin
  r := private.comprobar_recepcion(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  return private.estadia_anular(private.actor(p_clave) ->> 'alias', coalesce((private.actor(p_clave) ->> 'dueno')::boolean, false), p_id, true);
end;
$$;

-- p_anular = false restaura una reserva anulada.
create or replace function public.admin_reserva_anular(p_clave text, p_id bigint, p_anular boolean default true)
returns json language plpgsql security definer set search_path = '' as $$
declare r text;
begin
  r := private.comprobar_clave(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  return private.estadia_anular(coalesce(private.actor(p_clave) ->> 'alias', 'Dueño'), true, p_id, coalesce(p_anular, true));
end;
$$;

-- ---------------------------------------------------------------- reservas anotadas (el dueño y recepción las anotan y las corrigen; solo el dueño las cancela)

-- Anota una reserva por adelantado (p_id null) o corrige una que todavía no empezó el check-in. Devuelve { ok, id, superpuestas }: superpuestas son las
-- otras reservas anotadas de la MISMA habitación cuyas fechas se pisan con esta (es un aviso: igual se guarda; decide quien la anota).
--   Anotan y corrigen el DUEÑO y RECEPCIÓN (por ejemplo, para el que llega de la calle sin reserva: se anota a su nombre, con el monto, y se sigue con el check-in).
--   Recepción corrige las que ve (las de los últimos y próximos `dias_recepcion` días); el dueño, cualquiera. Cancelar es solo del dueño (más abajo).
--   Todo cambio queda en el historial con quién lo hizo y qué campos tocó.
--   Precios: p_efectivo y, si quiere, p_transferencia (sin cargar = igual al efectivo) y p_usd (sin cargar = se calcula con el dólar oficial del día).
--   p_sena: lo que ya pagó, en pesos (no importa cómo). Lo que resta es el precio de cada método menos la seña.
create or replace function private.anotada_guardar(p_quien text, p_dueno boolean, p_id bigint, p_titular text, p_ingreso date, p_habitacion text, p_noches int, p_categoria int, p_canal int, p_huespedes int,
                                                    p_efectivo numeric, p_transferencia numeric, p_usd numeric, p_sena numeric, p_fecha_sena date, p_nota text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  cfg private.checkin_config;
  a private.reservas_anotadas;
  v jsonb;
  v_quien text := p_quien;
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_id bigint;
  v_cambios text[] := array[]::text[];
  v_pisan json;
begin
  select * into cfg from private.checkin_config where id = 1;
  if p_id is not null then
    select * into a from private.reservas_anotadas where id = p_id for update;
    if not found then
      return json_build_object('ok', false, 'error', 'no_existe');
    end if;
    if a.cancelada_en is not null then
      return json_build_object('ok', false, 'error', 'anotada_cancelada');
    end if;
    if a.estadia_id is not null then
      return json_build_object('ok', false, 'error', 'anotada_ya_empezo');
    end if;
    if not p_dueno and a.fecha_ingreso not between v_hoy - cfg.dias_recepcion and v_hoy + cfg.dias_recepcion then
      return json_build_object('ok', false, 'error', 'llegada_fuera_de_fecha');
    end if;
  end if;
  v := private.anotada_validar(p_titular, p_ingreso, p_habitacion, p_noches, p_categoria, p_canal, p_huespedes, p_efectivo, p_transferencia, p_usd, p_sena, p_fecha_sena, p_nota, a);
  if not (v ->> 'ok')::boolean then
    return json_build_object('ok', false, 'error', 'datos_invalidos', 'campos', v -> 'campos');
  end if;
  if p_id is null then
    insert into private.reservas_anotadas (cargado_por, titular, fecha_ingreso, noches, habitacion, categoria_id, canal_id, huespedes_esperados, precio_efectivo, precio_transferencia, precio_usd, sena, fecha_sena, nota)
      values (v_quien, v ->> 'titular', (v ->> 'ingreso')::date, (v ->> 'noches')::int, v ->> 'habitacion', (v ->> 'categoria')::int, (v ->> 'canal')::int, (v ->> 'huespedes')::int,
              (v ->> 'efectivo')::numeric, (v ->> 'transf')::numeric, (v ->> 'usd')::numeric, (v ->> 'sena')::numeric, (v ->> 'fecha_sena')::date, v ->> 'nota')
      returning id into v_id;
    perform private.auditar(case when p_dueno then 'admin' else 'recepcion' end, 'anotada_guardar', null, jsonb_build_object('anotada', v_id, 'por', v_quien, 'nueva', true));
  else
    v_id := p_id;
    if (v ->> 'titular') <> a.titular then v_cambios := array_append(v_cambios, 'titular'); end if;
    if (v ->> 'ingreso')::date <> a.fecha_ingreso then v_cambios := array_append(v_cambios, 'fecha_ingreso'); end if;
    if (v ->> 'habitacion') <> a.habitacion then v_cambios := array_append(v_cambios, 'habitacion'); end if;
    if (v ->> 'noches')::int <> a.noches then v_cambios := array_append(v_cambios, 'noches'); end if;
    if (v ->> 'huespedes')::int <> a.huespedes_esperados then v_cambios := array_append(v_cambios, 'huespedes'); end if;
    if (v ->> 'efectivo')::numeric <> a.precio_efectivo or (v ->> 'transf')::numeric is distinct from a.precio_transferencia or (v ->> 'usd')::numeric is distinct from a.precio_usd then
      v_cambios := array_append(v_cambios, 'precios');
    end if;
    if (v ->> 'sena')::numeric <> a.sena or (v ->> 'fecha_sena')::date is distinct from a.fecha_sena then v_cambios := array_append(v_cambios, 'sena'); end if;
    if (v ->> 'nota') is distinct from a.nota then v_cambios := array_append(v_cambios, 'nota'); end if;
    if (v ->> 'categoria')::int is distinct from a.categoria_id or (v ->> 'canal')::int <> a.canal_id then v_cambios := array_append(v_cambios, 'categoria_canal'); end if;
    update private.reservas_anotadas set titular = v ->> 'titular', fecha_ingreso = (v ->> 'ingreso')::date, noches = (v ->> 'noches')::int, habitacion = v ->> 'habitacion',
           categoria_id = (v ->> 'categoria')::int, canal_id = (v ->> 'canal')::int, huespedes_esperados = (v ->> 'huespedes')::int,
           precio_efectivo = (v ->> 'efectivo')::numeric, precio_transferencia = (v ->> 'transf')::numeric, precio_usd = (v ->> 'usd')::numeric,
           sena = (v ->> 'sena')::numeric, fecha_sena = (v ->> 'fecha_sena')::date, nota = v ->> 'nota', editado_en = now(), editado_por = v_quien
     where id = v_id;
    perform private.auditar(case when p_dueno then 'admin' else 'recepcion' end, 'anotada_guardar', null, jsonb_build_object('anotada', v_id, 'por', v_quien, 'campos', to_jsonb(v_cambios)));
  end if;
  select coalesce(json_agg(json_build_object('id', o.id, 'titular', o.titular, 'fecha_ingreso', o.fecha_ingreso, 'salida', o.fecha_ingreso + o.noches) order by o.fecha_ingreso), '[]'::json) into v_pisan
    from private.reservas_anotadas o, private.reservas_anotadas n
   where n.id = v_id and o.id <> n.id and o.cancelada_en is null and o.habitacion = n.habitacion
     and o.fecha_ingreso < n.fecha_ingreso + n.noches and n.fecha_ingreso < o.fecha_ingreso + o.noches;
  return json_build_object('ok', true, 'id', v_id, 'superpuestas', v_pisan);
end;
$$;

-- Las dos puertas: el dueño (clave del dueño) y recepción (clave o sesión de recepción; si quien entra es el dueño, vale como dueño).
create or replace function public.admin_anotada_guardar(p_clave text, p_id bigint, p_titular text, p_ingreso date, p_habitacion text, p_noches int, p_categoria int, p_canal int, p_huespedes int,
                                                         p_efectivo numeric, p_transferencia numeric default null, p_usd numeric default null, p_sena numeric default 0, p_fecha_sena date default null, p_nota text default null)
returns json language plpgsql security definer set search_path = '' as $$
declare r text;
begin
  r := private.comprobar_clave(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  return private.anotada_guardar(coalesce(private.actor(p_clave) ->> 'alias', 'Dueño'), true, p_id, p_titular, p_ingreso, p_habitacion, p_noches, p_categoria, p_canal, p_huespedes,
                                 p_efectivo, p_transferencia, p_usd, p_sena, p_fecha_sena, p_nota);
end;
$$;

create or replace function public.recepcion_anotada_guardar(p_clave text, p_id bigint, p_titular text, p_ingreso date, p_habitacion text, p_noches int, p_categoria int, p_canal int, p_huespedes int,
                                                             p_efectivo numeric, p_transferencia numeric default null, p_usd numeric default null, p_sena numeric default 0, p_fecha_sena date default null, p_nota text default null)
returns json language plpgsql security definer set search_path = '' as $$
declare r text;
begin
  r := private.comprobar_recepcion(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  return private.anotada_guardar(private.actor(p_clave) ->> 'alias', coalesce((private.actor(p_clave) ->> 'dueno')::boolean, false), p_id, p_titular, p_ingreso, p_habitacion, p_noches, p_categoria, p_canal, p_huespedes,
                                 p_efectivo, p_transferencia, p_usd, p_sena, p_fecha_sena, p_nota);
end;
$$;

-- Cancela una reserva anotada que todavía no empezó el check-in (no se borra: queda marcada y se puede restaurar). SOLO EL DUEÑO: recepción anota y corrige,
-- pero no cancela (si se equivocó al anotar, lo corrige; si no hay que cancelarla, avisa al dueño). Una que ya empezó el check-in es una
-- reserva con su cobro: se corrige o se elimina como cualquier reserva.
create or replace function public.admin_anotada_cancelar(p_clave text, p_id bigint, p_cancelar boolean default true)
returns json language plpgsql security definer set search_path = '' as $$
declare
  r text;
  a private.reservas_anotadas;
  v_quien text;
begin
  r := private.comprobar_clave(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  v_quien := coalesce(private.actor(p_clave) ->> 'alias', 'Dueño');
  select * into a from private.reservas_anotadas where id = p_id for update;
  if not found then
    return json_build_object('ok', false, 'error', 'no_existe');
  end if;
  if coalesce(p_cancelar, true) then
    if a.estadia_id is not null then
      return json_build_object('ok', false, 'error', 'anotada_ya_empezo');
    end if;
    if a.cancelada_en is null then
      update private.reservas_anotadas set cancelada_en = now(), cancelada_por = v_quien where id = a.id;
      perform private.auditar('admin', 'anotada_cancelar', null, jsonb_build_object('anotada', a.id, 'por', v_quien));
    end if;
  elsif a.cancelada_en is not null then
    update private.reservas_anotadas set cancelada_en = null, cancelada_por = null where id = a.id;
    perform private.auditar('admin', 'anotada_restaurar', null, jsonb_build_object('anotada', a.id, 'por', v_quien));
  end if;
  return json_build_object('ok', true);
end;
$$;

-- Las reservas anotadas del dueño: las que todavía esperan al huésped (también las que ya pasaron de fecha), las que ya empezaron el check-in y las canceladas,
-- desde hace 60 días en adelante.
create or replace function public.admin_anotadas(p_clave text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  r text;
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
  r := private.comprobar_clave(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  return json_build_object('ok', true, 'hoy', v_hoy, 'anotadas', (
    select coalesce(json_agg(private.anotada_json(t.id) order by t.fecha_ingreso, t.id), '[]'::json)
      from (select a.id, a.fecha_ingreso from private.reservas_anotadas a where a.fecha_ingreso >= v_hoy - 60 order by a.fecha_ingreso, a.id limit 500) t));
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

-- Mueve un huésped a otra reserva (o a una de antes de las reservas): toma su habitación y su medio de pago. p_estadia null lo deja sin reserva.
-- Sirve para corregir un huésped que recepción puso en la reserva equivocada: la que dejó pierde uno (si le falta gente vuelve a estar abierta) y a la
-- que entra, si ya están todos, se le apagan los códigos. No se puede mover a una reserva anulada.
create or replace function public.admin_huesped_estadia(p_clave text, p_id bigint, p_estadia bigint)
returns json language plpgsql security definer set search_path = '' as $$
declare
  r text;
  e private.estadias;
  k private.checkins;
begin
  r := private.comprobar_clave(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  select * into k from private.checkins_activos where id = p_id;
  if not found then
    return json_build_object('ok', false, 'error', 'no_existe');
  end if;
  if p_estadia is not null then
    select * into e from private.estadias where id = p_estadia;
    if not found then
      return json_build_object('ok', false, 'error', 'no_existe');
    end if;
    if e.anulada_en is not null then
      return json_build_object('ok', false, 'error', 'reserva_anulada');
    end if;
    update private.checkins set estadia_id = e.id, habitacion = e.habitacion, medio_pago_id = e.medio_pago_id, editado_en = now(), editado_por = 'admin' where id = p_id;
  else
    update private.checkins set estadia_id = null, editado_en = now(), editado_por = 'admin' where id = p_id;
  end if;
  if k.estadia_id is not null and k.estadia_id is distinct from p_estadia then
    perform private.estadia_reabrir(k.estadia_id);
  end if;
  if p_estadia is not null and not private.estadia_abierta(p_estadia) then
    perform private.estadia_cerrar_codigos(p_estadia);
  end if;
  perform private.auditar('admin', 'huesped_estadia', p_id, jsonb_build_object('estadia', p_estadia, 'antes', k.estadia_id));
  return json_build_object('ok', true);
end;
$$;

-- Quita a un huésped (por ejemplo, uno que recepción cargó de más o por error) o lo restaura. NO borra nada: queda guardado con quién y cuándo, deja de verse y
-- de contar en las estadísticas, y se puede restaurar. Al quitarlo, a su reserva le falta uno: si ya estaba completa vuelve a estar abierta.
-- Si su reserva está anulada no se puede restaurar solo: se restaura la reserva (vuelven los que se quitaron con ella).
create or replace function private.huesped_quitar(p_quien text, p_id bigint, p_quitar boolean)
returns json language plpgsql security definer set search_path = '' as $$
declare
  k private.checkins;
  e private.estadias;
begin
  select * into k from private.checkins where id = p_id for update;
  if not found then
    return json_build_object('ok', false, 'error', 'no_existe');
  end if;
  if p_quitar then
    if k.quitado_en is null then
      update private.checkins set quitado_en = now(), quitado_por = p_quien where id = p_id;
      if k.estadia_id is not null then
        perform private.estadia_reabrir(k.estadia_id);
      end if;
      perform private.auditar('admin', 'huesped_quitar', p_id, jsonb_build_object('estadia', k.estadia_id, 'por', p_quien));
    end if;
  elsif k.quitado_en is not null then
    if k.estadia_id is not null then
      select * into e from private.estadias where id = k.estadia_id;
      if e.anulada_en is not null then
        return json_build_object('ok', false, 'error', 'reserva_anulada');
      end if;
    end if;
    update private.checkins set quitado_en = null, quitado_por = null where id = p_id;
    if k.estadia_id is not null and not private.estadia_abierta(k.estadia_id) then
      perform private.estadia_cerrar_codigos(k.estadia_id);
    end if;
    perform private.auditar('admin', 'huesped_restaurar', p_id, jsonb_build_object('estadia', k.estadia_id, 'por', p_quien));
  end if;
  return json_build_object('ok', true);
end;
$$;

create or replace function public.admin_huesped_quitar(p_clave text, p_id bigint, p_quitar boolean default true)
returns json language plpgsql security definer set search_path = '' as $$
declare r text;
begin
  r := private.comprobar_clave(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  return private.huesped_quitar(coalesce(private.actor(p_clave) ->> 'alias', 'Dueño'), p_id, coalesce(p_quitar, true));
end;
$$;

-- Los huéspedes quitados (por el dueño, o junto con una reserva anulada), para poder restaurarlos. reserva_anulada: se restauran con su reserva.
create or replace function public.admin_huespedes_quitados(p_clave text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  r text;
begin
  r := private.comprobar_clave(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  return json_build_object('ok', true, 'huespedes', (
    select coalesce(json_agg(row_to_json(t) order by t.quitado_en desc, t.id desc), '[]'::json) from (
      select k.id, k.datos ->> 'nombre' as nombre, k.datos ->> 'apellido' as apellido, k.habitacion, k.creado, k.quitado_en, k.quitado_por, k.estadia_id,
             coalesce((select e.anulada_en is not null from private.estadias e where e.id = k.estadia_id), false) as reserva_anulada
        from private.checkins k where k.quitado_en is not null
       order by k.quitado_en desc, k.id desc limit 100) t));
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
  v_reservas json;
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
        from private.checkins_activos k
        join private.medios_pago m on m.id = k.medio_pago_id
       where (p_antes is null or k.id < p_antes)
         and (v_q is null or translate(lower(concat_ws(' ', k.datos ->> 'nombre', k.datos ->> 'apellido', k.datos ->> 'email', k.datos ->> 'telefono',
                                        k.datos ->> 'localidad', k.datos ->> 'doc_numero', k.habitacion, m.nombre)),
                                       'áàâãäéèêëíìîïóòôõöúùûüñç', 'aaaaaeeeeiiiioooooouuuunc') like v_q escape '\')
       order by k.id desc
       limit v_lim + 1
    ) t;
  -- Las reservas de los últimos 60 días (no anuladas), también las que todavía no tienen ningún huésped: a donde se puede mover un huésped.
  select coalesce(json_agg(private.estadia_json(t.id) order by t.creado desc), '[]'::json) into v_reservas
    from (select e.id, e.creado from private.estadias e where e.anulada_en is null and e.creado > now() - interval '60 days' order by e.creado desc limit 100) t;
  return json_build_object('ok', true, 'huespedes', v_lista, 'hay_mas', v_n > v_lim, 'reservas', v_reservas);
end;
$$;

-- ---------------------------------------------------------------- estadísticas (solo el dueño)

-- Lo que necesita la pantalla de estadísticas: las reservas cobradas y los huéspedes del período, SIN datos personales
-- (ni nombre, ni documento, ni email, ni teléfono: solo si tiene o no). Las cuentas y los gráficos se arman en la pantalla.
-- El monto sigue en su moneda original con la fecha del cobro: la pantalla lo pasa a dólar oficial de ese día.
--   p_desde / p_hasta: fechas (hora argentina) · sin pasar nada, los últimos ~3 años.
--   visitas: cuántas estadías distintas tuvo esa misma persona (mismo documento) en toda la historia: 1 = vino una vez.
--   reservas: SOLO las que tienen al menos un huésped con check-in (y no están anuladas). Una reserva sin nadie adentro no es una habitación vendida:
--     no suma en ingresos, habitaciones, noches, tarifas ni en nada. Apenas entra el primer huésped, empieza a contar.
--   pendientes: las reservas del período que todavía no tienen ningún huésped (en espera) o se anularon (`anulada_en`; `quitados` = cuántos huéspedes
--     tiene eliminados, para saber cuántos vuelven al restaurarla), con todo lo que cargó recepción,
--     para que el dueño las vea en la caja, las corrija o las anule. Nunca entran en las cuentas.
create or replace function public.admin_estadisticas(p_clave text, p_desde date default null, p_hasta date default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  r text;
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_desde date := coalesce(p_desde, v_hoy - 1100);
  v_hasta date := coalesce(p_hasta, v_hoy);
  v_reservas json;
  v_pendientes json;
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
           e.medio_pago_id, e.canal_id, e.categoria_id, e.creado, e.huespedes_esperados as esperados, e.titular,
           (select count(*)::int from private.checkins_activos c where c.estadia_id = e.id) as huespedes
    from private.estadias e
    join private.medios_pago m on m.id = e.medio_pago_id
    join private.catalogo ca on ca.id = e.canal_id
    left join private.catalogo cg on cg.id = e.categoria_id
    where e.fecha_cobro between v_desde and v_hasta
      and e.anulada_en is null
      and exists (select 1 from private.checkins_activos c where c.estadia_id = e.id)
    order by e.fecha_cobro desc, e.id desc
    limit 20000
  ) t;

  select coalesce(json_agg(t order by t.creado desc, t.id desc), '[]'::json) into v_pendientes
  from (
    select e.id, e.habitacion, e.monto, e.moneda, e.pago_hotel, e.fecha_sena, m.nombre as medio_pago, e.fecha_cobro, e.cargado_por,
           e.noches, ca.nombre as canal, ca.cobra as canal_cobra, cg.nombre as categoria,
           e.medio_pago_id, e.canal_id, e.categoria_id, e.creado, e.huespedes_esperados as esperados, e.titular,
           0 as huespedes, e.anulada_en, e.anulada_por,
           (select count(*)::int from private.checkins c where c.estadia_id = e.id and c.quitado_en is not null) as quitados
    from private.estadias e
    join private.medios_pago m on m.id = e.medio_pago_id
    join private.catalogo ca on ca.id = e.canal_id
    left join private.catalogo cg on cg.id = e.categoria_id
    where e.fecha_cobro between v_desde and v_hasta
      and not exists (select 1 from private.checkins_activos c where c.estadia_id = e.id)
    order by e.creado desc, e.id desc
    limit 500
  ) t;

  select coalesce(json_agg(t order by t.id), '[]'::json) into v_huespedes
  from (
    with visitas as (
      select lower(btrim(coalesce(datos->>'doc_tipo', ''))) as tipo, lower(btrim(coalesce(datos->>'doc_numero', ''))) as numero,
             count(distinct coalesce(estadia_id, -id))::int as n
      from private.checkins_activos
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
    from private.checkins_activos c
    left join private.estadias e on e.id = c.estadia_id
    left join visitas v on v.tipo = lower(btrim(coalesce(c.datos->>'doc_tipo', ''))) and v.numero = lower(btrim(coalesce(c.datos->>'doc_numero', '')))
    where case when e.id is not null then e.fecha_cobro between v_desde and v_hasta and e.anulada_en is null
               else (c.creado at time zone 'America/Argentina/Buenos_Aires')::date between v_desde and v_hasta end
    order by c.id desc
    limit 50000
  ) t;

  return json_build_object('ok', true, 'desde', v_desde, 'hasta', v_hasta, 'hoy', v_hoy, 'reservas', v_reservas, 'pendientes', v_pendientes, 'huespedes', v_huespedes);
end;
$$;

-- ---------------------------------------------------------------- permisos

revoke all on function private.estadia_json(bigint, int) from public, anon, authenticated;
revoke all on function private.estadia_ultima(bigint) from public, anon, authenticated;
revoke all on function private.estadia_cerrar_codigos(bigint) from public, anon, authenticated;
revoke all on function private.estadia_abierta(bigint) from public, anon, authenticated;
revoke all on function private.anotada_json(bigint) from public, anon, authenticated;
revoke all on function private.anotada_guardar(text, boolean, bigint, text, date, text, int, int, int, int, numeric, numeric, numeric, numeric, date, text) from public, anon, authenticated;
revoke all on function private.anotada_validar(text, date, text, int, int, int, int, numeric, numeric, numeric, numeric, date, text, private.reservas_anotadas) from public, anon, authenticated;
revoke all on function private.estadia_crear(jsonb, text, numeric, text, int, date, numeric, date, int, int, int, int, text, text) from public, anon, authenticated;
revoke all on function private.estadia_reabrir(bigint) from public, anon, authenticated;
revoke all on function private.huesped_quitar(text, bigint, boolean) from public, anon, authenticated;
revoke all on function private.estadia_anular(text, boolean, bigint, boolean) from public, anon, authenticated;
revoke all on function private.estadia_validar(text, numeric, text, int, date, numeric, date, int, int, int, int, private.estadias) from public, anon, authenticated;
revoke all on function private.estadia_editar(text, boolean, bigint, text, numeric, text, int, date, numeric, date, int, int, int, int) from public, anon, authenticated;
revoke all on function private.validar_huesped(jsonb) from public, anon, authenticated;
revoke all on function private.catalogo_lista(text) from public, anon, authenticated;
revoke all on function public.recepcion_reserva_nueva(text, text, numeric, text, int, date, numeric, date, int, int, int, int) from public, anon, authenticated;
revoke all on function public.recepcion_reserva_abrir(text, bigint) from public, anon, authenticated;
revoke all on function public.recepcion_reserva_anular(text, bigint) from public, anon, authenticated;
revoke all on function public.admin_reserva_anular(text, bigint, boolean) from public, anon, authenticated;
revoke all on function public.recepcion_llegada_iniciar(text, bigint, text, numeric, text, int, date, numeric, date, int, int, int, int) from public, anon, authenticated;
revoke all on function public.admin_anotada_guardar(text, bigint, text, date, text, int, int, int, int, numeric, numeric, numeric, numeric, date, text) from public, anon, authenticated;
revoke all on function public.recepcion_anotada_guardar(text, bigint, text, date, text, int, int, int, int, numeric, numeric, numeric, numeric, date, text) from public, anon, authenticated;
revoke all on function public.admin_anotada_cancelar(text, bigint, boolean) from public, anon, authenticated;
revoke all on function public.admin_anotadas(text) from public, anon, authenticated;
revoke all on function public.admin_huesped_quitar(text, bigint, boolean) from public, anon, authenticated;
revoke all on function public.admin_huespedes_quitados(text) from public, anon, authenticated;
revoke all on function public.recepcion_reserva_cerrar(text, boolean) from public, anon, authenticated;
revoke all on function public.recepcion_estadia_editar(text, bigint, text, numeric, text, int, date, numeric, date, int, int, int, int) from public, anon, authenticated;
revoke all on function public.admin_estadia_editar(text, bigint, text, numeric, text, int, date, numeric, date, int, int, int, int) from public, anon, authenticated;
revoke all on function public.admin_huesped_estadia(text, bigint, bigint) from public, anon, authenticated;
revoke all on function public.admin_reserva_min(text, int) from public, anon, authenticated;
grant execute on function public.recepcion_reserva_nueva(text, text, numeric, text, int, date, numeric, date, int, int, int, int) to anon, authenticated;
grant execute on function public.recepcion_reserva_abrir(text, bigint) to anon, authenticated;
grant execute on function public.recepcion_reserva_anular(text, bigint) to anon, authenticated;
grant execute on function public.admin_reserva_anular(text, bigint, boolean) to anon, authenticated;
grant execute on function public.recepcion_llegada_iniciar(text, bigint, text, numeric, text, int, date, numeric, date, int, int, int, int) to anon, authenticated;
grant execute on function public.admin_anotada_guardar(text, bigint, text, date, text, int, int, int, int, numeric, numeric, numeric, numeric, date, text) to anon, authenticated;
grant execute on function public.recepcion_anotada_guardar(text, bigint, text, date, text, int, int, int, int, numeric, numeric, numeric, numeric, date, text) to anon, authenticated;
grant execute on function public.admin_anotada_cancelar(text, bigint, boolean) to anon, authenticated;
grant execute on function public.admin_anotadas(text) to anon, authenticated;
grant execute on function public.admin_huesped_quitar(text, bigint, boolean) to anon, authenticated;
grant execute on function public.admin_huespedes_quitados(text) to anon, authenticated;
grant execute on function public.recepcion_reserva_cerrar(text, boolean) to anon, authenticated;
grant execute on function public.recepcion_estadia_editar(text, bigint, text, numeric, text, int, date, numeric, date, int, int, int, int) to anon, authenticated;
grant execute on function public.admin_estadia_editar(text, bigint, text, numeric, text, int, date, numeric, date, int, int, int, int) to anon, authenticated;
grant execute on function public.admin_huesped_estadia(text, bigint, bigint) to anon, authenticated;
grant execute on function public.admin_reserva_min(text, int) to anon, authenticated;
revoke all on function public.admin_estadisticas(text, date, date) from public, anon, authenticated;
grant execute on function public.admin_estadisticas(text, date, date) to anon, authenticated;
revoke all on function public.admin_catalogos(text) from public, anon, authenticated;
revoke all on function public.admin_catalogo_guardar(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.admin_catalogos(text) to anon, authenticated;
grant execute on function public.admin_catalogo_guardar(text, text, jsonb) to anon, authenticated;
