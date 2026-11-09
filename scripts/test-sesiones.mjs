// Ingreso con sesión de dispositivo: la migración no pierde nada y la sesión se porta bien.
//   node scripts/test-sesiones.mjs
// Parte 1: se arma una base como la que está hoy en producción (schema.sql y checkin.sql de antes de esto), con huéspedes ya
//          cargados, se le aplica supabase/sesiones.sql (dos veces) y se comprueba que no se perdió ni cambió nada y que el
//          resultado es idéntico a una base nueva (schema.sql + checkin.sql).
// Parte 2: se prueba, como lo haría la guía (rol "anon"), que la clave se canjea por un código de dispositivo, que ese código sirve
//          según su rol, que se puede cerrar y revocar, y que un celular que quedó abierto no puede cambiar la clave del dueño.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { CLAVE_ADMIN, CLAVE_RECEPCION, SQL_RECEPCION, iniciarBackend } from './backend-local.mjs';

const ruta = (r) => fileURLToPath(new URL(`../${r}`, import.meta.url));
let fallas = 0;
let total = 0;
const ok = (c, m) => { total += 1; console.log(`${c ? 'OK    ' : 'FALLA '}${m}`); if (!c) fallas += 1; };
const TOKEN = /^sd_[0-9a-f]{64}$/;

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
console.log('\n== 1. La migración (base de hoy + supabase/sesiones.sql)');
{
  const db = await baseCon('scripts/fixtures/schema.antes-de-sesiones.sql', 'scripts/fixtures/checkin.antes-de-sesiones.sql');
  await db.query(`insert into private.admin (id, hash) values (1, extensions.crypt($1, extensions.gen_salt('bf')))`, [CLAVE_ADMIN]);
  await db.query(`insert into public.contenido (id, data) values (1, '{"hotel":{"nombre":"Chipre"}}'::jsonb)`);
  await db.query(`update private.checkin_config set activo = true, hash_recepcion = extensions.crypt($1, extensions.gen_salt('bf')) where id = 1`, [CLAVE_RECEPCION]);
  await db.query(`insert into private.checkins (grupo, idioma, datos, consentimiento, habitacion, medio_pago_id) values (1, 'es', $1::jsonb, '{"aceptado":true}'::jsonb, '204', 1), (1, 'es', $2::jsonb, '{"aceptado":true}'::jsonb, null, 6)`, [JSON.stringify(DATOS('Ana', 30111222)), JSON.stringify(DATOS('Beto', 30111333))]);
  const huellaDatos = async () => (await db.query(`select (select md5(string_agg(concat_ws('|', id, creado, datos::text, habitacion, medio_pago_id), ';' order by id)) from private.checkins) as k, (select hash from private.admin) as a, (select hash_recepcion from private.checkin_config where id = 1) as r, (select data::text from public.contenido where id = 1) as c`)).rows[0];
  const antes = await huellaDatos();
  // lo que ve hoy la guía publicada antes de migrar
  const antesAdmin = await llamarEn(db, 'verificar_clave', { p_clave: CLAVE_ADMIN });
  const antesRec = await llamarEn(db, 'recepcion_estado', { p_clave: CLAVE_RECEPCION });

  const sql = fs.readFileSync(ruta('supabase/sesiones.sql'), 'utf8');
  await db.exec(sql);
  ok(true, 'el SQL de la migración se ejecuta sin errores');
  const despues = await huellaDatos();
  ok(JSON.stringify(despues) === JSON.stringify(antes), 'no se perdió ni cambió nada: huéspedes, claves (admin y recepción) ni contenido');
  await db.exec(sql);
  ok(JSON.stringify(await huellaDatos()) === JSON.stringify(antes), 'ejecutarlo de nuevo no cambia nada (se puede repetir sin problema)');
  const adminDespues = await llamarEn(db, 'verificar_clave', { p_clave: CLAVE_ADMIN });
  const recDespues = await llamarEn(db, 'recepcion_estado', { p_clave: CLAVE_RECEPCION });
  ok(adminDespues.ok === true && antesAdmin.ok === true && recDespues.ok === true && recDespues.huespedes.length === antesRec.huespedes.length, 'las pantallas publicadas siguen entrando con las claves de siempre');
  ok((await llamarEn(db, 'verificar_clave', { p_clave: 'mala-clave-1234' })).ok === false, 'y una clave mala sigue rechazada');
  ok((await db.query('select count(*)::int as n from private.sesiones')).rows[0].n === 0, 'la tabla de sesiones arranca vacía');

  await db.exec(fs.readFileSync(ruta('supabase/equipo.sql'), 'utf8')); // el equipo con alias y clave propia va después de esta migración
  const nueva = await baseCon('supabase/schema.sql', 'supabase/checkin.sql');
  const huella = async (d) => Object.fromEntries((await d.query(`select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as fn, md5(regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), '\\s+', ' ', 'g')) as h from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private')`)).rows.map((x) => [x.fn, x.h]));
  const hv = await huella(db); const hn = await huella(nueva);
  const distintas = [...new Set([...Object.keys(hv), ...Object.keys(hn)])].filter((f) => hv[f] !== hn[f]);
  ok(distintas.length === 0, `la base migrada y una base nueva tienen las mismas ${Object.keys(hn).length} funciones` + (distintas.length ? ' · distintas: ' + distintas.join(', ') : ''));
  const permisos = async (d) => (await d.query(`select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by 1`)).rows.map((x) => `${x.proname}:${x.anon}`).join(',');
  ok(await permisos(db) === await permisos(nueva), 'y los mismos permisos: un anónimo solo puede llamar a las funciones previstas');
  const columnas = async (d) => (await d.query(`select column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema = 'private' and table_name = 'sesiones' order by ordinal_position`)).rows.map((x) => Object.values(x).join(':')).join(',');
  ok(await columnas(db) === await columnas(nueva) && (await columnas(db)).length > 0, 'y la tabla de sesiones queda con las mismas columnas');
  await db.close(); await nueva.close();
}

// ---------------------------------------------------------------- Parte 2: las funciones, como las usa la guía
console.log('\n== 2. La clave se canjea por un código de dispositivo');
const back = await iniciarBackend({ puerto: 54398 });
await back.sql(`update private.checkin_config set activo = true where id = 1`);
await back.sql(SQL_RECEPCION, [CLAVE_RECEPCION]);
let ipN = 10;
const ip = () => `198.51.100.${ipN++}`;
const llamar = (fn, args, ipp = ip()) => back.llamar(fn, args, ipp);
const filas = async () => (await back.sql('select count(*)::int as n from private.sesiones'))[0].n;

// -- entrar
const a = await llamar('sesion_entrar', { p_clave: CLAVE_ADMIN, p_etiqueta: 'iPhone de Maxi' });
ok(a.ok === true && a.rol === 'admin' && TOKEN.test(a.token), 'la clave del dueño da un código de dispositivo de rol admin');
const r = await llamar('sesion_entrar', { p_clave: CLAVE_RECEPCION, p_etiqueta: 'x'.repeat(100) });
ok(r.ok === true && r.rol === 'recepcion' && TOKEN.test(r.token), 'la clave de recepción da uno de rol recepción');
const guardado = await back.sql('select token_hash, rol, etiqueta, vence, creado from private.sesiones order by id');
ok(guardado.length === 2 && guardado.every((x) => x.token_hash !== a.token && x.token_hash !== r.token && /^[0-9a-f]{64}$/.test(x.token_hash)), 'en la base queda solo la huella del código, nunca el código');
ok(!JSON.stringify(await back.sql('select * from private.sesiones')).includes(CLAVE_ADMIN) && !JSON.stringify(await back.sql('select * from private.sesiones')).includes(CLAVE_RECEPCION), 'ni las claves');
const dias = (new Date(guardado[0].vence) - new Date(guardado[0].creado)) / 86400000;
ok(Math.round(dias) === 60, 'la sesión dura 60 días');
ok(guardado[0].etiqueta === 'iPhone de Maxi' && guardado[1].etiqueta.length === 60, 'guarda el nombre del dispositivo (con tope de 60 letras)');
let mala = await llamar('sesion_entrar', { p_clave: 'clave-mala-123' });
ok(mala.ok === false && mala.error === 'clave_incorrecta' && !('token' in mala), 'una clave mala no da nada');
mala = await llamar('sesion_entrar', { p_clave: null });
ok(mala.ok === false && mala.error === 'clave_incorrecta', 'ni un valor vacío');
ok((await filas()) === 2, 'y no crea sesiones');
let bloqueado = null;
const ipFija = ip();
for (let i = 0; i < 9; i += 1) bloqueado = await llamar('sesion_entrar', { p_clave: 'mala-' + i }, ipFija);
const igualBuena = await llamar('sesion_entrar', { p_clave: CLAVE_ADMIN }, ipFija);
ok(bloqueado.ok === false && bloqueado.error === 'demasiados_intentos' && igualBuena.error === 'demasiados_intentos', 'adivinar la clave desde la misma IP se frena (aunque después venga la buena)');
const aud = (await llamar('admin_checkin_auditoria', { p_clave: a.token, p_limite: 100 })).registros.filter((x) => x.accion === 'sesion_abierta');
ok(aud.length === 2 && aud.map((x) => x.quien).sort().join() === 'admin,recepcion', 'queda en el historial quién abrió sesión (dueño o recepción)');

// -- qué puede hacer cada código
console.log('\n== 3. Cada código sirve para lo que le toca');
ok((await llamar('verificar_clave', { p_clave: a.token })).ok === true, 'el código del dueño entra a las pantallas del dueño');
ok((await llamar('admin_huespedes', { p_clave: a.token })).ok === true, 'incluida la planilla de huéspedes');
ok((await llamar('recepcion_estado', { p_clave: a.token })).ok === true, 'y también a recepción (el dueño puede ver lo que ve recepción)');
ok((await llamar('recepcion_estado', { p_clave: r.token })).ok === true, 'el código de recepción entra a recepción');
let x = await llamar('admin_huespedes', { p_clave: r.token });
ok(x.ok === false && x.error === 'clave_incorrecta', 'pero el de recepción no entra a las pantallas del dueño');
x = await llamar('verificar_clave', { p_clave: r.token });
ok(x.ok === false, 'ni verifica como dueño');
x = await llamar('guardar_contenido', { p_clave: r.token, p_data: {} });
ok(x.ok === false && x.error === 'clave_incorrecta', 'ni puede guardar el contenido de la guía');
x = await llamar('admin_sesiones', { p_clave: r.token });
ok(x.ok === false && x.error === 'clave_incorrecta', 'ni ver ni cerrar los dispositivos');
x = await llamar('sesion_estado', { p_token: a.token });
ok(x.ok === true && x.rol === 'admin', 'sesion_estado dice el rol del dueño');
x = await llamar('sesion_estado', { p_token: r.token });
ok(x.ok === true && x.rol === 'recepcion', 'y el de recepción');
x = await llamar('sesion_estado', { p_token: 'sd_' + 'a'.repeat(64) });
ok(x.ok === false && x.rol === null, 'un código que no existe no sirve');
x = await llamar('sesion_estado', { p_token: 'cualquier-cosa' });
ok(x.ok === false, 'ni algo que no tiene el formato');
for (let i = 0; i < 20; i += 1) await llamar('sesion_estado', { p_token: 'sd_' + String(i).padStart(64, '0') }, ipFija);
ok((await llamar('sesion_entrar', { p_clave: CLAVE_ADMIN })).ok === true, 'probar códigos falsos no frena a nadie (son imposibles de adivinar)');

// -- vencimiento y renovación
console.log('\n== 4. Vencimiento, renovación y cierre');
await back.sql(`update private.sesiones set vence = now() - interval '1 minute' where token_hash = encode(extensions.digest($1, 'sha256'), 'hex')`, [r.token]);
x = await llamar('recepcion_estado', { p_clave: r.token });
ok(x.ok === false && x.error === 'clave_incorrecta', 'un código vencido no sirve');
const b = await llamar('sesion_entrar', { p_clave: CLAVE_ADMIN });
await back.sql(`update private.sesiones set ultimo_uso = now() - interval '3 days', vence = now() + interval '5 days' where token_hash = encode(extensions.digest($1, 'sha256'), 'hex')`, [b.token]);
await llamar('verificar_clave', { p_clave: b.token });
const renovada = (await back.sql(`select (vence > now() + interval '59 days') as ok from private.sesiones where token_hash = encode(extensions.digest($1, 'sha256'), 'hex')`, [b.token]))[0].ok;
ok(renovada === true, 'cada vez que se usa después de un día se renueva por 60 días más');
const antesFilas = await filas();
x = await llamar('sesion_cerrar', { p_token: b.token });
ok(x.ok === true && (await llamar('verificar_clave', { p_clave: b.token })).ok === false, 'cerrar la sesión de este dispositivo la deja sin efecto');
ok((await filas()) === antesFilas && (await back.sql(`select revocada_en from private.sesiones where token_hash = encode(extensions.digest($1, 'sha256'), 'hex')`, [b.token]))[0].revocada_en !== null, 'pero no se borra: queda marcada como cerrada');
ok((await llamar('sesion_cerrar', { p_token: 'basura' })).ok === true, 'cerrar con algo inválido no rompe nada');

// -- ver y cerrar dispositivos
console.log('\n== 5. El dueño ve y cierra los dispositivos');
const c = await llamar('sesion_entrar', { p_clave: CLAVE_ADMIN, p_etiqueta: 'Compu del codueño' });
const d = await llamar('sesion_entrar', { p_clave: CLAVE_RECEPCION, p_etiqueta: 'Celu de recepción' });
let lista = await llamar('admin_sesiones', { p_clave: a.token });
ok(lista.ok === true && lista.sesiones.every((s) => !s.etiqueta?.includes('sd_')) && lista.sesiones.filter((s) => s.actual).length === 1 && lista.sesiones.find((s) => s.actual).etiqueta === 'iPhone de Maxi', 'la lista marca cuál es "este dispositivo"');
ok(!JSON.stringify(lista).includes('token'), 'y no muestra códigos ni huellas');
const idCelu = lista.sesiones.find((s) => s.etiqueta === 'Celu de recepción').id;
x = await llamar('admin_sesion_cerrar', { p_clave: a.token, p_id: idCelu });
ok(x.ok === true && (await llamar('recepcion_estado', { p_clave: d.token })).ok === false && (await llamar('recepcion_estado', { p_clave: r.token })).ok === false, 'el dueño cierra un dispositivo puntual (el celular de recepción queda afuera)');
ok((await llamar('verificar_clave', { p_clave: c.token })).ok === true, 'y los demás siguen adentro');
x = await llamar('admin_sesion_cerrar', { p_clave: a.token });
ok(x.ok === true && (await llamar('verificar_clave', { p_clave: c.token })).ok === false, '"Cerrar en los demás dispositivos" los cierra a todos');
ok((await llamar('verificar_clave', { p_clave: a.token })).ok === true, 'pero el dispositivo del dueño se queda adentro');
lista = await llamar('admin_sesiones', { p_clave: a.token });
ok(lista.sesiones.length === 1 && lista.sesiones[0].actual === true, 'y la lista queda con ese solo dispositivo');
ok((await filas()) >= 6, 'todo sigue guardado en la base (se marcan como cerradas, no se borran)');

// -- cambiar claves
console.log('\n== 6. Un celular abierto no puede cambiar la clave del dueño');
x = await llamar('cambiar_clave', { p_actual: a.token, p_nueva: 'una-clave-nueva-12345' });
ok(x.ok === false && x.error === 'clave_incorrecta', 'cambiar la clave del dueño pide la clave de verdad: el código del dispositivo no alcanza');
ok((await llamar('verificar_clave', { p_clave: CLAVE_ADMIN })).ok === true, 'y la clave no cambió');
const e = await llamar('sesion_entrar', { p_clave: CLAVE_ADMIN, p_etiqueta: 'otro' });
const rec2 = await llamar('sesion_entrar', { p_clave: CLAVE_RECEPCION });
x = await llamar('cambiar_clave', { p_actual: CLAVE_ADMIN, p_nueva: 'una-clave-nueva-12345' });
ok(x.ok === true, 'con la clave de verdad sí se puede cambiar');
ok((await llamar('verificar_clave', { p_clave: a.token })).ok === false && (await llamar('verificar_clave', { p_clave: e.token })).ok === false, 'y cierra las sesiones de todos los dispositivos del dueño');
ok((await llamar('recepcion_estado', { p_clave: rec2.token })).ok === true, 'sin tocar las de recepción');
ok((await llamar('sesion_entrar', { p_clave: 'una-clave-nueva-12345' })).rol === 'admin' && (await llamar('sesion_entrar', { p_clave: CLAVE_ADMIN })).ok === false, 'la clave nueva entra y la vieja ya no');
x = await llamar('cambiar_clave', { p_actual: 'una-clave-nueva-12345', p_nueva: CLAVE_ADMIN });
ok(x.ok === true, '(se vuelve a la clave de las pruebas)');
const f = await llamar('sesion_entrar', { p_clave: CLAVE_ADMIN });
x = await llamar('admin_checkin_clave_recepcion', { p_clave: f.token, p_nueva: 'recepcion-nueva-123' });
ok(x.ok === false && x.error === 'usar_equipo', 'la clave de recepción ya no se cambia por la función vieja: ahora es una por persona (ver test-equipo)');
ok((await llamar('recepcion_estado', { p_clave: rec2.token })).ok === true && (await llamar('recepcion_estado', { p_clave: f.token })).ok === true, 'y no se cerró ninguna sesión');
const id = (await back.sql(`select id from private.usuarios where alias = 'Recepción'`))[0].id;
x = await llamar('admin_equipo_guardar', { p_clave: f.token, p_id: id, p_alias: null, p_rol: null, p_clave_usuario: 'recepcion-nueva-123', p_activo: null });
ok(x.ok === true, 'con el código del dueño sí se puede cambiar la clave de esa persona');
ok((await llamar('recepcion_estado', { p_clave: rec2.token })).ok === false, 'y eso cierra sus sesiones');
ok((await llamar('recepcion_estado', { p_clave: f.token })).ok === true, 'pero no la del dueño');
ok((await llamar('sesion_entrar', { p_clave: 'recepcion-nueva-123' })).rol === 'recepcion', 'la clave nueva entra');
await llamar('admin_equipo_guardar', { p_clave: f.token, p_id: id, p_alias: null, p_rol: null, p_clave_usuario: CLAVE_RECEPCION, p_activo: null });

// -- seguridad
console.log('\n== 7. Seguridad');
const intento = async (sql) => { try { await back.exec(`begin; set local role anon; ${sql}; rollback;`); return ''; } catch (err) { await back.exec('rollback').catch(() => {}); return String(err.message); } };
ok(/permission denied/.test(await intento('select * from private.sesiones')), 'un anónimo no puede leer la tabla de sesiones');
ok(/permission denied/.test(await intento(`insert into private.sesiones (token_hash, rol, vence) values ('${'0'.repeat(64)}', 'admin', now() + interval '1 day')`)), 'ni crear una sesión directo');
ok(/permission denied/.test(await intento(`update private.sesiones set revocada_en = null`)), 'ni reabrir una cerrada');
ok(/permission denied/.test(await intento(`select private.sesion_activa('sd_${'0'.repeat(64)}', array['admin'])`)), 'ni llamar a la función interna');
ok((await back.sql(`select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private') and p.prosrc ~* '\\mdelete\\M|\\mdrop\\M|\\mtruncate\\M'`))[0].n === 0, 'ninguna función de la guía contiene DELETE, DROP ni TRUNCATE');

console.log(`\n${total} comprobaciones, ${fallas} falla(s)`);
await back.cerrar();
process.exit(fallas ? 1 : 0);
