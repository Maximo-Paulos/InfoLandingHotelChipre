// Fotos del documento que carga el dueño: la migración no pierde nada y las funciones se portan bien.
//   node scripts/test-fotos-admin.mjs
// Parte 1: se arma una base como la que está hoy en producción (schema.sql + el check-in de antes de las fotos del dueño), con
//          huéspedes ya cargados (con y sin foto), se le aplica supabase/fotos_admin.sql (dos veces) y se comprueba que no se
//          perdió ni cambió nada, que las fotos que ya estaban pasaron a la lista nueva y que el resultado es idéntico a una
//          base nueva (schema.sql + checkin.sql).
// Parte 2: se prueba, como lo haría la guía (rol "anon") y con el script de Drive de siempre (apps-script/Codigo.gs, sin
//          cambios), que el dueño vea, agregue, quite y vuelva a poner fotos, y que nada se borre.
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
console.log('\n== 1. La migración (base de hoy + supabase/fotos_admin.sql)');
{
  const db = await baseVacia();
  await db.exec(fs.readFileSync(ruta('scripts/fixtures/checkin.antes-de-fotos-admin.sql'), 'utf8'));
  await db.query(`insert into private.admin (id, hash) values (1, extensions.crypt($1, extensions.gen_salt('bf')))`, [CLAVE_ADMIN]);
  await db.query(`update private.checkin_config set activo = true, hash_recepcion = extensions.crypt($1, extensions.gen_salt('bf')) where id = 1`, [CLAVE_RECEPCION]);
  // huéspedes que "ya ingresaron": con foto, sin foto, con foto y habitación, con medio de pago distinto de Otros
  await db.query(`insert into private.checkins (grupo, idioma, datos, consentimiento, habitacion, foto_id, foto_nombre, editado_en, editado_por, medio_pago_id) values
    (1, 'es', $1::jsonb, '{"aceptado":true}'::jsonb, '204', 'FOTOID0001', '2026-10-09_13-57_Prueba_Ana.jpg', now(), 'recepcion', 1),
    (1, 'pt', $2::jsonb, '{"aceptado":true}'::jsonb, null, null, null, null, null, 6),
    (1, 'en', $3::jsonb, '{"aceptado":true}'::jsonb, '305', 'FOTOID0003', '2026-10-09_14-10_Prueba_Carla.jpg', null, null, 2)`,
  [JSON.stringify(DATOS('Ana', 30111222)), JSON.stringify(DATOS('Beto', 30111333)), JSON.stringify(DATOS('Carla', 30111444))]);
  await db.query(`insert into private.checkin_auditoria (quien, accion, checkin_id, detalle) values ('recepcion', 'editar', 1, '{"campos":["habitacion"]}'::jsonb)`);
  const foto = async () => (await db.query(`select md5(string_agg(concat_ws('|', id, creado, grupo, idioma, datos::text, consentimiento::text, habitacion, foto_id, foto_nombre, editado_en, editado_por, medio_pago_id), ';' order by id)) as h, count(*)::int as n from private.checkins`)).rows[0];
  const antes = await foto();
  const auditAntes = (await db.query('select count(*)::int as n from private.checkin_auditoria')).rows[0].n;
  const medios = (await db.query('select md5(string_agg(concat_ws(\'|\', id, nombre, orden, activo, es_base), \';\' order by id)) as h from private.medios_pago')).rows[0].h;

  // lo que ve hoy la guía publicada (antes de migrar): una sola foto por huésped
  const rowsAntes = (await llamarEn(db, 'admin_huespedes', { p_clave: CLAVE_ADMIN })).huespedes;

  const sql = fs.readFileSync(ruta('supabase/fotos_admin.sql'), 'utf8');
  await db.exec(sql);
  ok(true, 'el SQL de la migración se ejecuta sin errores');
  const despues = await foto();
  ok(despues.n === antes.n && despues.h === antes.h, `no se perdió ni cambió ningún dato de los ${antes.n} huéspedes ya cargados (ni sus fotos de antes)`);
  ok((await db.query(`select md5(string_agg(concat_ws('|', id, nombre, orden, activo, es_base), ';' order by id)) as h from private.medios_pago`)).rows[0].h === medios, 'los medios de pago quedaron igual');
  ok((await db.query('select count(*)::int as n from private.checkin_auditoria')).rows[0].n === auditAntes, 'el historial de cambios quedó igual');
  const fotos = (await db.query('select checkin_id, foto_id, nombre, origen, activa, quitada_en from private.checkin_fotos order by checkin_id')).rows;
  ok(fotos.length === 2 && fotos[0].checkin_id === 1 && fotos[0].foto_id === 'FOTOID0001' && fotos[1].checkin_id === 3 && fotos[1].foto_id === 'FOTOID0003', 'las 2 fotos que ya estaban pasaron a la lista nueva (la del huésped sin foto no inventa nada)');
  ok(fotos.every((f) => f.origen === 'huesped' && f.activa === true && f.quitada_en === null), 'quedan activas y marcadas como cargadas por el huésped');
  ok(fotos[0].nombre === '2026-10-09_13-57_Prueba_Ana.jpg', 'con su nombre de archivo');

  await db.exec(sql);
  ok((await db.query('select count(*)::int as n from private.checkin_fotos')).rows[0].n === 2 && (await foto()).h === antes.h, 'ejecutarlo de nuevo no duplica ni cambia nada (se puede repetir sin problema)');
  // si el dueño ya quitó una foto, volver a correr el SQL no la resucita
  await db.query(`update private.checkin_fotos set activa = false, quitada_en = now(), quitada_por = 'admin' where checkin_id = 1`);
  await db.exec(sql);
  const tras = (await db.query('select checkin_id, activa from private.checkin_fotos order by checkin_id')).rows;
  ok(tras.length === 2 && tras[0].activa === false && tras[1].activa === true, 'y si el dueño ya había quitado una foto, correrlo otra vez no la vuelve a poner');
  await db.query(`update private.checkin_fotos set activa = true, quitada_en = null, quitada_por = null where checkin_id = 1`);

  // la guía publicada (que lee foto_id y foto_nombre) sigue viendo lo mismo, y la nueva suma la lista de fotos
  const rows = (await llamarEn(db, 'admin_huespedes', { p_clave: CLAVE_ADMIN })).huespedes;
  const igual = rowsAntes.every((a) => { const b = rows.find((x) => x.id === a.id); return b && b.foto_id === a.foto_id && b.foto_nombre === a.foto_nombre && b.habitacion === a.habitacion && b.medio_pago === a.medio_pago; });
  ok(rows.length === 3 && igual, 'admin_huespedes devuelve lo mismo que antes (foto_id, foto_nombre, habitación, medio de pago) para la guía publicada');
  ok(rows.every((r) => Array.isArray(r.fotos)) && rows.find((r) => r.id === 2).fotos.length === 0 && rows.find((r) => r.id === 1).fotos.length === 1, 'y trae la lista de fotos de cada uno (vacía para quien no tiene)');
  const est = await llamarEn(db, 'recepcion_estado', { p_clave: CLAVE_RECEPCION });
  const e1 = est.huespedes.find((h) => h.id === 1);
  ok(est.ok === true && est.huespedes.length === 3 && e1.foto_id === 'FOTOID0001' && e1.fotos.length === 1 && est.medios_pago.length === 6, 'recepcion_estado también sigue igual y suma las fotos');

  // una base nueva (schema + checkin completo) tiene exactamente las mismas funciones
  const nueva = await baseVacia();
  await nueva.exec(fs.readFileSync(ruta('supabase/checkin.sql'), 'utf8'));
  const huella = async (d) => Object.fromEntries((await d.query(`select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as fn, md5(regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), '\\s+', ' ', 'g')) as h from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private')`)).rows.map((x) => [x.fn, x.h]));
  const hv = await huella(db); const hn = await huella(nueva);
  const distintas = [...new Set([...Object.keys(hv), ...Object.keys(hn)])].filter((f) => hv[f] !== hn[f]);
  ok(distintas.length === 0, `la base migrada y una base nueva tienen las mismas ${Object.keys(hn).length} funciones` + (distintas.length ? ' · distintas: ' + distintas.join(', ') : ''));
  const permisos = async (d) => (await d.query(`select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by 1`)).rows.map((x) => `${x.proname}:${x.anon}`).join(',');
  ok(await permisos(db) === await permisos(nueva), 'y los mismos permisos: un anónimo solo puede llamar a las funciones previstas');
  const columnas = async (d) => (await d.query(`select table_name, column_name, data_type, is_nullable from information_schema.columns where table_schema = 'private' and table_name in ('checkin_fotos','foto_permisos') order by 1, ordinal_position`)).rows.map((x) => Object.values(x).join(':')).join(',');
  ok(await columnas(db) === await columnas(nueva), 'y las dos tablas nuevas quedan con las mismas columnas');
  await db.close(); await nueva.close();
}

// ---------------------------------------------------------------- Parte 2: las funciones, como las usa la guía
console.log('\n== 2. El dueño ve, agrega, quita y vuelve a poner fotos');
const back = await iniciarBackend({ puerto: 54396 });
const SCRIPT = `${back.url}/apps-script/exec`;
await back.sql(`update private.checkin_config set activo = true, codigo_seg = 300, usos_max = 20, foto_modo = 'opcional', foto_url = $2, hash_recepcion = extensions.crypt($1, extensions.gen_salt('bf')) where id = 1`, [CLAVE_RECEPCION, SCRIPT]);
const recepcion = (fn, args) => back.llamar(fn, { p_clave: CLAVE_RECEPCION, ...args }, '198.51.100.50');
const admin = (fn, args) => back.llamar(fn, { p_clave: CLAVE_ADMIN, ...args }, '198.51.100.60');
// un "JPEG" mínimo (lo que revisa el script es la firma del archivo y el tamaño)
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
const cuenta = async (tabla = 'private.checkin_fotos') => (await back.sql(`select count(*)::int as n from ${tabla}`))[0].n;
const filaDe = async (llamada, id) => (await llamada()).huespedes.find((h) => h.id === id);
const planilla = () => admin('admin_huespedes', {});
const hist = async (accion, id) => (await admin('admin_checkin_auditoria', { p_limite: 200 })).registros.filter((x) => x.accion === accion && x.checkin_id === id);

// -- el huésped que manda su foto al hacer el check-in (como hasta ahora)
const idAna = await nuevoHuesped('Ana', 30111222, true);
let f = await admin('admin_fotos', { p_id: idAna });
ok(f.ok === true && f.drive === true && f.fotos.length === 1 && f.fotos[0].origen === 'huesped' && f.fotos[0].activa === true, 'la foto que mandó el huésped al hacer el check-in aparece en su lista (origen "huésped")');
const legado = (await back.sql('select foto_id, foto_nombre from private.checkins where id = $1', [idAna]))[0];
ok(legado.foto_id === f.fotos[0].foto_id && legado.foto_nombre === f.fotos[0].nombre, 'y el check-in sigue guardando su id y su nombre como siempre');
ok((await cuenta()) === 1, 'una sola fila (no se duplica)');

// -- el caso del dueño: un huésped sin foto, y la foto que sacó el recepcionista
const idBeto = await nuevoHuesped('Beto', 30111333, false);
f = await admin('admin_fotos', { p_id: idBeto });
ok(f.ok === true && f.fotos.length === 0, 'un huésped que no mandó foto tiene la lista vacía');
let fila = await filaDe(planilla, idBeto);
ok(fila.foto_id === null && JSON.stringify(fila.fotos) === '[]', 'y en la planilla figura sin foto');

let p = await admin('admin_foto_permiso', { p_id: idBeto });
ok(p.ok === true && /^[0-9a-f]{32}\.\d{9,12}\.[0-9a-f]{64}$/.test(p.ticket) && p.url === SCRIPT && p.vence_seg === 600, 'el dueño pide permiso para subir una foto a ese huésped (firmado, de 10 minutos)');
const s1 = await subir(p.ticket, 'Beto', 'Prueba');
ok(s1.ok === true && /_Prueba_Beto\.jpg$/.test(s1.nombre), 'el script de Drive que ya está publicado la guarda (el script no cambió)');
f = await admin('admin_fotos', { p_id: idBeto });
ok(f.fotos.length === 1 && f.fotos[0].origen === 'admin' && f.fotos[0].activa === true && f.fotos[0].nombre === s1.nombre, 'queda en la lista del huésped, marcada como cargada por el dueño');
ok((await drive()).filter((a) => a.mime === 'image/jpeg').length === 2, 'y el archivo está en la carpeta de Drive');
fila = await filaDe(planilla, idBeto);
ok(fila.foto_id === f.fotos[0].foto_id && fila.foto_nombre === f.fotos[0].nombre && fila.fotos.length === 1, 'la planilla del dueño la muestra');
let filaRec = await filaDe(() => recepcion('recepcion_estado', {}), idBeto);
ok(filaRec.foto_id === f.fotos[0].foto_id && filaRec.fotos.length === 1, 'y la de recepción también (solo para ver)');
ok((await hist('foto_agregada', idBeto)).length === 1 && (await hist('foto_agregada', idBeto))[0].quien === 'admin', 'queda en el historial de cambios que el dueño agregó una foto');
ok(!JSON.stringify((await admin('admin_checkin_auditoria', { p_limite: 200 })).registros).includes('Prueba_Beto'), 'el historial no guarda el nombre del archivo (que lleva el nombre del huésped)');

// -- agregar otra foto al mismo huésped (por si la primera no se ve)
p = await admin('admin_foto_permiso', { p_id: idBeto });
const s2 = await subir(p.ticket, 'Beto', 'Prueba');
f = await admin('admin_fotos', { p_id: idBeto });
ok(s2.ok === true && f.fotos.length === 2 && f.fotos[1].origen === 'admin' && f.fotos[0].id < f.fotos[1].id, 'el dueño puede agregar otra foto al mismo huésped (queda después de la primera)');
ok(s2.nombre !== s1.nombre, 'con otro nombre de archivo (no pisa la anterior)');

// -- quitar la que no se ve: se oculta, no se borra
const primera = f.fotos[0];
const driveAntes = (await drive()).length;
const filasAntes = await cuenta();
let r = await admin('admin_foto_quitar', { p_foto: primera.id });
ok(r.ok === true && r.fotos.length === 2 && r.fotos[0].activa === false && r.fotos[0].quitada_en && r.fotos[1].activa === true, 'el dueño quita la foto que no se ve: queda marcada como quitada');
fila = await filaDe(planilla, idBeto);
ok(fila.fotos.length === 1 && fila.fotos[0].id === f.fotos[1].id && fila.foto_id === f.fotos[1].foto_id, 'la planilla muestra solo la otra (y "foto_id" pasa a ser esa)');
filaRec = await filaDe(() => recepcion('recepcion_estado', {}), idBeto);
ok(filaRec.fotos.length === 1 && filaRec.foto_id === f.fotos[1].foto_id, 'recepción tampoco ve la quitada');
ok((await drive()).length === driveAntes && (await cuenta()) === filasAntes, 'NO se borró nada: el archivo sigue en Drive y la fila sigue en la base');
const quitada = (await back.sql('select activa, quitada_por from private.checkin_fotos where id = $1', [primera.id]))[0];
ok(quitada.activa === false && quitada.quitada_por === 'admin', 'se anota que la quitó el administrador');
ok((await hist('foto_quitada', idBeto)).length === 1, 'y queda en el historial de cambios');
await admin('admin_foto_quitar', { p_foto: primera.id });
ok((await hist('foto_quitada', idBeto)).length === 1, 'quitar dos veces la misma no duplica el historial');

// -- volver a poner
r = await admin('admin_foto_quitar', { p_foto: primera.id, p_quitar: false });
ok(r.ok === true && r.fotos.every((x) => x.activa === true) && r.fotos[0].quitada_en === null, 'el dueño puede volver a poner la foto quitada');
fila = await filaDe(planilla, idBeto);
ok(fila.fotos.length === 2 && fila.foto_id === f.fotos[0].foto_id, 'y la planilla vuelve a mostrar las dos');
ok((await hist('foto_repuesta', idBeto)).length === 1, 'queda en el historial');

// -- quitar todas: el huésped queda "sin foto" en la planilla, pero todo sigue guardado
await admin('admin_foto_quitar', { p_foto: f.fotos[0].id });
await admin('admin_foto_quitar', { p_foto: f.fotos[1].id });
fila = await filaDe(planilla, idBeto);
ok(fila.foto_id === null && fila.foto_nombre === null && fila.fotos.length === 0, 'si quita todas, la planilla muestra al huésped sin foto');
f = await admin('admin_fotos', { p_id: idBeto });
ok(f.fotos.length === 2 && f.fotos.every((x) => x.activa === false), 'pero el dueño las sigue viendo en "Quitadas" y puede volver a ponerlas');
await admin('admin_foto_quitar', { p_foto: f.fotos[0].id, p_quitar: false });
await admin('admin_foto_quitar', { p_foto: f.fotos[1].id, p_quitar: false });

// -- ids que no existen y claves equivocadas
r = await admin('admin_foto_quitar', { p_foto: 999999 });
ok(r.ok === false && r.error === 'no_existe', 'quitar una foto que no existe da error claro');
r = await admin('admin_fotos', { p_id: 999999 });
ok(r.ok === false && r.error === 'no_existe', 'pedir las fotos de un huésped que no existe, también');
r = await admin('admin_foto_permiso', { p_id: 999999 });
ok(r.ok === false && r.error === 'no_existe', 'y pedir permiso para subir a un huésped que no existe');
let todasMalas = true;
for (const [fn, args, ip1, ip2] of [['admin_fotos', { p_id: idBeto }, '198.51.100.91', '198.51.100.92'], ['admin_foto_permiso', { p_id: idBeto }, '198.51.100.93', '198.51.100.94'], ['admin_foto_quitar', { p_foto: primera.id }, '198.51.100.95', '198.51.100.96']]) {
  const a = await back.llamar(fn, { p_clave: 'clave-equivocada', ...args }, ip1);
  const b = await back.llamar(fn, { p_clave: CLAVE_RECEPCION, ...args }, ip2);
  if (!(a.ok === false && a.error === 'clave_incorrecta' && b.ok === false && b.error === 'clave_incorrecta')) todasMalas = false;
}
ok(todasMalas, 'sin la clave de admin no se puede ver, pedir permiso ni quitar (y la clave de recepción tampoco sirve)');
ok((await cuenta('private.foto_permisos')) >= 2 && (await back.sql(`select count(*)::int as n from private.checkin_fotos where quitada_por is not null`))[0].n === 0, 'y esos intentos no tocaron nada');
let bloqueado = null;
for (let i = 0; i < 9; i += 1) bloqueado = await back.llamar('admin_foto_permiso', { p_clave: 'mala-' + i, p_id: idBeto }, '198.51.100.97');
ok(bloqueado.ok === false && bloqueado.error === 'demasiados_intentos', 'adivinar la clave desde la misma IP se frena (como el resto del admin)');

// -- permisos que vencen o se gastan
const idDario = await nuevoHuesped('Dario', 30111555, false);
p = await admin('admin_foto_permiso', { p_id: idDario });
await back.sql(`update private.foto_permisos set vence = now() - interval '1 minute' where ref = $1`, [p.ticket.split('.')[0]]);
const tarde = await subir(p.ticket, 'Dario', 'Prueba');
ok(tarde.ok === false && tarde.error === 'registro' && (await admin('admin_fotos', { p_id: idDario })).fotos.length === 0, 'un permiso vencido en la base no registra la foto');

p = await admin('admin_foto_permiso', { p_id: idDario });
const ref2 = p.ticket.split('.')[0];
const secreto = (await back.sql('select foto_secreto from private.checkin_config where id = 1'))[0].foto_secreto;
const reg = (ref, i, extra = {}) => back.llamar('checkin_foto_registrar', { p_secreto: secreto, p_ref: ref, p_foto_id: `DIRECTO${String(i).padStart(4, '0')}ABCD`, p_nombre: `directo${i}.jpg`, ...extra }, '198.51.100.77');
const tres = [await reg(ref2, 1), await reg(ref2, 2), await reg(ref2, 3)];
ok(tres.every((x) => x.ok === true) && (await admin('admin_fotos', { p_id: idDario })).fotos.length === 3, 'un permiso sirve para 3 fotos');
r = await reg(ref2, 4);
ok(r.ok === false && r.error === 'sesion_invalida' && (await admin('admin_fotos', { p_id: idDario })).fotos.length === 3, 'a la cuarta lo rechaza');
r = await reg('a'.repeat(32), 5);
ok(r.ok === false && r.error === 'sesion_invalida', 'una referencia que no es de ningún permiso ni de ninguna sesión se rechaza');
r = await back.llamar('checkin_foto_registrar', { p_secreto: 'secreto-malo', p_ref: ref2, p_foto_id: 'DIRECTO0009ABCD', p_nombre: 'x.jpg' }, '198.51.100.78');
ok(r.ok === false && r.error === 'no_autorizado', 'sin la clave que comparte el script con la base no se puede registrar nada');
p = await admin('admin_foto_permiso', { p_id: idDario });
const ref3 = p.ticket.split('.')[0];
r = await reg(ref3, 1);
ok(r.ok === true && (await back.sql(`select count(*)::int as n from private.checkin_fotos where checkin_id = $1 and foto_id = 'DIRECTO0001ABCD'`, [idDario]))[0].n === 1, 'si el script avisa dos veces la misma foto del mismo huésped, queda una sola');
const otro = await reg(ref3, 6, { p_foto_id: 'abc' });
ok(otro.ok === false && otro.error === 'datos_invalidos', 'un id de archivo con formato raro se rechaza');
r = await back.llamar('checkin_foto_registrar', { p_secreto: secreto, p_ref: ref3, p_foto_id: 'DIRECTO0007ABCD', p_nombre: '' }, '198.51.100.77');
ok(r.ok === false && r.error === 'datos_invalidos', 'y un nombre vacío también');

// -- tope de fotos por huésped
const idCarla = await nuevoHuesped('Carla', 30111444, false);
await back.sql(`insert into private.checkin_fotos (checkin_id, foto_id, nombre, origen) select $1, 'LIMITE' || lpad(g::text, 6, '0'), 'f' || g || '.jpg', 'admin' from generate_series(1, 10) g`, [idCarla]);
r = await admin('admin_foto_permiso', { p_id: idCarla });
ok(r.ok === false && r.error === 'limite_fotos', 'con 10 fotos activas no deja agregar más');
const fc = await admin('admin_fotos', { p_id: idCarla });
await admin('admin_foto_quitar', { p_foto: fc.fotos[0].id });
r = await admin('admin_foto_permiso', { p_id: idCarla });
ok(r.ok === true, 'al quitar una vuelve a dejar agregar');
await back.sql(`insert into private.checkin_fotos (checkin_id, foto_id, nombre, origen) values ($1, 'LIMITE999999', 'extra.jpg', 'admin')`, [idCarla]);
r = await admin('admin_foto_quitar', { p_foto: fc.fotos[0].id, p_quitar: false });
ok(r.ok === false && r.error === 'limite_fotos', 'y no deja volver a poner una quitada si se pasaría del tope');

// -- sin Drive conectado / check-in que no pide foto
await back.sql(`update private.checkin_config set foto_url = null where id = 1`);
r = await admin('admin_foto_permiso', { p_id: idBeto });
ok(r.ok === false && r.error === 'sin_drive', 'sin Drive conectado no se puede subir (avisa claro)');
ok((await admin('admin_fotos', { p_id: idBeto })).drive === false, 'y la lista avisa que no hay Drive');
await back.sql(`update private.checkin_config set foto_url = $1, foto_modo = 'no' where id = 1`, [SCRIPT]);
r = await admin('admin_foto_permiso', { p_id: idBeto });
ok(r.ok === true, 'aunque el check-in no le pida foto al huésped, el dueño puede subirla a mano');
await back.sql(`update private.checkin_config set foto_modo = 'obligatoria' where id = 1`);
{
  const est = await recepcion('recepcion_estado', {});
  const ses = await back.llamar('checkin_canjear', { p_codigo: String(est.codigo.valor) }, '198.51.100.71');
  const env = await back.llamar('checkin_enviar', { p_token: ses.token, p_idioma: 'es', p_acepta: true, p_datos: DATOS('Eva', 30111666) }, '198.51.100.71');
  ok(env.ok === false && env.error === 'foto_requerida', 'si la foto es obligatoria, el huésped sigue sin poder enviar sin foto (no cambió)');
}
await back.sql(`update private.checkin_config set foto_modo = 'opcional' where id = 1`);

// -- el huésped que sube la foto y la cambia: sigue valiendo la última
{
  const est = await recepcion('recepcion_estado', {});
  const ses = await back.llamar('checkin_canjear', { p_codigo: String(est.codigo.valor) }, '198.51.100.72');
  const a = await subir(ses.foto.ticket, 'Fede', 'Prueba');
  const b = await subir(ses.foto.ticket, 'Fede', 'Prueba');
  const sesion = await back.llamar('checkin_sesion', { p_token: ses.token }, '198.51.100.72');
  ok(a.ok && b.ok && sesion.foto.listo === true, 'el huésped puede subir su foto y cambiarla antes de enviar (como hasta ahora)');
  await back.llamar('checkin_enviar', { p_token: ses.token, p_idioma: 'es', p_acepta: true, p_datos: DATOS('Fede', 30111777) }, '198.51.100.72');
  const idFede = (await back.sql('select max(id)::int as id from private.checkins'))[0].id;
  const ff = await admin('admin_fotos', { p_id: idFede });
  ok(ff.fotos.length === 1 && ff.fotos[0].nombre === b.nombre && ff.fotos[0].origen === 'huesped', 'al enviar, queda en su lista la última foto que subió');
}

// -- seguridad
const intento = async (sql) => { try { await back.exec(`begin; set local role anon; ${sql}; rollback;`); return ''; } catch (e) { await back.exec('rollback').catch(() => {}); return String(e.message); } };
ok(/permission denied/.test(await intento('select * from private.checkin_fotos')), 'un anónimo no puede leer la lista de fotos directo');
ok(/permission denied/.test(await intento('select * from private.foto_permisos')), 'ni los permisos de subida');
ok(/permission denied/.test(await intento(`insert into private.checkin_fotos (checkin_id, foto_id) values (1, 'x')`)), 'ni agregar fotos directo');
ok(/permission denied/.test(await intento(`update private.checkin_fotos set activa = false`)), 'ni quitarlas directo');
ok(/permission denied/.test(await intento('select private.fotos_lista(1)')), 'ni llamar a las funciones internas');
ok((await back.sql(`select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private') and p.prosrc ~* '\\mdelete\\M|\\mdrop\\M|\\mtruncate\\M'`))[0].n === 0, 'ninguna función de la guía contiene DELETE, DROP ni TRUNCATE');
ok((await back.sql(`select count(*)::int as n from private.checkin_fotos where activa = false`))[0].n >= 1 && (await cuenta()) >= 17, 'y al final todas las fotos siguen en la base, también las quitadas');

console.log(`\n${total} comprobaciones, ${fallas} falla(s)`);
await back.cerrar();
process.exit(fallas ? 1 : 0);
