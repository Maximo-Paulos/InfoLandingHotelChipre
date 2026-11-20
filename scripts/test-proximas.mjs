// «Próximas reservas» de recepción: todas las reservas anotadas que todavía esperan al huésped (no solo las de los próximos días), para buscarlas por nombre,
// ver cuánto hay que cobrar y recién ahí hacer el check-in. Esto prueba lo que decide la base: qué reservas aparecen, en qué orden y cuándo se puede hacer el
// check-in (recepción solo `dias_recepcion` días antes y después de la fecha de ingreso; el dueño, siempre).
//   node scripts/test-proximas.mjs
// Usa la base de prueba en memoria con schema.sql + checkin.sql + estadias.sql y llama a las funciones como lo hace la guía (rol "anon").
// La parte 7 arma una base como la publicada hoy (scripts/fixtures/estadias-v5.sql) y le aplica el archivo nuevo dos veces.
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
const por = (reservas, titular) => reservas.find((x) => x.titular === titular);
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
ok(r.dias === 3 && r.hoy === hoy && r.mas === 0 && r.activo === true, 'y trae los días de recepción (3), la fecha de hoy y que el check-in digital está prendido');
r = await proximas(dueno);
ok(r.ok === true, 'el dueño también la puede ver');

console.log('\n== 2. Qué reservas aparecen (todas las que esperan al huésped, cerca o lejos)');
const ids = {};
for (const [nombre, dias] of [['Tarde', -2], ['Muy vieja', -20], ['Hoy', 0], ['Mañana', 1], ['En una semana', 7], ['En dos meses', 60], ['En un año', 365]]) {
  const a = await anotar({ p_titular: nombre, p_ingreso: AR(dias), p_habitacion: `H${Math.abs(dias)}` });
  ids[nombre] = a.id;
  ok(a.ok === true, `se anotó «${nombre}» (${dias} días)`);
}
let l = await lista();
const titulares = l.map((x) => x.titular);
ok(['Tarde', 'Hoy', 'Mañana', 'En una semana', 'En dos meses', 'En un año'].every((t) => titulares.includes(t)), 'aparecen las de hoy, las que llegan tarde y también las lejanas (una semana, dos meses, un año)');
ok(!titulares.includes('Muy vieja'), 'las que se pasaron hace más de 3 días ya no se ofrecen a recepción');
ok((await lista(dueno)).length === l.length, 'el dueño ve la misma lista');
ok(JSON.stringify(titulares) === JSON.stringify(['Tarde', 'Hoy', 'Mañana', 'En una semana', 'En dos meses', 'En un año']), 'van de la más cercana a la más lejana');
const x = por(l, 'Mañana');
ok(x.habitacion === 'H1' && x.esperados === 3 && x.noches === 2 && x.precio_efectivo === 100000 && x.precio_transferencia === 110000 && x.sena === 30000 && x.nota === 'Llega a la tarde', 'cada una trae los datos para atender: habitación, huéspedes, noches, precios, seña y nota');
ok(x.estado === 'anotada' && x.dias_para === 1 && x.canal === 'Directo' && x.canal_cobra === true && x.categoria === 'Doble', 'y su estado, los días que faltan, el canal (y si cobra) y la categoría');

console.log('\n== 3. Cuándo se puede hacer el check-in');
const dentro = (t) => por(l, t).en_ventana;
ok(dentro('Tarde') && dentro('Hoy') && dentro('Mañana'), 'recepción puede hacer el check-in de la que llega tarde, de hoy y de mañana');
ok(dentro('En una semana') === false && dentro('En dos meses') === false && dentro('En un año') === false, 'pero no de las que llegan más allá de los 3 días: se ven, no se atienden todavía');
ok(por(l, 'En una semana').checkin_desde === AR(4) && por(l, 'En dos meses').checkin_desde === AR(57), 'cada una dice desde qué día se puede (3 días antes de la fecha de ingreso)');
ok((await lista(dueno)).every((a) => a.en_ventana === true), 'el dueño puede en todas, sin límite de días');
r = await cobro(ids['En una semana']);
ok(r.ok === false && r.error === 'llegada_fuera_de_fecha', 'y la base lo confirma: recepción no puede hacer el check-in de una fuera de la ventana');
r = await llamar('recepcion_anotada_guardar', { p_clave: rec, p_id: ids['En una semana'], p_titular: 'Cambiada', p_ingreso: AR(7), p_habitacion: 'H7', p_noches: 2, p_categoria: DOBLE, p_canal: DIRECTO, p_huespedes: 3, p_efectivo: 100000 });
ok(r.ok === false && r.error === 'llegada_fuera_de_fecha', 'ni corregirla');
await back.sql(`update private.checkin_config set dias_recepcion = 10 where id = 1`);
l = await lista();
ok(por(l, 'En una semana').en_ventana === true && por(l, 'En dos meses').en_ventana === false && por(l, 'En una semana').checkin_desde === AR(-3), 'si el dueño amplía los días de recepción a 10, la de una semana pasa a poder atenderse (y se agrega alguna más vieja)');
await back.sql(`update private.checkin_config set dias_recepcion = 3 where id = 1`);
r = await cobro(ids['En una semana'], {}, dueno);
ok(r.ok === true, 'el dueño sí puede hacer el check-in de una lejana');

console.log('\n== 4. Qué sale de la lista');
l = await lista();
ok(!por(l, 'En una semana'), 'cuando empieza el check-in de una reserva, deja de estar en próximas (pasa a las reservas abiertas)');
r = await cobro(ids['Hoy']);
ok(r.ok === true && !por(await lista(), 'Hoy'), 'lo mismo al hacer el check-in recepción');
await llamar('admin_anotada_cancelar', { p_clave: dueno, p_id: ids['Mañana'], p_cancelar: true });
ok(!por(await lista(), 'Mañana'), 'una reserva cancelada no aparece');
await llamar('admin_anotada_cancelar', { p_clave: dueno, p_id: ids['Mañana'], p_cancelar: false });
ok(!!por(await lista(), 'Mañana'), 'y si el dueño la restaura, vuelve a aparecer');
const nueva = await llamar('recepcion_anotada_guardar', { p_clave: rec, p_id: null, p_titular: 'De la calle', p_ingreso: hoy, p_habitacion: '55', p_noches: 1, p_categoria: DOBLE, p_canal: DIRECTO, p_huespedes: 2, p_efectivo: 80000 });
ok(nueva.ok === true && !!por(await lista(), 'De la calle'), 'una anotada por recepción aparece enseguida en la lista de todos');
l = await lista();
ok(l.every((a) => a.estado === 'anotada'), 'solo hay reservas que esperan al huésped (ninguna en curso ni cancelada)');

console.log('\n== 5. El límite de la lista');
await back.sql(`insert into private.reservas_anotadas (cargado_por, titular, fecha_ingreso, noches, habitacion, categoria_id, canal_id, huespedes_esperados, precio_efectivo)
                select 'Dueño', 'Masiva ' || g, current_date + 100 + (g % 50), 1, 'M' || g, $1, $2, 1, 1000 from generate_series(1, 310) g`, [DOBLE, DIRECTO]);
const total = await n(`select count(*)::int n from private.reservas_anotadas where cancelada_en is null and estadia_id is null and fecha_ingreso >= current_date - 3`);
r = await proximas();
ok(r.reservas.length === 300 && r.mas === total - 300 && r.mas > 0, `con ${total} reservas esperando trae 300 (las más cercanas) y avisa cuántas quedaron afuera (${r.mas})`);
ok(r.reservas[0].titular === 'Tarde' && r.reservas.every((a, i, v) => i === 0 || v[i - 1].fecha_ingreso <= a.fecha_ingreso), 'y las 300 son las más cercanas, en orden');
await back.sql(`delete from private.reservas_anotadas where titular like 'Masiva %'`);

console.log('\n== 6. No toca nada, solo lee');
const antes = await n(`select count(*)::int n from private.reservas_anotadas`);
await proximas(); await proximas(dueno);
ok(await n(`select count(*)::int n from private.reservas_anotadas`) === antes && await n(`select count(*)::int n from private.estadias`) === 2, 'mirar la lista no crea ni cambia ninguna reserva');
await back.sql(`update private.checkin_config set activo = false where id = 1`);
r = await proximas();
ok(r.ok === true && r.activo === false && r.reservas.length > 0, 'con el check-in apagado se sigue viendo la lista (y avisa que está apagado)');
await back.sql(`update private.checkin_config set activo = true where id = 1`);

console.log('\n== 7. Pasar de la versión publicada hoy a esta');
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
const rV = await llamarV('recepcion_proximas', { p_clave: recV });
ok(rV.ok === true && rV.reservas.length === 1 && rV.reservas[0].titular === 'Antes' && rV.reservas[0].en_ventana === true, 'sobre la base migrada recepción ya ve la reserva que estaba anotada');
const bV = await llamarV('admin_anotada_guardar', { p_clave: duenoV, p_id: null, p_titular: 'Después', p_ingreso: AR(30), p_habitacion: '202', p_noches: 1, p_categoria: DOBLE, p_canal: DIRECTO, p_huespedes: 1, p_efectivo: 50000 });
const rV2 = await llamarV('recepcion_proximas', { p_clave: recV });
ok(bV.ok && rV2.reservas.length === 2 && rV2.reservas[1].en_ventana === false, 'y una anotada para dentro de un mes se ve, todavía sin poder hacer el check-in');
const iV = await llamarV('recepcion_llegada_iniciar', { p_clave: recV, p_id: aV.id, p_habitacion: '201', p_monto: 50000, p_moneda: 'ARS', p_medio_pago: EFECTIVO, p_fecha: hoy, p_pago_hotel: 50000, p_noches: 1, p_canal: DIRECTO, p_categoria: DOBLE, p_huespedes: 1 });
ok(iV.ok === true && (await llamarV('recepcion_proximas', { p_clave: recV })).reservas.length === 1, 'el check-in sigue funcionando y la reserva sale de la lista');
await viejo.cerrar();

await back.cerrar();
console.log(fallas ? `\n${fallas} fallas` : '\nTodo bien');
process.exit(fallas ? 1 : 0);
