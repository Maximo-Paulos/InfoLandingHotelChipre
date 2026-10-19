// Medio de pago de cada huésped: la migración no pierde nada y las funciones se portan bien.
//   node scripts/test-medios-pago.mjs
// Parte 1: se arma una base como la que está hoy en producción (schema.sql + el check-in de antes), con huéspedes ya cargados,
//          se le aplica supabase/medios_pago.sql (dos veces) y se comprueba que no se perdió ni cambió nada, que los
//          huéspedes ya cargados quedaron en "Otros" y que el resultado es idéntico a una base nueva (schema.sql + checkin.sql).
// Parte 2: se prueba, como lo haría la guía (rol "anon"), elegir el medio de pago, quitar, agregar y volver a poner medios.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { CLAVE_ADMIN, CLAVE_RECEPCION, iniciarBackend } from './backend-local.mjs';

const ruta = (r) => fileURLToPath(new URL(`../${r}`, import.meta.url));
let fallas = 0;
let total = 0;
const ok = (c, m) => { total += 1; console.log(`${c ? 'OK    ' : 'FALLA '}${m}`); if (!c) fallas += 1; };

// ---------------------------------------------------------------- Parte 1: la migración
async function baseVieja() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema extensions; create extension pgcrypto with schema extensions;
    grant usage on schema extensions to anon, authenticated;
  `);
  await db.exec(fs.readFileSync(ruta('supabase/schema.sql'), 'utf8'));
  await db.exec(fs.readFileSync(ruta('scripts/fixtures/checkin.antes-de-medios-pago.sql'), 'utf8'));
  await db.query(`insert into private.admin (id, hash) values (1, extensions.crypt($1, extensions.gen_salt('bf')))`, [CLAVE_ADMIN]);
  return db;
}
const llamarEn = (db, nombre, args = {}) => db.transaction(async (tx) => {
  const claves = Object.keys(args);
  await tx.query(`select set_config('request.headers', $1, true)`, [JSON.stringify({ 'cf-connecting-ip': '203.0.113.9' })]);
  await tx.exec('set local role anon');
  const r = await tx.query(`select public.${nombre}(${claves.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`, claves.map((k) => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k])));
  return r.rows[0].r;
});
const DATOS = (n, doc) => ({ nombre: n, apellido: 'Prueba', email: `${n.toLowerCase()}@correo.com`, telefono: '+541155551234', nacionalidad: 'Argentina', localidad: 'Capital Federal', domicilio: 'Av. Corrientes 1234 5° B', doc_tipo: 'DNI', doc_numero: String(doc) });

console.log('\n== 1. La migración (base de hoy + supabase/medios_pago.sql)');
{
  const db = await baseVieja();
  await db.query(`update private.checkin_config set activo = true, hash_recepcion = extensions.crypt($1, extensions.gen_salt('bf')) where id = 1`, [CLAVE_RECEPCION]);
  // huéspedes que "ya ingresaron", con habitación, edición y foto
  await db.query(`insert into private.checkins (grupo, idioma, datos, consentimiento, habitacion, foto_id, foto_nombre, editado_en, editado_por) values
    (1, 'es', $1::jsonb, '{"aceptado":true}'::jsonb, '204', 'FOTOID0001', '2026-10-09_13-57_Prueba_Ana.jpg', now(), 'recepcion'),
    (1, 'pt', $2::jsonb, '{"aceptado":true}'::jsonb, null, null, null, null, null)`, [JSON.stringify(DATOS('Ana', 30111222)), JSON.stringify(DATOS('Beto', 30111333))]);
  await db.query(`insert into private.checkin_auditoria (quien, accion, checkin_id, detalle) values ('recepcion', 'editar', 1, '{"campos":["habitacion"]}'::jsonb)`);
  const foto = async () => (await db.query(`select md5(string_agg(concat_ws('|', id, creado, grupo, idioma, datos::text, consentimiento::text, habitacion, foto_id, foto_nombre, editado_en, editado_por), ';' order by id)) as h, count(*)::int as n from private.checkins`)).rows[0];
  const antes = await foto();
  const auditAntes = (await db.query('select count(*)::int as n from private.checkin_auditoria')).rows[0].n;

  // la guía de hoy (sin medio de pago) sigue funcionando contra la base ya migrada, y al revés: antes de migrar anda
  const sql = fs.readFileSync(ruta('supabase/medios_pago.sql'), 'utf8');
  await db.exec(sql);
  ok(true, 'el SQL de la migración se ejecuta sin errores');
  const despues = await foto();
  ok(despues.n === antes.n && despues.h === antes.h, `no se perdió ni cambió ningún dato de los ${antes.n} huéspedes ya cargados`);
  const medios = (await db.query('select id, nombre, activo, es_base from private.medios_pago order by id')).rows;
  ok(medios.map((m) => m.nombre).join('|') === 'Efectivo|Transferencia|USD efectivo|PayPal|Link de pago|Otros', 'quedan los 6 medios de pago pedidos');
  ok(medios.find((m) => m.es_base)?.nombre === 'Otros' && medios.every((m) => m.activo), '"Otros" es el medio base y todos arrancan activos');
  const mp = (await db.query('select medio_pago_id as id from private.checkins order by id')).rows;
  ok(mp.length === 2 && mp.every((x) => x.id === 6), 'los huéspedes que ya estaban quedan marcados como "Otros" (ninguno vacío)');
  ok((await db.query('select count(*)::int as n from private.checkin_auditoria')).rows[0].n === auditAntes, 'el historial de cambios quedó igual');
  await db.exec(sql);
  const otraVez = await foto();
  ok(otraVez.h === antes.h && (await db.query('select count(*)::int as n from private.medios_pago')).rows[0].n === 6, 'ejecutarlo de nuevo no cambia nada (se puede repetir sin problema)');

  // lo que manda la guía de hoy: sin medio de pago -> queda el que tiene
  const e1 = await llamarEn(db, 'recepcion_editar', { p_clave: CLAVE_RECEPCION, p_id: 2, p_datos: DATOS('Beto', 30111333), p_habitacion: '305' });
  ok(e1.ok === true, 'la guía de hoy (sin medio de pago) puede seguir cargando la habitación');
  ok((await db.query('select habitacion, medio_pago_id from private.checkins where id = 2')).rows[0].medio_pago_id === 6, 'y no le cambia el medio de pago');
  const est = await llamarEn(db, 'recepcion_estado', { p_clave: CLAVE_RECEPCION });
  ok(est.ok === true && est.huespedes.length === 2 && est.medios_pago.length === 6, 'recepcion_estado sigue contestando (con los campos nuevos de más)');

  // una base nueva (schema + checkin completo) tiene exactamente las mismas funciones
  const nueva = new PGlite({ extensions: { pgcrypto } });
  await nueva.exec(`create role anon nologin; create role authenticated nologin; create schema extensions; create extension pgcrypto with schema extensions; grant usage on schema extensions to anon, authenticated;`);
  await nueva.exec(fs.readFileSync(ruta('supabase/schema.sql'), 'utf8'));
  await nueva.exec(fs.readFileSync(ruta('supabase/checkin.sql'), 'utf8'));
  const huella = async (d) => Object.fromEntries((await d.query(`select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as fn, md5(regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), '\\s+', ' ', 'g')) as h from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private')`)).rows.map((x) => [x.fn, x.h]));
  const hv = await huella(db); const hn = await huella(nueva);
  const distintas = [...new Set([...Object.keys(hv), ...Object.keys(hn)])].filter((f) => hv[f] !== hn[f]);
  ok(distintas.length === 0, `la base migrada y una base nueva tienen las mismas ${Object.keys(hn).length} funciones` + (distintas.length ? ' · distintas: ' + distintas.join(', ') : ''));
  const permisos = async (d) => (await d.query(`select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by 1`)).rows.map((x) => `${x.proname}:${x.anon}`).join(',');
  ok(await permisos(db) === await permisos(nueva), 'y los mismos permisos: un anónimo solo puede llamar a las funciones previstas');
  await db.close(); await nueva.close();
}

// ---------------------------------------------------------------- Parte 2: las funciones, como las usa la guía
console.log('\n== 2. Elegir, agregar, quitar y volver a poner medios de pago');
const back = await iniciarBackend({ puerto: 54395 });
await back.sql(`update private.checkin_config set activo = true, codigo_seg = 300, usos_max = 20, hash_recepcion = extensions.crypt($1, extensions.gen_salt('bf')) where id = 1`, [CLAVE_RECEPCION]);
const recepcion = (fn, args) => back.llamar(fn, { p_clave: CLAVE_RECEPCION, ...args }, '198.51.100.50');
const admin = (fn, args) => back.llamar(fn, { p_clave: CLAVE_ADMIN, ...args }, '198.51.100.60');
async function nuevoHuesped(nombre, doc) {
  const est = await recepcion('recepcion_estado', {});
  const ses = await back.llamar('checkin_canjear', { p_codigo: String(est.codigo.valor) }, '198.51.100.70');
  const env = await back.llamar('checkin_enviar', { p_token: ses.token, p_idioma: 'es', p_acepta: true, p_datos: DATOS(nombre, doc) }, '198.51.100.70');
  if (!env.ok) throw new Error('no se pudo cargar el huésped ' + nombre + ' ' + JSON.stringify(env));
  return (await back.sql('select max(id)::int as id from private.checkins'))[0].id;
}
const id1 = await nuevoHuesped('Ana', 30111222);
const id2 = await nuevoHuesped('Beto', 30111333);
const id3 = await nuevoHuesped('Carla', 30111444);
let est = await recepcion('recepcion_estado', {});
ok(est.medios_pago.map((m) => m.nombre).join('|') === 'Efectivo|Transferencia|USD efectivo|PayPal|Link de pago|Otros', 'recepción recibe la lista: Efectivo, Transferencia, USD efectivo, PayPal, Link de pago y Otros (Otros al final)');
ok(est.huespedes.every((h) => h.medio_pago === 'Otros' && h.medio_pago_id === 6), 'un huésped nuevo arranca en "Otros" (nunca vacío)');

const medioDe = async (id) => (await back.sql('select m.nombre from private.checkins k join private.medios_pago m on m.id = k.medio_pago_id where k.id = $1', [id]))[0].nombre;
let r = await recepcion('recepcion_editar', { p_id: id1, p_datos: { ...DATOS('Ana', 30111222), medio_pago: 1 }, p_habitacion: '101' });
ok(r.ok === true && await medioDe(id1) === 'Efectivo', 'recepción elige "Efectivo" junto con la habitación y queda guardado');
r = await recepcion('recepcion_editar', { p_id: id2, p_datos: { ...DATOS('Beto', 30111333), medio_pago: '3' }, p_habitacion: '102' });
ok(r.ok === true && await medioDe(id2) === 'USD efectivo', 'también acepta el id como texto ("3" = USD efectivo)');
r = await recepcion('recepcion_editar', { p_id: id1, p_datos: DATOS('Ana', 30111222), p_habitacion: '101' });
ok(r.ok === true && await medioDe(id1) === 'Efectivo', 'si no se manda medio de pago, queda el que tenía');
for (const [valor, texto] of [[99999, 'un id que no existe'], ['abc', 'un texto'], [-1, 'un número negativo'], ['1 or 1=1', 'un intento de inyección'], [1.5, 'un decimal']]) {
  r = await recepcion('recepcion_editar', { p_id: id1, p_datos: { ...DATOS('Ana', 30111222), medio_pago: valor }, p_habitacion: '101' });
  ok(r.ok === false && r.error === 'datos_invalidos' && JSON.stringify(r.campos) === '["medio_pago"]', `se rechaza ${texto} como medio de pago`);
}
ok(await medioDe(id1) === 'Efectivo', 'y los rechazos no cambiaron nada');
const aud2 = (await back.sql(`select detalle::text as d from private.checkin_auditoria where checkin_id = $1 and accion = 'editar' order by id`, [id1])).map((x) => x.d).join(' ');
ok(/medio_pago/.test(aud2), 'el historial de cambios menciona el campo medio_pago (no el valor)');

// el dueño ve y edita la lista
let lista = await admin('admin_medios_pago', {});
ok(lista.ok === true && lista.medios.length === 6 && lista.medios.find((m) => m.nombre === 'Efectivo').usos === 1, 'el dueño ve los 6 medios con cuántos huéspedes usa cada uno');
const otro = await back.llamar('admin_medios_pago', { p_clave: 'mala' }, '198.51.100.61');
ok(otro.ok === false && otro.error === 'clave_incorrecta', 'sin la clave del dueño no se ve ni se cambia nada');
const base = (l) => l.map((m) => ({ id: m.id, nombre: m.nombre, activo: m.activo }));
// agregar "Tarjeta de crédito" y renombrar PayPal
let nueva = base(lista.medios); nueva.splice(5, 0, { id: null, nombre: '  Tarjeta   de crédito ', activo: true });
nueva.find((m) => m.id === 4).nombre = 'PayPal / MercadoPago';
r = await admin('admin_medios_pago_guardar', { p_lista: nueva });
ok(r.ok === true && r.medios.map((m) => m.nombre).join('|') === 'Efectivo|Transferencia|USD efectivo|PayPal / MercadoPago|Link de pago|Tarjeta de crédito|Otros', 'el dueño agrega uno nuevo (con los espacios prolijos) y renombra otro; "Otros" sigue al final');
const tarjeta = r.medios.find((m) => m.nombre === 'Tarjeta de crédito');
ok(tarjeta.id >= 7 && tarjeta.activo === true && tarjeta.usos === 0, 'el nuevo tiene su propio id y arranca activo');
est = await recepcion('recepcion_estado', {});
ok(est.medios_pago.map((m) => m.nombre).includes('Tarjeta de crédito') && est.medios_pago.map((m) => m.nombre).includes('PayPal / MercadoPago'), 'recepción ve enseguida la lista nueva');
r = await recepcion('recepcion_editar', { p_id: id3, p_datos: { ...DATOS('Carla', 30111444), medio_pago: tarjeta.id }, p_habitacion: '103' });
ok(r.ok === true && await medioDe(id3) === 'Tarjeta de crédito', 'recepción puede elegir el medio de pago nuevo');
// renombrar no toca a los huéspedes: siguen apuntando al mismo medio, que ahora se llama distinto
r = await recepcion('recepcion_editar', { p_id: id1, p_datos: { ...DATOS('Ana', 30111222), medio_pago: 4 }, p_habitacion: '101' });
ok(r.ok === true && await medioDe(id1) === 'PayPal / MercadoPago', 'un huésped con PayPal pasa a mostrar el nombre nuevo sin haber tocado su registro');

// quitar: se oculta del selector, pero NO se borra y los huéspedes que lo tenían lo siguen mostrando
const antes = (await back.sql('select count(*)::int as n from private.checkins'))[0].n;
nueva = base(r.medios ?? (await admin('admin_medios_pago', {})).medios); // lista actual
lista = await admin('admin_medios_pago', {});
nueva = base(lista.medios).map((m) => (m.nombre === 'USD efectivo' ? { ...m, activo: false } : m));
r = await admin('admin_medios_pago_guardar', { p_lista: nueva });
ok(r.ok === true && r.medios.find((m) => m.nombre === 'USD efectivo').activo === false, 'el dueño quita "USD efectivo"');
ok(r.medios.find((m) => m.nombre === 'USD efectivo').usos === 1, 'y la lista del dueño sigue contando el huésped que lo tiene (nada se borró)');
est = await recepcion('recepcion_estado', {});
ok(!est.medios_pago.map((m) => m.nombre).includes('USD efectivo'), 'recepción ya no lo ofrece');
ok(est.huespedes.find((h) => h.id === id2).medio_pago === 'USD efectivo', 'pero el huésped que ya lo tenía lo sigue mostrando como "USD efectivo" (no pasa a vacío ni a "Otros")');
r = await recepcion('recepcion_editar', { p_id: id3, p_datos: { ...DATOS('Carla', 30111444), medio_pago: 3 }, p_habitacion: '103' });
ok(r.ok === false && r.error === 'datos_invalidos', 'a otro huésped ya no se le puede asignar un medio quitado');
r = await recepcion('recepcion_editar', { p_id: id2, p_datos: { ...DATOS('Beto', 30111333), medio_pago: 3, localidad: 'Rosario' }, p_habitacion: '102' });
ok(r.ok === true && await medioDe(id2) === 'USD efectivo', 'pero el que ya lo tenía puede seguir editándose conservando ese medio');
r = await recepcion('recepcion_editar', { p_id: id2, p_datos: { ...DATOS('Beto', 30111333), medio_pago: 2 }, p_habitacion: '102' });
ok(r.ok === true && await medioDe(id2) === 'Transferencia', 'y si se lo cambia a otro, ya no puede volver al quitado');
ok((await back.sql('select count(*)::int as n from private.checkins'))[0].n === antes, 'en ningún momento se borró ni un huésped');
ok((await back.sql('select count(*)::int as n from private.medios_pago'))[0].n === 7, 'ni un medio de pago: los 7 siguen en la base');

// volver a poner
lista = await admin('admin_medios_pago', {});
r = await admin('admin_medios_pago_guardar', { p_lista: base(lista.medios).map((m) => (m.nombre === 'USD efectivo' ? { ...m, activo: true } : m)) });
est = await recepcion('recepcion_estado', {});
ok(r.ok === true && est.medios_pago.map((m) => m.nombre).includes('USD efectivo'), 'el dueño puede volver a poner un medio quitado');

// reglas
lista = await admin('admin_medios_pago', {});
const L = () => base(lista.medios);
r = await admin('admin_medios_pago_guardar', { p_lista: L().map((m) => (m.nombre === 'Otros' ? { ...m, activo: false } : m)) });
ok(r.ok === false && r.error === 'base_obligatoria', '"Otros" no se puede quitar');
r = await admin('admin_medios_pago_guardar', { p_lista: L().map((m) => (m.nombre === 'Otros' ? { ...m, nombre: 'Otro medio' } : m)) });
ok(r.ok === true && r.medios.at(-1).nombre === 'Otro medio', 'pero sí se le puede cambiar el nombre (queda al final)');
await admin('admin_medios_pago_guardar', { p_lista: base(r.medios).map((m) => (m.nombre === 'Otro medio' ? { ...m, nombre: 'Otros' } : m)) });
lista = await admin('admin_medios_pago', {});
r = await admin('admin_medios_pago_guardar', { p_lista: [...L(), { id: null, nombre: 'efectivo', activo: true }] });
ok(r.ok === false && r.error === 'nombre_repetido', 'no deja repetir un nombre (sin importar mayúsculas)');
r = await admin('admin_medios_pago_guardar', { p_lista: [...L(), { id: null, nombre: 'Otro', activo: false }, { id: null, nombre: 'OTRO', activo: true }] });
ok(r.ok === false && r.error === 'nombre_repetido', 'ni dos nuevos iguales en la misma lista');
for (const [nombre, texto] of [['', 'vacío'], ['   ', 'solo espacios'], ['<b>x</b>', 'con símbolos de código'], ['x'.repeat(41), 'de más de 40 letras'], ['-guion', 'que empieza con símbolo'], ['a\u0007b', 'con caracteres de control']]) {
  r = await admin('admin_medios_pago_guardar', { p_lista: [...L(), { id: null, nombre, activo: true }] });
  ok(r.ok === false && r.error === 'nombre_invalido', `se rechaza un nombre ${texto}`);
}
r = await admin('admin_medios_pago_guardar', { p_lista: [...L(), { id: 99999, nombre: 'Fantasma', activo: true }] });
ok(r.ok === false && r.error === 'no_existe', 'se rechaza un medio con id que no existe');
for (const malo of [null, [], {}, '"x"', [1, 2], [{ id: 1, nombre: 'a', activo: 'si' }], [{ id: 1, nombre: 'a' }, { id: 1, nombre: 'b' }]]) {
  r = await admin('admin_medios_pago_guardar', { p_lista: malo });
  ok(r.ok === false && ['lista_invalida', 'no_existe'].includes(r.error), `se rechaza una lista mal armada (${JSON.stringify(malo)})`);
}
ok((await back.sql('select count(*)::int as n from private.medios_pago'))[0].n === 7, 'después de todos los rechazos la lista no cambió');
r = await admin('admin_medios_pago_guardar', { p_lista: [...L(), ...Array.from({ length: 70 }, (_, i) => ({ id: null, nombre: `M${i}`, activo: true }))] });
ok(r.ok === false && r.error === 'lista_invalida', 'y no deja pasarse de 60 medios');
r = await admin('admin_medios_pago_guardar', { p_lista: [...L(), { id: null, nombre: 'Débito/Crédito (MP) + QR', activo: true }] });
ok(r.ok === true && r.medios.some((m) => m.nombre === 'Débito/Crédito (MP) + QR'), 'acepta acentos, barras, paréntesis y signos comunes');

// el admin edita huéspedes con medio de pago, sin límite de tiempo, y los ve todos
await back.sql(`update private.checkins set creado = now() - interval '3 days'`);
const lh = await admin('admin_huespedes', {});
ok(lh.ok === true && lh.huespedes.length === 3 && lh.huespedes.every((h) => typeof h.medio_pago === 'string' && Number.isInteger(h.medio_pago_id)), 'el admin ve a todos los huéspedes con su medio de pago');
const buscar = await admin('admin_huespedes', { p_buscar: 'tarjeta' });
ok(buscar.huespedes.length === 1 && buscar.huespedes[0].id === id3, 'se puede buscar por medio de pago ("tarjeta" encuentra a quien pagó con tarjeta)');
r = await admin('admin_huesped_editar', { p_id: id3, p_datos: { ...DATOS('Carla', 30111444), medio_pago: 1 }, p_habitacion: '103' });
ok(r.ok === true && await medioDe(id3) === 'Efectivo', 'el admin cambia el medio de pago aunque haya pasado la ventana de recepción');
r = await admin('admin_huesped_editar', { p_id: id3, p_datos: { ...DATOS('Carla', 30111444), medio_pago: 99999 }, p_habitacion: '103' });
ok(r.ok === false && r.error === 'datos_invalidos', 'y el admin tampoco puede poner un id que no existe');
r = await recepcion('recepcion_editar', { p_id: id3, p_datos: { ...DATOS('Carla', 30111444), medio_pago: 2 }, p_habitacion: '103' });
ok(r.ok === false && r.error === 'fuera_de_tiempo', 'recepción, pasada su ventana, no puede cambiarlo (como la habitación)');

// seguridad
const intento = async (sql) => { try { await back.exec(`begin; set local role anon; ${sql}; rollback;`); return ''; } catch (e) { await back.exec('rollback').catch(() => {}); return String(e.message); } };
ok(/permission denied/.test(await intento('select * from private.medios_pago')), 'un anónimo no puede leer la tabla de medios de pago directo');
ok(/permission denied/.test(await intento(`insert into private.medios_pago (id, nombre) values (99, 'x')`)), 'ni agregar medios de pago directo');
ok(/permission denied/.test(await intento('select private.medios_pago_lista()')), 'ni llamar a las funciones internas');
ok((await back.sql(`select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosrc ~* '\\mdelete\\M|\\mdrop\\M|\\mtruncate\\M'`))[0].n === 0, 'ninguna función de la guía contiene DELETE, DROP ni TRUNCATE');

console.log(`\n${total} comprobaciones, ${fallas} falla(s)`);
await back.cerrar();
process.exit(fallas ? 1 : 0);
