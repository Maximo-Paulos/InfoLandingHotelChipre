// Reservas (estadías): habitación + monto antes del código, huéspedes agrupados, año de nacimiento.
//   node scripts/test-estadias.mjs
// Usa la base de prueba en memoria con schema.sql + checkin.sql + estadias.sql y llama a las funciones como lo hace la guía (rol "anon").
import fs from 'node:fs';
import { CLAVE_ADMIN, CLAVE_RECEPCION, SQL_RECEPCION, iniciarBackend } from './backend-local.mjs';

let fallas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK    ' : 'FALLA '}${m}`); if (!c) fallas += 1; };

const back = await iniciarBackend({ puerto: 54399, estadias: true });
await back.sql(`update private.checkin_config set activo = true, usos_max = 20 where id = 1`);
await back.sql(SQL_RECEPCION, [CLAVE_RECEPCION]);
const llamar = (n, a, ip = '203.0.113.7') => back.llamar(n, a, ip);
const rec = (await llamar('sesion_entrar', { p_clave: CLAVE_RECEPCION })).token;
const dueno = (await llamar('sesion_entrar', { p_clave: CLAVE_ADMIN })).token;
const hoy = new Date().toISOString().slice(0, 10);
const reserva = (extra = {}) => ({ p_clave: rec, p_habitacion: '107', p_monto: 85000, p_moneda: 'ARS', p_medio_pago: 2, p_fecha: hoy, ...extra });
const DATOS = (n, doc, anio = 1990) => ({ nombre: n, apellido: 'Prueba', email: `${n.toLowerCase()}@correo.com`, telefono: '+541155551234', nacionalidad: 'Argentina', localidad: 'Capital Federal', domicilio: 'Av. Corrientes 1234 5° B', doc_tipo: 'DNI', doc_numero: String(doc), ...(anio ? { anio_nac: anio } : {}) });
let ipN = 10;
const checkin = async (codigo, datos) => {
  const s = await llamar('checkin_canjear', { p_codigo: String(codigo) }, `198.51.100.${ipN++}`);
  if (!s.ok) return s;
  return llamar('checkin_enviar', { p_token: s.token, p_datos: datos, p_idioma: 'es', p_acepta: true });
};

console.log('\n== 1. Sin reserva no hay código');
let est = await llamar('recepcion_estado', { p_clave: rec });
ok(est.ok && est.activo && est.codigo === null && est.reserva === null, 'recepción no ve ningún código mientras no abre una reserva');
ok((await llamar('checkin_canjear', { p_codigo: '123456' })).error === 'codigo_invalido', 'y un código cualquiera no sirve');

console.log('\n== 2. Abrir una reserva pide todo');
for (const [m, extra, campo] of [
  ['sin habitación', { p_habitacion: '  ' }, 'habitacion'],
  ['habitación muy larga', { p_habitacion: 'x'.repeat(13) }, 'habitacion'],
  ['monto negativo', { p_monto: -1 }, 'monto'],
  ['sin monto', { p_monto: null }, 'monto'],
  ['moneda inventada', { p_moneda: 'EUR' }, 'moneda'],
  ['medio de pago que no existe', { p_medio_pago: 999 }, 'medio_pago'],
  ['fecha lejana', { p_fecha: '2020-01-01' }, 'fecha_cobro']
]) {
  const r = await llamar('recepcion_reserva_nueva', reserva(extra));
  ok(r.ok === false && r.error === 'datos_invalidos' && r.campos.includes(campo), `${m} → ${campo}`);
}
ok((await back.sql('select count(*)::int n from private.estadias'))[0].n === 0, 'ningún intento inválido creó una reserva');
let r = await llamar('recepcion_reserva_nueva', { ...reserva(), p_clave: 'clave-mala' });
ok(r.ok === false, 'sin clave de recepción no se puede');
r = await llamar('recepcion_reserva_nueva', reserva());
ok(r.ok === true, 'una reserva completa se abre');
est = await llamar('recepcion_estado', { p_clave: rec });
ok(est.codigo?.valor?.length === 6 && est.reserva.estadia.habitacion === '107' && Number(est.reserva.estadia.monto) === 85000 && est.reserva.estadia.moneda === 'ARS', 'recepción ve el código y la reserva');
ok(est.reserva.vence_seg > 9 * 60 && est.reserva.vence_seg <= 10 * 60, 'que dura 10 minutos por defecto');

console.log('\n== 3. Los huéspedes caen en la reserva');
const cod1 = est.codigo.valor;
let e = await checkin(cod1, DATOS('Ana', 30111001, null));
ok(e.ok === false && e.error === 'datos_invalidos' && e.campos.includes('anio_nac'), 'sin año de nacimiento no se envía');
e = await checkin(cod1, DATOS('Ana', 30111001, 1850));
ok(e.ok === false && e.campos?.includes('anio_nac'), 'un año imposible tampoco');
ok((await checkin(cod1, DATOS('Ana', 30111001, 1988))).ok === true, 'Ana hace el check-in');
ok((await checkin(cod1, DATOS('Beto', 30111002, 2015))).ok === true, 'Beto, con el mismo código');
let filas = await back.sql(`select datos->>'nombre' n, habitacion, estadia_id, medio_pago_id, (datos->>'anio_nac')::int anio from private.checkins order by id`);
ok(filas.length === 2 && filas.every((f) => f.habitacion === '107' && f.estadia_id === filas[0].estadia_id && f.medio_pago_id === 2), 'los dos quedan en la misma reserva, con su habitación y medio de pago');
ok(filas[0].anio === 1988 && filas[1].anio === 2015, 'y se guarda el año de nacimiento');
est = await llamar('recepcion_estado', { p_clave: rec });
ok(est.reserva.huespedes.length === 2 && est.huespedes.length === 2 && est.huespedes[0].estadia.habitacion === '107', 'recepción ve quiénes ya entraron y la reserva de cada uno');

console.log('\n== 4. Otra habitación, otra reserva');
r = await llamar('recepcion_reserva_nueva', reserva({ p_habitacion: '204', p_monto: 60, p_moneda: 'USD', p_medio_pago: 1 }));
ok(r.ok === true, 'se abre la reserva de la 204');
ok((await checkin(cod1, DATOS('Caro', 30111003))).error === 'codigo_invalido', 'el código de la 107 ya no sirve');
est = await llamar('recepcion_estado', { p_clave: rec });
ok((await checkin(est.codigo.valor, DATOS('Dani', 30111004))).ok === true, 'el nuevo código mete a Dani en la 204');
filas = await back.sql(`select datos->>'nombre' n, habitacion from private.checkins order by id`);
ok(filas[2].n === 'Dani' && filas[2].habitacion === '204', 'con su habitación');

console.log('\n== 5. Cerrar y vencer');
r = await llamar('recepcion_reserva_cerrar', { p_clave: rec });
est = await llamar('recepcion_estado', { p_clave: rec });
ok(r.ok && est.codigo === null && est.reserva === null, 'recepción cierra la reserva y desaparece el código');
await llamar('recepcion_reserva_nueva', reserva({ p_habitacion: '301' }));
est = await llamar('recepcion_estado', { p_clave: rec });
const cod3 = est.codigo.valor;
await back.sql(`update private.codigos_usuario set estadia_vence = now() - interval '1 second'`);
ok((await checkin(cod3, DATOS('Eli', 30111005))).error === 'codigo_invalido', 'una reserva vencida no deja entrar a nadie');
r = await llamar('recepcion_reserva_nueva', reserva({ p_habitacion: '301' }));
await back.sql(`update private.codigos_usuario set estadia_vence = now() + interval '30 seconds'`);
r = await llamar('recepcion_reserva_cerrar', { p_clave: rec, p_extender: true });
est = await llamar('recepcion_estado', { p_clave: rec });
ok(r.ok && est.reserva.vence_seg > 9 * 60, 'se puede extender la reserva');
r = await llamar('admin_reserva_min', { p_clave: dueno, p_min: 5 });
ok(r.ok && r.reserva_min === 5 && (await llamar('admin_reserva_min', { p_clave: dueno, p_min: 500 })).ok === false, 'el dueño cambia los minutos (con tope)');
ok((await llamar('admin_reserva_min', { p_clave: rec, p_min: 7 })).ok === false, 'recepción no');
await llamar('admin_reserva_min', { p_clave: dueno, p_min: 10 });

console.log('\n== 6. Corregir una reserva');
const id107 = (await back.sql(`select id from private.estadias where habitacion = '107'`))[0].id;
r = await llamar('recepcion_estadia_editar', { p_clave: rec, p_id: id107, p_habitacion: '108', p_monto: 90000, p_moneda: 'ARS', p_medio_pago: 1, p_fecha: hoy });
ok(r.ok === true, 'recepción corrige dentro de la ventana de edición');
filas = await back.sql(`select habitacion, medio_pago_id from private.checkins where estadia_id = $1`, [id107]);
ok(filas.length === 2 && filas.every((f) => f.habitacion === '108' && f.medio_pago_id === 1), 'la habitación y el medio pasan a todos los huéspedes');
await back.sql(`update private.estadias set creado = now() - interval '2 hours' where id = $1`, [id107]);
r = await llamar('recepcion_estadia_editar', { p_clave: rec, p_id: id107, p_habitacion: '108', p_monto: 91000, p_moneda: 'ARS', p_medio_pago: 1, p_fecha: hoy });
ok(r.ok === false && r.error === 'fuera_de_tiempo', 'pasada la ventana, recepción ya no');
r = await llamar('admin_estadia_editar', { p_clave: dueno, p_id: id107, p_habitacion: '108', p_monto: 91000, p_moneda: 'USD', p_medio_pago: 1, p_fecha: hoy });
ok(r.ok === true && (await back.sql('select monto::float m, moneda from private.estadias where id = $1', [id107]))[0].m === 91000, 'el dueño sí, siempre');
ok((await llamar('admin_estadia_editar', { p_clave: rec, p_id: id107, p_habitacion: '1', p_monto: 1, p_moneda: 'ARS', p_medio_pago: 1, p_fecha: hoy })).ok === false, 'recepción no entra por la puerta del dueño');
const aud = await back.sql(`select count(*)::int n from private.checkin_auditoria where accion = 'estadia_editar'`);
ok(aud[0].n >= 2, 'cada cambio queda en la auditoría');

console.log('\n== 7. Check-ins viejos');
await back.sql(`insert into private.checkins (grupo, datos, consentimiento) values (1, $1::jsonb, '{"aceptado":true}'::jsonb)`, [JSON.stringify(DATOS('Viejo', 30119999, null))]);
const idViejo = (await back.sql(`select id from private.checkins where datos->>'nombre' = 'Viejo'`))[0].id;
let lista = await llamar('admin_huespedes', { p_clave: dueno });
ok(lista.huespedes.find((h) => h.id === idViejo).estadia === null, 'un check-in de antes aparece sin reserva');
ok((await llamar('admin_huesped_estadia', { p_clave: rec, p_id: idViejo, p_estadia: id107 })).ok === false, 'recepción no lo puede asignar');
r = await llamar('admin_huesped_estadia', { p_clave: dueno, p_id: idViejo, p_estadia: id107 });
lista = await llamar('admin_huespedes', { p_clave: dueno });
ok(r.ok && lista.huespedes.find((h) => h.id === idViejo).estadia.id === id107, 'el dueño lo asigna a una reserva');

console.log('\n== 8. Valor total, pago en el hotel y seña');
const dias = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
r = await llamar('recepcion_reserva_nueva', reserva({ p_habitacion: '401', p_monto: 100000, p_pago_hotel: 70000, p_fecha_sena: dias(10) }));
ok(r.ok === true, 'una reserva de 100.000 con 70.000 pagados en el hotel (seña de 30.000) se abre');
let fila = (await back.sql(`select monto::float m, pago_hotel::float p, fecha_sena::text f from private.estadias where id = $1`, [r.id]))[0];
ok(fila.m === 100000 && fila.p === 70000 && fila.f === dias(10), 'se guarda el total, lo pagado en el hotel y la fecha de la seña');
est = await llamar('recepcion_estado', { p_clave: rec });
ok(Number(est.reserva.estadia.monto) === 100000 && Number(est.reserva.estadia.pago_hotel) === 70000 && est.reserva.estadia.fecha_sena === dias(10), 'recepción ve el total, el pago en el hotel y la fecha de la seña');
r = await llamar('recepcion_reserva_nueva', reserva({ p_habitacion: '402' }));
fila = (await back.sql(`select monto::float m, pago_hotel::float p, fecha_sena from private.estadias where id = $1`, [r.id]))[0];
ok(fila.p === fila.m && fila.fecha_sena === null, 'sin decir nada del pago, se cobró todo en el hotel (sin seña)');
for (const [m, extra, campo] of [
  ['pagó más que el total', { p_monto: 1000, p_pago_hotel: 1001 }, 'pago_hotel'],
  ['pago negativo', { p_pago_hotel: -5 }, 'pago_hotel'],
  ['seña cobrada después del hotel', { p_monto: 1000, p_pago_hotel: 400, p_fecha_sena: dias(-1) }, 'fecha_sena'],
  ['seña de hace años', { p_monto: 1000, p_pago_hotel: 400, p_fecha_sena: '2020-01-01' }, 'fecha_sena']
]) {
  const x = await llamar('recepcion_reserva_nueva', reserva({ p_habitacion: '403', ...extra }));
  ok(x.ok === false && x.error === 'datos_invalidos' && x.campos.includes(campo), `${m} → ${campo}`);
}
r = await llamar('recepcion_reserva_nueva', reserva({ p_habitacion: '404', p_monto: 5000, p_pago_hotel: 5000, p_fecha_sena: dias(3) }));
fila = (await back.sql(`select fecha_sena from private.estadias where id = $1`, [r.id]))[0];
ok(r.ok && fila.fecha_sena === null, 'la fecha de la seña se ignora si no hubo seña');
const id401 = (await back.sql(`select id from private.estadias where habitacion = '401'`))[0].id;
r = await llamar('admin_estadia_editar', { p_clave: dueno, p_id: id401, p_habitacion: '401', p_monto: 100000, p_moneda: 'ARS', p_medio_pago: 2, p_fecha: hoy, p_pago_hotel: 50000, p_fecha_sena: dias(12) });
fila = (await back.sql(`select pago_hotel::float p, fecha_sena::text f from private.estadias where id = $1`, [id401]))[0];
ok(r.ok && fila.p === 50000 && fila.f === dias(12), 'el dueño corrige lo pagado en el hotel y la fecha de la seña');
const aud2 = await back.sql(`select detalle from private.checkin_auditoria where accion = 'estadia_editar' order by id desc limit 1`);
ok(JSON.stringify(aud2[0].detalle.campos).includes('pago_hotel') && JSON.stringify(aud2[0].detalle.campos).includes('fecha_sena'), 'y queda en el historial qué se cambió');
r = await llamar('admin_estadia_editar', { p_clave: dueno, p_id: id401, p_habitacion: '401', p_monto: 40000, p_moneda: 'ARS', p_medio_pago: 2, p_fecha: hoy, p_pago_hotel: 50000 });
ok(r.ok === false && r.campos.includes('pago_hotel'), 'bajar el total por debajo de lo pagado en el hotel se rechaza');
const stats = await llamar('admin_estadisticas', { p_clave: dueno });
const e401 = stats.reservas.find((x) => x.id === id401);
ok(Number(e401.monto) === 100000 && Number(e401.pago_hotel) === 50000 && e401.fecha_sena === dias(12), 'las estadísticas reciben el total, lo pagado en el hotel y la fecha de la seña');
// Migración: una base con reservas de la versión anterior (sin pago_hotel) pasa a «se cobró todo en el hotel», y el archivo se puede repetir.
await back.exec(`alter table private.estadias drop constraint estadias_pago_hotel_ck; alter table private.estadias drop column pago_hotel, drop column fecha_sena`);
await back.exec(fs.readFileSync(new URL('../supabase/estadias.sql', import.meta.url), 'utf8'));
await back.exec(fs.readFileSync(new URL('../supabase/estadias.sql', import.meta.url), 'utf8'));
const mig = await back.sql(`select count(*)::int n, count(*) filter (where pago_hotel = monto and fecha_sena is null)::int ok from private.estadias`);
ok(mig[0].n > 0 && mig[0].n === mig[0].ok, 'al migrar, las reservas de antes quedan cobradas enteras en el hotel (y el archivo se puede repetir)');
ok((await llamar('recepcion_reserva_nueva', reserva({ p_habitacion: '405', p_monto: 1000, p_pago_hotel: 400 }))).ok === true, 'y las funciones siguen andando después de repetirlo');
await back.cerrar();
console.log(fallas ? `\n${fallas} fallas` : '\nTodo bien');
process.exit(fallas ? 1 : 0);
