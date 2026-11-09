// Equipo con alias y clave propia, un código por persona y "check-in habilitado por".
//   node scripts/test-equipo.mjs
// Parte 1: se arma una base como la que está hoy en producción (con una sola clave de recepción y un celular ya abierto), se le aplica
//          supabase/equipo.sql (dos veces) y se comprueba que no se perdió nada, que la clave de hoy pasa a ser la persona "Recepción",
//          que su celular sigue abierto y que el resultado es idéntico a una base nueva (schema.sql + checkin.sql).
// Parte 2: se prueba, como lo haría la guía (rol "anon"), que el dueño crea personas, que cada una tiene su código, que cada check-in
//          guarda quién lo habilitó (con el nombre de ese día, aunque después lo cambien) y que nadie más puede tocar al equipo.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { CLAVE_ADMIN, CLAVE_RECEPCION, SQL_RECEPCION, iniciarBackend } from './backend-local.mjs';

const ruta = (r) => fileURLToPath(new URL(`../${r}`, import.meta.url));
let fallas = 0;
let total = 0;
const ok = (c, m) => { total += 1; console.log(`${c ? 'OK    ' : 'FALLA '}${m}`); if (!c) fallas += 1; };

const DATOS = (n, doc) => ({ nombre: n, apellido: 'Prueba', email: `${n.toLowerCase()}@correo.com`, telefono: '+541155551234', nacionalidad: 'Argentina', localidad: 'Capital Federal', domicilio: 'Av. Corrientes 1234 5° B', doc_tipo: 'DNI', doc_numero: String(doc) });
const baseCon = async (...archivos) => {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema extensions; create extension pgcrypto with schema extensions;
    grant usage on schema extensions to anon, authenticated;
  `);
  for (const a of archivos) await db.exec(fs.readFileSync(ruta(a), 'utf8'));
  return db;
};
const llamarEn = (db, nombre, args = {}) => db.transaction(async (tx) => {
  const claves = Object.keys(args);
  await tx.query(`select set_config('request.headers', $1, true)`, [JSON.stringify({ 'cf-connecting-ip': '203.0.113.9' })]);
  await tx.exec('set local role anon');
  const r = await tx.query(`select public.${nombre}(${claves.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`, claves.map((k) => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k])));
  return r.rows[0].r;
});

// ---------------------------------------------------------------- Parte 1: la migración
console.log('\n== 1. La migración (base de hoy + supabase/equipo.sql)');
{
  const db = await baseCon('scripts/fixtures/schema.antes-de-equipo.sql', 'scripts/fixtures/checkin.antes-de-equipo.sql');
  await db.query(`insert into private.admin (id, hash) values (1, extensions.crypt($1, extensions.gen_salt('bf')))`, [CLAVE_ADMIN]);
  await db.query(`update private.checkin_config set activo = true, hash_recepcion = extensions.crypt($1, extensions.gen_salt('bf')) where id = 1`, [CLAVE_RECEPCION]);
  await db.query(`insert into private.checkins (grupo, idioma, datos, consentimiento, habitacion, medio_pago_id) values (1, 'es', $1::jsonb, '{"aceptado":true}'::jsonb, '204', 1), (1, 'es', $2::jsonb, '{"aceptado":true}'::jsonb, null, 6)`, [JSON.stringify(DATOS('Ana', 30111222)), JSON.stringify(DATOS('Beto', 30111333))]);
  const rec = await llamarEn(db, 'sesion_entrar', { p_clave: CLAVE_RECEPCION, p_etiqueta: 'Celular de recepción' }); // el celular que hoy ya está abierto
  const adm = await llamarEn(db, 'sesion_entrar', { p_clave: CLAVE_ADMIN });
  const huellaDatos = async () => (await db.query(`select (select md5(string_agg(concat_ws('|', id, creado, datos::text, habitacion, medio_pago_id), ';' order by id)) from private.checkins) as k, (select hash from private.admin) as a, (select hash_recepcion from private.checkin_config where id = 1) as r, (select count(*)::int from private.sesiones) as s`)).rows[0];
  const antes = await huellaDatos();

  const sql = fs.readFileSync(ruta('supabase/equipo.sql'), 'utf8');
  await db.exec(sql);
  ok(true, 'el SQL de la migración se ejecuta sin errores');
  ok(JSON.stringify(await huellaDatos()) === JSON.stringify(antes), 'no se perdió ni cambió nada: huéspedes, claves ni sesiones');
  await db.exec(sql);
  ok(JSON.stringify(await huellaDatos()) === JSON.stringify(antes), 'ejecutarlo de nuevo no cambia nada (se puede repetir sin problema)');
  const equipo = (await db.query(`select alias, rol, hash_clave, activo from private.usuarios`)).rows;
  ok(equipo.length === 1 && equipo[0].alias === 'Recepción' && equipo[0].rol === 'recepcion' && equipo[0].activo && equipo[0].hash_clave === antes.r, 'la clave de recepción de hoy pasó a ser la persona "Recepción", con la misma clave');
  ok((await db.query(`select count(*)::int as n from private.checkins where habilitado_por is not null`)).rows[0].n === 0, 'los check-ins de antes quedan sin "habilitado por" (no se sabe quién dio el código)');
  const e1 = await llamarEn(db, 'recepcion_estado', { p_clave: rec.token });
  ok(e1.ok === true && e1.quien === 'Recepción' && e1.huespedes.length === 2, 'el celular de recepción que ya estaba abierto sigue entrando, ahora como "Recepción"');
  ok((await llamarEn(db, 'recepcion_estado', { p_clave: CLAVE_RECEPCION })).ok === true, 'y la clave de siempre también');
  const e2 = await llamarEn(db, 'sesion_estado', { p_token: adm.token });
  ok(e2.ok === true && e2.rol === 'admin' && e2.dueno === true && e2.alias === 'Dueño', 'el celular del dueño sigue abierto y se sabe que es el dueño');
  ok((await llamarEn(db, 'admin_equipo', { p_clave: rec.token })).ok === false, 'y recepción no puede ver al equipo');
  ok((await llamarEn(db, 'admin_equipo', { p_clave: adm.token })).usuarios.length === 1, 'pero el dueño sí');

  const nueva = await baseCon('supabase/schema.sql', 'supabase/checkin.sql');
  const huella = async (d) => Object.fromEntries((await d.query(`select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as fn, md5(regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), '\\s+', ' ', 'g')) as h from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private')`)).rows.map((x) => [x.fn, x.h]));
  const hv = await huella(db); const hn = await huella(nueva);
  const distintas = [...new Set([...Object.keys(hv), ...Object.keys(hn)])].filter((f) => hv[f] !== hn[f]);
  ok(distintas.length === 0, `la base migrada y una base nueva tienen las mismas ${Object.keys(hn).length} funciones` + (distintas.length ? ' · distintas: ' + distintas.join(', ') : ''));
  const permisos = async (d) => (await d.query(`select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by 1`)).rows.map((x) => `${x.proname}:${x.anon}`).join(',');
  ok(await permisos(db) === await permisos(nueva), 'y los mismos permisos: un anónimo solo puede llamar a las funciones previstas');
  const columnas = async (d) => (await d.query(`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema = 'private' and table_name in ('usuarios', 'codigos_usuario', 'sesiones', 'checkins', 'checkin_sesiones') order by 1, 2`)).rows.map((x) => Object.values(x).join(':')).join(',');
  ok(await columnas(db) === await columnas(nueva) && (await columnas(db)).length > 0, 'y las tablas quedan con las mismas columnas');
  await db.close(); await nueva.close();
}

// ---------------------------------------------------------------- Parte 2: las funciones, como las usa la guía
console.log('\n== 2. El dueño arma el equipo');
const back = await iniciarBackend({ puerto: 54397 });
await back.sql(`update private.checkin_config set activo = true, codigo_seg = 300, usos_max = 20 where id = 1`);
let ipN = 10;
const ip = () => `198.51.100.${ipN++}`;
const llamar = (fn, args, ipp = ip()) => back.llamar(fn, args, ipp);

const dueno = await llamar('sesion_entrar', { p_clave: CLAVE_ADMIN });
ok(dueno.ok && dueno.dueno === true && dueno.alias === 'Dueño', 'el dueño entra y se llama "Dueño"');
const guardar = (p, extra = {}) => llamar('admin_equipo_guardar', { p_clave: dueno.token, p_id: null, p_alias: null, p_rol: null, p_clave_usuario: null, p_activo: true, ...p, ...extra });

ok((await llamar('admin_equipo', { p_clave: dueno.token })).usuarios.length === 0, 'una base nueva arranca sin nadie en el equipo');
let x = await guardar({ p_alias: 'Jorge', p_rol: 'recepcion', p_clave_usuario: 'jorge-clave-123' });
ok(x.ok === true && x.usuarios.length === 1 && x.usuarios[0].alias === 'Jorge' && x.usuarios[0].rol === 'recepcion' && x.usuarios[0].activo === true, 'crea a Jorge como recepción');
ok(!JSON.stringify(x).includes('hash') && !JSON.stringify(x).includes('jorge-clave'), 'y la lista no muestra ninguna clave ni huella');
ok((await back.sql(`select hash_clave from private.usuarios`))[0].hash_clave.startsWith('$2'), 'en la base la clave queda encriptada');
x = await guardar({ p_alias: 'Mara', p_rol: 'recepcion', p_clave_usuario: 'mara-clave-1234' });
ok(x.ok === true && x.usuarios.length === 2, 'crea a Mara');
x = await guardar({ p_alias: 'Papá', p_rol: 'admin', p_clave_usuario: 'papa-clave-12345' });
ok(x.ok === true, 'crea a Papá con acceso de dueño');

// -- validaciones
const falla = async (m, p, err) => { const r = await guardar(p); ok(r.ok === false && r.error === err, `${m} → ${err}`); };
await falla('alias repetido (sin importar mayúsculas)', { p_alias: ' jorge ', p_rol: 'recepcion', p_clave_usuario: 'otra-clave-12345' }, 'alias_repetido');
await falla('alias "Dueño" reservado', { p_alias: 'dueño', p_rol: 'recepcion', p_clave_usuario: 'otra-clave-12345' }, 'alias_repetido');
await falla('alias vacío', { p_alias: '   ', p_rol: 'recepcion', p_clave_usuario: 'otra-clave-12345' }, 'alias_invalido');
await falla('alias de más de 30 letras', { p_alias: 'x'.repeat(31), p_rol: 'recepcion', p_clave_usuario: 'otra-clave-12345' }, 'alias_invalido');
await falla('clave muy corta', { p_alias: 'Lola', p_rol: 'recepcion', p_clave_usuario: 'corta' }, 'clave_corta');
await falla('sin clave', { p_alias: 'Lola', p_rol: 'recepcion' }, 'clave_corta');
await falla('clave igual a la de otra persona', { p_alias: 'Lola', p_rol: 'recepcion', p_clave_usuario: 'jorge-clave-123' }, 'clave_repetida');
await falla('clave igual a la del dueño', { p_alias: 'Lola', p_rol: 'recepcion', p_clave_usuario: CLAVE_ADMIN }, 'clave_repetida');
await falla('rol inventado', { p_alias: 'Lola', p_rol: 'superadmin', p_clave_usuario: 'otra-clave-12345' }, 'rol_invalido');
await falla('persona que no existe', { p_id: 9999, p_alias: 'Lola' }, 'no_existe');
ok((await llamar('admin_equipo', { p_clave: dueno.token })).usuarios.length === 3, 'ninguno de esos intentos creó nada');

// -- quién puede tocar al equipo
console.log('\n== 3. Solo el dueño maneja al equipo');
const jorge = await llamar('sesion_entrar', { p_clave: 'jorge-clave-123', p_etiqueta: 'Celular de Jorge' });
const mara = await llamar('sesion_entrar', { p_clave: 'mara-clave-1234' });
const papa = await llamar('sesion_entrar', { p_clave: 'papa-clave-12345' });
ok(jorge.ok && jorge.rol === 'recepcion' && jorge.alias === 'Jorge' && jorge.dueno === false, 'Jorge entra con su clave: recepción');
ok(papa.ok && papa.rol === 'admin' && papa.alias === 'Papá' && papa.dueno === false, 'Papá entra con la suya: acceso de dueño, pero no es "el dueño"');
ok((await llamar('sesion_entrar', { p_clave: 'clave-que-no-existe' })).ok === false, 'una clave que no es de nadie no entra');
ok((await llamar('sesion_estado', { p_token: jorge.token })).alias === 'Jorge', 'la sesión dice cómo se llama quien entró');
ok((await llamar('admin_equipo', { p_clave: jorge.token })).ok === false, 'recepción no puede ver al equipo');
ok((await llamar('admin_equipo_guardar', { p_clave: jorge.token, p_id: null, p_alias: 'Cuco', p_rol: 'recepcion', p_clave_usuario: 'cuco-clave-1234', p_activo: true })).ok === false, 'ni crear a alguien');
let r = await llamar('admin_equipo', { p_clave: papa.token });
ok(r.ok === false && r.error === 'sin_permiso', 'Papá, con acceso de dueño, tampoco maneja al equipo (solo el dueño)');
ok((await llamar('verificar_clave', { p_clave: papa.token })).ok === true && (await llamar('admin_huespedes', { p_clave: papa.token })).ok === true, 'pero sí usa el resto del panel del dueño');
ok((await llamar('admin_equipo', { p_clave: CLAVE_ADMIN })).ok === true, 'con la clave del dueño, directo, también anda');
const ses = (await llamar('admin_sesiones', { p_clave: dueno.token })).sesiones;
ok(ses.find((s) => s.etiqueta === 'Celular de Jorge')?.alias === 'Jorge' && ses.some((s) => s.alias === 'Dueño'), 'el dueño ve a nombre de quién está cada dispositivo');

// -- códigos
console.log('\n== 4. Cada persona tiene su código y el check-in dice quién lo habilitó');
const estJ = await llamar('recepcion_estado', { p_clave: jorge.token });
const estM = await llamar('recepcion_estado', { p_clave: mara.token });
const estD = await llamar('recepcion_estado', { p_clave: dueno.token });
ok(estJ.quien === 'Jorge' && estM.quien === 'Mara' && estD.quien === 'Dueño', 'cada uno ve su nombre arriba');
const cods = [estJ.codigo.valor, estM.codigo.valor, estD.codigo.valor];
ok(new Set(cods).size === 3 && cods.every((c) => /^\d{6}$/.test(c)), 'y su propio código de 6 números, distinto al de los demás');
ok((await llamar('recepcion_estado', { p_clave: jorge.token })).codigo.valor === cods[0], 'el código de cada uno se mantiene mientras no venza');
const checkin = async (codigo, nombre, doc) => {
  const s = await llamar('checkin_canjear', { p_codigo: codigo });
  if (!s.ok) return s;
  return llamar('checkin_enviar', { p_token: s.token, p_idioma: 'es', p_acepta: true, p_datos: DATOS(nombre, doc) });
};
ok((await checkin(cods[0], 'Ana', 30111001)).ok === true, 'Ana usa el código de Jorge');
ok((await checkin(cods[1], 'Beto', 30111002)).ok === true, 'Beto usa el de Mara');
ok((await checkin(cods[2], 'Carla', 30111003)).ok === true, 'Carla usa el del dueño');
const quien = async () => Object.fromEntries((await back.sql(`select datos ->> 'nombre' as n, habilitado_por as h from private.checkins`)).map((k) => [k.n, k.h]));
let q = await quien();
ok(q.Ana === 'Jorge' && q.Beto === 'Mara' && q.Carla === 'Dueño', 'cada check-in guarda quién lo habilitó: Jorge, Mara y Dueño');
r = await llamar('recepcion_estado', { p_clave: mara.token });
ok(r.huespedes.find((h) => h.datos.nombre === 'Ana').habilitado_por === 'Jorge', 'recepción ve quién habilitó a cada huésped');
r = await llamar('admin_huespedes', { p_clave: dueno.token });
ok(r.huespedes.find((h) => h.datos.nombre === 'Beto').habilitado_por === 'Mara', 'y el dueño también');
const nuevoJ = await llamar('recepcion_codigo_nuevo', { p_clave: jorge.token });
ok(nuevoJ.ok && nuevoJ.codigo.valor !== cods[0], 'Jorge pide un código nuevo');
ok((await llamar('recepcion_estado', { p_clave: mara.token })).codigo.valor === cods[1], 'y el de Mara no cambia');
ok((await checkin(cods[0], 'Nadie', 30111999)).error === 'codigo_invalido', 'el anterior de Jorge queda anulado (así funciona "código nuevo ahora")');
ok((await checkin(nuevoJ.codigo.valor, 'Eva', 30111998)).ok === true && (await quien()).Eva === 'Jorge', 'y el nuevo se anota a Jorge');
let aud = await back.sql(`select quien, detalle from private.checkin_auditoria where accion = 'codigo_nuevo'`);
ok(aud.length === 1 && aud[0].detalle.alias === 'Jorge', 'el historial dice que el código nuevo lo pidió Jorge');

// -- cambiar el nombre
console.log('\n== 5. Si cambia el alias, lo anterior no cambia');
const idJ = (await llamar('admin_equipo', { p_clave: dueno.token })).usuarios.find((u) => u.alias === 'Jorge').id;
x = await guardar({ p_id: idJ, p_alias: 'Lucas', p_clave_usuario: 'lucas-clave-123' });
ok(x.ok === true && x.usuarios.some((u) => u.alias === 'Lucas') && !x.usuarios.some((u) => u.alias === 'Jorge'), 'el dueño le cambia el nombre y la clave: Jorge pasa a ser Lucas');
q = await quien();
ok(q.Ana === 'Jorge' && q.Eva === 'Jorge', 'los check-ins anteriores siguen diciendo Jorge');
ok((await llamar('recepcion_estado', { p_clave: jorge.token })).ok === false, 'el celular de Jorge se cerró');
ok((await llamar('sesion_entrar', { p_clave: 'jorge-clave-123' })).ok === false, 'y su clave vieja ya no entra');
const lucas = await llamar('sesion_entrar', { p_clave: 'lucas-clave-123' });
ok(lucas.ok && lucas.alias === 'Lucas', 'Lucas entra con la suya');
const estL = await llamar('recepcion_estado', { p_clave: lucas.token });
ok(estL.quien === 'Lucas' && estL.codigo.valor !== cods[1] && estL.codigo.valor !== estD.codigo.valor, 'con su código');
ok((await checkin(estL.codigo.valor, 'Diego', 30111004)).ok === true, 'Diego usa el código de Lucas');
q = await quien();
ok(q.Diego === 'Lucas' && q.Ana === 'Jorge', 'el check-in nuevo dice Lucas y los viejos siguen diciendo Jorge');
x = await guardar({ p_id: idJ, p_alias: 'Lucas Gómez' });
ok(x.ok === true && (await llamar('recepcion_estado', { p_clave: lucas.token })).ok === true, 'cambiar solo el nombre no le cierra el celular');
q = await quien();
ok(q.Diego === 'Lucas', 'y el check-in de antes sigue diciendo "Lucas"');
x = await guardar({ p_alias: 'Jorge', p_rol: 'recepcion', p_clave_usuario: 'jorge-otro-1234' });
ok(x.ok === true, 'un alias libre se puede volver a usar para una persona nueva');
aud = await back.sql(`select detalle from private.checkin_auditoria where accion = 'usuario_editado' order by id`);
ok(aud.length === 2 && aud[0].detalle.antes === 'Jorge' && aud[0].detalle.alias === 'Lucas' && aud[0].detalle.campos.includes('clave') && aud[0].detalle.campos.includes('alias'), 'el historial anota quién pasó a quién y qué se cambió');
ok(!JSON.stringify(await back.sql('select detalle from private.checkin_auditoria')).includes('clave-123'), 'sin guardar ninguna clave');

// -- dar de baja
console.log('\n== 6. Dar de baja y volver a dar de alta');
const idM = (await llamar('admin_equipo', { p_clave: dueno.token })).usuarios.find((u) => u.alias === 'Mara').id;
x = await guardar({ p_id: idM, p_activo: false });
ok(x.ok === true && x.usuarios.find((u) => u.id === idM).activo === false, 'el dueño da de baja a Mara');
ok((await llamar('recepcion_estado', { p_clave: mara.token })).ok === false, 'su celular se cerró');
ok((await llamar('sesion_entrar', { p_clave: 'mara-clave-1234' })).ok === false, 'su clave no entra');
ok((await checkin(cods[1], 'Tarde', 30111005)).error === 'codigo_invalido', 'y su código ya no sirve');
ok((await back.sql(`select count(*)::int as n from private.checkins where habilitado_por = 'Mara'`))[0].n === 1, 'sus check-ins quedan a su nombre');
x = await guardar({ p_alias: 'Mara', p_rol: 'recepcion', p_clave_usuario: 'otra-mara-12345' });
ok(x.ok === true, 'se puede crear otra "Mara" mientras la anterior esté de baja');
x = await guardar({ p_id: idM, p_activo: true });
ok(x.ok === false && x.error === 'alias_repetido', 'pero no reactivar a la primera mientras haya otra con el mismo nombre');
x = await guardar({ p_id: idM, p_activo: true, p_alias: 'Mara vieja' });
ok(x.ok === true && (await llamar('sesion_entrar', { p_clave: 'mara-clave-1234' })).ok === true, 'dándole otro alias, se reactiva y su clave vuelve a andar');
ok((await guardar({ p_alias: 'Cuco', p_rol: 'recepcion', p_clave_usuario: 'mara-clave-1234' })).error === 'clave_repetida', 'la clave de alguien de baja tampoco se puede reusar (así no hay dos con la misma)');
const idP = (await llamar('admin_equipo', { p_clave: dueno.token })).usuarios.find((u) => u.alias === 'Papá').id;
x = await guardar({ p_id: idP, p_rol: 'recepcion' });
ok(x.ok === true && (await llamar('verificar_clave', { p_clave: papa.token })).ok === false, 'cambiarle el rol a alguien le cierra las sesiones (tiene que volver a entrar)');
ok((await llamar('sesion_entrar', { p_clave: 'papa-clave-12345' })).rol === 'recepcion', 'y entra con el rol nuevo');

// -- unicidad de códigos
console.log('\n== 7. Los códigos nunca se repiten entre personas');
const tokens = [];
for (const k of ['lucas-clave-123', 'jorge-otro-1234', 'otra-mara-12345', 'mara-clave-1234', 'papa-clave-12345']) tokens.push((await llamar('sesion_entrar', { p_clave: k })).token);
let repetidos = 0;
for (let i = 0; i < 15; i += 1) {
  for (const t of tokens) await llamar('recepcion_codigo_nuevo', { p_clave: t });
  const v = await back.sql(`select codigo, prev_codigo from private.codigos_usuario`);
  const todos = v.flatMap((c) => [c.codigo, c.prev_codigo]).filter(Boolean);
  if (new Set(todos).size !== todos.length) repetidos += 1;
}
ok(repetidos === 0, 'en 15 rondas de códigos nuevos para 6 personas, ninguno se repitió');
ok((await back.sql(`select count(*)::int as n from private.codigos_usuario`))[0].n === 6, 'hay una sola fila de código por persona (no crece)');

// -- seguridad
console.log('\n== 8. Seguridad');
const intento = async (sql) => { try { await back.exec(`begin; set local role anon; ${sql}; rollback;`); return ''; } catch (err) { await back.exec('rollback').catch(() => {}); return String(err.message); } };
ok(/permission denied/.test(await intento('select * from private.usuarios')), 'un anónimo no puede leer la tabla del equipo');
ok(/permission denied/.test(await intento(`update private.usuarios set rol = 'admin'`)), 'ni cambiarle el rol a alguien');
ok(/permission denied/.test(await intento(`insert into private.usuarios (alias, rol, hash_clave) values ('X', 'admin', 'x')`)), 'ni crear una persona directo');
ok(/permission denied/.test(await intento('select * from private.codigos_usuario')), 'ni leer los códigos de cada uno');
ok(/permission denied/.test(await intento(`select private.actor('${CLAVE_ADMIN}')`)), 'ni llamar a la función interna que dice quién es quién');
let frenado = 0;
for (let i = 0; i < 12; i += 1) { const e = await llamar('sesion_entrar', { p_clave: `intento-${i}-xxxxxxx` }, '198.51.100.250'); if (e.error === 'demasiados_intentos') frenado += 1; }
ok(frenado >= 3, 'probar muchas claves seguidas se frena');
ok((await back.sql(`select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private') and p.prosrc ~* '\\mdelete\\M|\\mdrop\\M|\\mtruncate\\M'`))[0].n === 0, 'ninguna función de la guía contiene DELETE, DROP ni TRUNCATE');

console.log(`\n${total} comprobaciones, ${fallas} falla(s)`);
await back.cerrar();
process.exit(fallas ? 1 : 0);
