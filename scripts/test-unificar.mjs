// Unificar reservas repetidas (lo aprueba el dueño): dos armadas, dos anotadas, o una anotada con una armada. La que sobra no se borra: queda eliminada con el número de la que se conservó.
//   node scripts/test-unificar.mjs
// Usa la base de prueba en memoria con schema.sql + checkin.sql + estadias.sql y llama a las funciones como lo hace la guía (rol "anon").
// La parte 7 arma una base como la publicada hoy (scripts/fixtures/estadias-v8.sql), con reservas ya cargadas, y le aplica el archivo nuevo dos veces.
import fs from 'node:fs';
import { CLAVE_ADMIN, CLAVE_RECEPCION, SQL_RECEPCION, iniciarBackend } from './backend-local.mjs';

let fallas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK    ' : 'FALLA '}${m}`); if (!c) fallas += 1; };

const back = await iniciarBackend({ puerto: 54406, estadias: true });
await back.sql(`update private.checkin_config set activo = true, usos_max = 20, dias_recepcion = 5 where id = 1`);
await back.sql(SQL_RECEPCION, [CLAVE_RECEPCION]);
const llamar = (n, a, ip = '203.0.113.7') => back.llamar(n, a, ip);
const rec = (await llamar('sesion_entrar', { p_clave: CLAVE_RECEPCION })).token;
const dueno = (await llamar('sesion_entrar', { p_clave: CLAVE_ADMIN })).token;
const AR = (n = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(Date.now() + n * 864e5));
const hoy = AR();
const idDe = async (tipo, nombre) => (await back.sql(`select id from private.catalogo where tipo = $1 and nombre = $2`, [tipo, nombre]))[0].id;
const DIRECTO = await idDe('canal', 'Directo');
const DOBLE = await idDe('categoria', 'Doble');
const EFECTIVO = (await back.sql(`select id from private.medios_pago where nombre = 'Efectivo'`))[0].id;
const n = async (sql, p = []) => (await back.sql(sql, p))[0].n;

const DATOS = (nom, doc) => ({ nombre: nom, apellido: 'Prueba', email: `${nom.toLowerCase()}@correo.com`, telefono: '+541155551234', nacionalidad: 'Argentina', localidad: 'Capital Federal', domicilio: 'Av. Corrientes 1234 5° B', doc_tipo: 'DNI', doc_numero: String(doc), anio_nac: 1990 });
let ipN = 10;
let docN = 37000000;
const entra = async (nom) => {
  const codigo = (await llamar('recepcion_estado', { p_clave: rec })).codigo.valor;
  const s = await llamar('checkin_canjear', { p_codigo: String(codigo) }, `198.51.100.${ipN++}`);
  return s.ok ? llamar('checkin_enviar', { p_token: s.token, p_datos: DATOS(nom, docN++), p_idioma: 'es', p_acepta: true }) : s;
};
const rapida = (hab, hues = 2, monto = 63800) => llamar('recepcion_reserva_nueva', { p_clave: rec, p_habitacion: hab, p_monto: monto, p_moneda: 'ARS', p_medio_pago: EFECTIVO, p_fecha: hoy, p_pago_hotel: monto, p_fecha_sena: null, p_noches: 1, p_canal: DIRECTO, p_categoria: DOBLE, p_huespedes: hues });
const anotar = (extra = {}) => llamar('admin_anotada_guardar', {
  p_clave: dueno, p_id: null, p_titular: 'Maldonado', p_ingreso: hoy, p_habitacion: '202', p_noches: 1, p_categoria: DOBLE, p_canal: DIRECTO, p_huespedes: 2,
  p_efectivo: 63800, p_transferencia: null, p_usd: null, p_sena: 0, p_fecha_sena: null, p_nota: null, ...extra
});
const iniciar = (id, hab, hues = 2) => llamar('recepcion_llegada_iniciar', { p_clave: rec, p_id: id, p_habitacion: hab, p_monto: 63800, p_moneda: 'ARS', p_medio_pago: EFECTIVO, p_fecha: hoy, p_pago_hotel: 63800, p_fecha_sena: null, p_noches: 1, p_canal: DIRECTO, p_categoria: DOBLE, p_huespedes: hues });
const unificar = (a, b, conservar = null, quien = dueno) => llamar('admin_reservas_unificar', { p_clave: quien, p_a: a, p_b: b, p_conservar: conservar });
const datos = async (quien = dueno) => llamar('recepcion_proximas', { p_clave: quien });
const numE = async (id) => (await back.sql(`select numero::int as n from private.estadias where id = $1`, [id]))[0].n;
const numA = async (id) => (await back.sql(`select numero::int as n from private.reservas_anotadas where id = $1`, [id]))[0].n;
const fila = async (id) => (await back.sql(`select anulada_en is not null as anulada, unificada_con::int as unificada, huespedes_esperados as esperados, titular, nota from private.estadias where id = $1`, [id]))[0];
const guestsDe = (id) => n(`select count(*)::int as n from private.checkins_activos where estadia_id = $1`, [id]);

console.log('\n== 1. Dos reservas armadas repetidas (la 114 con el código dado dos veces, y una con huéspedes)');
const e1 = await rapida('301', 2);
await entra('Ana'); await entra('Luis');
const e2 = await rapida('301', 2); // la repetida: copiada y sin huéspedes
const n1 = await numE(e1.id);
const n2 = await numE(e2.id);
ok(e1.ok && e2.ok && n1 !== n2, `dos reservas armadas en la 301: N.º ${n1} (con 2 huéspedes) y N.º ${n2} (vacía)`);
let r = await unificar(`e${e1.id}`, `e${e2.id}`);
ok(r.ok === true && r.conservada === `e${e1.id}` && r.numero === n1, 'se unifican: sin elegir, se queda la que tiene huéspedes (la N.º ' + n1 + ')');
let f = await fila(e2.id);
ok(f.anulada === true && f.unificada === n1, `la vacía queda eliminada (no se borró) y marcada «unificada con la N.º ${n1}»`);
ok((await guestsDe(e1.id)) === 2 && (await n(`select count(*)::int as n from private.estadias where id = $1`, [e2.id])) === 1, 'la que se conserva sigue con sus 2 huéspedes y la otra sigue guardada en la base');
ok((await llamar('admin_estadisticas', { p_clave: dueno })).reservas.length === 1, 'las estadísticas siguen contando una sola reserva');
const el = (await datos()).eliminadas.find((x) => x.tipo === 'estadia' && x.id === e2.id);
ok(el?.unificada === n1 && el.numero === n2, 'el dueño la ve en «Eliminadas» con «unificada con la N.º ' + n1 + '»');
ok((await llamar('admin_reserva_anular', { p_clave: dueno, p_id: e2.id, p_anular: false })).ok === true && (await fila(e2.id)).unificada == null && (await fila(e2.id)).anulada === false, 'si se restaura, vuelve y se borra la marca de unificada');
r = await unificar(`e${e1.id}`, `e${e2.id}`);
ok(r.ok === true, 'se puede volver a unificar');

console.log('\n== 2. Dos armadas con un huésped cada una: los huéspedes pasan a la que se conserva');
const e3 = await rapida('302', 1);
await entra('Zoe');
const e4 = await rapida('302', 1);
await entra('Yago');
const n3 = await numE(e3.id);
const n4 = await numE(e4.id);
const codigoApunta = async () => (await back.sql(`select estadia_id::int as e from private.codigos_usuario where usuario_id = (select id from private.usuarios where alias = 'Recepción' limit 1)`).catch(() => [{ e: null }]))[0]?.e;
r = await unificar(`e${e3.id}`, `e${e4.id}`, `e${e4.id}`);
ok(r.ok === true && r.conservada === `e${e4.id}` && r.numero === n4, `eligiendo la N.º ${n4}, esa es la que se queda`);
ok((await guestsDe(e4.id)) === 2 && (await guestsDe(e3.id)) === 0, 'los 2 huéspedes (Zoe y Yago) quedan en la que se conserva; la otra sin ninguno');
f = await fila(e4.id);
ok(f.esperados >= 2, 'y esa reserva espera, como mínimo, a los 2 que ya tiene');
ok((await fila(e3.id)).anulada === true && (await fila(e3.id)).unificada === n4, 'la otra queda eliminada, «unificada con la N.º ' + n4 + '»');
ok((await n(`select count(*)::int as n from private.checkins where estadia_id = $1 and quitado_en is not null`, [e3.id])) === 0, 'y los huéspedes no se «quitaron»: pasaron de reserva, siguen contando una vez');
const aud = await back.sql(`select detalle from private.checkin_auditoria where accion = 'reservas_unificar' order by id desc limit 1`);
ok(JSON.stringify(aud[0]?.detalle ?? '').includes('"registros_movidos":1') && JSON.stringify(aud[0].detalle).includes(`"conserva":${e4.id}`), 'queda en el registro de movimientos: cuál se conservó y cuántos huéspedes se movieron');

console.log('\n== 3. Lo que no se puede unificar');
const e5 = await rapida('303', 1);
const e6 = await rapida('304', 1);
r = await unificar(`e${e5.id}`, `e${e6.id}`);
ok(r.ok === false && r.error === 'habitacion_distinta', 'no se unen reservas de habitaciones distintas');
r = await unificar(`e${e5.id}`, `e${e3.id}`);
ok(r.ok === false && (r.error === 'reserva_anulada' || r.error === 'habitacion_distinta'), 'ni con una ya eliminada');
const e7 = await rapida('303', 1);
await back.sql(`update private.estadias set creado = now() - interval '20 days' where id = $1`, [e7.id]);
r = await unificar(`e${e5.id}`, `e${e7.id}`);
ok(r.ok === false && r.error === 'fechas_lejanas', 'ni reservas con más de 10 días de diferencia');
r = await unificar(`e${e5.id}`, `e${e5.id}`);
ok(r.ok === false && r.error === 'misma_reserva', 'ni una consigo misma');
r = await unificar(`e${e5.id}`, 'e999999');
ok(r.ok === false && r.error === 'no_existe', 'ni una que no existe');
const e8 = await rapida('303', 1);
r = await unificar(`e${e5.id}`, `e${e8.id}`, 'e12345');
ok(r.ok === false && r.error === 'conservar_invalido', 'ni conservando una que no es ninguna de las dos');
for (const raro of [['x1', 'e1'], ['e1', 'a'], ["e1'; drop table private.estadias; --", 'e2'], [null, 'e2'], ['e1', ''], ['e1 ', 'e2']]) {
  r = await unificar(raro[0], raro[1]);
  if (r.ok !== false || r.error !== 'datos_invalidos') { ok(false, `datos raros ${JSON.stringify(raro)} → ${JSON.stringify(r)}`); }
}
ok(true, 'datos raros o inyección (letras, vacíos, comillas, sin número) se rechazan como «datos_invalidos»');
ok((await n(`select count(*)::int as n from private.estadias`)) >= 8, 'y no se tocó nada');
r = await unificar(`e${e5.id}`, `e${e8.id}`, null, rec);
ok(r.ok === false, 'recepción no puede unificar (lo aprueba el dueño)');
ok((await unificar(`e${e5.id}`, `e${e8.id}`, null, 'clave-mala')).ok === false && (await unificar(`e${e5.id}`, `e${e8.id}`, null, '')).ok === false, 'sin clave o con una mala, tampoco');
ok((await fila(e8.id)).anulada === false, 'y la reserva sigue como estaba');

console.log('\n== 4. Armada con anotada (cada una con su historia)');
const aX = await anotar({ p_titular: 'Con anotada', p_habitacion: '305' });
const iX = await iniciar(aX.id, '305', 1); // armada que sale de la anotada
await entra('Pau');
const eY = await rapida('305', 1); // repetida suelta
await entra('Pepe');
r = await unificar(`e${iX.id}`, `e${eY.id}`, `e${eY.id}`);
ok(r.ok === false && r.error === 'conservar_invalido', 'se tiene que quedar la que viene de una anotada: no se puede conservar la suelta');
r = await unificar(`e${iX.id}`, `e${eY.id}`);
ok(r.ok === true && r.conservada === `e${iX.id}`, 'sin elegir, se queda la que viene de la anotada');
ok((await guestsDe(iX.id)) === 2 && (await fila(eY.id)).anulada === true, 'con los huéspedes de las dos');
// al revés: la suelta es la más vieja y la que tiene más huéspedes, pero igual se queda la que viene de la anotada
const eSuelta = await rapida('307', 2);
await entra('Uno'); await entra('Dos');
const aQ = await anotar({ p_titular: 'Anotada nueva', p_habitacion: '307' });
const iQ = await iniciar(aQ.id, '307', 2);
r = await unificar(`e${eSuelta.id}`, `e${iQ.id}`);
ok(r.ok === true && r.conservada === `e${iQ.id}` && (await guestsDe(iQ.id)) === 2, 'aunque la suelta sea más vieja y tenga más huéspedes, se queda la que viene de la anotada (y recibe a los huéspedes)');
const aZ = await anotar({ p_titular: 'Otra con anotada', p_habitacion: '306' });
const aW = await anotar({ p_titular: 'Y otra', p_habitacion: '306' });
const iZ = await iniciar(aZ.id, '306', 1);
const iW = await iniciar(aW.id, '306', 1);
r = await unificar(`e${iZ.id}`, `e${iW.id}`);
ok(r.ok === false && r.error === 'ambas_con_anotada', 'dos armadas que vienen de anotadas distintas no se unifican');

console.log('\n== 5. Dos anotadas repetidas');
const a1 = await anotar({ p_titular: 'Pérez Juan', p_habitacion: '401' });
const a2 = await anotar({ p_titular: 'Juan Pérez', p_habitacion: '401', p_nota: 'Llega tarde' });
const na1 = await numA(a1.id);
const na2 = await numA(a2.id);
r = await unificar(`a${a1.id}`, `a${a2.id}`);
ok(r.ok === true && r.conservada === `a${a1.id}` && r.numero === na1, `sin elegir, se queda la más vieja (N.º ${na1})`);
const filaA = async (id) => (await back.sql(`select cancelada_en is not null as cancelada, unificada_con::int as unificada, nota, titular from private.reservas_anotadas where id = $1`, [id]))[0];
let fa = await filaA(a2.id);
ok(fa.cancelada === true && fa.unificada === na1, `la otra (N.º ${na2}) queda cancelada, «unificada con la N.º ${na1}», sin borrarse`);
ok((await filaA(a1.id)).nota === 'Llega tarde' && (await filaA(a1.id)).titular === 'Pérez Juan', 'la que se conserva toma la nota que le faltaba y mantiene su nombre');
ok((await datos()).eliminadas.some((x) => x.tipo === 'anotada' && x.id === a2.id && x.unificada === na1), 'aparece en «Eliminadas» como unificada');
ok((await llamar('admin_anotada_cancelar', { p_clave: dueno, p_id: a2.id, p_cancelar: false })).ok === true && (await filaA(a2.id)).unificada == null, 'y al restaurarla se borra la marca');
const a3 = await anotar({ p_titular: 'Elegida', p_habitacion: '401' });
r = await unificar(`a${a2.id}`, `a${a3.id}`, `a${a3.id}`);
ok(r.ok === true && r.conservada === `a${a3.id}` && (await filaA(a2.id)).cancelada === true, 'se puede elegir cuál se queda');
const a4 = await anotar({ p_titular: 'Empezada', p_habitacion: '402' });
const a5 = await anotar({ p_titular: 'Otra', p_habitacion: '402' });
await iniciar(a4.id, '402', 2);
r = await unificar(`a${a4.id}`, `a${a5.id}`);
ok(r.ok === false && r.error === 'anotada_ya_empezo', 'una que ya empezó el check-in no se unifica con otra anotada');
const a6 = await anotar({ p_titular: 'Cancelada', p_habitacion: '403' });
const a7 = await anotar({ p_titular: 'Viva', p_habitacion: '403' });
await llamar('admin_anotada_cancelar', { p_clave: dueno, p_id: a6.id, p_cancelar: true });
r = await unificar(`a${a6.id}`, `a${a7.id}`);
ok(r.ok === false && r.error === 'anotada_cancelada', 'ni una cancelada');
const a8 = await anotar({ p_titular: 'Lejos', p_habitacion: '403', p_ingreso: AR(20) });
r = await unificar(`a${a7.id}`, `a${a8.id}`);
ok(r.ok === false && r.error === 'fechas_lejanas', 'ni anotadas con más de 10 días de diferencia');
const a9 = await anotar({ p_titular: 'Otra hab', p_habitacion: '404' });
r = await unificar(`a${a7.id}`, `a${a9.id}`);
ok(r.ok === false && r.error === 'habitacion_distinta', 'ni de otra habitación');

console.log('\n== 6. Anotada con armada (en cualquier orden) y descartar la sugerencia');
const aM = await anotar({ p_titular: 'Maldonado Gianfranco', p_habitacion: '202', p_ingreso: AR(-1) });
const eM = await rapida('202', 2);
await entra('Johanna'); await entra('Gianfranco');
r = await unificar(`e${eM.id}`, `a${aM.id}`, null, rec);
ok(r.ok === false && (await datos()).reservas.find((x) => x.id === aM.id)?.estado === 'anotada', 'recepción no puede (anotada + armada tampoco) y la anotada sigue esperando');
r = await unificar(`e${eM.id}`, `a${aM.id}`);
ok(r.ok === true && (await numE(eM.id)) === (await numA(aM.id)), 'el dueño sí, también con la armada primero: la reserva queda con el número de la anotada');
const dd = await datos();
ok(dd.estadias.find((x) => x.id === eM.id)?.titular === 'Maldonado Gianfranco' && dd.reservas.find((x) => x.id === aM.id)?.estado === 'en_curso', 'y con el nombre de la anotada');
ok(dd.estadias.find((x) => x.id === eM.id)?.monto === 63800 && dd.estadias.find((x) => x.id === eM.id)?.moneda === 'ARS', 'las reservas armadas traen lo cobrado, para decidir cuál conservar');
ok(Array.isArray(dd.descartadas) && dd.descartadas.length === 0, 'al principio no hay sugerencias descartadas');
const d1 = await llamar('admin_repetida_descartar', { p_clave: dueno, p_a: 'e9', p_b: 'a3' });
ok(d1.ok === true && (await datos(rec)).descartadas.join() === 'a3|e9', 'el dueño descarta una sugerencia: queda guardada siempre en el mismo orden (a3|e9) y la ven todos');
ok((await llamar('admin_repetida_descartar', { p_clave: dueno, p_a: 'a3', p_b: 'e9' })).ok === true && (await datos()).descartadas.length === 1, 'repetirla (al revés) no duplica nada');
ok((await llamar('admin_repetida_descartar', { p_clave: rec, p_a: 'a3', p_b: 'e9' })).ok === false, 'recepción no puede descartar');
ok((await llamar('admin_repetida_descartar', { p_clave: dueno, p_a: 'a3', p_b: 'a3' })).error === 'datos_invalidos' && (await llamar('admin_repetida_descartar', { p_clave: dueno, p_a: 'z3', p_b: 'a1' })).error === 'datos_invalidos', 'y rechaza datos raros');

console.log('\n== 7. Pasar de la versión publicada hoy a esta, con reservas ya cargadas');
const viejo = await iniciarBackend({ puerto: 54407, estadias: false });
await viejo.sql(`update private.checkin_config set activo = true, usos_max = 20, dias_recepcion = 5 where id = 1`);
await viejo.sql(SQL_RECEPCION, [CLAVE_RECEPCION]);
await viejo.exec(fs.readFileSync(new URL('./fixtures/estadias-v8.sql', import.meta.url), 'utf8')); // el estadias.sql que hoy está en producción
const llamarV = (nom, x) => viejo.llamar(nom, x, '203.0.113.8');
const recV = (await llamarV('sesion_entrar', { p_clave: CLAVE_RECEPCION })).token;
const duenoV = (await llamarV('sesion_entrar', { p_clave: CLAVE_ADMIN })).token;
const rapV = (hab) => llamarV('recepcion_reserva_nueva', { p_clave: recV, p_habitacion: hab, p_monto: 50000, p_moneda: 'ARS', p_medio_pago: EFECTIVO, p_fecha: hoy, p_pago_hotel: 50000, p_fecha_sena: null, p_noches: 1, p_canal: DIRECTO, p_categoria: DOBLE, p_huespedes: 1 });
const vA = await rapV('501');
const vB = await rapV('501');
const huella = async () => JSON.stringify(await viejo.sql(`select id, numero::int n, habitacion, monto, huespedes_esperados from private.estadias order by id`));
const h0 = await huella();
const sql = fs.readFileSync(new URL('../supabase/estadias.sql', import.meta.url), 'utf8');
await viejo.exec(sql);
await viejo.exec(sql);
ok(await huella() === h0, 'las reservas quedan idénticas (también sus números), aun aplicando el archivo dos veces');
ok((await llamarV('recepcion_proximas', { p_clave: duenoV })).descartadas?.length === 0, 'recepcion_proximas ya manda «descartadas»');
r = await llamarV('admin_reservas_unificar', { p_clave: duenoV, p_a: `e${vA.id}`, p_b: `e${vB.id}` });
ok(r.ok === true, 'sobre la base migrada se puede unificar');
ok((await llamarV('recepcion_proximas', { p_clave: duenoV })).eliminadas.some((x) => x.id === vB.id && x.unificada != null), 'y la que sobró aparece en «Eliminadas» como unificada');
await viejo.cerrar();

await back.cerrar();
console.log(fallas ? `\n${fallas} fallas` : '\nTodo bien');
process.exit(fallas ? 1 : 0);
