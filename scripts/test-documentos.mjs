// Tipo de documento «Identificación» (además de DNI y pasaporte): la migración no pierde nada y las funciones se portan bien.
//   node scripts/test-documentos.mjs
// Parte 1: se arma una base como la que está hoy en producción (schema.sql + el check-in de antes de este cambio), con
//          huéspedes ya cargados, se le aplica supabase/documentos.sql (dos veces) y se comprueba que NINGUNA tabla cambió ni
//          perdió una fila, que antes la base rechazaba «Identificación» y después la acepta, que la guía sabe qué tipos
//          acepta la base y que el resultado es idéntico a una base nueva (schema.sql + checkin.sql).
// Parte 2: se prueba, como lo haría la guía (rol "anon") y con el script de Drive de siempre (apps-script/Codigo.gs, sin
//          cambios), que el huésped pueda cargar su foto y enviar el formulario con DNI, pasaporte o identificación,
//          que recepción y el dueño puedan cambiar el tipo de documento, y que cada tipo valide su número.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { CLAVE_ADMIN, CLAVE_RECEPCION, iniciarBackend } from './backend-local.mjs';

const ruta = (r) => fileURLToPath(new URL(`../${r}`, import.meta.url));
let fallas = 0;
let total = 0;
const ok = (c, m) => { total += 1; console.log(`${c ? 'OK    ' : 'FALLA '}${m}`); if (!c) fallas += 1; };

const IDENTIFICACION = 'Identificación';
const DATOS = (n, doc, tipo = 'DNI') => ({ nombre: n, apellido: 'Prueba', email: `${n.toLowerCase()}@correo.com`, telefono: '+541155551234', nacionalidad: 'Argentina', localidad: 'Capital Federal', domicilio: 'Av. Corrientes 1234 5° B', doc_tipo: tipo, doc_numero: String(doc) });
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
// Cómo ve la base un dato que llega de la guía (lo que revisan el check-in, la edición de recepción y la del dueño).
const validar = async (db, datos) => (await db.query('select private.validar_huesped($1::jsonb) as r', [JSON.stringify(datos)])).rows[0].r;
// Lo que cuenta el tiempo (los segundos que le quedan a recepción para editar) cambia de una llamada a otra: no se compara.
const sinTiempos = (lista) => lista.map(({ editable_seg: _s, ...resto }) => resto);

// El contenido de TODAS las tablas (public y private): cuántas filas y una huella de lo que dicen.
const instantanea = async (db) => {
  const tablas = (await db.query(`select table_schema || '.' || table_name as t from information_schema.tables where table_schema in ('public', 'private') and table_type = 'BASE TABLE' order by 1`)).rows.map((x) => x.t);
  const res = {};
  for (const t of tablas) {
    const [s, n] = t.split('.');
    res[t] = (await db.query(`select count(*)::int as n, md5(coalesce(string_agg(to_jsonb(x)::text, ';' order by to_jsonb(x)::text), '')) as h from "${s}"."${n}" x`)).rows[0];
  }
  return res;
};
const diferencias = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((t) => !a[t] || !b[t] || a[t].n !== b[t].n || a[t].h !== b[t].h);

// ---------------------------------------------------------------- Parte 1: la migración
console.log('\n== 1. La migración (base de hoy + supabase/documentos.sql)');
{
  const db = await baseVacia();
  await db.exec(fs.readFileSync(ruta('scripts/fixtures/checkin.antes-de-documentos.sql'), 'utf8'));
  await db.query(`insert into private.admin (id, hash) values (1, extensions.crypt($1, extensions.gen_salt('bf')))`, [CLAVE_ADMIN]);
  await db.query(`update private.checkin_config set activo = true, codigo_seg = 300, foto_modo = 'opcional', foto_url = 'https://script.google.com/macros/s/AKfycbxPRUEBA/exec', hash_recepcion = extensions.crypt($1, extensions.gen_salt('bf')) where id = 1`, [CLAVE_RECEPCION]);
  // huéspedes que "ya ingresaron": uno con DNI y foto, uno con pasaporte y sin foto, uno con DNI, foto y habitación
  const pasaporte = { ...DATOS('Beto', 'AB123456', 'Pasaporte'), nacionalidad: 'Brasil', telefono: '+5511987654321' };
  await db.query(`insert into private.checkins (grupo, idioma, datos, consentimiento, habitacion, foto_id, foto_nombre, editado_en, editado_por, medio_pago_id) values
    (1, 'es', $1::jsonb, '{"aceptado":true}'::jsonb, '204', 'FOTOID0001', '2026-10-09_13-57_Prueba_Ana.jpg', now(), 'recepcion', 1),
    (1, 'pt', $2::jsonb, '{"aceptado":true}'::jsonb, null, null, null, null, null, 6),
    (1, 'en', $3::jsonb, '{"aceptado":true}'::jsonb, '305', 'FOTOID0003', '2026-10-09_14-10_Prueba_Carla.jpg', null, null, 2)`,
  [JSON.stringify(DATOS('Ana', 30111222)), JSON.stringify(pasaporte), JSON.stringify(DATOS('Carla', 30111444))]);
  await db.query(`insert into private.checkin_fotos (checkin_id, foto_id, nombre, origen) values (1, 'FOTOID0001', '2026-10-09_13-57_Prueba_Ana.jpg', 'huesped'), (3, 'FOTOID0003', '2026-10-09_14-10_Prueba_Carla.jpg', 'huesped')`);
  await db.query(`insert into private.checkin_auditoria (quien, accion, checkin_id, detalle) values ('recepcion', 'editar', 1, '{"campos":["habitacion"]}'::jsonb)`);

  // lo que hace hoy la base publicada
  const antesEstado = await llamarEn(db, 'checkin_estado');
  ok(antesEstado.activo === true && antesEstado.tipos_doc === undefined, 'antes de migrar, la base no avisa qué tipos de documento acepta (la guía nueva ofrece solo DNI y pasaporte)');
  const antesId = await validar(db, DATOS('Dora', '12.345.678-9', IDENTIFICACION));
  ok(antesId.ok === false && antesId.campos.length === 1 && antesId.campos[0] === 'doc_tipo', 'y rechaza «Identificación» (por eso la guía nueva no la ofrece hasta que se corra el SQL)');
  // (las consultas van antes de sacar la foto de las tablas: la de recepción genera el código del día la primera vez)
  const huespedesAntes = (await llamarEn(db, 'admin_huespedes', { p_clave: CLAVE_ADMIN })).huespedes;
  const recepcionAntes = await llamarEn(db, 'recepcion_estado', { p_clave: CLAVE_RECEPCION });
  const antes = await instantanea(db);

  const sql = fs.readFileSync(ruta('supabase/documentos.sql'), 'utf8');
  await db.exec(sql);
  ok(true, 'el SQL de la migración se ejecuta sin errores');
  const malas = diferencias(antes, await instantanea(db));
  ok(malas.length === 0, `no cambió ni se perdió ninguna fila en las ${Object.keys(antes).length} tablas de la base (huéspedes, fotos, medios de pago, historial, configuración...)` + (malas.length ? ' · distintas: ' + malas.join(', ') : ''));
  ok(antes['private.checkins'].n === 3 && antes['private.checkin_fotos'].n === 2, 'incluidos los 3 huéspedes ya cargados y sus 2 fotos');

  const despuesEstado = await llamarEn(db, 'checkin_estado');
  ok(JSON.stringify(despuesEstado.tipos_doc) === JSON.stringify(['DNI', 'Pasaporte', IDENTIFICACION]), 'después de migrar, la base avisa que acepta DNI, Pasaporte e Identificación (en ese orden)');
  ok(despuesEstado.activo === antesEstado.activo && JSON.stringify(despuesEstado.foto) === JSON.stringify(antesEstado.foto), 'y lo que ya devolvía (activo, foto) sigue igual: la guía publicada no nota la diferencia');
  const despuesId = await validar(db, DATOS('Dora', '12.345.678-9', IDENTIFICACION));
  ok(despuesId.ok === true && despuesId.datos.doc_tipo === IDENTIFICACION && despuesId.datos.doc_numero === '123456789', 'y acepta «Identificación» (número sin puntos ni guiones)');
  ok((await validar(db, DATOS('Ana', '30.111.222'))).datos.doc_numero === '30111222' && (await validar(db, pasaporte)).datos.doc_numero === 'AB123456', 'DNI y pasaporte se validan igual que siempre');

  // la guía publicada (y las pantallas de recepción y del dueño) ven lo mismo que antes
  const huespedesDespues = (await llamarEn(db, 'admin_huespedes', { p_clave: CLAVE_ADMIN })).huespedes;
  ok(JSON.stringify(huespedesAntes) === JSON.stringify(huespedesDespues), 'la planilla del dueño devuelve exactamente lo mismo que antes');
  const recepcionDespues = await llamarEn(db, 'recepcion_estado', { p_clave: CLAVE_RECEPCION });
  ok(JSON.stringify(sinTiempos(recepcionAntes.huespedes)) === JSON.stringify(sinTiempos(recepcionDespues.huespedes)), 'y la de recepción también');

  const trasPrimera = await instantanea(db);
  await db.exec(sql);
  ok(diferencias(trasPrimera, await instantanea(db)).length === 0 && JSON.stringify(await llamarEn(db, 'checkin_estado')) === JSON.stringify(despuesEstado), 'ejecutarlo de nuevo no cambia nada (se puede repetir sin problema)');

  // una base nueva (schema + checkin completo) tiene exactamente las mismas funciones
  const nueva = await baseVacia();
  await nueva.exec(fs.readFileSync(ruta('supabase/checkin.sql'), 'utf8'));
  const huella = async (d) => Object.fromEntries((await d.query(`select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as fn, md5(regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), '\\s+', ' ', 'g')) as h from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private')`)).rows.map((x) => [x.fn, x.h]));
  const hv = await huella(db); const hn = await huella(nueva);
  const distintas = [...new Set([...Object.keys(hv), ...Object.keys(hn)])].filter((f) => hv[f] !== hn[f]);
  ok(distintas.length === 0, `la base migrada y una base nueva tienen las mismas ${Object.keys(hn).length} funciones` + (distintas.length ? ' · distintas: ' + distintas.join(', ') : ''));
  const viejaBase = await baseVacia();
  await viejaBase.exec(fs.readFileSync(ruta('scripts/fixtures/checkin.antes-de-documentos.sql'), 'utf8'));
  const hViejas = await huella(viejaBase);
  const agregadas = Object.keys(hn).filter((f) => !(f in hViejas));
  const quitadas = Object.keys(hViejas).filter((f) => !(f in hn));
  ok(agregadas.length === 0 && quitadas.length === 0, 'este cambio no agrega ni quita ninguna función' + (agregadas.length + quitadas.length ? ' · ' + [...agregadas, ...quitadas].join(', ') : ''));
  const quedaron = Object.keys(hn).filter((f) => hViejas[f] !== hn[f]).sort();
  ok(JSON.stringify(quedaron) === JSON.stringify(['private.validar_huesped(p_datos jsonb)', 'public.checkin_estado()']), 'y de todas las funciones solo cambian esas dos: validar_huesped y checkin_estado' + (quedaron.length !== 2 ? ' · cambian: ' + quedaron.join(', ') : ''));
  const permisos = async (d) => (await d.query(`select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as fn, has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as aut from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private') order by 1`)).rows.map((x) => `${x.fn}:${x.anon}:${x.aut}`).join(',');
  ok(await permisos(db) === await permisos(nueva), 'y los mismos permisos: un anónimo solo puede llamar a las funciones públicas previstas');
  ok((await db.query(`select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`)).rows[0].n === 0, 'ninguna función interna (private) se puede llamar desde la guía');
  await db.close(); await nueva.close(); await viejaBase.close();
}

// ---------------------------------------------------------------- Parte 2: las funciones, como las usa la guía
console.log('\n== 2. DNI, pasaporte e identificación: números, foto y edición');
const back = await iniciarBackend({ puerto: 54398 });
const SCRIPT = `${back.url}/apps-script/exec`;
await back.sql(`update private.checkin_config set activo = true, codigo_seg = 300, usos_max = 20, foto_modo = 'opcional', foto_url = $2, hash_recepcion = extensions.crypt($1, extensions.gen_salt('bf')) where id = 1`, [CLAVE_RECEPCION, SCRIPT]);
const recepcion = (fn, args) => back.llamar(fn, { p_clave: CLAVE_RECEPCION, ...args }, '198.51.100.50');
const admin = (fn, args) => back.llamar(fn, { p_clave: CLAVE_ADMIN, ...args }, '198.51.100.60');
// un "JPEG" mínimo (lo que revisa el script es la firma del archivo y el tamaño)
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7)]).toString('base64');
const subir = async (ticket, nombre, apellido) => (await fetch(SCRIPT, { method: 'POST', body: JSON.stringify({ ticket, nombre, apellido, imagen: JPG }) })).json();
const drive = async () => (await fetch(`${back.url}/__test/drive`)).json();
const fotosDrive = async () => (await drive()).filter((a) => a.mime === 'image/jpeg').length;
let ipN = 100;
const ipNueva = () => `198.51.100.${(ipN += 1)}`;
const canjear = async (ip) => {
  const est = await recepcion('recepcion_estado', {});
  return back.llamar('checkin_canjear', { p_codigo: String(est.codigo.valor) }, ip);
};
const ultimo = async () => (await back.sql('select id::int as id, datos from private.checkins order by id desc limit 1'))[0];
const cuenta = async (tabla) => (await back.sql(`select count(*)::int as n from ${tabla}`))[0].n;
const validarAca = async (datos) => (await back.sql('select private.validar_huesped($1::jsonb) as r', [JSON.stringify(datos)]))[0].r;

// -- la guía averigua qué tipos acepta la base
const est0 = await back.llamar('checkin_estado', {});
ok(JSON.stringify(est0.tipos_doc) === JSON.stringify(['DNI', 'Pasaporte', IDENTIFICACION]), 'checkin_estado le dice a la guía que acepta DNI, Pasaporte e Identificación');
ok(est0.activo === true && est0.foto && est0.foto.url === SCRIPT, 'y sigue diciendo si el check-in está activo y dónde se sube la foto');

// -- cada tipo valida su número (el servidor vuelve a revisar lo que ya revisó la guía)
const casos = [
  // [tipo, lo que escribe el huésped, cómo queda guardado (null = se rechaza el número)]
  ['DNI', '30.123.456', '30123456'], ['DNI', ' 30 123 456 ', '30123456'], ['DNI', '3012', null], ['DNI', 'A0123456', null], ['DNI', '123456789', null],
  ['Pasaporte', 'aa 123456', 'AA123456'], ['Pasaporte', 'AA-123456', 'AA123456'], ['Pasaporte', 'A1', null], ['Pasaporte', '1234567890123', null],
  [IDENTIFICACION, '12.345.678-9', '123456789'], [IDENTIFICACION, 'mg-12.345.678', 'MG12345678'], [IDENTIFICACION, 'A123-4567-8901-23', 'A1234567890123'],
  [IDENTIFICACION, '12/34 56', '123456'], [IDENTIFICACION, '1234', '1234'], [IDENTIFICACION, 'x1234', 'X1234'], [IDENTIFICACION, '1'.repeat(20), '1'.repeat(20)],
  [IDENTIFICACION, '123', null], [IDENTIFICACION, '12-3', null], [IDENTIFICACION, '1'.repeat(21), null], [IDENTIFICACION, '12345$', null],
  [IDENTIFICACION, 'Ñ12345', null], [IDENTIFICACION, '<b>12345</b>', null], [IDENTIFICACION, '   ', null], [IDENTIFICACION, '', null]
];
let malos = [];
for (const [tipo, escrito, guardado] of casos) {
  const r = await validarAca(DATOS('Ana', escrito, tipo));
  const bien = guardado === null ? (r.ok === false && r.campos.length === 1 && r.campos[0] === 'doc_numero') : (r.ok === true && r.datos.doc_tipo === tipo && r.datos.doc_numero === guardado);
  if (!bien) malos.push(`${tipo} «${escrito}»`);
}
ok(malos.length === 0, `${casos.length} números de DNI, pasaporte e identificación se aceptan o se rechazan como corresponde (separadores, mayúsculas, largo, símbolos)` + (malos.length ? ' · mal: ' + malos.join('; ') : ''));
malos = [];
for (const tipo of ['Cédula', 'identificación', 'Identificacion', 'IDENTIFICACIÓN', 'dni', 'Licencia', '', ' ', null, 5]) {
  const d = { ...DATOS('Ana', '30111222'), doc_tipo: tipo };
  const r = await validarAca(d);
  if (!(r.ok === false && r.campos.length === 1 && r.campos[0] === 'doc_tipo')) malos.push(JSON.stringify(tipo));
}
ok(malos.length === 0, 'un tipo de documento que no es uno de los tres (otro nombre, minúsculas, sin tilde, vacío) se rechaza como «doc_tipo»' + (malos.length ? ' · mal: ' + malos.join('; ') : ''));
{
  const sinTipo = DATOS('Ana', '30111222'); delete sinTipo.doc_tipo;
  const r = await validarAca(sinTipo);
  ok(r.ok === false && r.campos.includes('doc_tipo'), 'y si no viene el tipo, también');
  const dos = await validarAca({ ...DATOS('Ana', '12', IDENTIFICACION), email: 'no-es-un-mail' });
  ok(dos.ok === false && dos.campos.length === 2 && dos.campos.includes('doc_numero') && dos.campos.includes('email'), 'varios errores a la vez se informan todos (para marcarlos en la pantalla)');
}

// -- el huésped manda su foto y el formulario con cada tipo de documento
const huespedes = {};
for (const [tipo, escrito, guardado, nombre] of [['DNI', '30.111.222', '30111222', 'Ana'], ['Pasaporte', 'ab 123456', 'AB123456', 'Beto'], [IDENTIFICACION, '12.345.678-9', '123456789', 'Carla']]) {
  const ip = ipNueva();
  const ses = await canjear(ip);
  ok(ses.ok === true && ses.foto && ses.foto.ticket, `${tipo}: el huésped entra con el código y recibe el permiso para subir su foto`);
  const antesDrive = await fotosDrive();
  const sub = await subir(ses.foto.ticket, nombre, 'Prueba');
  ok(sub.ok === true && /_Prueba_.*\.jpg$/.test(sub.nombre) && (await fotosDrive()) === antesDrive + 1, `${tipo}: la foto se sube a la carpeta de Drive`);
  const sesion = await back.llamar('checkin_sesion', { p_token: ses.token }, ip);
  ok(sesion.foto.listo === true, `${tipo}: la base ya sabe que la foto está subida`);
  const env = await back.llamar('checkin_enviar', { p_token: ses.token, p_idioma: 'es', p_acepta: true, p_datos: DATOS(nombre, escrito, tipo) }, ip);
  ok(env.ok === true, `${tipo}: se envía el formulario`);
  const u = await ultimo();
  ok(u.datos.doc_tipo === tipo && u.datos.doc_numero === guardado, `${tipo}: queda guardado el tipo y el número normalizado (${guardado})`);
  const f = await admin('admin_fotos', { p_id: u.id });
  ok(f.ok === true && f.fotos.length === 1 && f.fotos[0].origen === 'huesped' && f.fotos[0].activa === true && f.fotos[0].nombre === sub.nombre, `${tipo}: la foto figura en la lista del huésped`);
  huespedes[tipo] = { id: u.id, foto: f.fotos[0] };
}
{
  const planilla = (await admin('admin_huespedes', {})).huespedes;
  const rec = (await recepcion('recepcion_estado', {})).huespedes;
  const comoSeVe = (lista, tipo) => { const h = lista.find((x) => x.id === huespedes[tipo].id); return h && `${h.datos.doc_tipo} ${h.datos.doc_numero} ${h.foto_id === huespedes[tipo].foto.foto_id ? 'con foto' : 'SIN FOTO'}`; };
  ok(comoSeVe(planilla, IDENTIFICACION) === `${IDENTIFICACION} 123456789 con foto` && comoSeVe(planilla, 'Pasaporte') === 'Pasaporte AB123456 con foto' && comoSeVe(planilla, 'DNI') === 'DNI 30111222 con foto', 'la planilla del dueño muestra el tipo, el número y la foto de los tres');
  ok(comoSeVe(rec, IDENTIFICACION) === `${IDENTIFICACION} 123456789 con foto` && comoSeVe(rec, 'DNI') === 'DNI 30111222 con foto', 'y la de recepción también');
}

// -- sin foto: el check-in con «Identificación» también se puede enviar (la foto es opcional)
{
  const ip = ipNueva();
  const ses = await canjear(ip);
  const env = await back.llamar('checkin_enviar', { p_token: ses.token, p_idioma: 'pt', p_acepta: true, p_datos: DATOS('Dora', 'RG 1.234.567', IDENTIFICACION) }, ip);
  const u = await ultimo();
  ok(env.ok === true && u.datos.doc_numero === 'RG1234567', 'sin foto también se envía (si la foto es opcional), y el número queda como RG1234567');
  huespedes.sinFoto = { id: u.id };
}
// -- foto obligatoria: se pide igual con los tres tipos
await back.sql(`update private.checkin_config set foto_modo = 'obligatoria' where id = 1`);
{
  const malosTipos = [];
  for (const tipo of ['DNI', 'Pasaporte', IDENTIFICACION]) {
    const ip = ipNueva();
    const ses = await canjear(ip);
    const env = await back.llamar('checkin_enviar', { p_token: ses.token, p_idioma: 'es', p_acepta: true, p_datos: DATOS('Eva', tipo === 'DNI' ? '30111666' : 'ZZ123456', tipo) }, ip);
    if (!(env.ok === false && env.error === 'foto_requerida')) malosTipos.push(tipo);
  }
  ok(malosTipos.length === 0, 'si la foto es obligatoria, se pide con DNI, con pasaporte y con identificación' + (malosTipos.length ? ' · mal: ' + malosTipos.join(', ') : ''));
}
await back.sql(`update private.checkin_config set foto_modo = 'opcional' where id = 1`);

// -- recepción y el dueño pueden cambiar el tipo de documento (dentro de la ventana de edición, y el dueño siempre)
const historial = async (id) => (await admin('admin_checkin_auditoria', { p_limite: 200 })).registros.filter((x) => x.checkin_id === id && x.accion === 'editar');
{
  const { id } = huespedes['DNI'];
  const nuevo = DATOS('Ana', 'cd 12.345/678', IDENTIFICACION);
  let r = await recepcion('recepcion_editar', { p_id: id, p_datos: nuevo, p_habitacion: '204' });
  ok(r.ok === true, 'recepción cambia un DNI por una identificación');
  const guardado = (await back.sql('select datos, habitacion from private.checkins where id = $1', [id]))[0];
  ok(guardado.datos.doc_tipo === IDENTIFICACION && guardado.datos.doc_numero === 'CD12345678' && guardado.habitacion === '204', 'y queda guardado normalizado, con la habitación');
  const h = await historial(id);
  ok(h.length === 1 && h[0].detalle.campos.includes('doc_tipo') && h[0].detalle.campos.includes('doc_numero') && h[0].detalle.campos.includes('habitacion'), 'el historial anota que cambiaron el tipo, el número y la habitación');
  ok(!JSON.stringify(h).includes('CD12345678'), 'sin guardar el número en el historial');
  r = await recepcion('recepcion_editar', { p_id: id, p_datos: DATOS('Ana', '12', IDENTIFICACION), p_habitacion: '204' });
  ok(r.ok === false && r.error === 'datos_invalidos' && r.campos.length === 1 && r.campos[0] === 'doc_numero', 'si el número no sirve para ese tipo, lo rechaza y marca el campo');
  r = await recepcion('recepcion_editar', { p_id: id, p_datos: DATOS('Ana', '30111222', 'Libreta'), p_habitacion: '204' });
  ok(r.ok === false && r.error === 'datos_invalidos' && r.campos[0] === 'doc_tipo', 'y rechaza un tipo que no existe');
  ok((await back.sql('select datos from private.checkins where id = $1', [id]))[0].datos.doc_numero === 'CD12345678', 'los rechazos no tocaron lo guardado');
  r = await admin('admin_huesped_editar', { p_id: id, p_datos: DATOS('Ana', '30.111.222', 'DNI'), p_habitacion: '204' });
  ok(r.ok === true, 'el dueño lo puede volver a cambiar a DNI');
  ok((await back.sql('select datos from private.checkins where id = $1', [id]))[0].datos.doc_numero === '30111222', 'y queda el DNI normalizado');
  r = await admin('admin_huesped_editar', { p_id: huespedes['Pasaporte'].id, p_datos: DATOS('Beto', 'xk-98.76/54', IDENTIFICACION), p_habitacion: '' });
  ok(r.ok === true && (await back.sql('select datos from private.checkins where id = $1', [huespedes['Pasaporte'].id]))[0].datos.doc_numero === 'XK987654', 'el dueño cambia un pasaporte por una identificación');
}
// -- la foto y los demás datos no se mueven al cambiar el tipo de documento
{
  const f1 = await admin('admin_fotos', { p_id: huespedes['DNI'].id });
  const f2 = await admin('admin_fotos', { p_id: huespedes['Pasaporte'].id });
  ok(f1.fotos.length === 1 && f1.fotos[0].foto_id === huespedes['DNI'].foto.foto_id && f2.fotos.length === 1 && f2.fotos[0].foto_id === huespedes['Pasaporte'].foto.foto_id, 'las fotos de esos huéspedes siguen ahí, iguales');
}

// -- el dueño le sube la foto del documento a un huésped que mandó «Identificación» sin foto
{
  const { id } = huespedes.sinFoto;
  const antes = await fotosDrive();
  const p = await admin('admin_foto_permiso', { p_id: id });
  ok(p.ok === true && p.url === SCRIPT, 'el dueño pide permiso para subir la foto de un huésped con identificación que no mandó foto');
  const s = await subir(p.ticket, 'Dora', 'Prueba');
  const f = await admin('admin_fotos', { p_id: id });
  ok(s.ok === true && (await fotosDrive()) === antes + 1 && f.fotos.length === 1 && f.fotos[0].origen === 'admin', 'se sube a Drive y queda en su lista (cargada por el dueño)');
}

// -- nada se borra
ok((await cuenta('private.checkins')) === 4, 'al final están los 4 huéspedes cargados (ninguno se borró ni se duplicó)');
ok((await cuenta('private.checkin_fotos')) === 4 && (await back.sql(`select count(*)::int as n from private.checkin_fotos where activa = false`))[0].n === 0, 'y las 4 fotos (3 de los huéspedes y 1 del dueño)');
ok((await fotosDrive()) === 4, 'y los 4 archivos están en la carpeta de Drive');
ok((await back.sql(`select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private') and p.prosrc ~* '\\mdelete\\M|\\mdrop\\M|\\mtruncate\\M'`))[0].n === 0, 'ninguna función de la guía contiene DELETE, DROP ni TRUNCATE');

console.log(`\n${total} comprobaciones, ${fallas} falla(s)`);
await back.cerrar();
process.exit(fallas ? 1 : 0);
