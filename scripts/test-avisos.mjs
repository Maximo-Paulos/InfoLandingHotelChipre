// Avisos en el celular (notificaciones push): qué celulares se registran, a quién le llega cada aviso (y a quién no), que un fallo al avisar nunca frena una reserva
// ni un check-in, y la migración desde la versión publicada. La base de prueba no tiene pg_net: se arma un «net.http_post» falso que anota cada pedido.
//   node scripts/test-avisos.mjs
import fs from 'node:fs';
import { CLAVE_ADMIN, CLAVE_RECEPCION, SQL_RECEPCION, iniciarBackend } from './backend-local.mjs';

let fallas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK    ' : 'FALLA '}${m}`); if (!c) fallas += 1; };

const FALSO_NET = `
  create schema if not exists net;
  create table if not exists private.test_net (id serial primary key, url text, headers jsonb, body jsonb);
  create or replace function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}', params jsonb default '{}', timeout_milliseconds int default 5000)
  returns bigint language plpgsql as $$ begin insert into private.test_net (url, headers, body) values (url, headers, body); return 1; end $$;`;
const NET_ROTO = `
  create or replace function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}', params jsonb default '{}', timeout_milliseconds int default 5000)
  returns bigint language plpgsql as $$ begin raise exception 'el servidor de avisos no responde'; end $$;`;

const back = await iniciarBackend({ puerto: 54389, estadias: true });
await back.sql(`update private.checkin_config set activo = true, usos_max = 20 where id = 1`);
await back.sql(SQL_RECEPCION, [CLAVE_RECEPCION]);
await back.exec(FALSO_NET);
const llamar = (n, a, ip = '203.0.113.7') => back.llamar(n, a, ip);
const dueno = (await llamar('sesion_entrar', { p_clave: CLAVE_ADMIN })).token;
await llamar('admin_equipo_guardar', { p_clave: dueno, p_id: null, p_alias: 'Martín', p_rol: 'recepcion', p_clave_usuario: 'martin-clave-1234', p_activo: true });
await llamar('admin_equipo_guardar', { p_clave: dueno, p_id: null, p_alias: 'Carla', p_rol: 'admin', p_clave_usuario: 'carla-clave-1234', p_activo: true });
let lucia = (await llamar('sesion_entrar', { p_clave: CLAVE_RECEPCION }, '203.0.113.20')).token; // alias «Recepción»
const martin = (await llamar('sesion_entrar', { p_clave: 'martin-clave-1234' }, '203.0.113.21')).token;
const carla = (await llamar('sesion_entrar', { p_clave: 'carla-clave-1234' }, '203.0.113.22')).token; // otra persona con rol de dueño
const AR = (n = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(Date.now() + n * 864e5));
const hoy = AR();
const idDe = async (tipo, nombre) => (await back.sql(`select id from private.catalogo where tipo = $1 and nombre = $2`, [tipo, nombre]))[0].id;
const DIRECTO = await idDe('canal', 'Directo');
const DOBLE = await idDe('categoria', 'Doble');
const n = async (sql, p = []) => (await back.sql(sql, p))[0].n;
const b64 = (bytes) => Buffer.from(Array.from({ length: bytes }, () => Math.floor(Math.random() * 256))).toString('base64url');
const celular = (nombre) => ({ endpoint: `https://push.ejemplo.test/${nombre}`, p256dh: b64(65), auth: b64(16) });
const suscribir = (token, cel, ip = '203.0.113.30') => llamar('push_suscribir', { p_clave: token, p_endpoint: cel.endpoint, p_llave: cel.p256dh, p_auth: cel.auth, p_agente: 'iPhone · Safari (app)' }, ip);
const CEL = { dueno: celular('dueno'), carla: celular('carla'), lucia: celular('lucia'), martin: celular('martin') };
// El arnés de prueba manda los arreglos como JSON; Postgres los espera como literal ({a,b}). PostgREST (el de verdad) sí entiende el JSON.
const arreglo = (xs) => `{${xs.map((e) => `"${e}"`).join(',')}}`;
const llamadas = () => back.sql(`select url, headers, body from private.test_net order by id`);
const limpiarLlamadas = async () => { await back.sql(`delete from private.test_net`); await back.sql(`delete from private.push_cola`); };
const ultima = async () => (await back.sql(`select * from private.push_cola order by id desc limit 1`))[0];
const destinosDe = (llamada) => llamada.body.suscripciones.map((x) => x.endpoint.split('/').pop()).sort();

console.log('\n== 1. Registrar el celular');
let r = await llamar('push_suscribir', { p_clave: CLAVE_RECEPCION, p_endpoint: CEL.lucia.endpoint, p_llave: CEL.lucia.p256dh, p_auth: CEL.lucia.auth });
ok(r.ok === false && r.error === 'sesion_requerida', 'con la clave no se puede: hace falta la sesión del celular');
ok((await llamar('push_suscribir', { p_clave: 'sd_' + '0'.repeat(64), p_endpoint: CEL.lucia.endpoint, p_llave: CEL.lucia.p256dh, p_auth: CEL.lucia.auth })).ok === false, 'ni con una sesión que no existe');
r = await llamar('push_suscribir', { p_clave: lucia, p_endpoint: 'http://inseguro.test/x', p_llave: CEL.lucia.p256dh, p_auth: CEL.lucia.auth });
ok(r.ok === false && r.error === 'datos_invalidos', 'un endpoint que no es https se rechaza');
r = await llamar('push_suscribir', { p_clave: lucia, p_endpoint: CEL.lucia.endpoint, p_llave: 'corta', p_auth: CEL.lucia.auth });
ok(r.ok === false && r.error === 'datos_invalidos', 'y claves de largo imposible también');
for (const [quien, token] of [['dueno', dueno], ['carla', carla], ['lucia', lucia], ['martin', martin]]) {
  ok((await suscribir(token, CEL[quien])).ok === true, `${quien}: activa los avisos en su celular`);
}
const filas = await back.sql(`select alias, rol, usuario_id from private.push_suscripciones order by id`);
ok(filas.map((f) => `${f.alias}:${f.rol}`).join() === 'Dueño:admin,Carla:admin,Recepción:recepcion,Martín:recepcion', 'quedan anotados con su nombre y su rol (dueño y Carla: dueño; Recepción y Martín: recepción)');
await suscribir(lucia, CEL.lucia);
ok(await n('select count(*)::int n from private.push_suscripciones') === 4, 'volver a activar el mismo celular no lo duplica');
ok((await llamar('push_estado', { p_clave: lucia, p_endpoint: CEL.lucia.endpoint })).suscripto === true && (await llamar('push_estado', { p_clave: lucia, p_endpoint: CEL.martin.endpoint })).suscripto === false, 'cada uno ve que su celular está activo, y no el de otro');
ok((await llamar('push_estado', { p_clave: lucia, p_endpoint: CEL.lucia.endpoint })).configurado === false, 'y que el envío todavía no está conectado en el servidor');
await llamar('push_desuscribir', { p_clave: martin, p_endpoint: CEL.lucia.endpoint });
ok(await n('select count(*)::int n from private.push_suscripciones') === 4, 'nadie puede apagar el celular de otra persona');
await llamar('push_desuscribir', { p_clave: martin, p_endpoint: CEL.martin.endpoint });
ok(await n('select count(*)::int n from private.push_suscripciones') === 3, 'cada uno apaga el suyo');
await suscribir(martin, CEL.martin);

console.log('\n== 2. Ajustes del dueño');
ok((await llamar('admin_push_config', { p_clave: lucia })).ok === false, 'recepción no ve ni cambia los ajustes de avisos');
let cfg = await llamar('admin_push_config', { p_clave: dueno });
ok(cfg.ok && cfg.con_nombre === true && cfg.checkin_a_recepcion === false && cfg.configurado === false && cfg.dispositivos.admin === 2 && cfg.dispositivos.recepcion === 2, 'por defecto: el aviso lleva el nombre, el check-in no le llega a recepción, y hay 2 celulares del dueño y 2 de recepción');
ok(JSON.stringify(cfg).includes('secreto') === false && JSON.stringify(cfg).includes('url') === false, 'nunca devuelve el secreto ni la dirección del servidor');

console.log('\n== 3. Reserva anotada por el dueño → les llega a recepción');
const anotar = (extra = {}, quien = dueno, puerta = 'admin_anotada_guardar') => llamar(puerta, {
  p_clave: quien, p_id: null, p_titular: 'Juan Pérez', p_ingreso: AR(2), p_habitacion: '107', p_noches: 2, p_categoria: DOBLE, p_canal: DIRECTO, p_huespedes: 3,
  p_efectivo: 100000, p_transferencia: 110000, p_usd: null, p_sena: 30000, p_fecha_sena: AR(-3), p_nota: 'Llega a la tarde', ...extra });
r = await anotar();
ok(r.ok === true, 'el dueño anota una reserva');
let q = await ultima();
ok(q.tipo === 'anotada' && q.titulo === 'Reserva nueva' && q.destinos === 2, 'se arma un aviso «Reserva nueva» para 2 celulares (recepción)');
ok(q.cuerpo.includes('Hab. 107') && q.cuerpo.includes('Juan Pérez') && q.cuerpo.includes('llega ') && q.cuerpo.includes('3 huéspedes'), 'con habitación, titular, cuándo llega y cuántos son');
ok(!q.cuerpo.includes('la anotó') && !q.cuerpo.includes('100000') && !q.cuerpo.includes('30000') && !q.cuerpo.includes('Llega a la tarde'), 'sin plata ni la nota');
ok((await llamadas()).length === 0 && q.enviado === false, 'mientras el servidor de envío no esté conectado no sale nada (queda en la cola)');
await back.sql(`update private.push_config set url = 'https://hotel.ejemplo.test/api/push', secreto = 'secreto-de-prueba' where id = 1`);
ok((await llamar('push_estado', { p_clave: lucia, p_endpoint: CEL.lucia.endpoint })).configurado === true, 'al conectarlo, la app lo sabe');
await limpiarLlamadas();
await anotar({ p_titular: 'María Gómez', p_habitacion: '204', p_ingreso: AR(1) });
let ll = await llamadas();
ok(ll.length === 1 && ll[0].url === 'https://hotel.ejemplo.test/api/push', 'ahora sí se le pide a la función de envío (una sola llamada)');
ok(ll[0].headers.Authorization === 'Bearer secreto-de-prueba', 'con el secreto, para que nadie más pueda mandar avisos');
ok(destinosDe(ll[0]).join() === 'lucia,martin', 'a los celulares de recepción (Recepción y Martín), y no al del dueño ni al de Carla');
ok(ll[0].body.suscripciones.every((x) => x.url === '#/recepcion' && x.p256dh && x.auth) && ll[0].body.tag.startsWith('anotada-'), 'cada uno con lo que necesita para abrirlo, y una etiqueta para no repetir');
ok((await ultima()).enviado === true, 'y la cola lo marca como enviado');

console.log('\n== 4. Reserva anotada por recepción → le llega al dueño y a los otros de recepción');
await limpiarLlamadas();
r = await anotar({ p_titular: 'Cliente de la calle', p_habitacion: '305', p_ingreso: hoy }, lucia, 'recepcion_anotada_guardar');
ok(r.ok === true, 'Recepción anota a alguien que llegó de la calle');
ll = await llamadas();
ok(destinosDe(ll[0]).join() === 'carla,dueno,martin', 'le llega al dueño, a Carla y a Martín, y NO a quien la anotó');
ok(ll[0].body.cuerpo.includes('Cliente de la calle') && ll[0].body.cuerpo.includes('la anotó Recepción'), 'y el aviso dice quién la anotó');
const porRol = Object.fromEntries(ll[0].body.suscripciones.map((x) => [x.endpoint.split('/').pop(), x.url]));
ok(porRol.dueno === '#/admin' && porRol.carla === '#/admin' && porRol.martin === '#/recepcion', 'al tocar el aviso, el dueño abre su inicio y recepción su pantalla');
await limpiarLlamadas();
await anotar({ p_titular: 'Corregida', p_habitacion: '306', p_ingreso: AR(1) }, lucia, 'recepcion_anotada_guardar');
const idCorr = (await back.sql(`select id from private.reservas_anotadas where titular = 'Corregida'`))[0].id;
await limpiarLlamadas();
await llamar('recepcion_anotada_guardar', { p_clave: lucia, p_id: idCorr, p_titular: 'Corregida 2', p_ingreso: AR(1), p_habitacion: '306', p_noches: 1, p_categoria: DOBLE, p_canal: DIRECTO, p_huespedes: 1, p_efectivo: 5000 });
ok((await llamadas()).length === 0, 'corregir una reserva no manda avisos (solo crearla)');

console.log('\n== 5. El aviso sin nombre');
await limpiarLlamadas();
await llamar('admin_push_config', { p_clave: dueno, p_nombre: false });
await anotar({ p_titular: 'Secreta Pérez', p_habitacion: '401', p_ingreso: AR(2) });
ll = await llamadas();
ok(!ll[0].body.cuerpo.includes('Secreta') && ll[0].body.cuerpo.includes('Hab. 401'), 'con el nombre apagado el aviso lleva solo la habitación');
await llamar('admin_push_config', { p_clave: dueno, p_nombre: true });

console.log('\n== 6. Check-in realizado → le llega al dueño');
const estado = (quien) => llamar('recepcion_estado', { p_clave: quien });
const anotada = (await llamar('admin_anotadas', { p_clave: dueno })).anotadas.find((x) => x.titular === 'Juan Pérez');
let ipN = 100;
let docN = 36000000;
const DATOS = (nom, doc) => ({ nombre: nom, apellido: 'Apellido', email: `${nom.toLowerCase()}@correo.com`, telefono: '+541155551234', nacionalidad: 'Argentina', localidad: 'Capital Federal', domicilio: 'Av. Corrientes 1234 5° B', doc_tipo: 'DNI', doc_numero: String(doc), anio_nac: 1990 });
const checkin = async (codigo, nom) => {
  const s = await llamar('checkin_canjear', { p_codigo: String(codigo) }, `198.51.100.${ipN++}`);
  return s.ok ? llamar('checkin_enviar', { p_token: s.token, p_datos: DATOS(nom, docN++), p_idioma: 'es', p_acepta: true }) : s;
};
r = await llamar('recepcion_llegada_iniciar', { p_clave: lucia, p_id: anotada.id, p_habitacion: '107', p_monto: 100000, p_moneda: 'ARS', p_medio_pago: 2, p_fecha: hoy, p_pago_hotel: 70000, p_fecha_sena: AR(-3), p_noches: 2, p_canal: DIRECTO, p_categoria: DOBLE, p_huespedes: 3 });
ok(r.ok === true, '(recepción hace el check-in de la reserva de Juan: Recepción da el código)');
const idEst = r.id;
await limpiarLlamadas();
const cod = (await estado(lucia)).codigo.valor;
ok((await checkin(cod, 'Ana')).ok === true, 'entra el primer huésped (Ana)');
ll = await llamadas();
q = await ultima();
ok(ll.length === 1 && q.titulo === 'Check-in realizado' && q.cuerpo.includes('Hab. 107') && q.cuerpo.includes('Juan Pérez') && q.cuerpo.includes('1 de 3 huéspedes'), 'sale «Check-in realizado: Hab. 107 · Juan Pérez · 1 de 3 huéspedes»');
ok(destinosDe(ll[0]).join() === 'carla,dueno', 'le llega al dueño y a Carla, no a recepción');
ok(!q.cuerpo.includes('Ana') && !q.cuerpo.includes('ana@') && !q.cuerpo.includes('Apellido') && !q.cuerpo.includes('36000') && !q.cuerpo.includes('1155'), 'sin datos del huésped: ni nombre, ni documento, ni email, ni teléfono');
ok(ll[0].body.tag === `checkin-${idEst}`, 'con una etiqueta por reserva: el segundo aviso reemplaza al primero en vez de apilarse');
await limpiarLlamadas();
await checkin(cod, 'Beto');
await checkin(cod, 'Caro');
q = await ultima();
ok((await llamadas()).length === 2 && q.cuerpo.includes('3 de 3 huéspedes') && q.cuerpo.includes('reserva completa'), 'al entrar el último dice «3 de 3 huéspedes · reserva completa»');
console.log('   — y a quién NO se le avisa:');
// el dueño da el código: no se le avisa a él de lo que él mismo habilitó
const B = (await anotar({ p_titular: 'Con código del dueño', p_habitacion: '501', p_huespedes: 2, p_ingreso: hoy })).id;
await limpiarLlamadas();
await llamar('recepcion_llegada_iniciar', { p_clave: dueno, p_id: B, p_habitacion: '501', p_monto: 50000, p_moneda: 'ARS', p_medio_pago: 2, p_fecha: hoy, p_pago_hotel: 50000, p_noches: 2, p_canal: DIRECTO, p_categoria: DOBLE, p_huespedes: 2 }).catch(() => null);
const codD = (await estado(dueno)).codigo?.valor;
await limpiarLlamadas();
if (codD) await checkin(codD, 'Dani');
ll = await llamadas();
ok(codD && ll.length === 1 && destinosDe(ll[0]).join() === 'carla', 'si el dueño dio el código, el aviso no le llega a él (a Carla sí)');
console.log('   — el dueño prende «avisar los check-ins también a recepción»:');
await llamar('admin_push_config', { p_clave: dueno, p_checkin_recepcion: true });
await limpiarLlamadas();
await checkin(codD, 'Eli');
ll = await llamadas();
ok(ll.length === 1 && destinosDe(ll[0]).join() === 'carla,lucia,martin', 'ahora le llega también a recepción (Recepción y Martín) y a Carla; el dueño, que dio el código, no');
await llamar('admin_push_config', { p_clave: dueno, p_checkin_recepcion: false });

console.log('\n== 7. Las sesiones cerradas ya no reciben');
await limpiarLlamadas();
await llamar('sesion_cerrar', { p_token: martin });
await anotar({ p_titular: 'Sin Martín', p_habitacion: '601', p_ingreso: AR(2) });
ll = await llamadas();
ok(destinosDe(ll[0]).join() === 'lucia', 'Martín cerró la sesión: el aviso le llega solo a Recepción');
ok((await llamar('admin_push_config', { p_clave: dueno })).dispositivos.recepcion === 1, 'y los ajustes cuentan un celular menos de recepción');
await back.sql(`update private.sesiones set vence = now() - interval '1 minute' where token_hash = encode(extensions.digest($1, 'sha256'), 'hex')`, [lucia]);
await limpiarLlamadas();
await anotar({ p_titular: 'Sin nadie', p_habitacion: '602', p_ingreso: AR(2) });
ok((await llamadas()).length === 0, 'una sesión vencida tampoco recibe (y si no queda nadie, no se llama a nadie)');
const luciaNueva = (await llamar('sesion_entrar', { p_clave: CLAVE_RECEPCION }, '203.0.113.23')).token;
lucia = luciaNueva; // de acá en adelante Recepción usa la sesión nueva (la anterior venció)
await suscribir(luciaNueva, CEL.lucia);
await limpiarLlamadas();
await anotar({ p_titular: 'Con sesión nueva', p_habitacion: '603', p_ingreso: AR(2) });
ll = await llamadas();
ok(destinosDe(ll[0]).join() === 'lucia', 'al volver a entrar, la app vuelve a atar el celular a la sesión nueva y los avisos siguen');
ok(await n('select count(*)::int n from private.push_suscripciones where endpoint = $1', [CEL.lucia.endpoint]) === 1, 'sin duplicar el celular');

console.log('\n== 8. Un fallo al avisar nunca frena la operación');
await back.exec(NET_ROTO);
await limpiarLlamadas();
r = await anotar({ p_titular: 'Con el servidor roto', p_habitacion: '701', p_huespedes: 2, p_ingreso: hoy });
ok(r.ok === true, 'con el servidor de avisos caído, anotar una reserva funciona igual');
const C = r.id;
r = await llamar('recepcion_llegada_iniciar', { p_clave: lucia, p_id: C, p_habitacion: '701', p_monto: 50000, p_moneda: 'ARS', p_medio_pago: 2, p_fecha: hoy, p_pago_hotel: 50000, p_noches: 1, p_canal: DIRECTO, p_categoria: DOBLE, p_huespedes: 2 });
ok(r.ok === true, 'y también el check-in de recepción');
const codR = (await estado(lucia)).codigo.valor;
ok((await checkin(codR, 'Fede')).ok === true, 'y el check-in del huésped, que es lo más importante');
ok(await n(`select count(*)::int n from private.checkins where datos->>'nombre' = 'Fede'`) === 1, 'el huésped quedó registrado');
await back.exec(FALSO_NET);
await back.sql(`update private.push_config set url = null where id = 1`);
r = await anotar({ p_titular: 'Sin configurar', p_habitacion: '702', p_ingreso: AR(2) });
ok(r.ok === true, 'y sin configurar el servidor de avisos tampoco pasa nada');
await back.sql(`update private.push_config set url = 'https://hotel.ejemplo.test/api/push' where id = 1`);

console.log('\n== 9. Aviso de prueba, limpieza y topes');
await limpiarLlamadas();
r = await llamar('push_prueba', { p_clave: lucia, p_endpoint: CEL.lucia.endpoint });
ll = await llamadas();
ok(r.ok && r.configurado && ll.length === 1 && destinosDe(ll[0]).join() === 'lucia' && ll[0].body.titulo === 'Aviso de prueba', 'el aviso de prueba llega solo al celular de quien lo pide');
ok((await llamar('push_prueba', { p_clave: lucia, p_endpoint: CEL.dueno.endpoint }, '203.0.113.50')).error === 'no_existe', 'y no se puede probar el celular de otro');
for (let i = 0; i < 6; i += 1) r = await llamar('push_prueba', { p_clave: lucia, p_endpoint: CEL.lucia.endpoint }, '203.0.113.60');
ok(r.ok === false && r.error === 'demasiados_intentos', 'las pruebas tienen freno (no se puede inundar de avisos)');
r = await llamar('push_limpiar', { p_secreto: 'secreto-equivocado', p_endpoints: arreglo([CEL.lucia.endpoint]) }, '203.0.113.70');
ok(r.ok === false && r.error === 'clave_incorrecta' && await n('select count(*)::int n from private.push_suscripciones where endpoint = $1', [CEL.lucia.endpoint]) === 1, 'sacar celulares de la lista exige el secreto');
for (let i = 0; i < 9; i += 1) r = await llamar('push_limpiar', { p_secreto: `mal-${i}`, p_endpoints: arreglo([]) }, '203.0.113.71');
ok(r.error === 'demasiados_intentos', 'y probar secretos tiene freno');
r = await llamar('push_limpiar', { p_secreto: 'secreto-de-prueba', p_endpoints: arreglo([CEL.carla.endpoint, 'https://no.existe.test/uno']) }, '203.0.113.72');
ok(r.ok === true && await n('select count(*)::int n from private.push_suscripciones where endpoint = $1', [CEL.carla.endpoint]) === 0, 'con el secreto, la función de envío saca los celulares que ya no existen');
for (let i = 0; i < 10; i += 1) await suscribir(dueno, celular(`viejo${i}`), '203.0.113.80');
ok(await n('select count(*)::int n from private.push_suscripciones where usuario_id = 0') === 8, 'cada persona junta como máximo 8 celulares (los más nuevos)');
await back.sql(`update private.push_suscripciones set visto = now() - interval '46 days' where endpoint like '%viejo%'`);
await back.sql(`update private.push_cola set creado = now() - interval '4 days'`);
await anotar({ p_titular: 'Limpieza', p_habitacion: '703', p_ingreso: AR(2) });
ok(await n(`select count(*)::int n from private.push_suscripciones where endpoint like '%viejo%'`) === 0, 'los celulares que no abren la app hace más de 45 días se sacan solos');
ok(await n(`select count(*)::int n from private.push_cola where creado < now() - interval '3 days'`) === 0, 'y la cola de avisos se vacía a los 3 días');

console.log('\n== 10. Pasar de la versión publicada hoy a esta');
const viejo = await iniciarBackend({ puerto: 54388, estadias: false });
await viejo.sql(`update private.checkin_config set activo = true, usos_max = 20 where id = 1`);
await viejo.sql(SQL_RECEPCION, [CLAVE_RECEPCION]);
await viejo.exec(fs.readFileSync(new URL('./fixtures/estadias-v4.sql', import.meta.url), 'utf8')); // el estadias.sql que hoy está en producción
const llamarV = (nom, a) => viejo.llamar(nom, a, '203.0.113.8');
const recV = (await llamarV('sesion_entrar', { p_clave: CLAVE_RECEPCION })).token;
const duenoV = (await llamarV('sesion_entrar', { p_clave: CLAVE_ADMIN })).token;
const aV = await llamarV('admin_anotada_guardar', { p_clave: duenoV, p_id: null, p_titular: 'Antes', p_ingreso: AR(1), p_habitacion: '201', p_noches: 1, p_categoria: DOBLE, p_canal: DIRECTO, p_huespedes: 1, p_efectivo: 50000 });
const huella = async () => (await viejo.sql(`select md5(string_agg(concat_ws('|', id, titular, fecha_ingreso, habitacion, precio_efectivo, huespedes_esperados, cargado_por), ';' order by id)) as k from private.reservas_anotadas`))[0];
const h0 = await huella();
const sql = fs.readFileSync(new URL('../supabase/estadias.sql', import.meta.url), 'utf8');
await viejo.exec(sql);
await viejo.exec(sql);
ok(JSON.stringify(await huella()) === JSON.stringify(h0), 'las reservas anotadas quedan idénticas, aun aplicando el archivo dos veces');
ok((await viejo.sql(`select count(*)::int n from private.push_suscripciones`))[0].n === 0 && (await viejo.sql(`select con_nombre, checkin_a_recepcion, url from private.push_config`))[0].con_nombre === true, 'no hay celulares registrados y la configuración arranca con el nombre en el aviso y sin servidor conectado');
const aV2 = await llamarV('admin_anotada_guardar', { p_clave: duenoV, p_id: null, p_titular: 'Después', p_ingreso: AR(1), p_habitacion: '202', p_noches: 1, p_categoria: DOBLE, p_canal: DIRECTO, p_huespedes: 1, p_efectivo: 50000 });
ok(aV.ok && aV2.ok, 'se puede seguir anotando reservas sobre la base migrada (sin pg_net ni celulares, avisar no hace nada y no falla)');
const iV = await llamarV('recepcion_llegada_iniciar', { p_clave: recV, p_id: aV2.id, p_habitacion: '202', p_monto: 50000, p_moneda: 'ARS', p_medio_pago: 2, p_fecha: hoy, p_pago_hotel: 50000, p_noches: 1, p_canal: DIRECTO, p_categoria: DOBLE, p_huespedes: 1 });
const codV = (await llamarV('recepcion_estado', { p_clave: recV })).codigo.valor;
const sV = await llamarV('checkin_canjear', { p_codigo: codV });
ok(iV.ok && (await llamarV('checkin_enviar', { p_token: sV.token, p_datos: DATOS('Nuevo', 37000000), p_idioma: 'es', p_acepta: true })).ok === true, 'y el check-in funciona');
await viejo.cerrar();

await back.cerrar();
console.log(fallas ? `\n${fallas} fallas` : '\nTodo bien');
process.exit(fallas ? 1 : 0);
