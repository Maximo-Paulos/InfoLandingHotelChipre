// Fotos del documento desde recepción: la migración no pierde nada y recepción puede agregar pero no quitar.
//   node scripts/test-fotos-recepcion.mjs
// Parte 1: se arma una base como la que está hoy en producción (schema.sql + el check-in de antes de esto), con huéspedes y fotos
//          ya cargados, se le aplica supabase/fotos_recepcion.sql (dos veces) y se comprueba que no se perdió ni cambió nada y
//          que el resultado es idéntico a una base nueva (schema.sql + checkin.sql).
// Parte 2: se prueba, como lo haría la guía (rol "anon") y con el script de Drive de siempre (apps-script/Codigo.gs, sin
//          cambios), que recepción vea y agregue fotos, que NO pueda quitarlas y que el dueño siga viéndolo todo.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { CLAVE_ADMIN, CLAVE_RECEPCION, iniciarBackend } from './backend-local.mjs';

const ruta = (r) => fileURLToPath(new URL(`../${r}`, import.meta.url));
let fallas = 0;
let total = 0;
const ok = (c, m) => { total += 1; console.log(`${c ? 'OK    ' : 'FALLA '}${m}`); if (!c) fallas += 1; };

const DATOS = (n, doc) => ({ nombre: n, apellido: 'Prueba', email: `${n.toLowerCase()}@correo.com`, telefono: '+541155551234', nacionalidad: 'Argentina', localidad: 'Capital Federal', domicilio: 'Av. Corrientes 1234 5° B', doc_tipo: 'DNI', doc_numero: String(doc) });
const baseVacia = async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema extensions; create extension pgcrypto with schema extensions;
    grant usage on schema extensions to anon, authenticated;
  `);
  await db.exec(fs.readFileSync(ruta('supabase/schema.sql'), 'utf8'));
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
console.log('\n== 1. La migración (base de hoy + supabase/fotos_recepcion.sql)');
{
  const db = await baseVacia();
  await db.exec(fs.readFileSync(ruta('scripts/fixtures/checkin.antes-de-fotos-recepcion.sql'), 'utf8'));
  await db.query(`insert into private.admin (id, hash) values (1, extensions.crypt($1, extensions.gen_salt('bf')))`, [CLAVE_ADMIN]);
  await db.query(`update private.checkin_config set activo = true, hash_recepcion = extensions.crypt($1, extensions.gen_salt('bf')) where id = 1`, [CLAVE_RECEPCION]);
  await db.query(`insert into private.checkins (grupo, idioma, datos, consentimiento, habitacion, foto_id, foto_nombre, medio_pago_id) values
    (1, 'es', $1::jsonb, '{"aceptado":true}'::jsonb, '204', 'FOTOID0001', 'ana.jpg', 1),
    (1, 'pt', $2::jsonb, '{"aceptado":true}'::jsonb, null, null, null, 6)`,
  [JSON.stringify(DATOS('Ana', 30111222)), JSON.stringify(DATOS('Beto', 30111333))]);
  // una foto que el dueño agregó y otra que quitó: la migración no las toca
  await db.query(`insert into private.checkin_fotos (checkin_id, foto_id, nombre, origen) values (1, 'FOTOID0001', 'ana.jpg', 'huesped'), (1, 'DUENIO00001', 'duenio.jpg', 'admin'), (2, 'QUITADA0001', 'quitada.jpg', 'admin')`);
  await db.query(`update private.checkin_fotos set activa = false, quitada_en = now(), quitada_por = 'admin' where foto_id = 'QUITADA0001'`);
  await db.query(`insert into private.foto_permisos (ref, checkin_id, vence, usos) values ('${'a'.repeat(32)}', 1, now() + interval '5 minutes', 1)`);
  const huellaDatos = async () => (await db.query(`select (select md5(string_agg(concat_ws('|', id, creado, datos::text, habitacion, foto_id, foto_nombre, medio_pago_id), ';' order by id)) from private.checkins) as k, (select md5(string_agg(concat_ws('|', id, checkin_id, foto_id, nombre, origen, creado, activa, quitada_en, quitada_por), ';' order by id)) from private.checkin_fotos) as f, (select md5(string_agg(concat_ws('|', ref, checkin_id, vence, usos), ';' order by ref)) from private.foto_permisos) as p`)).rows[0];
  const antes = await huellaDatos();

  const sql = fs.readFileSync(ruta('supabase/fotos_recepcion.sql'), 'utf8');
  await db.exec(sql);
  ok(true, 'el SQL de la migración se ejecuta sin errores');
  const despues = await huellaDatos();
  ok(despues.k === antes.k && despues.f === antes.f && despues.p === antes.p, 'no se perdió ni cambió ningún huésped, foto (activa o quitada) ni permiso que ya estaba');
  ok((await db.query('select count(*)::int as n from private.checkin_fotos where cargada_por is not null')).rows[0].n === 0, 'las fotos de antes quedan sin "cargada por recepción"');
  ok((await db.query(`select por from private.foto_permisos`)).rows.every((x) => x.por === 'admin'), 'y los permisos de antes siguen siendo del dueño');
  await db.exec(sql);
  ok((await huellaDatos()).f === antes.f, 'ejecutarlo de nuevo no cambia nada (se puede repetir sin problema)');

  const nueva = await baseVacia();
  await nueva.exec(fs.readFileSync(ruta('supabase/checkin.sql'), 'utf8'));
  const huella = async (d) => Object.fromEntries((await d.query(`select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as fn, md5(regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), '\\s+', ' ', 'g')) as h from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private')`)).rows.map((x) => [x.fn, x.h]));
  await db.exec(fs.readFileSync(ruta('supabase/sesiones.sql'), 'utf8')); // y el ingreso con sesión de dispositivo, que va después
  const hv = await huella(db); const hn = await huella(nueva);
  const distintas = [...new Set([...Object.keys(hv), ...Object.keys(hn)])].filter((f) => hv[f] !== hn[f]);
  ok(distintas.length === 0, `la base migrada y una base nueva tienen las mismas ${Object.keys(hn).length} funciones` + (distintas.length ? ' · distintas: ' + distintas.join(', ') : ''));
  const permisos = async (d) => (await d.query(`select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by 1`)).rows.map((x) => `${x.proname}:${x.anon}`).join(',');
  ok(await permisos(db) === await permisos(nueva), 'y los mismos permisos: un anónimo solo puede llamar a las funciones previstas');
  const columnas = async (d) => (await d.query(`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema = 'private' and table_name in ('checkin_fotos','foto_permisos') order by 1, ordinal_position`)).rows.map((x) => Object.values(x).join(':')).join(',');
  ok(await columnas(db) === await columnas(nueva), 'y las dos tablas quedan con las mismas columnas');
  await db.close(); await nueva.close();
}

// ---------------------------------------------------------------- Parte 2: las funciones, como las usa la guía
console.log('\n== 2. Recepción ve y agrega fotos, pero no las quita');
const back = await iniciarBackend({ puerto: 54397 });
const SCRIPT = `${back.url}/apps-script/exec`;
await back.sql(`update private.checkin_config set activo = true, codigo_seg = 300, usos_max = 20, foto_modo = 'opcional', foto_url = $2, hash_recepcion = extensions.crypt($1, extensions.gen_salt('bf')) where id = 1`, [CLAVE_RECEPCION, SCRIPT]);
const recepcion = (fn, args, ip = '198.51.100.50') => back.llamar(fn, { p_clave: CLAVE_RECEPCION, ...args }, ip);
const admin = (fn, args, ip = '198.51.100.60') => back.llamar(fn, { p_clave: CLAVE_ADMIN, ...args }, ip);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7)]).toString('base64');
const subir = async (ticket, nombre, apellido) => (await fetch(SCRIPT, { method: 'POST', body: JSON.stringify({ ticket, nombre, apellido, imagen: JPG }) })).json();
const drive = async () => (await fetch(`${back.url}/__test/drive`)).json();
async function nuevoHuesped(nombre, doc, conFoto) {
  const est = await recepcion('recepcion_estado', {});
  const ses = await back.llamar('checkin_canjear', { p_codigo: String(est.codigo.valor) }, '198.51.100.70');
  if (conFoto) {
    const r = await subir(ses.foto.ticket, nombre, 'Prueba');
    if (!r.ok) throw new Error('el huésped no pudo subir su foto: ' + JSON.stringify(r));
  }
  const env = await back.llamar('checkin_enviar', { p_token: ses.token, p_idioma: 'es', p_acepta: true, p_datos: DATOS(nombre, doc) }, '198.51.100.70');
  if (!env.ok) throw new Error('no se pudo cargar el huésped ' + nombre + ' ' + JSON.stringify(env));
  return (await back.sql('select max(id)::int as id from private.checkins'))[0].id;
}
const cuenta = async () => (await back.sql('select count(*)::int as n from private.checkin_fotos'))[0].n;
const filaRec = async (id) => (await recepcion('recepcion_estado', {})).huespedes.find((h) => h.id === id);

// -- el caso pedido: el huésped no subió su foto y recepción la agrega
const idBeto = await nuevoHuesped('Beto', 30111333, false);
let f = await recepcion('recepcion_fotos', { p_id: idBeto });
ok(f.ok === true && f.drive === true && f.fotos.length === 0, 'recepción ve que un huésped que no mandó foto no tiene ninguna (y que hay Drive conectado)');
let p = await recepcion('recepcion_foto_permiso', { p_id: idBeto });
ok(p.ok === true && /^[0-9a-f]{32}\.\d{9,12}\.[0-9a-f]{64}$/.test(p.ticket) && p.url === SCRIPT && p.vence_seg === 600, 'recepción pide permiso para subir una foto (firmado, de 10 minutos)');
const s1 = await subir(p.ticket, 'Beto', 'Prueba');
ok(s1.ok === true && /_Prueba_Beto\.jpg$/.test(s1.nombre), 'el script de Drive que ya está publicado la guarda (el script no cambió)');
f = await recepcion('recepcion_fotos', { p_id: idBeto });
ok(f.fotos.length === 1 && f.fotos[0].origen === 'admin' && f.fotos[0].cargada_por === 'recepcion' && f.fotos[0].nombre === s1.nombre && !!f.fotos[0].creado, 'queda en la lista del huésped, marcada como cargada por recepción');
const fila = await filaRec(idBeto);
ok(fila.foto_id === f.fotos[0].foto_id && fila.fotos.length === 1 && fila.fotos[0].cargada_por === 'recepcion', 'la planilla de recepción la muestra');
ok((await drive()).filter((a) => a.mime === 'image/jpeg').length === 1, 'y el archivo está en la carpeta de Drive');
const aud = (await admin('admin_checkin_auditoria', { p_limite: 200 })).registros.filter((x) => x.accion === 'foto_agregada' && x.checkin_id === idBeto);
ok(aud.length === 1 && aud[0].quien === 'recepcion', 'queda en el historial que la agregó recepción');
ok(!JSON.stringify(aud).includes('Prueba_Beto'), 'sin guardar el nombre del archivo (lleva el nombre del huésped)');
const fa = await admin('admin_fotos', { p_id: idBeto });
ok(fa.fotos.length === 1 && fa.fotos[0].cargada_por === 'recepcion' && fa.fotos[0].activa === true, 'el dueño ve la misma foto, con la marca de que la cargó recepción');

// -- agregar otra a un huésped que ya tiene (la primera no se leía)
p = await recepcion('recepcion_foto_permiso', { p_id: idBeto });
const s2 = await subir(p.ticket, 'Beto', 'Prueba');
f = await recepcion('recepcion_fotos', { p_id: idBeto });
ok(s2.ok === true && f.fotos.length === 2 && s2.nombre !== s1.nombre, 'recepción puede agregar otra foto al mismo huésped, con otro nombre de archivo');

// -- recepción NO puede quitar: ni con su clave ni con otra función
const idAna = await nuevoHuesped('Ana', 30111222, true);
const fotoAna = (await admin('admin_fotos', { p_id: idAna })).fotos[0];
ok(fotoAna.origen === 'huesped' && fotoAna.cargada_por === null, 'la foto que subió el huésped al hacer el check-in sigue marcada como del huésped');
const filasAntes = await cuenta();
const driveAntes = (await drive()).length;
let r = await recepcion('admin_foto_quitar', { p_foto: fotoAna.id }, '198.51.100.81');
ok(r.ok === false && r.error === 'clave_incorrecta', 'con la clave de recepción no se puede quitar una foto (esa función es solo del dueño)');
r = await recepcion('admin_fotos', { p_id: idAna }, '198.51.100.82');
ok(r.ok === false && r.error === 'clave_incorrecta', 'ni ver las fotos quitadas (la pantalla del dueño es solo del dueño)');
r = await recepcion('admin_foto_permiso', { p_id: idAna }, '198.51.100.83');
ok(r.ok === false && r.error === 'clave_incorrecta', 'ni usar el permiso del dueño');
ok((await cuenta()) === filasAntes && (await drive()).length === driveAntes && (await back.sql('select count(*)::int as n from private.checkin_fotos where activa = false'))[0].n === 0, 'esos intentos no tocaron nada: no hay fotos quitadas, ni borradas');
const nombres = (await back.sql(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'recepcion%'`)).map((x) => x.proname).sort();
ok(JSON.stringify(nombres) === JSON.stringify(['recepcion_codigo_nuevo', 'recepcion_editar', 'recepcion_entrar', 'recepcion_estado', 'recepcion_foto_permiso', 'recepcion_fotos']), 'y entre las funciones de recepción no hay ninguna para quitar fotos');

// -- lo que el dueño quitó, recepción no lo ve ni lo repone
await admin('admin_foto_quitar', { p_foto: fotoAna.id });
f = await recepcion('recepcion_fotos', { p_id: idAna });
ok(f.ok === true && f.fotos.length === 0, 'una foto que el dueño quitó no aparece en la lista de recepción');
ok((await filaRec(idAna)).fotos.length === 0, 'ni en su planilla');
await admin('admin_foto_quitar', { p_foto: fotoAna.id, p_quitar: false });

// -- claves, huéspedes que no existen o fuera de los días que ve recepción
let todasMalas = true;
for (const [fn, ip1] of [['recepcion_fotos', '198.51.100.91'], ['recepcion_foto_permiso', '198.51.100.93']]) {
  const a = await back.llamar(fn, { p_clave: 'clave-equivocada', p_id: idBeto }, ip1);
  const b = await back.llamar(fn, { p_clave: CLAVE_ADMIN, p_id: idBeto }, ip1.replace(/\d+$/, (n) => String(Number(n) + 1)));
  if (!(a.ok === false && a.error === 'clave_incorrecta' && b.ok === false && b.error === 'clave_incorrecta')) todasMalas = false;
}
ok(todasMalas, 'sin la clave de recepción no se pueden ver fotos ni pedir permiso (y la del dueño tampoco sirve acá)');
r = await recepcion('recepcion_fotos', { p_id: 999999 });
ok(r.ok === false && r.error === 'no_existe', 'pedir las fotos de un huésped que no existe da error claro');
r = await recepcion('recepcion_foto_permiso', { p_id: 999999 });
ok(r.ok === false && r.error === 'no_existe', 'y pedir permiso para subir a uno que no existe');
await back.sql(`update private.checkins set creado = now() - interval '10 days' where id = $1`, [idAna]);
r = await recepcion('recepcion_fotos', { p_id: idAna });
ok(r.ok === false && r.error === 'no_existe', 'un huésped más viejo que los días que ve recepción tampoco se puede tocar desde recepción');
r = await recepcion('recepcion_foto_permiso', { p_id: idAna });
ok(r.ok === false && r.error === 'no_existe', 'ni agregarle fotos');
ok((await admin('admin_fotos', { p_id: idAna })).ok === true, 'pero el dueño sí');
await back.sql(`update private.checkins set creado = now() where id = $1`, [idAna]);
let bloqueado = null;
for (let i = 0; i < 9; i += 1) bloqueado = await back.llamar('recepcion_foto_permiso', { p_clave: 'mala-' + i, p_id: idBeto }, '198.51.100.97');
ok(bloqueado.ok === false && bloqueado.error === 'demasiados_intentos', 'adivinar la clave de recepción desde la misma IP se frena');

// -- permisos que vencen o se gastan, y el tope de fotos
const idDario = await nuevoHuesped('Dario', 30111555, false);
p = await recepcion('recepcion_foto_permiso', { p_id: idDario });
await back.sql(`update private.foto_permisos set vence = now() - interval '1 minute' where ref = $1`, [p.ticket.split('.')[0]]);
const tarde = await subir(p.ticket, 'Dario', 'Prueba');
ok(tarde.ok === false && tarde.error === 'registro' && (await recepcion('recepcion_fotos', { p_id: idDario })).fotos.length === 0, 'un permiso vencido no registra la foto');
p = await recepcion('recepcion_foto_permiso', { p_id: idDario });
const ref = p.ticket.split('.')[0];
const secreto = (await back.sql('select foto_secreto from private.checkin_config where id = 1'))[0].foto_secreto;
const reg = (i) => back.llamar('checkin_foto_registrar', { p_secreto: secreto, p_ref: ref, p_foto_id: `DIRECTO${String(i).padStart(4, '0')}ABCD`, p_nombre: `directo${i}.jpg` }, '198.51.100.77');
const tres = [await reg(1), await reg(2), await reg(3)];
ok(tres.every((x) => x.ok === true) && (await recepcion('recepcion_fotos', { p_id: idDario })).fotos.length === 3, 'un permiso de recepción sirve para 3 fotos');
r = await reg(4);
ok(r.ok === false && r.error === 'sesion_invalida' && (await recepcion('recepcion_fotos', { p_id: idDario })).fotos.length === 3, 'a la cuarta lo rechaza');
const idCarla = await nuevoHuesped('Carla', 30111444, false);
await back.sql(`insert into private.checkin_fotos (checkin_id, foto_id, nombre, origen) select $1, 'LIMITE' || lpad(g::text, 6, '0'), 'f' || g || '.jpg', 'admin' from generate_series(1, 10) g`, [idCarla]);
r = await recepcion('recepcion_foto_permiso', { p_id: idCarla });
ok(r.ok === false && r.error === 'limite_fotos', 'con 10 fotos activas recepción no puede agregar más');

// -- el dueño sigue igual: su permiso queda marcado como suyo
const idEva = await nuevoHuesped('Eva', 30111666, false);
p = await admin('admin_foto_permiso', { p_id: idEva });
const sd = await subir(p.ticket, 'Eva', 'Prueba');
const fe = await admin('admin_fotos', { p_id: idEva });
ok(sd.ok === true && fe.fotos.length === 1 && fe.fotos[0].origen === 'admin' && fe.fotos[0].cargada_por === null, 'lo que sube el dueño sigue marcado como del dueño (no como de recepción)');
const audEva = (await admin('admin_checkin_auditoria', { p_limite: 200 })).registros.filter((x) => x.accion === 'foto_agregada' && x.checkin_id === idEva);
ok(audEva.length === 1 && audEva[0].quien === 'admin', 'y en el historial figura el dueño');

// -- sin Drive conectado
await back.sql(`update private.checkin_config set foto_url = null where id = 1`);
r = await recepcion('recepcion_foto_permiso', { p_id: idBeto });
ok(r.ok === false && r.error === 'sin_drive', 'sin Drive conectado recepción no puede subir (avisa claro)');
ok((await recepcion('recepcion_fotos', { p_id: idBeto })).drive === false, 'y la lista avisa que no hay Drive');
await back.sql(`update private.checkin_config set foto_url = $1 where id = 1`, [SCRIPT]);

// -- seguridad
const intento = async (sql) => { try { await back.exec(`begin; set local role anon; ${sql}; rollback;`); return ''; } catch (e) { await back.exec('rollback').catch(() => {}); return String(e.message); } };
ok(/permission denied/.test(await intento(`update private.checkin_fotos set cargada_por = 'recepcion'`)), 'un anónimo no puede marcar fotos directo');
ok(/permission denied/.test(await intento(`insert into private.foto_permisos (ref, checkin_id, vence, por) values ('${'b'.repeat(32)}', 1, now(), 'recepcion')`)), 'ni crear permisos directo');
ok((await back.sql(`select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private') and p.prosrc ~* '\\mdelete\\M|\\mdrop\\M|\\mtruncate\\M'`))[0].n === 0, 'ninguna función de la guía contiene DELETE, DROP ni TRUNCATE');
ok((await back.sql(`select count(*)::int as n from private.checkin_fotos where activa = false`))[0].n === 0 && (await cuenta()) >= 17, 'y al final todas las fotos siguen en la base');

console.log(`\n${total} comprobaciones, ${fallas} falla(s)`);
await back.cerrar();
process.exit(fallas ? 1 : 0);
