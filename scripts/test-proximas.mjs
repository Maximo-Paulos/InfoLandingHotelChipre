// «Próximas reservas» de recepción: las reservas anotadas que todavía esperan al huésped, para buscarlas por nombre, ver cuánto hay que cobrar y recién ahí hacer
// el check-in. Recepción solo ve (y solo encuentra buscando) las que llegan entre N días atrás y N días adelante: N lo cambia el dueño en Ajustes (`dias_recepcion`).
// Lo que está fuera de esos días no se le muestra a nadie: no existe para recepción. El dueño ve todo.
//   node scripts/test-proximas.mjs
// Usa la base de prueba en memoria con schema.sql + checkin.sql + estadias.sql y llama a las funciones como lo hace la guía (rol "anon").
// La parte 8 arma una base como la publicada hoy (scripts/fixtures/estadias-v5.sql) y le aplica el archivo nuevo dos veces.
import fs from 'node:fs';
import { CLAVE_ADMIN, CLAVE_RECEPCION, SQL_RECEPCION, iniciarBackend } from './backend-local.mjs';

let fallas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK    ' : 'FALLA '}${m}`); if (!c) fallas += 1; };

const back = await iniciarBackend({ puerto: 54396, estadias: true });
await back.sql(`update private.checkin_config set activo = true, usos_max = 20 where id = 1`);
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

const anotar = (extra = {}, quien = dueno) => llamar('admin_anotada_guardar', {
  p_clave: quien, p_id: null, p_titular: 'Juan Pérez', p_ingreso: AR(2), p_habitacion: '107', p_noches: 2, p_categoria: DOBLE, p_canal: DIRECTO, p_huespedes: 3,
  p_efectivo: 100000, p_transferencia: 110000, p_usd: null, p_sena: 30000, p_fecha_sena: AR(-5), p_nota: 'Llega a la tarde', ...extra
});
const proximas = (quien = rec) => llamar('recepcion_proximas', { p_clave: quien });
const lista = async (quien = rec) => (await proximas(quien)).reservas;
const nombres = async (quien = rec) => (await lista(quien)).map((x) => x.titular);
const por = (reservas, titular) => reservas.find((x) => x.titular === titular);
const dias = (d) => llamar('admin_checkin_config_guardar', { p_clave: dueno, p_config: { dias_recepcion: d } });
const cobro = (id, extra = {}, quien = rec) => llamar('recepcion_llegada_iniciar', {
  p_clave: quien, p_id: id, p_habitacion: '107', p_monto: 100000, p_moneda: 'ARS', p_medio_pago: EFECTIVO, p_fecha: hoy, p_pago_hotel: 70000, p_fecha_sena: AR(-5),
  p_noches: 2, p_canal: DIRECTO, p_categoria: DOBLE, p_huespedes: 3, ...extra
});

console.log('\n== 1. Quién puede mirar la lista');
let r = await proximas('clave-mala');
ok(r.ok === false, 'con una clave mala no se ve nada');
r = await proximas('');
ok(r.ok === false, 'ni sin clave');
r = await proximas(rec);
ok(r.ok === true && Array.isArray(r.reservas) && r.reservas.length === 0, 'recepción la ve (vacía si no hay reservas anotadas)');
ok(r.hoy === hoy && r.mas === 0 && r.activo === true, 'y trae la fecha de hoy y que el check-in digital está prendido');
r = await proximas(dueno);
ok(r.ok === true, 'el dueño también la puede ver');

console.log('\n== 2. El dueño elige cuántos días ve recepción (5 hacia atrás y 5 hacia adelante)');
r = await llamar('admin_checkin_config_guardar', { p_clave: rec, p_config: { dias_recepcion: 30 } });
ok(r.ok === false, 'recepción no puede cambiar esos días');
for (const malo of [0, -1, 366, 'cinco']) {
  r = await llamar('admin_checkin_config_guardar', { p_clave: dueno, p_config: { dias_recepcion: malo } });
  ok(r.ok === false, `el dueño no puede poner ${JSON.stringify(malo)} (de 1 a 365)`);
}
ok((await dias(5)).ok === true && (await proximas(rec)).dias === 5, 'el dueño los pone en 5 y la lista lo informa');

console.log('\n== 3. Qué reservas ve recepción: solo las de esos días');
const ids = {};
const CASOS = [['Lucas Fuentes', -7], ['Hace cinco', -5], ['Hace cuatro', -4], ['Tarde', -2], ['Hoy', 0], ['Mañana', 1], ['En cuatro', 4], ['En cinco', 5], ['En seis', 6], ['En siete', 7], ['En dos meses', 60], ['En un año', 365], ['Muy vieja', -59]];
for (const [nombre, d] of CASOS) {
  const a = await anotar({ p_titular: nombre, p_ingreso: AR(d), p_habitacion: `H${Math.abs(d)}${d < 0 ? 'a' : 'b'}` });
  ids[nombre] = a.id;
  ok(a.ok === true, `se anotó «${nombre}» (${d} días)`);
}
let l = await nombres();
ok(JSON.stringify(l) === JSON.stringify(['Hace cinco', 'Hace cuatro', 'Tarde', 'Hoy', 'Mañana', 'En cuatro', 'En cinco']), `recepción ve de 5 días atrás a 5 adelante, de la más cercana a la más lejana (${l.join(', ')})`);
ok(!l.includes('Lucas Fuentes'), 'una reserva de hace 7 días (Lucas Fuentes) no aparece: ni listada ni buscando por su nombre');
ok(!l.includes('En seis') && !l.includes('En siete') && !l.includes('En dos meses') && !l.includes('En un año'), 'las que llegan a partir de 6 días tampoco');
ok(['Hace cuatro', 'En cuatro'].every((t) => l.includes(t)), 'las de hace 4 días y de dentro de 4 días sí');
const x = por(await lista(), 'Mañana');
ok(x.habitacion === 'H1b' && x.esperados === 3 && x.noches === 2 && x.precio_efectivo === 100000 && x.precio_transferencia === 110000 && x.sena === 30000 && x.nota === 'Llega a la tarde', 'cada una trae los datos para atender: habitación, huéspedes, noches, precios, seña y nota');
ok(x.estado === 'anotada' && x.dias_para === 1 && x.canal === 'Directo' && x.canal_cobra === true && x.categoria === 'Doble', 'y su estado, los días que faltan, el canal (y si cobra) y la categoría');
ok(!('en_ventana' in x) && !('checkin_desde' in x), 'y nada de «todavía no»: lo que se ve es lo que se puede atender');
l = await nombres(dueno);
ok(l.includes('Lucas Fuentes') && l.includes('En un año') && l.includes('Muy vieja') && l.length === CASOS.length, 'el dueño ve todas, las lejanas y las viejas también');

console.log('\n== 4. Cambiar los días cambia lo que ve recepción');
await dias(10);
l = await nombres();
ok(l.includes('Lucas Fuentes') && l.includes('En siete') && !l.includes('En dos meses') && !l.includes('Muy vieja'), 'con 10 días: ya ve la de hace 7 y la de dentro de 7 (pero no las de dos meses ni la de hace 59 días)');
await dias(2);
l = await nombres();
ok(JSON.stringify(l) === JSON.stringify(['Tarde', 'Hoy', 'Mañana']), `con 2 días: solo de hace 2 a dentro de 2 (${l.join(', ')})`);
await dias(1);
l = await nombres();
ok(JSON.stringify(l) === JSON.stringify(['Hoy', 'Mañana']), `con 1 día: hoy y mañana (${l.join(', ')})`);
await dias(5);

console.log('\n== 5. Lo que no se ve tampoco se puede atender ni corregir (la base lo frena aunque se llame a mano)');
r = await cobro(ids['En seis']);
ok(r.ok === false && r.error === 'llegada_fuera_de_fecha', 'recepción no puede hacer el check-in de una que llega en 6 días');
r = await cobro(ids['Lucas Fuentes']);
ok(r.ok === false && r.error === 'llegada_fuera_de_fecha', 'ni de la de hace 7 días');
r = await llamar('recepcion_anotada_guardar', { p_clave: rec, p_id: ids['En seis'], p_titular: 'Cambiada', p_ingreso: AR(6), p_habitacion: 'H6b', p_noches: 2, p_categoria: DOBLE, p_canal: DIRECTO, p_huespedes: 3, p_efectivo: 100000 });
ok(r.ok === false && r.error === 'llegada_fuera_de_fecha', 'ni corregirla');
ok(await n(`select count(*)::int n from private.estadias`) === 0, 'y no se creó ninguna reserva');
r = await cobro(ids['En cinco']);
ok(r.ok === true, 'la de dentro de 5 días sí se puede atender');
r = await cobro(ids['En siete'], {}, dueno);
ok(r.ok === true, 'el dueño sí puede hacer el check-in de cualquiera, aunque llegue en 7 días');

console.log('\n== 6. Qué sale de la lista');
l = await nombres();
ok(!l.includes('En cinco'), 'cuando empieza el check-in de una reserva, deja de estar en próximas (pasa a las reservas abiertas)');
await llamar('admin_anotada_cancelar', { p_clave: dueno, p_id: ids['Mañana'], p_cancelar: true });
ok(!(await nombres()).includes('Mañana'), 'una reserva cancelada no aparece');
await llamar('admin_anotada_cancelar', { p_clave: dueno, p_id: ids['Mañana'], p_cancelar: false });
ok((await nombres()).includes('Mañana'), 'y si el dueño la restaura, vuelve a aparecer');
const nueva = await llamar('recepcion_anotada_guardar', { p_clave: rec, p_id: null, p_titular: 'De la calle', p_ingreso: hoy, p_habitacion: '55', p_noches: 1, p_categoria: DOBLE, p_canal: DIRECTO, p_huespedes: 2, p_efectivo: 80000 });
ok(nueva.ok === true && (await nombres()).includes('De la calle'), 'una anotada por recepción aparece enseguida en la lista de todos');
ok((await lista()).every((a) => a.estado === 'anotada'), 'solo hay reservas que esperan al huésped (ninguna en curso ni cancelada)');

console.log('\n== 7. El límite de la lista, y que solo lee');
await back.sql(`insert into private.reservas_anotadas (cargado_por, titular, fecha_ingreso, noches, habitacion, categoria_id, canal_id, huespedes_esperados, precio_efectivo)
                select 'Dueño', 'Masiva ' || g, $3::date + (g % 5), 1, 'M' || g, $1, $2, 1, 1000 from generate_series(1, 310) g`, [DOBLE, DIRECTO, hoy]);
const total = await n(`select count(*)::int n from private.reservas_anotadas where cancelada_en is null and estadia_id is null and fecha_ingreso between $1::date - 5 and $1::date + 5`, [hoy]);
r = await proximas();
ok(r.reservas.length === 300 && r.mas === total - 300 && r.mas > 0, `con ${total} reservas en los días que ve recepción trae 300 y avisa cuántas quedaron afuera (${r.mas})`);
ok(r.reservas.every((a, i, v) => i === 0 || v[i - 1].fecha_ingreso <= a.fecha_ingreso), 'y vienen en orden de fecha');
await back.sql(`delete from private.reservas_anotadas where titular like 'Masiva %'`);
const antes = await n(`select count(*)::int n from private.reservas_anotadas`);
const estadias = await n(`select count(*)::int n from private.estadias`);
await proximas(); await proximas(dueno);
ok(await n(`select count(*)::int n from private.reservas_anotadas`) === antes && await n(`select count(*)::int n from private.estadias`) === estadias, 'mirar la lista no crea ni cambia ninguna reserva');
await back.sql(`update private.checkin_config set activo = false where id = 1`);
r = await proximas();
ok(r.ok === true && r.activo === false && r.reservas.length > 0, 'con el check-in apagado se sigue viendo la lista (y avisa que está apagado)');
await back.sql(`update private.checkin_config set activo = true where id = 1`);

console.log('\n== 8. Pasar de la versión publicada hoy a esta');
const viejo = await iniciarBackend({ puerto: 54397, estadias: false });
await viejo.sql(`update private.checkin_config set activo = true, usos_max = 20 where id = 1`);
await viejo.sql(SQL_RECEPCION, [CLAVE_RECEPCION]);
await viejo.exec(fs.readFileSync(new URL('./fixtures/estadias-v5.sql', import.meta.url), 'utf8')); // el estadias.sql que hoy está en producción
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
ok((await viejo.sql(`select dias_recepcion from private.checkin_config`))[0].dias_recepcion === 3, 'y los días que ve recepción siguen como estaban (el dueño los cambia en Ajustes)');
const rV = await llamarV('recepcion_proximas', { p_clave: recV });
ok(rV.ok === true && rV.reservas.length === 1 && rV.reservas[0].titular === 'Antes', 'sobre la base migrada recepción ya ve la reserva que estaba anotada');
const bV = await llamarV('admin_anotada_guardar', { p_clave: duenoV, p_id: null, p_titular: 'Después', p_ingreso: AR(30), p_habitacion: '202', p_noches: 1, p_categoria: DOBLE, p_canal: DIRECTO, p_huespedes: 1, p_efectivo: 50000 });
ok(bV.ok && (await llamarV('recepcion_proximas', { p_clave: recV })).reservas.length === 1, 'una anotada para dentro de un mes no la ve recepción (queda fuera de sus días)');
ok((await llamarV('recepcion_proximas', { p_clave: duenoV })).reservas.length === 2, 'pero el dueño sí');
const iV = await llamarV('recepcion_llegada_iniciar', { p_clave: recV, p_id: aV.id, p_habitacion: '201', p_monto: 50000, p_moneda: 'ARS', p_medio_pago: EFECTIVO, p_fecha: hoy, p_pago_hotel: 50000, p_noches: 1, p_canal: DIRECTO, p_categoria: DOBLE, p_huespedes: 1 });
ok(iV.ok === true && (await llamarV('recepcion_proximas', { p_clave: recV })).reservas.length === 0, 'el check-in sigue funcionando y la reserva sale de la lista');
await viejo.cerrar();

await back.cerrar();
console.log(fallas ? `\n${fallas} fallas` : '\nTodo bien');
process.exit(fallas ? 1 : 0);
