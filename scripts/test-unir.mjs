// Reservas duplicadas: una reserva anotada que sigue figurando como «todavía no llegó» porque el huésped hizo el check-in en OTRA reserva abierta aparte (por ejemplo una reserva
// rápida en la misma habitación). «Unir» la deja como la misma reserva, con su nombre, sin tocar lo cobrado ni a los huéspedes.
//   node scripts/test-unir.mjs
// Usa la base de prueba en memoria con schema.sql + checkin.sql + estadias.sql y llama a las funciones como lo hace la guía (rol "anon").
// La parte 6 arma una base como la publicada hoy (scripts/fixtures/estadias-v7.sql) y le aplica el archivo nuevo dos veces.
import fs from 'node:fs';
import { CLAVE_ADMIN, CLAVE_RECEPCION, SQL_RECEPCION, iniciarBackend } from './backend-local.mjs';

let fallas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK    ' : 'FALLA '}${m}`); if (!c) fallas += 1; };

const back = await iniciarBackend({ puerto: 54402, estadias: true });
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
let docN = 35000000;
const entra = async (nom) => {
  const codigo = (await llamar('recepcion_estado', { p_clave: rec })).codigo.valor;
  const s = await llamar('checkin_canjear', { p_codigo: String(codigo) }, `198.51.100.${ipN++}`);
  return s.ok ? llamar('checkin_enviar', { p_token: s.token, p_datos: DATOS(nom, docN++), p_idioma: 'es', p_acepta: true }) : s;
};
const rapida = (hab, hues = 2, monto = 63800) => llamar('recepcion_reserva_nueva', { p_clave: rec, p_habitacion: hab, p_monto: monto, p_moneda: 'ARS', p_medio_pago: EFECTIVO, p_fecha: hoy, p_pago_hotel: monto, p_fecha_sena: null, p_noches: 1, p_canal: DIRECTO, p_categoria: DOBLE, p_huespedes: hues });
const anotar = (extra = {}) => llamar('admin_anotada_guardar', {
  p_clave: dueno, p_id: null, p_titular: 'Maldonado Gianfranco', p_ingreso: AR(-1), p_habitacion: '202', p_noches: 1, p_categoria: DOBLE, p_canal: DIRECTO, p_huespedes: 2,
  p_efectivo: 63800, p_transferencia: null, p_usd: null, p_sena: 0, p_fecha_sena: null, p_nota: 'Booking', ...extra
});
const iniciar = (id, hab, hues) => llamar('recepcion_llegada_iniciar', { p_clave: rec, p_id: id, p_habitacion: hab, p_monto: 63800, p_moneda: 'ARS', p_medio_pago: EFECTIVO, p_fecha: hoy, p_pago_hotel: 63800, p_fecha_sena: null, p_noches: 1, p_canal: DIRECTO, p_categoria: DOBLE, p_huespedes: hues });
const unir = (a, e, quien = rec) => llamar('recepcion_anotada_unir', { p_clave: quien, p_anotada: a, p_estadia: e });
const datos = async (quien = rec) => llamar('recepcion_proximas', { p_clave: quien });
const anot = async (id, quien = rec) => (await datos(quien)).reservas.find((x) => x.id === id);
const est = async (id, quien = rec) => (await datos(quien)).estadias.find((x) => x.id === id);

console.log('\n== 1. El caso: la reserva anotada espera, pero el huésped ya hizo el check-in en otra reserva de la misma habitación');
const a1 = await anotar();
const e1 = await rapida('202', 2);
ok(a1.ok && e1.ok, 'el dueño anotó a «Maldonado Gianfranco» en la 202 (ayer) y recepción abrió aparte una reserva rápida en la 202');
await entra('Johanna');
await entra('Gianfranco');
let d = await datos();
ok((await anot(a1.id)).estado === 'anotada' && (await anot(a1.id)).dias_para === -1, 'la anotada sigue como «anotada» y atrasada: figura en «Faltan llegar»');
let fila = await est(e1.id);
ok(fila.estado === 'completa' && fila.con_checkin === 2 && fila.titular == null && fila.anotada_id == null, 'y la reserva rápida ya tiene a sus 2 huéspedes adentro (completa), sin nombre y sin anotada: son dos registros de lo mismo');
const stats0 = await llamar('admin_estadisticas', { p_clave: dueno });
ok(stats0.reservas.length === 1, 'las estadísticas cuentan una sola reserva (la anotada no suma hasta que hay huéspedes)');

console.log('\n== 2. El intento de arreglarlo con «Hacer el check-in» crea una segunda reserva vacía; se anula y la anotada vuelve a esperar');
const ini = await iniciar(a1.id, '202', 2);
ok(ini.ok === true, 'se hace el check-in desde la anotada: se abre otra reserva con el código dado');
fila = await est(ini.id);
ok(fila.estado === 'sin_ingresos' && fila.anotada_id === a1.id && fila.con_checkin === 0, 'figura «con el código dado y nadie adentro» (lo que se ve en la pantalla)');
ok((await llamar('recepcion_reserva_anular', { p_clave: rec, p_id: ini.id })).ok === true, 'recepción la anula (esa reserva no tenía huéspedes)');
ok((await anot(a1.id)).estado === 'anotada', 'la anotada vuelve a «anotada» (a la espera), lista para unirla');

console.log('\n== 3. Unir');
let r = await unir(a1.id, e1.id);
ok(r.ok === true, 'recepción une la anotada con la reserva donde ya ingresaron los 2');
const despues = await anot(a1.id);
ok(despues.estado === 'en_curso' && despues.estadia_id === e1.id && despues.con_checkin === 2, 'la anotada pasa a «en curso» enlazada a esa reserva, con los 2 ingresados');
fila = await est(e1.id);
ok(fila.titular === 'Maldonado Gianfranco' && fila.anotada_id === a1.id && fila.estado === 'completa' && fila.llegada === AR(-1), 'la reserva ahora lleva el nombre del titular, sabe de qué anotada viene y su llegada es la que se anotó');
ok((await llamar('recepcion_estado', { p_clave: rec })).llegadas.every((x) => x.id !== a1.id), 'y ya no figura entre las llegadas que esperan');
const stats1 = await llamar('admin_estadisticas', { p_clave: dueno });
ok(stats1.reservas.length === 1 && JSON.stringify(stats1.reservas.map((x) => [x.monto, x.huespedes?.length ?? x.con_checkin])) === JSON.stringify(stats0.reservas.map((x) => [x.monto, x.huespedes?.length ?? x.con_checkin])), 'las estadísticas no cambian: una reserva, mismo monto');
ok(await n(`select count(*)::int n from private.estadias where anulada_en is null and habitacion = '202'`) === 1, 'y queda una sola reserva viva en la 202 (la otra está anulada)');
ok(await n(`select count(*)::int n from private.checkin_auditoria where accion = 'anotada_unir'`) === 1, 'queda anotado en el registro de movimientos');
ok((await unir(a1.id, e1.id)).error === 'anotada_ya_empezo', 'unirla de nuevo no se puede: ya está enlazada');

console.log('\n== 4. Cuándo no se puede unir');
const a2 = await anotar({ p_titular: 'Otra persona', p_habitacion: '202' });
r = await unir(a2.id, e1.id);
ok(r.ok === false && r.error === 'estadia_ya_unida', 'una reserva que ya está unida a una anotada no se une a otra');
const e2 = await rapida('203', 1, 50000);
await entra('Carla');
r = await unir(a2.id, e2.id);
ok(r.ok === false && r.error === 'habitacion_distinta', 'deben ser la misma habitación (202 con 203 no)');
const a3 = await anotar({ p_titular: 'Para cancelar', p_habitacion: '204' });
await llamar('admin_anotada_cancelar', { p_clave: dueno, p_id: a3.id, p_cancelar: true });
const e3 = await rapida('204', 1, 40000);
r = await unir(a3.id, e3.id);
ok(r.ok === false && r.error === 'anotada_cancelada', 'una anotada cancelada no se une');
const e4 = await rapida('205', 1, 40000);
await llamar('recepcion_reserva_anular', { p_clave: rec, p_id: e4.id });
const a4 = await anotar({ p_titular: 'Con anulada', p_habitacion: '205' });
r = await unir(a4.id, e4.id);
ok(r.ok === false && r.error === 'reserva_anulada', 'una reserva anulada no se une');
r = await unir(999999, e2.id);
ok(r.ok === false && r.error === 'no_existe', 'una anotada que no existe, tampoco');
r = await unir(a2.id, 999999);
ok(r.ok === false && r.error === 'no_existe', 'ni una reserva que no existe');
ok((await unir(a2.id, e2.id, 'clave-mala')).ok === false && (await unir(a2.id, e2.id, '')).ok === false, 'sin clave o con una mala no se une nada');
const lejana = await anotar({ p_titular: 'Lejana', p_habitacion: '203', p_ingreso: AR(30) });
r = await unir(lejana.id, e2.id);
ok(r.ok === false && r.error === 'llegada_fuera_de_fecha', 'recepción no une una anotada que llega fuera de sus días');
r = await unir(lejana.id, e2.id, dueno);
ok(r.ok === false && r.error === 'fechas_lejanas', 'ni siquiera el dueño une reservas con más de 10 días de diferencia (no son la misma)');
const media = await anotar({ p_titular: 'A nueve días', p_habitacion: '203', p_ingreso: AR(9) });
r = await unir(media.id, e2.id);
ok(r.ok === false && r.error === 'llegada_fuera_de_fecha', 'recepción, con una anotada de dentro de 9 días (fuera de sus 5), no puede');
r = await unir(media.id, e2.id, dueno);
ok(r.ok === true && (await est(e2.id, dueno)).titular === 'A nueve días', 'el dueño sí (con 9 días de diferencia, hasta 10)');

console.log('\n== 5. Lo que ya tenía nombre lo conserva, y la reserva vencida');
const a5 = await anotar({ p_titular: 'Nombre nuevo', p_habitacion: '206', p_nota: 'Nota nueva' });
const e5 = await rapida('206', 1, 30000);
await entra('Eva');
await back.sql(`update private.estadias set titular = 'Nombre que ya tenía', nota = 'Nota que ya tenía' where id = $1`, [e5.id]);
r = await unir(a5.id, e5.id);
const f5 = await est(e5.id);
ok(r.ok === true && f5.titular === 'Nombre que ya tenía' && f5.nota === 'Nota que ya tenía', 'si la reserva ya tenía nombre y nota, no se pisan');
const a6 = await anotar({ p_titular: 'Vencida', p_habitacion: '207', p_ingreso: AR(-3) });
const e6 = await rapida('207', 1, 30000);
await entra('Dani');
await back.sql(`update private.checkins set creado = now() - interval '9 days' where estadia_id = $1`, [e6.id]);
await back.sql(`update private.estadias set creado = now() - interval '9 days' where id = $1`, [e6.id]);
r = await unir(a6.id, e6.id);
ok(r.ok === false && r.error === 'reserva_vencida', 'recepción no une con una reserva cuya última actividad fue hace más de 5 días');

console.log('\n== 6. Pasar de la versión publicada hoy a esta');
const viejo = await iniciarBackend({ puerto: 54403, estadias: false });
await viejo.sql(`update private.checkin_config set activo = true, usos_max = 20 where id = 1`);
await viejo.sql(SQL_RECEPCION, [CLAVE_RECEPCION]);
await viejo.exec(fs.readFileSync(new URL('./fixtures/estadias-v7.sql', import.meta.url), 'utf8')); // el estadias.sql que hoy está en producción
const llamarV = (nom, x) => viejo.llamar(nom, x, '203.0.113.8');
const recV = (await llamarV('sesion_entrar', { p_clave: CLAVE_RECEPCION })).token;
const duenoV = (await llamarV('sesion_entrar', { p_clave: CLAVE_ADMIN })).token;
const aV = await llamarV('admin_anotada_guardar', { p_clave: duenoV, p_id: null, p_titular: 'Antes', p_ingreso: AR(0), p_habitacion: '301', p_noches: 1, p_categoria: DOBLE, p_canal: DIRECTO, p_huespedes: 1, p_efectivo: 50000, p_transferencia: null, p_usd: null, p_sena: 0, p_fecha_sena: null, p_nota: null });
const eV = await llamarV('recepcion_reserva_nueva', { p_clave: recV, p_habitacion: '301', p_monto: 50000, p_moneda: 'ARS', p_medio_pago: EFECTIVO, p_fecha: hoy, p_pago_hotel: 50000, p_fecha_sena: null, p_noches: 1, p_canal: DIRECTO, p_categoria: DOBLE, p_huespedes: 1 });
const huella = async () => (await viejo.sql(`select md5(string_agg(concat_ws('|', id, habitacion, monto, huespedes_esperados, titular), ';' order by id)) as k from private.estadias`))[0];
const h0 = await huella();
const sql = fs.readFileSync(new URL('../supabase/estadias.sql', import.meta.url), 'utf8');
await viejo.exec(sql);
await viejo.exec(sql);
ok(JSON.stringify(await huella()) === JSON.stringify(h0), 'las reservas quedan idénticas, aun aplicando el archivo dos veces');
ok((await llamarV('recepcion_anotada_unir', { p_clave: recV, p_anotada: aV.id, p_estadia: eV.id })).ok === true, 'sobre la base migrada se puede unir');
ok((await llamarV('recepcion_proximas', { p_clave: recV })).estadias.find((x) => x.id === eV.id)?.titular === 'Antes', 'y la reserva queda con el nombre');
await viejo.cerrar();

await back.cerrar();
console.log(fallas ? `\n${fallas} fallas` : '\nTodo bien');
process.exit(fallas ? 1 : 0);
