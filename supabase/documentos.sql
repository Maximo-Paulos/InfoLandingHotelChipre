-- Tipo de documento «Identificación» (cédula, RG, carnet de conducir u otro documento de identidad con foto), además de DNI y pasaporte.
-- Es SOLO LO NUEVO de checkin.sql, listo para pegar en el SQL Editor de Supabase de una base que ya tiene el check-in.
-- (Para una base nueva alcanza con schema.sql + checkin.sql, que ya lo incluye todo.) No depende de medios_pago.sql ni de
-- fotos_admin.sql: se puede correr antes o después de ellos.
--
-- Qué hace:
--   * Ajusta private.validar_huesped: además de "DNI" y "Pasaporte" acepta el tipo "Identificación" (de 4 a 20 letras o
--     números; se ignoran los espacios, puntos, guiones y barras). Es la función que revisan el check-in del huésped y
--     la edición de recepción y del dueño.
--   * Ajusta public.checkin_estado: le avisa a la guía qué tipos de documento acepta la base ("tipos_doc"). Así la guía solo
--     ofrece «Identificación» cuando ya corriste este SQL, y mientras tanto sigue andando igual con DNI y pasaporte.
--   * No cambia ninguna firma, ninguna tabla ni ningún dato: los huéspedes ya cargados quedan exactamente igual. La guía y el
--     script de Drive que ya están publicados siguen andando igual (NO hay que tocar el script de Google). La foto del
--     documento se sube igual con los tres tipos.
--   * No borra nada.
-- Se puede ejecutar más de una vez sin problema.

-- ---------------------------------------------------------------- funciones

create or replace function private.validar_huesped(p_datos jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_nombre text; v_apellido text; v_email text; v_tel text; v_nac text; v_loc text; v_dom text; v_tipo text; v_num text;
  v_err text[] := array[]::text[];
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

  if v_nombre !~ '^[[:alpha:]][[:alpha:] .''-]{1,59}$' then v_err := array_append(v_err, 'nombre'); end if;
  if v_apellido !~ '^[[:alpha:]][[:alpha:] .''-]{1,59}$' then v_err := array_append(v_err, 'apellido'); end if;
  if length(v_email) > 120 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$' then v_err := array_append(v_err, 'email'); end if;
  if v_tel !~ '^\+[1-9][0-9]{7,14}$' then v_err := array_append(v_err, 'telefono'); end if;
  if v_nac !~ '^[[:alpha:]][[:alpha:] .,''()-]{1,59}$' then v_err := array_append(v_err, 'nacionalidad'); end if;
  if v_loc !~ '^[[:alnum:]][^[:cntrl:]<>]{1,79}$' then v_err := array_append(v_err, 'localidad'); end if;
  if v_dom !~ '^[[:alnum:]][^[:cntrl:]<>]{4,119}$' then v_err := array_append(v_err, 'domicilio'); end if;

  if v_tipo = 'DNI' then
    v_num := regexp_replace(v_num, '[\s.-]', '', 'g');
    if v_num !~ '^[0-9]{7,8}$' then v_err := array_append(v_err, 'doc_numero'); end if;
  elsif v_tipo = 'Pasaporte' then
    v_num := upper(regexp_replace(v_num, '[\s-]', '', 'g'));
    if v_num !~ '^[A-Z0-9]{6,12}$' then v_err := array_append(v_err, 'doc_numero'); end if;
  elsif v_tipo = 'Identificación' then
    -- cédula, RG, carnet de conducir u otro documento de identidad: letras y números, con o sin puntos, guiones, barras o espacios
    v_num := upper(regexp_replace(v_num, '[\s./-]', '', 'g'));
    if v_num !~ '^[A-Z0-9]{4,20}$' then v_err := array_append(v_err, 'doc_numero'); end if;
  else
    v_err := array_append(v_err, 'doc_tipo');
  end if;

  if array_length(v_err, 1) is not null then
    return jsonb_build_object('ok', false, 'campos', to_jsonb(v_err));
  end if;
  return jsonb_build_object('ok', true, 'datos', jsonb_build_object(
    'nombre', v_nombre, 'apellido', v_apellido, 'email', v_email, 'telefono', v_tel,
    'nacionalidad', v_nac, 'localidad', v_loc, 'domicilio', v_dom, 'doc_tipo', v_tipo, 'doc_numero', v_num));
end;
$$;

create or replace function public.checkin_estado()
returns json language plpgsql security definer set search_path = '' as $$
declare cfg private.checkin_config;
begin
  select * into cfg from private.checkin_config where id = 1;
  return json_build_object(
    'activo', cfg.activo,
    'foto', case when cfg.activo and cfg.foto_modo <> 'no' and cfg.foto_url is not null
                 then json_build_object('modo', cfg.foto_modo, 'url', cfg.foto_url) else null end,
    -- los tipos de documento que acepta la base: la guía solo ofrece los que figuran acá (así la guía nueva anda también con una base sin migrar)
    'tipos_doc', json_build_array('DNI', 'Pasaporte', 'Identificación'));
end;
$$;

-- ---------------------------------------------------------------- permisos

revoke all on function private.validar_huesped(jsonb) from public, anon, authenticated;
revoke all on function public.checkin_estado() from public, anon, authenticated;

grant execute on function public.checkin_estado() to anon, authenticated;

-- Avisa a la API que cambiaron funciones (si no, tarda unos minutos en verlas).
notify pgrst, 'reload schema';
