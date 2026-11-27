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

--
-- AVISOS EN EL CELULAR (notificaciones push, ver la sección «avisos» más abajo):
--   * Cada celular con la app instalada activa los avisos con un botón y queda registrado, atado a su sesión (si la sesión se cierra o vence, deja de recibir).
--   * Avisos: reserva anotada nueva (la crea el dueño → les llega a recepción; la crea recepción → le llega al dueño y a los otros de recepción) y check-in
--     realizado (le llega al dueño; a recepción solo si el dueño lo prende). A quien hizo la acción no se le avisa.
--   * El envío lo hace una función en Vercel (api/push.js); la base le pasa los celulares y el texto con pg_net. Un fallo al avisar NUNCA frena una reserva ni un check-in.

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
-- Cerrar una reserva a mano: ya ingresó al menos un huésped y el resto no va a venir (se anotaron dos y vino uno). Deja de esperar a los que faltan. Solo el dueño la reabre.
alter table private.estadias add column if not exists cerrada_en timestamptz;
alter table private.estadias add column if not exists cerrada_por text;
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

-- ---------------------------------------------------------------- número de reserva
-- Cada reserva tiene un NÚMERO propio, visible en todas las pantallas («N.º 41»), para distinguir una de otra aunque tengan el mismo nombre y la misma habitación (por ejemplo,
-- una reserva anotada y una reserva rápida que en realidad son la misma). Un solo contador para las dos: una reserva anotada y la estadía que sale de ella (cuando se hace el
-- check-in) comparten el número; una reserva rápida (sin anotar antes) tiene el suyo. Una reserva eliminada y restaurada conserva su número. Nunca se reutiliza ni se cambia.
create sequence if not exists private.reserva_numero_seq;
alter table private.estadias add column if not exists numero bigint;
alter table private.reservas_anotadas add column if not exists numero bigint;
-- Las que ya existían: se numeran de la más vieja a la más nueva (una anotada y su estadía, con el mismo número). Solo toca las que todavía no tienen número.
with base as (select coalesce(max(n), 0) as m from (select numero as n from private.estadias union all select numero from private.reservas_anotadas) x),
     items as (select 'a'::text as t, a.id, a.creado from private.reservas_anotadas a where a.numero is null
               union all
               select 'e'::text, e.id, e.creado from private.estadias e
                where e.numero is null and not exists (select 1 from private.reservas_anotadas a where a.estadia_id = e.id)),
     num as (select t, id, (select m from base) + row_number() over (order by creado, t, id) as n from items),
     ua as (update private.reservas_anotadas a set numero = num.n from num where num.t = 'a' and a.id = num.id returning 1),
     ue as (update private.estadias e set numero = num.n from num where num.t = 'e' and e.id = num.id returning 1)
select (select count(*) from ua) as anotadas_numeradas, (select count(*) from ue) as estadias_numeradas;
update private.estadias e set numero = a.numero from private.reservas_anotadas a where a.estadia_id = e.id and e.numero is null and a.numero is not null;
select setval('private.reserva_numero_seq', b.m, true)
  from (select coalesce(max(n), 0) as m from (select numero as n from private.estadias union all select numero from private.reservas_anotadas) x) b
 where b.m > 0 and (select (not q.is_called) or q.last_value < b.m from private.reserva_numero_seq q);
alter table private.estadias alter column numero set default nextval('private.reserva_numero_seq');
alter table private.reservas_anotadas alter column numero set default nextval('private.reserva_numero_seq');
alter table private.estadias alter column numero set not null;
alter table private.reservas_anotadas alter column numero set not null;
create unique index if not exists anotadas_numero_idx on private.reservas_anotadas (numero);
create index if not exists estadias_numero_idx on private.estadias (numero);

-- ---------------------------------------------------------------- unificar reservas repetidas
-- Cuando el dueño unifica dos reservas repetidas, la que sobra NO se borra: queda eliminada y anotada con el número de la que se conservó (`unificada_con`), y se ve en «Eliminadas».
alter table private.estadias add column if not exists unificada_con bigint;
alter table private.reservas_anotadas add column if not exists unificada_con bigint;
-- Las sugerencias de «parecen repetidas» que el dueño descartó («no son la misma»): claves como 'a41' (reserva anotada 41) o 'e55' (reserva armada 55), siempre en orden.
create table if not exists private.reservas_no_repetidas (
  clave_a text not null,
  clave_b text not null,
  descartada_por text not null,
  creado timestamptz not null default now(),
  primary key (clave_a, clave_b),
  check (clave_a < clave_b)
);
alter table private.reservas_no_repetidas enable row level security;

-- Los celulares que activaron los avisos. endpoint/p256dh/auth son lo que el navegador entrega para poder avisarle (no sirven para nada más).
-- sesion_hash: la sesión de ese celular (sha256 del código sd_…). Cada vez que se abre la app se vuelve a anotar con la sesión de ese momento.
create table if not exists private.push_suscripciones (
  id bigint generated always as identity primary key,
  creado timestamptz not null default now(),
  visto timestamptz not null default now(),
  sesion_hash text not null,
  usuario_id bigint not null,
  alias text not null,
  rol text not null check (rol in ('admin', 'recepcion')),
  endpoint text not null unique check (endpoint ~ '^https://' and length(endpoint) between 20 and 1000),
  p256dh text not null check (length(p256dh) between 40 and 200),
  auth text not null check (length(auth) between 10 and 100),
  agente text check (length(agente) <= 200)
);
alter table private.push_suscripciones enable row level security;
create index if not exists push_susc_rol_idx on private.push_suscripciones (rol);
-- Lo último que se mandó (queda unos días para revisar qué pasó; trae habitación y titular, por eso se vacía solo).
create table if not exists private.push_cola (
  id bigint generated always as identity primary key,
  creado timestamptz not null default now(),
  tipo text not null,
  titulo text not null,
  cuerpo text not null,
  destinos int not null default 0,
  enviado boolean not null default false
);
alter table private.push_cola enable row level security;
-- url + secreto: a dónde y con qué clave se le pide a la función de Vercel que mande los avisos (los carga el dueño una vez, ver README). Sin eso no se envía nada.
-- con_nombre: el aviso lleva el nombre del titular · checkin_a_recepcion: el aviso de check-in también le llega a recepción.
create table if not exists private.push_config (
  id int primary key check (id = 1),
  url text,
  secreto text,
  con_nombre boolean not null default true,
  checkin_a_recepcion boolean not null default false
);
alter table private.push_config enable row level security;
insert into private.push_config (id) values (1) on conflict (id) do nothing;

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
    'id', e.id, 'numero', e.numero, 'habitacion', e.habitacion, 'monto', e.monto, 'moneda', e.moneda, 'pago_hotel', e.pago_hotel, 'fecha_sena', e.fecha_sena,
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
--   Una reserva con el check-in empezado (en_curso) muestra lo REAL de su reserva (la habitación y cuántos huéspedes se esperan, por si el dueño los corrigió), con_checkin
--   (cuántos ya ingresaron), ingresaron (sus nombres) y ultima (la última actividad: sirve para saber hasta cuándo la ve recepción).
create or replace function private.anotada_json(p_id bigint)
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'id', a.id, 'numero', a.numero, 'titular', a.titular, 'fecha_ingreso', a.fecha_ingreso, 'noches', a.noches, 'salida', a.fecha_ingreso + a.noches,
    'dias_para', a.fecha_ingreso - (now() at time zone 'America/Argentina/Buenos_Aires')::date,
    'habitacion', coalesce(e.habitacion, a.habitacion), 'categoria_id', a.categoria_id, 'categoria', cg.nombre, 'canal_id', a.canal_id, 'canal', ca.nombre, 'canal_cobra', ca.cobra,
    'esperados', coalesce(e.huespedes_esperados, a.huespedes_esperados), 'precio_efectivo', a.precio_efectivo, 'precio_transferencia', a.precio_transferencia, 'precio_usd', a.precio_usd,
    'sena', a.sena, 'fecha_sena', a.fecha_sena, 'nota', a.nota, 'cargado_por', a.cargado_por, 'creado', a.creado,
    'estado', case when a.cancelada_en is not null then 'cancelada' when a.estadia_id is not null then 'en_curso' else 'anotada' end,
    'cancelada_por', a.cancelada_por, 'estadia_id', a.estadia_id,
    'con_checkin', case when a.estadia_id is null then 0 else (select count(*)::int from private.checkins_activos c where c.estadia_id = a.estadia_id) end,
    'ingresaron', case when a.estadia_id is null then '[]'::json
                       else (select coalesce(json_agg(btrim(concat_ws(' ', c.datos ->> 'nombre', c.datos ->> 'apellido')) order by c.id), '[]'::json)
                               from private.checkins_activos c where c.estadia_id = a.estadia_id) end,
    'ultima', case when a.estadia_id is null then null else private.estadia_ultima(a.estadia_id) end)
    from private.reservas_anotadas a
    join private.catalogo ca on ca.id = a.canal_id
    left join private.catalogo cg on cg.id = a.categoria_id
    left join private.estadias e on e.id = a.estadia_id
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

-- ¿Sigue abierta la reserva? No está anulada, no se cerró a mano y todavía faltan huéspedes por hacer el check-in.
create or replace function private.estadia_abierta(p_id bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.estadias e
     where e.id = p_id and e.anulada_en is null and e.cerrada_en is null
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
  if e.id is not null then
    perform private.push_aviso_checkin(e.id, v_n + 1, s.habilitado_por); -- avisa en los celulares (nunca falla: avisar no frena el check-in)
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

drop function if exists private.estadia_crear(jsonb, text, numeric, text, integer, date, numeric, date, integer, integer, integer, integer, text, text);

-- Arma una reserva (estadía) y deja a quien la arma con su primer código. La usan «Nueva reserva» (sin anotar antes) y «Hacer el check-in» de una reserva
-- anotada: las dos pasan por las mismas validaciones. p_actor = private.actor(clave). Devuelve { ok, id } o { ok:false, error, campos? }.
--   p_numero: el número de la reserva anotada de la que sale (la reserva conserva ese número); sin pasarlo, toma el próximo número.
create or replace function private.estadia_crear(p_actor jsonb, p_habitacion text, p_monto numeric, p_moneda text, p_medio_pago int, p_fecha date, p_pago_hotel numeric,
                                                  p_fecha_sena date, p_noches int, p_canal int, p_categoria int, p_huespedes int, p_titular text default null, p_nota text default null,
                                                  p_numero bigint default null)
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
  insert into private.estadias (habitacion, monto, moneda, medio_pago_id, fecha_cobro, cargado_por, pago_hotel, fecha_sena, noches, canal_id, categoria_id, huespedes_esperados, titular, nota, numero)
    values (v ->> 'habitacion', (v ->> 'monto')::numeric, v ->> 'moneda', (v ->> 'medio')::int, p_fecha, p_actor ->> 'alias', (v ->> 'pago')::numeric, (v ->> 'fecha_sena')::date,
            (v ->> 'noches')::int, (v ->> 'canal')::int, (v ->> 'categoria')::int, (v ->> 'huespedes')::int, nullif(btrim(p_titular), ''), nullif(btrim(p_nota), ''),
            coalesce(p_numero, nextval('private.reserva_numero_seq'))) returning id into v_id;
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
  res := private.estadia_crear(v_actor, p_habitacion, p_monto, p_moneda, p_medio_pago, p_fecha, p_pago_hotel, p_fecha_sena, p_noches, p_canal, p_categoria, p_huespedes, a.titular, a.nota, a.numero);
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

-- Anula (elimina) una reserva (por ejemplo, una de prueba o una a la que al final no llegó nadie), o la restaura. NO borra nada: la fila queda marcada con quién y
-- cuándo, y se puede restaurar.
--   SOLO EL DUEÑO, para anular y para restaurar: recepción NO puede eliminar ni anular ninguna reserva (control: que una eliminación no pase desapercibida).
--   Si tenía huéspedes, se quitan junto con la reserva (con la misma marca de tiempo) y vuelven cuando la restaura; los que ya se habían quitado antes por
--   separado siguen quitados.
create or replace function private.estadia_anular(p_quien text, p_dueno boolean, p_id bigint, p_anular boolean)
returns json language plpgsql security definer set search_path = '' as $$
declare
  cfg private.checkin_config;
  e private.estadias;
  v_n int := 0;
begin
  if not coalesce(p_dueno, false) then
    return json_build_object('ok', false, 'error', 'sin_permiso'); -- eliminar y restaurar es solo del dueño
  end if;
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
    update private.estadias set anulada_en = now(), anulada_por = p_quien where id = e.id;
    if v_n = 0 then
      update private.reservas_anotadas set estadia_id = null where estadia_id = e.id; -- si venía de una reserva anotada, vuelve a las llegadas (se cargó mal el cobro)
    end if;
    update private.checkins set quitado_en = now(), quitado_por = p_quien where estadia_id = e.id and quitado_en is null;
    perform private.estadia_cerrar_codigos(e.id);
    perform private.auditar('admin', 'reserva_anular', null, jsonb_build_object('estadia', e.id, 'por', p_quien, 'huespedes', v_n));
  else
    if e.anulada_en is not null then
      update private.checkins set quitado_en = null, quitado_por = null where estadia_id = e.id and quitado_en = e.anulada_en; -- los que se quitaron con ella
      update private.estadias set anulada_en = null, anulada_por = null, unificada_con = null, reabierta_en = now() where id = e.id;
      if not private.estadia_abierta(e.id) then
        perform private.estadia_cerrar_codigos(e.id);
      end if;
      perform private.auditar('admin', 'reserva_restaurar', null, jsonb_build_object('estadia', e.id, 'por', p_quien));
    end if;
  end if;
  return json_build_object('ok', true);
end;
$$;

-- Ninguna pantalla de recepción la usa: eliminar una reserva es solo del dueño (admin_reserva_anular). Con una sesión de recepción devuelve «sin_permiso» y no toca nada.
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
    perform private.push_aviso_anotada(v_id, v_quien, p_dueno);
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
    update private.reservas_anotadas set cancelada_en = null, cancelada_por = null, unificada_con = null where id = a.id;
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

-- Cierra a mano una reserva a la que ya ingresó al menos un huésped y el resto no va a venir (se anotaron dos y vino uno, o «al final no viene el otro»): deja de esperar
-- a los que faltan y el código deja de servir. Recepción puede; reabrirla es solo del dueño. Sin ningún huésped no se cierra: se anula. Si ya estaba cerrada o completa, no pasa nada.
create or replace function public.recepcion_estadia_cerrar(p_clave text, p_id bigint)
returns json language plpgsql security definer set search_path = '' as $$
declare
  r text;
  cfg private.checkin_config;
  e private.estadias;
  v_actor jsonb;
  v_n int;
begin
  r := private.comprobar_recepcion(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  select * into cfg from private.checkin_config where id = 1;
  v_actor := private.actor(p_clave);
  select * into e from private.estadias where id = p_id for update;
  if not found then
    return json_build_object('ok', false, 'error', 'no_existe');
  end if;
  if e.anulada_en is not null then
    return json_build_object('ok', false, 'error', 'reserva_anulada');
  end if;
  select count(*)::int into v_n from private.checkins_activos c where c.estadia_id = e.id;
  if v_n = 0 then
    return json_build_object('ok', false, 'error', 'sin_huespedes');
  end if;
  if e.cerrada_en is not null or v_n >= e.huespedes_esperados then
    return json_build_object('ok', true);
  end if;
  if not coalesce((v_actor ->> 'dueno')::boolean, false) and private.estadia_ultima(e.id) <= now() - make_interval(days => cfg.dias_recepcion) then
    return json_build_object('ok', false, 'error', 'reserva_vencida');
  end if;
  update private.estadias set cerrada_en = now(), cerrada_por = v_actor ->> 'alias' where id = e.id;
  perform private.estadia_cerrar_codigos(e.id);
  perform private.auditar('recepcion', 'reserva_cerrar', null, jsonb_build_object('estadia', e.id, 'alias', v_actor ->> 'alias', 'ingresaron', v_n, 'esperados', e.huespedes_esperados));
  return json_build_object('ok', true);
end;
$$;

-- Reabre una reserva que se cerró a mano (vuelve a esperar a los que faltan). SOLO EL DUEÑO. Si no estaba cerrada a mano, no pasa nada.
create or replace function public.admin_estadia_reabrir(p_clave text, p_id bigint)
returns json language plpgsql security definer set search_path = '' as $$
declare
  r text;
  e private.estadias;
  v_quien text;
begin
  r := private.comprobar_clave(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  v_quien := coalesce(private.actor(p_clave) ->> 'alias', 'Dueño');
  select * into e from private.estadias where id = p_id for update;
  if not found then
    return json_build_object('ok', false, 'error', 'no_existe');
  end if;
  if e.anulada_en is not null then
    return json_build_object('ok', false, 'error', 'reserva_anulada');
  end if;
  if e.cerrada_en is not null then
    update private.estadias set cerrada_en = null, cerrada_por = null, reabierta_en = now() where id = e.id;
    perform private.auditar('admin', 'reserva_reabrir', null, jsonb_build_object('estadia', e.id, 'por', v_quien));
  end if;
  return json_build_object('ok', true);
end;
$$;

-- Une una reserva anotada que sigue esperando («todavía no llegó») con la reserva donde el huésped YA hizo el check-in, cuando se abrió aparte (por ejemplo, una reserva rápida
-- en la misma habitación). Es el arreglo de las reservas duplicadas: la anotada pasa a ser la misma reserva (con su nombre y su nota) y deja de figurar como que falta llegar.
-- No cambia lo cobrado ni los huéspedes. Deben ser la misma habitación y fechas cercanas (hasta 10 días). La reserva ya ingresada no puede estar unida a otra anotada.
-- Recepción puede (con las reservas de sus días); el dueño, cualquiera.
create or replace function public.recepcion_anotada_unir(p_clave text, p_anotada bigint, p_estadia bigint)
returns json language plpgsql security definer set search_path = '' as $$
declare
  r text;
  cfg private.checkin_config;
  a private.reservas_anotadas;
  e private.estadias;
  v_actor jsonb;
  v_dueno boolean;
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_llegada date;
begin
  r := private.comprobar_recepcion(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  select * into cfg from private.checkin_config where id = 1;
  v_actor := private.actor(p_clave);
  v_dueno := coalesce((v_actor ->> 'dueno')::boolean, false);
  if not v_dueno then
    return json_build_object('ok', false, 'error', 'sin_permiso'); -- unificar lo aprueba el dueño
  end if;
  select * into a from private.reservas_anotadas where id = p_anotada for update;
  if not found then
    return json_build_object('ok', false, 'error', 'no_existe');
  end if;
  if a.cancelada_en is not null then
    return json_build_object('ok', false, 'error', 'anotada_cancelada');
  end if;
  if a.estadia_id is not null then
    return json_build_object('ok', false, 'error', 'anotada_ya_empezo');
  end if;
  if not v_dueno and a.fecha_ingreso not between v_hoy - cfg.dias_recepcion and v_hoy + cfg.dias_recepcion then
    return json_build_object('ok', false, 'error', 'llegada_fuera_de_fecha');
  end if;
  select * into e from private.estadias where id = p_estadia for update;
  if not found then
    return json_build_object('ok', false, 'error', 'no_existe');
  end if;
  if e.anulada_en is not null then
    return json_build_object('ok', false, 'error', 'reserva_anulada');
  end if;
  if exists (select 1 from private.reservas_anotadas x where x.estadia_id = e.id) then
    return json_build_object('ok', false, 'error', 'estadia_ya_unida');
  end if;
  if lower(btrim(e.habitacion)) <> lower(btrim(a.habitacion)) then
    return json_build_object('ok', false, 'error', 'habitacion_distinta');
  end if;
  v_llegada := (e.creado at time zone 'America/Argentina/Buenos_Aires')::date;
  if abs(v_llegada - a.fecha_ingreso) > 10 then
    return json_build_object('ok', false, 'error', 'fechas_lejanas');
  end if;
  if not v_dueno and private.estadia_ultima(e.id) <= now() - make_interval(days => cfg.dias_recepcion) then
    return json_build_object('ok', false, 'error', 'reserva_vencida');
  end if;
  update private.reservas_anotadas set estadia_id = e.id where id = a.id;
  update private.estadias set titular = coalesce(titular, a.titular), nota = coalesce(nota, a.nota), numero = a.numero where id = e.id; -- pasa a ser la reserva anotada: con su número
  perform private.auditar(case when v_dueno then 'admin' else 'recepcion' end, 'anotada_unir', null, jsonb_build_object('anotada', a.id, 'estadia', e.id, 'por', v_actor ->> 'alias'));
  return json_build_object('ok', true);
end;
$$;

-- Unifica dos reservas ARMADAS (estadías) repetidas: los huéspedes de la que sobra pasan a la que se conserva, y la que sobra queda eliminada (no se borra) con el número de la
-- que se conservó. Lo cobrado es el de la que se conserva. p_conservar: 'e55' para elegir cuál se queda; sin pasarlo se queda la que tiene anotada, o la que tiene más huéspedes,
-- o la más vieja. Si una de las dos viene de una reserva anotada, se queda esa (la anotada no puede quedar sin su reserva).
create or replace function private.unificar_estadias(p_quien text, p_a bigint, p_b bigint, p_conservar text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  ea private.estadias;
  eb private.estadias;
  k private.estadias;
  s private.estadias;
  v_anot_a bigint;
  v_anot_b bigint;
  v_cant_a int;
  v_cant_b int;
  v_la date;
  v_lb date;
  v_movidos int;
begin
  -- se bloquean siempre en el mismo orden (la de número de id más chico primero)
  select * into ea from private.estadias where id = least(p_a, p_b) for update;
  select * into eb from private.estadias where id = greatest(p_a, p_b) for update;
  if ea.id is null or eb.id is null then
    return json_build_object('ok', false, 'error', 'no_existe');
  end if;
  if ea.anulada_en is not null or eb.anulada_en is not null then
    return json_build_object('ok', false, 'error', 'reserva_anulada');
  end if;
  if lower(btrim(ea.habitacion)) <> lower(btrim(eb.habitacion)) then
    return json_build_object('ok', false, 'error', 'habitacion_distinta');
  end if;
  select a.id, a.fecha_ingreso into v_anot_a, v_la from private.reservas_anotadas a where a.estadia_id = ea.id limit 1;
  select a.id, a.fecha_ingreso into v_anot_b, v_lb from private.reservas_anotadas a where a.estadia_id = eb.id limit 1;
  v_la := coalesce(v_la, (ea.creado at time zone 'America/Argentina/Buenos_Aires')::date);
  v_lb := coalesce(v_lb, (eb.creado at time zone 'America/Argentina/Buenos_Aires')::date);
  if abs(v_la - v_lb) > 10 then
    return json_build_object('ok', false, 'error', 'fechas_lejanas');
  end if;
  if v_anot_a is not null and v_anot_b is not null then
    return json_build_object('ok', false, 'error', 'ambas_con_anotada');
  end if;
  select count(*)::int into v_cant_a from private.checkins_activos where estadia_id = ea.id;
  select count(*)::int into v_cant_b from private.checkins_activos where estadia_id = eb.id;
  if p_conservar is null then
    if v_anot_a is not null then k := ea;
    elsif v_anot_b is not null then k := eb;
    elsif v_cant_a <> v_cant_b then k := case when v_cant_a > v_cant_b then ea else eb end;
    else k := ea; -- la de id más chico: la más vieja
    end if;
  elsif p_conservar = 'e' || ea.id then k := ea;
  elsif p_conservar = 'e' || eb.id then k := eb;
  else
    return json_build_object('ok', false, 'error', 'conservar_invalido');
  end if;
  s := case when k.id = ea.id then eb else ea end;
  if (k.id = ea.id and v_anot_b is not null) or (k.id = eb.id and v_anot_a is not null) then
    return json_build_object('ok', false, 'error', 'conservar_invalido'); -- se tiene que quedar la que viene de una anotada
  end if;
  update private.checkins set estadia_id = k.id where estadia_id = s.id;
  get diagnostics v_movidos = row_count;
  update private.checkin_sesiones set estadia_id = k.id where estadia_id = s.id;
  update private.codigos_usuario set estadia_id = k.id where estadia_id = s.id;
  update private.estadias set
      huespedes_esperados = least(12, greatest(k.huespedes_esperados, (select count(*)::int from private.checkins_activos where estadia_id = k.id))),
      titular = coalesce(k.titular, s.titular), nota = coalesce(k.nota, s.nota)
   where id = k.id;
  update private.estadias set anulada_en = now(), anulada_por = p_quien, unificada_con = k.numero where id = s.id;
  perform private.auditar('admin', 'reservas_unificar', null, jsonb_build_object('tipo', 'estadias', 'conserva', k.id, 'numero', k.numero, 'elimina', s.id, 'numero_eliminada', s.numero, 'registros_movidos', v_movidos, 'por', p_quien));
  return json_build_object('ok', true, 'conservada', 'e' || k.id, 'numero', k.numero);
end;
$$;

-- Unifica dos reservas ANOTADAS repetidas (las dos siguen esperando): se queda una y la otra se cancela (no se borra) con el número de la que se conservó.
-- Se queda la que se pida en p_conservar ('a41') o, sin pasarlo, la más vieja. Si a la que se conserva le faltaba la nota, toma la de la otra.
create or replace function private.unificar_anotadas(p_quien text, p_a bigint, p_b bigint, p_conservar text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  aa private.reservas_anotadas;
  ab private.reservas_anotadas;
  k private.reservas_anotadas;
  s private.reservas_anotadas;
begin
  select * into aa from private.reservas_anotadas where id = least(p_a, p_b) for update;
  select * into ab from private.reservas_anotadas where id = greatest(p_a, p_b) for update;
  if aa.id is null or ab.id is null then
    return json_build_object('ok', false, 'error', 'no_existe');
  end if;
  if aa.cancelada_en is not null or ab.cancelada_en is not null then
    return json_build_object('ok', false, 'error', 'anotada_cancelada');
  end if;
  if aa.estadia_id is not null or ab.estadia_id is not null then
    return json_build_object('ok', false, 'error', 'anotada_ya_empezo');
  end if;
  if lower(btrim(aa.habitacion)) <> lower(btrim(ab.habitacion)) then
    return json_build_object('ok', false, 'error', 'habitacion_distinta');
  end if;
  if abs(aa.fecha_ingreso - ab.fecha_ingreso) > 10 then
    return json_build_object('ok', false, 'error', 'fechas_lejanas');
  end if;
  if p_conservar is null or p_conservar = 'a' || aa.id then k := aa;
  elsif p_conservar = 'a' || ab.id then k := ab;
  else
    return json_build_object('ok', false, 'error', 'conservar_invalido');
  end if;
  s := case when k.id = aa.id then ab else aa end;
  update private.reservas_anotadas set nota = coalesce(k.nota, s.nota), editado_en = now(), editado_por = p_quien where id = k.id;
  update private.reservas_anotadas set cancelada_en = now(), cancelada_por = p_quien, unificada_con = k.numero where id = s.id;
  perform private.auditar('admin', 'reservas_unificar', null, jsonb_build_object('tipo', 'anotadas', 'conserva', k.id, 'numero', k.numero, 'elimina', s.id, 'numero_eliminada', s.numero, 'por', p_quien));
  return json_build_object('ok', true, 'conservada', 'a' || k.id, 'numero', k.numero);
end;
$$;

-- UNIFICAR dos reservas que son la misma cargada dos veces. SOLO EL DUEÑO (lo aprueba él). Las dos se pasan como 'a41' (reserva anotada 41) o 'e55' (reserva armada 55):
--   · anotada + armada → la anotada pasa a ser esa reserva (con su nombre y su número), sin tocar lo cobrado ni a los huéspedes (igual que recepcion_anotada_unir);
--   · armada + armada → los huéspedes pasan a la que se conserva y la otra queda eliminada;
--   · anotada + anotada → se queda una y la otra se cancela.
--   Nada se borra: la que sobra queda en «Eliminadas» como «unificada con la N.º …» y se puede restaurar. p_conservar elige cuál se queda (armada+armada o anotada+anotada).
create or replace function public.admin_reservas_unificar(p_clave text, p_a text, p_b text, p_conservar text default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  r text;
  v_quien text;
  ta text;
  tb text;
  ia bigint;
  ib bigint;
begin
  r := private.comprobar_clave(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  v_quien := coalesce(private.actor(p_clave) ->> 'alias', 'Dueño');
  if p_a is null or p_b is null or p_a !~ '^[ae][0-9]{1,15}$' or p_b !~ '^[ae][0-9]{1,15}$' then
    return json_build_object('ok', false, 'error', 'datos_invalidos');
  end if;
  if p_a = p_b then
    return json_build_object('ok', false, 'error', 'misma_reserva');
  end if;
  ta := left(p_a, 1);
  tb := left(p_b, 1);
  ia := substr(p_a, 2)::bigint;
  ib := substr(p_b, 2)::bigint;
  if ta <> tb then
    return case when ta = 'a' then public.recepcion_anotada_unir(p_clave, ia, ib) else public.recepcion_anotada_unir(p_clave, ib, ia) end;
  elsif ta = 'e' then
    return private.unificar_estadias(v_quien, ia, ib, p_conservar);
  end if;
  return private.unificar_anotadas(v_quien, ia, ib, p_conservar);
end;
$$;

-- El dueño dice «no son la misma»: la sugerencia de «parecen repetidas» para ese par deja de mostrarse (a todos). Se puede repetir.
create or replace function public.admin_repetida_descartar(p_clave text, p_a text, p_b text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  r text;
  v_quien text;
begin
  r := private.comprobar_clave(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  if p_a is null or p_b is null or p_a !~ '^[ae][0-9]{1,15}$' or p_b !~ '^[ae][0-9]{1,15}$' or p_a = p_b then
    return json_build_object('ok', false, 'error', 'datos_invalidos');
  end if;
  v_quien := coalesce(private.actor(p_clave) ->> 'alias', 'Dueño');
  insert into private.reservas_no_repetidas (clave_a, clave_b, descartada_por) values (least(p_a, p_b), greatest(p_a, p_b), v_quien) on conflict do nothing;
  perform private.auditar('admin', 'repetida_descartar', null, jsonb_build_object('a', p_a, 'b', p_b, 'por', v_quien));
  return json_build_object('ok', true);
end;
$$;

-- «Reservas» de recepción: las reservas anotadas (no canceladas) separadas en dos grupos que la pantalla muestra en secciones:
--   · FALTA INGRESAR: las que todavía no empezaron el check-in (estado «anotada»), que llegan entre `dias_recepcion` días atrás y `dias_recepcion` días adelante (el dueño lo
--     cambia en Ajustes). Las que ya empezaron pero todavía no entró nadie (se dio el código y falta el primer huésped) también están acá: estado «en_curso» y con_checkin = 0.
--   · YA INGRESARON: las que tienen el check-in empezado (estado «en_curso»), con con_checkin (cuántos ya entraron), ingresaron (sus nombres) y esperados; las ve recepción
--     mientras su última actividad esté dentro de esos días.
--   Lo que está fuera de esos días NO se devuelve: recepción no lo ve ni lo encuentra buscando (una reserva de hace 7 días o de dentro de 7 no aparece, con 5 de ventana).
--   El dueño ve todo: las que esperan desde hace 60 días en adelante y las que ya empezaron con actividad en los últimos 60 días.
--   Devuelve hasta 300, de la más cercana a la más lejana (`mas` dice cuántas quedaron afuera). Además `estadias`: todas las reservas con actividad en esos días (ver abajo).
create or replace function public.recepcion_proximas(p_clave text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  r text;
  cfg private.checkin_config;
  v_dueno boolean;
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_desde date;
  v_hasta date;
  v_dias int;
  v_total int;
begin
  r := private.comprobar_recepcion(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  select * into cfg from private.checkin_config where id = 1;
  v_dueno := coalesce((private.actor(p_clave) ->> 'dueno')::boolean, false);
  v_dias := case when v_dueno then 60 else cfg.dias_recepcion end;
  v_desde := v_hoy - v_dias;
  v_hasta := case when v_dueno then null else v_hoy + cfg.dias_recepcion end;
  select count(*)::int into v_total from private.reservas_anotadas a
   where a.cancelada_en is null
     and ((a.estadia_id is null and a.fecha_ingreso >= v_desde and (v_hasta is null or a.fecha_ingreso <= v_hasta))
          or (a.estadia_id is not null and private.estadia_ultima(a.estadia_id) > now() - make_interval(days => v_dias)));
  return json_build_object('ok', true, 'activo', cfg.activo, 'hoy', v_hoy, 'dias', cfg.dias_recepcion, 'limitada', not v_dueno, 'mas', greatest(0, v_total - 300), 'reservas', (
    select coalesce(json_agg(private.anotada_json(t.id) order by t.fecha_ingreso, t.id), '[]'::json)
      from (select a.id, a.fecha_ingreso from private.reservas_anotadas a
             where a.cancelada_en is null
               and ((a.estadia_id is null and a.fecha_ingreso >= v_desde and (v_hasta is null or a.fecha_ingreso <= v_hasta))
                    or (a.estadia_id is not null and private.estadia_ultima(a.estadia_id) > now() - make_interval(days => v_dias)))
             order by a.fecha_ingreso, a.id limit 300) t),
    -- Todas las reservas (estadías) con actividad en esos días, tengan o no nombre: una anotada que ya empezó o una reserva rápida. estado: sin_ingresos (todavía no entró nadie)
    -- · faltan (ingresó alguien y faltan huéspedes: falta cerrar) · completa (entraron todos) · cerrada (se cerró a mano con menos de los esperados).
    'estadias', (
    select coalesce(json_agg(json_build_object(
             'id', t.id, 'numero', t.numero, 'anotada_id', t.anotada_id, 'titular', t.titular, 'habitacion', t.habitacion, 'llegada', t.llegada, 'dias_para', t.llegada - v_hoy,
             'noches', t.noches, 'esperados', t.huespedes_esperados, 'categoria', t.categoria, 'canal', t.canal, 'nota', t.nota, 'cargado_por', t.cargado_por, 'monto', t.monto, 'moneda', t.moneda, 'pago_hotel', t.pago_hotel,
             'creado', t.creado, 'ultima', t.ultima, 'con_checkin', t.cant, 'ingresaron', t.nombres, 'cerrada_en', t.cerrada_en, 'cerrada_por', t.cerrada_por,
             'estado', case when t.cant = 0 then 'sin_ingresos' when t.cerrada_en is not null then 'cerrada' when t.cant >= t.huespedes_esperados then 'completa' else 'faltan' end)
           order by t.llegada desc, t.id desc), '[]'::json)
      from (select e.id, e.numero, a.id as anotada_id, e.titular, e.habitacion, e.noches, e.huespedes_esperados, e.nota, e.cargado_por, e.monto, e.moneda, e.pago_hotel, e.creado, e.cerrada_en, e.cerrada_por,
                   cg.nombre as categoria, ca.nombre as canal, private.estadia_ultima(e.id) as ultima, n.cant, n.nombres,
                   coalesce(a.fecha_ingreso, (e.creado at time zone 'America/Argentina/Buenos_Aires')::date) as llegada
              from private.estadias e
              left join private.reservas_anotadas a on a.estadia_id = e.id
              left join private.catalogo ca on ca.id = e.canal_id
              left join private.catalogo cg on cg.id = e.categoria_id
              cross join lateral (select count(*)::int as cant,
                                         coalesce(json_agg(btrim(concat_ws(' ', c.datos ->> 'nombre', c.datos ->> 'apellido')) order by c.id), '[]'::json) as nombres
                                    from private.checkins_activos c where c.estadia_id = e.id) n
             where e.anulada_en is null and private.estadia_ultima(e.id) > now() - make_interval(days => v_dias)
             order by coalesce(a.fecha_ingreso, (e.creado at time zone 'America/Argentina/Buenos_Aires')::date) desc, e.id desc limit 300) t),
    -- Solo para el dueño: lo que se eliminó en los últimos 60 días (reservas anuladas y anotadas canceladas), para poder restaurarlo. Nada se borra.
    --   tipo: estadia | anotada · huespedes: cuántos huéspedes se sacaron junto con la reserva y vuelven al restaurarla · cuando / por: cuándo y quién la eliminó.
    'eliminadas', case when not v_dueno then '[]'::json else (
    select coalesce(json_agg(row_to_json(x) order by x.cuando desc, x.id desc), '[]'::json)
      from (select * from (
              select 'estadia'::text as tipo, e.id, e.numero, e.titular, e.habitacion, e.noches, e.huespedes_esperados as esperados,
                     coalesce(a.fecha_ingreso, (e.creado at time zone 'America/Argentina/Buenos_Aires')::date) as llegada,
                     e.anulada_en as cuando, e.anulada_por as por, e.unificada_con as unificada,
                     (select count(*)::int from private.checkins c where c.estadia_id = e.id and c.quitado_en = e.anulada_en) as huespedes
                from private.estadias e
                left join private.reservas_anotadas a on a.estadia_id = e.id
               where e.anulada_en is not null and e.anulada_en > now() - interval '60 days'
              union all
              select 'anotada'::text, a.id, a.numero, a.titular, a.habitacion, a.noches, a.huespedes_esperados, a.fecha_ingreso, a.cancelada_en, a.cancelada_por, a.unificada_con, 0
                from private.reservas_anotadas a
               where a.cancelada_en is not null and a.estadia_id is null and a.cancelada_en > now() - interval '60 days') u
             order by u.cuando desc, u.id desc limit 100) x) end,
    -- Las sugerencias de «parecen repetidas» que el dueño descartó, como 'a41|e55' (la pantalla no las vuelve a mostrar).
    'descartadas', (select coalesce(json_agg(d.clave_a || '|' || d.clave_b), '[]'::json) from (select clave_a, clave_b from private.reservas_no_repetidas order by creado desc limit 500) d));
end;
$$;

-- ---------------------------------------------------------------- avisos en el celular (notificaciones push)

-- Quién es esa persona del equipo (0 = el dueño), por su nombre. null si no hay nadie activo con ese nombre.
create or replace function private.push_usuario_id(p_alias text)
returns bigint language sql stable security definer set search_path = '' as $$
  select case when lower(btrim(coalesce(p_alias, ''))) = 'dueño' then 0
              else (select u.id from private.usuarios u where lower(btrim(u.alias)) = lower(btrim(p_alias)) and u.activo limit 1) end;
$$;

-- Manda un aviso a los celulares de esos roles que tengan la sesión abierta (menos a los de p_excluir, quien hizo la acción), o solo al celular p_solo.
-- No devuelve nada y NUNCA falla: avisar es un extra, no puede frenar una reserva ni un check-in.
--   La función de Vercel (config.url) firma y entrega; acá solo se arma la lista y se llama con pg_net (sin esperar la respuesta).
create or replace function private.push_enviar(p_tipo text, p_titulo text, p_cuerpo text, p_tag text, p_roles text[], p_excluir bigint default null, p_solo bigint default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  cfg private.push_config;
  v_subs jsonb;
  v_n int;
  v_cola bigint;
begin
  select * into cfg from private.push_config where id = 1;
  select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth,
                                                'url', case when s.rol = 'admin' then '#/admin' when p_tipo = 'anotada' then '#/recepcion/reservas' else '#/recepcion' end)), '[]'::jsonb), count(*)::int
    into v_subs, v_n
    from private.push_suscripciones s
    join private.sesiones x on x.token_hash = s.sesion_hash and x.revocada_en is null and x.vence > now()
   where (p_solo is not null and s.id = p_solo)
      or (p_solo is null and s.rol = any(p_roles) and s.usuario_id is distinct from p_excluir);
  if v_n = 0 then
    return;
  end if;
  -- limpieza: lo enviado hace más de 3 días y los celulares que no abren la app hace 45 días
  delete from private.push_cola where creado < now() - interval '3 days';
  delete from private.push_suscripciones where visto < now() - interval '45 days';
  insert into private.push_cola (tipo, titulo, cuerpo, destinos) values (p_tipo, left(p_titulo, 100), left(p_cuerpo, 250), v_n) returning id into v_cola;
  if cfg.url is not null and cfg.secreto is not null
     and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'net' and p.proname = 'http_post') then
    execute 'select net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 10000)'
      using cfg.url, jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || cfg.secreto),
            jsonb_build_object('titulo', left(p_titulo, 100), 'cuerpo', left(p_cuerpo, 250), 'tag', p_tag, 'suscripciones', v_subs);
    update private.push_cola set enviado = true where id = v_cola;
  end if;
exception when others then
  null;
end;
$$;

-- «dom 17/11» para el aviso.
create or replace function private.push_fecha(p_fecha date)
returns text language sql immutable security definer set search_path = '' as $$
  select (array['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'])[extract(dow from p_fecha)::int + 1] || ' ' || to_char(p_fecha, 'DD/MM');
$$;

-- Se anotó una reserva: si la anotó el dueño les avisa a recepción; si la anotó recepción, le avisa al dueño y a los otros de recepción.
create or replace function private.push_aviso_anotada(p_id bigint, p_quien text, p_dueno boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  a private.reservas_anotadas;
  cfg private.push_config;
begin
  select * into a from private.reservas_anotadas where id = p_id;
  select * into cfg from private.push_config where id = 1;
  perform private.push_enviar('anotada', 'Reserva nueva',
    concat_ws(' · ', 'Hab. ' || a.habitacion, case when cfg.con_nombre then a.titular end, 'llega ' || private.push_fecha(a.fecha_ingreso),
              a.huespedes_esperados || case when a.huespedes_esperados = 1 then ' huésped' else ' huéspedes' end,
              case when not p_dueno then 'la anotó ' || p_quien end),
    'anotada-' || a.id, case when p_dueno then array['recepcion'] else array['admin', 'recepcion'] end, private.push_usuario_id(p_quien));
exception when others then
  null;
end;
$$;

-- Entró un huésped a una reserva: le avisa al dueño (y a recepción si el dueño lo prendió), menos a quien dio el código. Un solo aviso por reserva (el último reemplaza al anterior).
create or replace function private.push_aviso_checkin(p_estadia bigint, p_con int, p_habilito text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  e private.estadias;
  cfg private.push_config;
begin
  select * into e from private.estadias where id = p_estadia;
  select * into cfg from private.push_config where id = 1;
  perform private.push_enviar('checkin', 'Check-in realizado',
    concat_ws(' · ', 'Hab. ' || e.habitacion, case when cfg.con_nombre then e.titular end,
              p_con || ' de ' || e.huespedes_esperados || case when e.huespedes_esperados = 1 then ' huésped' else ' huéspedes' end,
              case when p_con >= e.huespedes_esperados then 'reserva completa' end),
    'checkin-' || e.id, case when cfg.checkin_a_recepcion then array['admin', 'recepcion'] else array['admin'] end, private.push_usuario_id(p_habilito));
exception when others then
  null;
end;
$$;

-- Activa los avisos en este celular (lo llama la app cuando la persona toca «Activar avisos», y cada vez que se abre, para atarlo a la sesión de ese momento).
-- p_endpoint / p_llave (p256dh) / p_auth: lo que entrega el navegador. Solo con una sesión de dispositivo (no con la clave).
create or replace function public.push_suscribir(p_clave text, p_endpoint text, p_llave text, p_auth text, p_agente text default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  r text;
  v_actor jsonb;
  v_uid bigint;
begin
  r := private.comprobar_recepcion(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  if p_clave !~ '^sd_[0-9a-f]{64}$' then
    return json_build_object('ok', false, 'error', 'sesion_requerida');
  end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or length(p_endpoint) not between 20 and 1000 or p_llave is null or length(p_llave) not between 40 and 200
     or p_auth is null or length(p_auth) not between 10 and 100 then
    return json_build_object('ok', false, 'error', 'datos_invalidos');
  end if;
  v_actor := private.actor(p_clave);
  v_uid := (v_actor ->> 'id')::bigint;
  insert into private.push_suscripciones (sesion_hash, usuario_id, alias, rol, endpoint, p256dh, auth, agente)
    values (encode(extensions.digest(p_clave, 'sha256'), 'hex'), v_uid, v_actor ->> 'alias', v_actor ->> 'rol', p_endpoint, p_llave, p_auth, left(p_agente, 200))
    on conflict (endpoint) do update set sesion_hash = excluded.sesion_hash, usuario_id = excluded.usuario_id, alias = excluded.alias, rol = excluded.rol,
                                         p256dh = excluded.p256dh, auth = excluded.auth, agente = excluded.agente, visto = now();
  -- una persona no junta celulares viejos: se queda con los 8 más recientes
  delete from private.push_suscripciones where usuario_id = v_uid and id not in (select id from private.push_suscripciones where usuario_id = v_uid order by visto desc, id desc limit 8);
  return json_build_object('ok', true);
end;
$$;

-- Apaga los avisos de este celular (cada persona solo puede apagar los suyos).
create or replace function public.push_desuscribir(p_clave text, p_endpoint text)
returns json language plpgsql security definer set search_path = '' as $$
declare r text;
begin
  r := private.comprobar_recepcion(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  delete from private.push_suscripciones where endpoint = p_endpoint and usuario_id = (private.actor(p_clave) ->> 'id')::bigint;
  return json_build_object('ok', true);
end;
$$;

-- ¿Este celular tiene los avisos activos? configurado: el envío ya está conectado en el servidor (si no, los avisos todavía no salen).
create or replace function public.push_estado(p_clave text, p_endpoint text default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  r text;
  cfg private.push_config;
begin
  r := private.comprobar_recepcion(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  select * into cfg from private.push_config where id = 1;
  return json_build_object('ok', true, 'configurado', cfg.url is not null and cfg.secreto is not null,
    'suscripto', exists (select 1 from private.push_suscripciones where endpoint = p_endpoint and usuario_id = (private.actor(p_clave) ->> 'id')::bigint));
end;
$$;

-- Un aviso de prueba, solo a este celular, para comprobar que llega.
create or replace function public.push_prueba(p_clave text, p_endpoint text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  r text;
  cfg private.push_config;
  v_id bigint;
begin
  r := private.comprobar_recepcion(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  if private.limite_alcanzado('prb', 5) then
    return json_build_object('ok', false, 'error', 'demasiados_intentos');
  end if;
  perform private.registrar_fallo('prb');
  select * into cfg from private.push_config where id = 1;
  select id into v_id from private.push_suscripciones where endpoint = p_endpoint and usuario_id = (private.actor(p_clave) ->> 'id')::bigint;
  if v_id is null then
    return json_build_object('ok', false, 'error', 'no_existe');
  end if;
  perform private.push_enviar('prueba', 'Aviso de prueba', 'Si ves esto, los avisos funcionan en este celular.', 'prueba', array[]::text[], null, v_id);
  return json_build_object('ok', true, 'configurado', cfg.url is not null and cfg.secreto is not null);
end;
$$;

-- La función de Vercel avisa qué celulares ya no existen (se desinstaló la app o se quitó el permiso) para sacarlos de la lista. Se entra con el secreto.
create or replace function public.push_limpiar(p_secreto text, p_endpoints text[])
returns json language plpgsql security definer set search_path = '' as $$
declare cfg private.push_config;
begin
  if private.limite_alcanzado('psh', 8) then
    return json_build_object('ok', false, 'error', 'demasiados_intentos');
  end if;
  select * into cfg from private.push_config where id = 1;
  if cfg.secreto is null or p_secreto is distinct from cfg.secreto then
    perform private.registrar_fallo('psh');
    return json_build_object('ok', false, 'error', 'clave_incorrecta');
  end if;
  delete from private.push_suscripciones where endpoint = any(coalesce(p_endpoints, array[]::text[]));
  return json_build_object('ok', true);
end;
$$;

-- Ajustes de los avisos (solo el dueño): si el aviso lleva el nombre del titular, y si el check-in también le avisa a recepción. Sin pasar nada, devuelve lo de hoy.
--   dispositivos: cuántos celulares con sesión abierta tienen los avisos activos, del dueño y de recepción.
create or replace function public.admin_push_config(p_clave text, p_nombre boolean default null, p_checkin_recepcion boolean default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  r text;
  cfg private.push_config;
begin
  r := private.comprobar_clave(p_clave);
  if r <> 'ok' then
    return json_build_object('ok', false, 'error', r);
  end if;
  if p_nombre is not null or p_checkin_recepcion is not null then
    update private.push_config set con_nombre = coalesce(p_nombre, con_nombre), checkin_a_recepcion = coalesce(p_checkin_recepcion, checkin_a_recepcion) where id = 1;
    perform private.auditar('admin', 'config', null, jsonb_build_object('claves', jsonb_build_array('avisos')));
  end if;
  select * into cfg from private.push_config where id = 1;
  return json_build_object('ok', true, 'con_nombre', cfg.con_nombre, 'checkin_a_recepcion', cfg.checkin_a_recepcion, 'configurado', cfg.url is not null and cfg.secreto is not null,
    'dispositivos', json_build_object(
      'admin', (select count(*)::int from private.push_suscripciones s join private.sesiones x on x.token_hash = s.sesion_hash and x.revocada_en is null and x.vence > now() where s.rol = 'admin'),
      'recepcion', (select count(*)::int from private.push_suscripciones s join private.sesiones x on x.token_hash = s.sesion_hash and x.revocada_en is null and x.vence > now() where s.rol = 'recepcion')));
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
    select e.id, e.numero, e.habitacion, e.monto, e.moneda, e.pago_hotel, e.fecha_sena, m.nombre as medio_pago, e.fecha_cobro, e.cargado_por,
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
    select e.id, e.numero, e.habitacion, e.monto, e.moneda, e.pago_hotel, e.fecha_sena, m.nombre as medio_pago, e.fecha_cobro, e.cargado_por,
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
revoke all on function private.push_usuario_id(text) from public, anon, authenticated;
revoke all on function private.push_enviar(text, text, text, text, text[], bigint, bigint) from public, anon, authenticated;
revoke all on function private.push_fecha(date) from public, anon, authenticated;
revoke all on function private.push_aviso_anotada(bigint, text, boolean) from public, anon, authenticated;
revoke all on function private.push_aviso_checkin(bigint, int, text) from public, anon, authenticated;
revoke all on function private.anotada_guardar(text, boolean, bigint, text, date, text, int, int, int, int, numeric, numeric, numeric, numeric, date, text) from public, anon, authenticated;
revoke all on function private.anotada_validar(text, date, text, int, int, int, int, numeric, numeric, numeric, numeric, date, text, private.reservas_anotadas) from public, anon, authenticated;
revoke all on function private.estadia_crear(jsonb, text, numeric, text, int, date, numeric, date, int, int, int, int, text, text, bigint) from public, anon, authenticated;
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
revoke all on function public.recepcion_proximas(text) from public, anon, authenticated;
revoke all on function public.recepcion_estadia_cerrar(text, bigint) from public, anon, authenticated;
revoke all on function public.admin_estadia_reabrir(text, bigint) from public, anon, authenticated;
revoke all on function public.recepcion_anotada_unir(text, bigint, bigint) from public, anon, authenticated;
revoke all on function private.unificar_estadias(text, bigint, bigint, text) from public, anon, authenticated;
revoke all on function private.unificar_anotadas(text, bigint, bigint, text) from public, anon, authenticated;
revoke all on function public.admin_reservas_unificar(text, text, text, text) from public, anon, authenticated;
revoke all on function public.admin_repetida_descartar(text, text, text) from public, anon, authenticated;
revoke all on function public.push_suscribir(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.push_desuscribir(text, text) from public, anon, authenticated;
revoke all on function public.push_estado(text, text) from public, anon, authenticated;
revoke all on function public.push_prueba(text, text) from public, anon, authenticated;
revoke all on function public.push_limpiar(text, text[]) from public, anon, authenticated;
revoke all on function public.admin_push_config(text, boolean, boolean) from public, anon, authenticated;
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
grant execute on function public.recepcion_proximas(text) to anon, authenticated;
grant execute on function public.recepcion_estadia_cerrar(text, bigint) to anon, authenticated;
grant execute on function public.admin_estadia_reabrir(text, bigint) to anon, authenticated;
grant execute on function public.recepcion_anotada_unir(text, bigint, bigint) to anon, authenticated;
grant execute on function public.admin_reservas_unificar(text, text, text, text) to anon, authenticated;
grant execute on function public.admin_repetida_descartar(text, text, text) to anon, authenticated;
grant execute on function public.push_suscribir(text, text, text, text, text) to anon, authenticated;
grant execute on function public.push_desuscribir(text, text) to anon, authenticated;
grant execute on function public.push_estado(text, text) to anon, authenticated;
grant execute on function public.push_prueba(text, text) to anon, authenticated;
grant execute on function public.push_limpiar(text, text[]) to anon, authenticated;
grant execute on function public.admin_push_config(text, boolean, boolean) to anon, authenticated;
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
