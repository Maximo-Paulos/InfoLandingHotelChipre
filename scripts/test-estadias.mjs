// Reservas (estadías): habitación + monto antes del código, huéspedes agrupados, año de nacimiento.
//   node scripts/test-estadias.mjs
// Usa la base de prueba en memoria con schema.sql + checkin.sql + estadias.sql y llama a las funciones como lo hace la guía (rol "anon").
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

await back.cerrar();
console.log(fallas ? `\n${fallas} fallas` : '\nTodo bien');
process.exit(fallas ? 1 : 0);
