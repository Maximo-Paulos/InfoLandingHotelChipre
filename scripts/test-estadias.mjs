// Reservas (estadías): habitación + monto antes del código, huéspedes agrupados, año de nacimiento, noches, canal de venta y categoría.
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
const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date()); // el «hoy» del hotel (hora argentina), como lo usan el formulario y las estadísticas
const idDe = async (tipo, nombre) => (await back.sql(`select id from private.catalogo where tipo = $1 and nombre = $2`, [tipo, nombre]))[0].id;
const CANAL = await idDe('canal', 'Directo');
const OBRA = await idDe('canal', 'Obra social');
const CAT = await idDe('categoria', 'Doble');
const NUEVOS = { p_noches: 2, p_canal: CANAL, p_categoria: CAT, p_huespedes: 4 }; // lo que ahora pide toda reserva (con lugar de sobra: los grupos de las pruebas de abajo no la completan)
const reserva = (extra = {}) => ({ p_clave: rec, p_habitacion: '107', p_monto: 85000, p_moneda: 'ARS', p_medio_pago: 2, p_fecha: hoy, ...NUEVOS, ...extra });
const DATOS = (n, doc, anio = 1990) => ({ nombre: n, apellido: 'Prueba', email: `${n.toLowerCase()}@correo.com`, telefono: '+541155551234', nacionalidad: 'Argentina', localidad: 'Capital Federal', domicilio: 'Av. Corrientes 1234 5° B', doc_tipo: 'DNI', doc_numero: String(doc), ...(anio ? { anio_nac: anio } : {}) });
// Un huésped con check-in cargado directo en la base, para que una reserva «cuente» (una reserva sin huéspedes no suma en las estadísticas).
let gN = 0;
const conHuesped = (estadiaId) => back.sql(`insert into private.checkins (grupo, datos, consentimiento, habitacion, estadia_id) values (1, $1::jsonb, '{"aceptado":true}'::jsonb, (select habitacion from private.estadias where id = $2), $2)`, [JSON.stringify(DATOS(`Directo${++gN}`, 50000000 + gN)), estadiaId]);
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
r = await llamar('recepcion_estadia_editar', { p_clave: rec, p_id: id107, p_habitacion: '108', p_monto: 90000, p_moneda: 'ARS', p_medio_pago: 1, p_fecha: hoy, ...NUEVOS });
ok(r.ok === true, 'recepción corrige dentro de la ventana de edición');
filas = await back.sql(`select habitacion, medio_pago_id from private.checkins where estadia_id = $1`, [id107]);
ok(filas.length === 2 && filas.every((f) => f.habitacion === '108' && f.medio_pago_id === 1), 'la habitación y el medio pasan a todos los huéspedes');
await back.sql(`update private.estadias set creado = now() - interval '2 hours' where id = $1`, [id107]);
r = await llamar('recepcion_estadia_editar', { p_clave: rec, p_id: id107, p_habitacion: '108', p_monto: 91000, p_moneda: 'ARS', p_medio_pago: 1, p_fecha: hoy, ...NUEVOS });
ok(r.ok === false && r.error === 'fuera_de_tiempo', 'pasada la ventana, recepción ya no');
r = await llamar('admin_estadia_editar', { p_clave: dueno, p_id: id107, p_habitacion: '108', p_monto: 91000, p_moneda: 'USD', p_medio_pago: 1, p_fecha: hoy, ...NUEVOS });
ok(r.ok === true && (await back.sql('select monto::float m, moneda from private.estadias where id = $1', [id107]))[0].m === 91000, 'el dueño sí, siempre');
ok((await llamar('admin_estadia_editar', { p_clave: rec, p_id: id107, p_habitacion: '1', p_monto: 1, p_moneda: 'ARS', p_medio_pago: 1, p_fecha: hoy, ...NUEVOS })).ok === false, 'recepción no entra por la puerta del dueño');
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
const dias = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(Date.now() - n * 864e5));
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
r = await llamar('admin_estadia_editar', { p_clave: dueno, p_id: id401, p_habitacion: '401', p_monto: 100000, p_moneda: 'ARS', p_medio_pago: 2, p_fecha: hoy, ...NUEVOS, p_pago_hotel: 50000, p_fecha_sena: dias(12) });
fila = (await back.sql(`select pago_hotel::float p, fecha_sena::text f from private.estadias where id = $1`, [id401]))[0];
ok(r.ok && fila.p === 50000 && fila.f === dias(12), 'el dueño corrige lo pagado en el hotel y la fecha de la seña');
const aud2 = await back.sql(`select detalle from private.checkin_auditoria where accion = 'estadia_editar' order by id desc limit 1`);
ok(JSON.stringify(aud2[0].detalle.campos).includes('pago_hotel') && JSON.stringify(aud2[0].detalle.campos).includes('fecha_sena'), 'y queda en el historial qué se cambió');
r = await llamar('admin_estadia_editar', { p_clave: dueno, p_id: id401, p_habitacion: '401', p_monto: 40000, p_moneda: 'ARS', p_medio_pago: 2, p_fecha: hoy, ...NUEVOS, p_pago_hotel: 50000 });
ok(r.ok === false && r.campos.includes('pago_hotel'), 'bajar el total por debajo de lo pagado en el hotel se rechaza');
await conHuesped(id401);
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
console.log('\n== 9. Noches, canal de venta y categoría');
const buena = (extra = {}) => reserva({ p_habitacion: '501', ...extra });
for (const [m, extra, campo] of [
  ['sin noches', { p_noches: null }, 'noches'],
  ['0 noches', { p_noches: 0 }, 'noches'],
  ['más de un año de noches', { p_noches: 366 }, 'noches'],
  ['sin canal', { p_canal: null }, 'canal'],
  ['un canal que no existe', { p_canal: 99999 }, 'canal'],
  ['una categoría en el lugar del canal', { p_canal: CAT }, 'canal'],
  ['sin categoría', { p_categoria: null }, 'categoria'],
  ['un canal en el lugar de la categoría', { p_categoria: CANAL }, 'categoria']
]) {
  const x = await llamar('recepcion_reserva_nueva', buena(extra));
  ok(x.ok === false && x.error === 'datos_invalidos' && x.campos.includes(campo), `${m} → ${campo}`);
}
r = await llamar('recepcion_reserva_nueva', buena({ p_monto: 400000, p_noches: 4 }));
const idCuatro = r.id;
fila = (await back.sql(`select noches, canal_id, categoria_id from private.estadias where id = $1`, [idCuatro]))[0];
ok(r.ok && fila.noches === 4 && fila.canal_id === CANAL && fila.categoria_id === CAT, 'una reserva de 400.000 por 4 noches guarda noches, canal y categoría');
est = await llamar('recepcion_estado', { p_clave: rec });
const ee = est.reserva.estadia;
ok(ee.noches === 4 && ee.canal === 'Directo' && ee.canal_cobra === true && ee.categoria === 'Doble', 'recepción ve las noches, el canal y la categoría');
ok(est.categorias.map((c) => c.nombre).join() === 'Single,Doble,Triple,Cuádruple' && est.canales.length === 4 && est.canales.find((c) => c.nombre === 'Obra social').cobra === false, 'recepción recibe las listas para elegir');

// Obra social: no lleva monto; lo que mande la pantalla se ignora y el medio queda en «Otros».
r = await llamar('recepcion_reserva_nueva', buena({ p_habitacion: '502', p_canal: OBRA, p_monto: 55000, p_moneda: 'USD', p_pago_hotel: 1000, p_fecha_sena: dias(3), p_medio_pago: 1 }));
fila = (await back.sql(`select monto::float m, moneda, pago_hotel::float p, fecha_sena, medio_pago_id from private.estadias where id = $1`, [r.id]))[0];
ok(r.ok && fila.m === 0 && fila.moneda === 'ARS' && fila.p === 0 && fila.fecha_sena === null && fila.medio_pago_id === 6, 'obra social: no lleva monto (se ignora lo que mande la pantalla) y queda con el medio «Otros»');
r = await llamar('recepcion_reserva_nueva', buena({ p_habitacion: '503', p_canal: OBRA, p_monto: 0, p_medio_pago: null, p_moneda: null }));
ok(r.ok === true, 'obra social sin ningún dato de cobro se abre igual');
const idObra = r.id;
r = await llamar('admin_estadia_editar', { p_clave: dueno, p_id: idCuatro, p_habitacion: '501', p_monto: 400000, p_moneda: 'ARS', p_medio_pago: 2, p_fecha: hoy, p_noches: 5, p_canal: OBRA, p_categoria: CAT });
fila = (await back.sql(`select monto::float m, noches, canal_id from private.estadias where id = $1`, [idCuatro]))[0];
const aud3 = await back.sql(`select detalle from private.checkin_auditoria where accion = 'estadia_editar' order by id desc limit 1`);
ok(r.ok && fila.m === 0 && fila.noches === 5 && fila.canal_id === OBRA, 'el dueño pasa una reserva a obra social: el monto queda en 0 y cambia las noches');
ok(['canal', 'noches', 'monto'].every((c) => aud3[0].detalle.campos.includes(c)), 'y el historial dice qué cambió');
r = await llamar('admin_estadia_editar', { p_clave: dueno, p_id: idCuatro, p_habitacion: '501', p_monto: 400000, p_moneda: 'ARS', p_medio_pago: 2, p_fecha: hoy, p_noches: 5, p_canal: CANAL, p_categoria: CAT });
fila = (await back.sql(`select monto::float m from private.estadias where id = $1`, [idCuatro]))[0];
ok(r.ok && fila.m === 400000, 'y la vuelve a un canal que cobra, con su monto');

console.log('\n== 9b. Las listas las edita el dueño y nada se borra');
let lc = await llamar('admin_catalogos', { p_clave: dueno });
ok(lc.ok && lc.categorias.length === 4 && lc.canales.length === 4 && lc.canales.find((c) => c.nombre === 'Obra social').usos >= 2, 'el dueño ve las dos listas, con cuántas reservas tiene cada opción');
ok((await llamar('admin_catalogos', { p_clave: rec })).ok === false && (await llamar('admin_catalogo_guardar', { p_clave: rec, p_tipo: 'canal', p_lista: [] })).ok === false, 'recepción no las ve ni las toca');
const base = (lista) => lista.map(({ id, nombre, activo, cobra }) => ({ id, nombre, activo, cobra }));
r = await llamar('admin_catalogo_guardar', { p_clave: dueno, p_tipo: 'categoria', p_lista: [...base(lc.categorias), { id: null, nombre: '  Suite  junior ', activo: true }] });
const suite = r.lista?.find((x) => x.nombre === 'Suite junior')?.id;
ok(r.ok && r.lista.length === 5 && suite, 'el dueño agrega una categoría');
let x = await llamar('recepcion_reserva_nueva', buena({ p_habitacion: '504', p_categoria: suite }));
const idSuite = x.id;
ok(x.ok === true, 'y recepción ya puede elegirla');
r = await llamar('admin_catalogo_guardar', { p_clave: dueno, p_tipo: 'categoria', p_lista: base(r.lista).map((c) => (c.id === suite ? { ...c, activo: false } : c)) });
ok(r.ok && r.lista.find((c) => c.id === suite).activo === false && r.lista.find((c) => c.id === suite).usos === 1, 'quitarla no la borra: queda guardada con su uso');
est = await llamar('recepcion_estado', { p_clave: rec });
ok(!est.categorias.some((c) => c.id === suite), 'recepción deja de ofrecerla');
x = await llamar('recepcion_reserva_nueva', buena({ p_habitacion: '505', p_categoria: suite }));
ok(x.ok === false && x.campos.includes('categoria'), 'y no se puede usar en una reserva nueva');
x = await llamar('admin_estadia_editar', { p_clave: dueno, p_id: idSuite, p_habitacion: '504', p_monto: 85000, p_moneda: 'ARS', p_medio_pago: 2, p_fecha: hoy, p_noches: 3, p_canal: CANAL, p_categoria: suite });
ok(x.ok === true, 'pero la reserva que ya la tenía se puede corregir sin cambiársela');
const nombres = (lista) => base(lista);
for (const [m, tipo, lista, error] of [
  ['una categoría repetida', 'categoria', [{ id: null, nombre: 'doble' }, ...nombres(lc.categorias)], 'nombre_repetido'],
  ['un nombre con símbolos raros', 'categoria', [{ id: null, nombre: '<b>x</b>' }], 'nombre_invalido'],
  ['un tipo inventado', 'otra', [], 'lista_invalida'],
  ['quitar el canal «Directo»', 'canal', nombres(lc.canales).map((c) => (c.nombre === 'Directo' ? { ...c, activo: false } : c)), 'base_obligatoria'],
  ['que «Directo» deje de cobrar', 'canal', nombres(lc.canales).map((c) => (c.nombre === 'Directo' ? { ...c, cobra: false } : c)), 'base_obligatoria'],
  ['cambiar si cobra un canal que ya tiene reservas', 'canal', nombres(lc.canales).map((c) => (c.nombre === 'Obra social' ? { ...c, cobra: true } : c)), 'canal_en_uso']
]) {
  x = await llamar('admin_catalogo_guardar', { p_clave: dueno, p_tipo: tipo, p_lista: lista });
  ok(x.ok === false && x.error === error, `${m} → ${error}`);
}
r = await llamar('admin_catalogo_guardar', { p_clave: dueno, p_tipo: 'canal', p_lista: nombres(lc.canales).map((c) => (c.nombre === 'Agencia' ? { ...c, cobra: false, nombre: 'Convenio' } : c)) });
ok(r.ok && r.lista.find((c) => c.nombre === 'Convenio')?.cobra === false, 'un canal sin reservas sí se puede renombrar y marcar como «sin cobro»');
ok((await back.sql(`select count(*)::int n from private.catalogo`))[0].n === 9, 'las listas no pierden ninguna opción (4 canales + 5 categorías)');
await conHuesped(idObra);
await conHuesped(idCuatro);
const st = await llamar('admin_estadisticas', { p_clave: dueno });
const rObra = st.reservas.find((x) => x.id === idObra);
const rCuatro = st.reservas.find((x) => x.id === idCuatro);
ok(rCuatro.noches === 5 && rCuatro.canal === 'Directo' && rCuatro.canal_cobra === true && rCuatro.categoria === 'Doble' && rObra.canal === 'Obra social' && rObra.canal_cobra === false && rObra.categoria === 'Doble', 'las estadísticas reciben noches, canal, si cobra y categoría');
// Sin categorías en la lista, la categoría deja de ser obligatoria.
const todas = base((await llamar('admin_catalogos', { p_clave: dueno })).categorias).map((c) => ({ ...c, activo: false }));
await llamar('admin_catalogo_guardar', { p_clave: dueno, p_tipo: 'categoria', p_lista: todas });
x = await llamar('recepcion_reserva_nueva', buena({ p_habitacion: '506', p_categoria: null }));
ok(x.ok === true && (await back.sql(`select categoria_id from private.estadias where id = $1`, [x.id]))[0].categoria_id === null, 'sin categorías en la lista, la reserva se abre sin categoría');

console.log('\n== 10. Pasar de la versión que ya está publicada a esta (sin perder nada)');
const viejo = await iniciarBackend({ puerto: 54396, estadias: false });
await viejo.sql(`update private.checkin_config set activo = true, usos_max = 20 where id = 1`);
await viejo.sql(SQL_RECEPCION, [CLAVE_RECEPCION]);
await viejo.exec(fs.readFileSync(new URL('./fixtures/estadias-v1.sql', import.meta.url), 'utf8')); // el estadias.sql que hoy está en producción
const llamarV = (n, a) => viejo.llamar(n, a, '203.0.113.8');
const recV = (await llamarV('sesion_entrar', { p_clave: CLAVE_RECEPCION })).token;
const duenoV = (await llamarV('sesion_entrar', { p_clave: CLAVE_ADMIN })).token;
const a1 = await llamarV('recepcion_reserva_nueva', { p_clave: recV, p_habitacion: '201', p_monto: 100000, p_moneda: 'ARS', p_medio_pago: 2, p_fecha: hoy, p_pago_hotel: 70000, p_fecha_sena: dias(5) });
const a2 = await llamarV('recepcion_reserva_nueva', { p_clave: recV, p_habitacion: '202', p_monto: 60, p_moneda: 'USD', p_medio_pago: 1, p_fecha: hoy });
ok(a1.ok && a2.ok, 'con la versión anterior se abren dos reservas (una con seña)');
for (const id of [a1.id, a2.id]) {
  await viejo.sql(`insert into private.checkins (grupo, datos, consentimiento, habitacion, estadia_id) values (1, $1::jsonb, '{"aceptado":true}'::jsonb, (select habitacion from private.estadias where id = $2), $2)`, [JSON.stringify(DATOS(`Previo${id}`, 40000000 + id)), id]);
}
const antes = await viejo.sql(`select id, habitacion, monto::float m, moneda, pago_hotel::float p, fecha_sena::text f, medio_pago_id, cargado_por from private.estadias order by id`);
const huesAntes = await viejo.sql(`select id, estadia_id, habitacion from private.checkins order by id`);
const nuevoSql = fs.readFileSync(new URL('../supabase/estadias.sql', import.meta.url), 'utf8');
await viejo.exec(nuevoSql);
await viejo.exec(nuevoSql);
const despues = await viejo.sql(`select e.id, e.habitacion, e.monto::float m, e.moneda, e.pago_hotel::float p, e.fecha_sena::text f, e.medio_pago_id, e.cargado_por, e.noches, e.categoria_id, c.nombre canal, c.cobra from private.estadias e join private.catalogo c on c.id = e.canal_id order by e.id`);
ok(despues.length === antes.length && antes.every((x, i) => ['id', 'habitacion', 'm', 'moneda', 'p', 'f', 'medio_pago_id', 'cargado_por'].every((k) => x[k] === despues[i][k])), 'las reservas ya cargadas quedan idénticas (monto, seña, medio, fecha, quién), aun aplicando el archivo dos veces');
ok(despues.every((x) => x.canal === 'Directo' && x.cobra === true && x.noches === null && x.categoria_id === null), 'pasan al canal «Directo» (cuentan como siempre), sin noches ni categoría todavía');
ok(JSON.stringify(await viejo.sql(`select id, estadia_id, habitacion from private.checkins order by id`)) === JSON.stringify(huesAntes), 'ningún huésped cambia ni se pierde');
ok((await viejo.sql(`select count(*) filter (where tipo = 'canal')::int c, count(*) filter (where tipo = 'categoria')::int k from private.catalogo`))[0].c === 4, 'las listas de arranque no se duplican al repetir el archivo');
const sV = await llamarV('admin_estadisticas', { p_clave: duenoV });
ok(sV.ok && sV.reservas.length === 2 && sV.reservas.every((x) => x.noches === null && x.canal === 'Directo' && x.canal_cobra === true), 'las estadísticas las siguen mostrando (sin noches)');
x = await llamarV('admin_estadia_editar', { p_clave: duenoV, p_id: a1.id, p_habitacion: '201', p_monto: 100000, p_moneda: 'ARS', p_medio_pago: 2, p_fecha: hoy, p_pago_hotel: 70000, p_fecha_sena: dias(5) });
ok(x.ok === false && x.campos.includes('noches'), 'la guía anterior ya no puede corregir una reserva: pide noches (por eso se publica la guía nueva después del SQL)');
const dirV = (await viejo.sql(`select id from private.catalogo where tipo = 'canal' and es_base`))[0].id;
x = await llamarV('admin_estadia_editar', { p_clave: duenoV, p_id: a1.id, p_habitacion: '201', p_monto: 100000, p_moneda: 'ARS', p_medio_pago: 2, p_fecha: hoy, p_pago_hotel: 70000, p_fecha_sena: dias(5), p_noches: 3, p_canal: dirV });
ok(x.ok === true, 'una reserva de antes se completa con sus noches (la categoría puede quedar sin elegir)');
await viejo.cerrar();
await back.cerrar();
console.log(fallas ? `\n${fallas} fallas` : '\nTodo bien');
process.exit(fallas ? 1 : 0);
