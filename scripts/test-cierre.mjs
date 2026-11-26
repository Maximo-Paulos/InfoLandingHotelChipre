// Cerrar una reserva a mano («se anotaron dos y vino uno, al final no viene el otro») y la lista de reservas de la pantalla Reservas (el campo `estadias`):
// todas las reservas con actividad en los días que ve recepción, tengan o no nombre, con quiénes ingresaron y en qué estado están (sin ingresos, faltan, completa, cerrada).
//   node scripts/test-cierre.mjs
// Usa la base de prueba en memoria con schema.sql + checkin.sql + estadias.sql y llama a las funciones como lo hace la guía (rol "anon").
// La parte 8 arma una base como la publicada hoy (scripts/fixtures/estadias-v6.sql) y le aplica el archivo nuevo dos veces.
import fs from 'node:fs';
import { CLAVE_ADMIN, CLAVE_RECEPCION, SQL_RECEPCION, iniciarBackend } from './backend-local.mjs';

let fallas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK    ' : 'FALLA '}${m}`); if (!c) fallas += 1; };

const back = await iniciarBackend({ puerto: 54398, estadias: true });
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
let docN = 34000000;
const codigoDe = async (quien = rec) => (await llamar('recepcion_estado', { p_clave: quien })).codigo?.valor ?? null;
const entra = async (nom, codigo) => {
  const s = await llamar('checkin_canjear', { p_codigo: String(codigo) }, `198.51.100.${ipN++}`);
  return s.ok ? llamar('checkin_enviar', { p_token: s.token, p_datos: DATOS(nom, docN++), p_idioma: 'es', p_acepta: true }) : s;
};
const reserva = (extra = {}) => llamar('recepcion_reserva_nueva', { p_clave: rec, p_habitacion: '12', p_monto: 90000, p_moneda: 'ARS', p_medio_pago: EFECTIVO, p_fecha: hoy, p_pago_hotel: 90000, p_fecha_sena: null, p_noches: 2, p_canal: DIRECTO, p_categoria: DOBLE, p_huespedes: 2, ...extra });
const abrir = (id, quien = rec) => llamar('recepcion_reserva_abrir', { p_clave: quien, p_id: id });
const cerrar = (id, quien = rec) => llamar('recepcion_estadia_cerrar', { p_clave: quien, p_id: id });
const reabrir = (id, quien = dueno) => llamar('admin_estadia_reabrir', { p_clave: quien, p_id: id });
const estadias = async (quien = rec) => (await llamar('recepcion_proximas', { p_clave: quien })).estadias;
const de = async (id, quien = rec) => (await estadias(quien)).find((x) => x.id === id);
const anotar = (extra = {}) => llamar('admin_anotada_guardar', {
  p_clave: dueno, p_id: null, p_titular: 'Juan Pérez', p_ingreso: hoy, p_habitacion: '107', p_noches: 2, p_categoria: DOBLE, p_canal: DIRECTO, p_huespedes: 3,
  p_efectivo: 100000, p_transferencia: null, p_usd: null, p_sena: 0, p_fecha_sena: null, p_nota: null, ...extra
});
const iniciar = (id, hab, hues, quien = rec) => llamar('recepcion_llegada_iniciar', { p_clave: quien, p_id: id, p_habitacion: hab, p_monto: 100000, p_moneda: 'ARS', p_medio_pago: EFECTIVO, p_fecha: hoy, p_pago_hotel: 100000, p_fecha_sena: null, p_noches: 2, p_canal: DIRECTO, p_categoria: DOBLE, p_huespedes: hues });

console.log('\n== 1. Cerrar una reserva a la que vino uno de los dos');
const r1 = await reserva({ p_habitacion: '12', p_huespedes: 2 });
ok(r1.ok === true, 'recepción abre una reserva rápida (sin nombre) para 2 huéspedes en la habitación 12');
let cod = await codigoDe();
ok((await entra('Ana', cod)).ok === true, 'entra Ana');
let e1 = await de(r1.id);
ok(e1.estado === 'faltan' && e1.con_checkin === 1 && e1.esperados === 2 && e1.ingresaron.join() === 'Ana Prueba', 'queda «faltan»: 1 de 2, con el nombre de Ana (falta cerrar)');
ok((await llamar('recepcion_estado', { p_clave: rec })).reservas_abiertas.some((x) => x.id === r1.id), 'y está entre las reservas abiertas');
const statsAntes = (await llamar('admin_estadisticas', { p_clave: dueno })).reservas.length;
let r = await cerrar(r1.id);
ok(r.ok === true, 'recepción la cierra: «al final no viene el otro»');
e1 = await de(r1.id);
ok(e1.estado === 'cerrada' && e1.con_checkin === 1 && e1.esperados === 2 && e1.cerrada_por === 'Recepción' && e1.cerrada_en != null, 'queda «cerrada»: sigue diciendo 1 de 2 y quién la cerró');
ok(!(await llamar('recepcion_estado', { p_clave: rec })).reservas_abiertas.some((x) => x.id === r1.id), 'ya no está entre las reservas abiertas');
ok((await entra('Beto', cod)).ok === false, 'el código que tenía a la vista ya no sirve: nadie más puede entrar a esa reserva');
r = await abrir(r1.id);
ok(r.ok === false && r.error === 'reserva_completa', 'y no se le puede volver a dar código');
ok((await llamar('admin_estadisticas', { p_clave: dueno })).reservas.length === statsAntes, 'las estadísticas no cambian: sigue siendo una reserva con 1 huésped');
ok(await n(`select count(*)::int n from private.checkin_auditoria where accion = 'reserva_cerrar'`) === 1, 'queda anotado en el registro de movimientos quién la cerró');
r = await cerrar(r1.id);
ok(r.ok === true && (await de(r1.id)).cerrada_por === 'Recepción', 'cerrarla de nuevo no pasa nada (sigue igual)');

console.log('\n== 2. Cuándo no se puede cerrar');
const r2 = await reserva({ p_habitacion: '13' });
r = await cerrar(r2.id);
ok(r.ok === false && r.error === 'sin_huespedes', 'una reserva sin ningún huésped no se cierra (la anula el dueño)');
ok((await de(r2.id)).estado === 'sin_ingresos', 'y figura como «sin ingresos»');
r = await llamar('recepcion_reserva_anular', { p_clave: rec, p_id: r2.id });
ok(r.ok === false && r.error === 'sin_permiso', 'recepción no la puede anular (eliminar es solo del dueño)');
r = await llamar('admin_reserva_anular', { p_clave: dueno, p_id: r2.id });
ok(r.ok === true, 'el dueño la anula');
r = await cerrar(r2.id);
ok(r.ok === false && r.error === 'reserva_anulada', 'y una anulada no se puede cerrar');
ok(!(await estadias()).some((x) => x.id === r2.id), 'ni aparece en la lista de reservas');
r = await cerrar(999999);
ok(r.ok === false && r.error === 'no_existe', 'una que no existe, tampoco');
ok((await cerrar(r1.id, 'clave-mala')).ok === false && (await cerrar(r1.id, '')).ok === false, 'sin clave o con una mala no se cierra nada');
const r3 = await reserva({ p_habitacion: '14', p_huespedes: 1 });
await entra('Carla', await codigoDe());
ok((await de(r3.id)).estado === 'completa', 'una reserva con todos adentro queda «completa» (se cierra sola)');
r = await cerrar(r3.id);
ok(r.ok === true && (await de(r3.id)).cerrada_en == null && (await de(r3.id)).estado === 'completa', 'cerrarla a mano no cambia nada: ya estaba completa');

console.log('\n== 3. Reabrirla es solo del dueño');
r = await reabrir(r1.id, rec);
ok(r.ok === false, 'recepción no puede reabrir una reserva cerrada');
ok((await de(r1.id)).estado === 'cerrada', 'y sigue cerrada');
r = await reabrir(r1.id);
ok(r.ok === true, 'el dueño la reabre');
e1 = await de(r1.id);
ok(e1.estado === 'faltan' && e1.cerrada_en == null && e1.cerrada_por == null, 'vuelve a «faltan»: 1 de 2, sin marca de cerrada');
r = await abrir(r1.id);
ok(r.ok === true && (await codigoDe()) != null, 'y se le puede volver a dar el código');
ok((await entra('Dani', await codigoDe())).ok === true && (await de(r1.id)).estado === 'completa', 'entra el otro: queda «completa»');
ok(await n(`select count(*)::int n from private.checkin_auditoria where accion = 'reserva_reabrir'`) === 1, 'y queda anotado quién la reabrió');
r = await reabrir(r3.id);
ok(r.ok === true && (await de(r3.id)).estado === 'completa', 'reabrir una que no estaba cerrada a mano no cambia nada');
r = await reabrir(999999);
ok(r.ok === false && r.error === 'no_existe', 'una que no existe, tampoco');
ok((await reabrir(r1.id, 'clave-mala')).ok === false, 'ni con una clave mala');

console.log('\n== 4. Las que se cierran fuera de los días');
const r4 = await reserva({ p_habitacion: '15', p_huespedes: 2 });
await entra('Eva', await codigoDe());
await back.sql(`update private.checkins set creado = now() - interval '9 days' where estadia_id = $1`, [r4.id]);
await back.sql(`update private.estadias set creado = now() - interval '9 days' where id = $1`, [r4.id]);
ok(!(await estadias()).some((x) => x.id === r4.id), 'con la última actividad de hace 9 días (ventana de 5) recepción ya no la ve');
r = await cerrar(r4.id);
ok(r.ok === false && r.error === 'reserva_vencida', 'y no la puede cerrar');
ok((await de(r4.id, dueno))?.estado === 'faltan', 'el dueño sí la ve');
r = await cerrar(r4.id, dueno);
ok(r.ok === true && (await de(r4.id, dueno)).estado === 'cerrada' && (await de(r4.id, dueno)).cerrada_por === 'Dueño', 'y sí la puede cerrar');

console.log('\n== 5. La lista de reservas: con nombre, sin nombre y de todo tipo');
const rapida = await de(r1.id);
ok(rapida.titular == null && rapida.anotada_id == null && rapida.llegada === hoy && rapida.dias_para === 0 && rapida.habitacion === '12' && rapida.noches === 2, 'una reserva rápida no tiene nombre ni reserva anotada, y su llegada es el día en que se abrió');
const a = await anotar({ p_titular: 'Familia Gómez', p_habitacion: '77', p_ingreso: AR(-1), p_huespedes: 3 });
await iniciar(a.id, '77', 3);
await entra('Luis', await codigoDe());
const fam = await de((await back.sql(`select estadia_id from private.reservas_anotadas where id = $1`, [a.id]))[0].estadia_id);
ok(fam.titular === 'Familia Gómez' && fam.anotada_id === a.id && fam.llegada === AR(-1) && fam.dias_para === -1 && fam.estado === 'faltan' && fam.con_checkin === 1 && fam.esperados === 3, 'una que viene de una reserva anotada trae el nombre, su fecha de ingreso (ayer) y cuántos entraron (1 de 3)');
ok(fam.categoria === 'Doble' && fam.canal === 'Directo' && typeof fam.ultima === 'string' && fam.creado != null, 'y la categoría, el canal y la última actividad');
const sin = await iniciar((await anotar({ p_titular: 'Sin nadie', p_habitacion: '88', p_ingreso: hoy, p_huespedes: 2 })).id, '88', 2);
const sinFila = (await estadias()).find((x) => x.titular === 'Sin nadie');
ok(sin.ok && sinFila.estado === 'sin_ingresos' && sinFila.con_checkin === 0 && sinFila.ingresaron.length === 0, 'con el código dado y nadie adentro: «sin ingresos»');
const todos = await estadias();
const estados = Object.fromEntries(todos.map((x) => [x.habitacion, x.estado]));
ok(estados['12'] === 'completa' && estados['14'] === 'completa' && estados['77'] === 'faltan' && estados['88'] === 'sin_ingresos', `los estados de cada una: ${JSON.stringify(estados)}`);
ok(todos.every((x, i, v) => i === 0 || v[i - 1].llegada >= x.llegada), 'vienen de la llegada más reciente a la más vieja (para el historial por día)');
await back.sql(`update private.estadias set creado = now() - interval '70 days' where id = $1`, [r4.id]);
await back.sql(`update private.checkins set creado = now() - interval '70 days' where estadia_id = $1`, [r4.id]);
ok(!(await estadias(dueno)).some((x) => x.id === r4.id), 'pasados 60 días ni el dueño la ve');
ok((await estadias(dueno)).length >= (await estadias()).length, 'el dueño ve lo mismo o más que recepción');
const pagina = await llamar('recepcion_proximas', { p_clave: rec });
ok(pagina.ok && Array.isArray(pagina.estadias) && Array.isArray(pagina.reservas), 'la respuesta sigue trayendo las reservas anotadas (reservas) y ahora también las reservas (estadias)');

console.log('\n== 6. Sin permisos');
ok((await llamar('recepcion_proximas', { p_clave: 'clave-mala' })).ok === false, 'sin una clave buena no se ve ninguna reserva');

console.log('\n== 7. Que no rompa lo de siempre');
ok((await llamar('recepcion_estado', { p_clave: rec })).ok === true && (await llamar('admin_estadisticas', { p_clave: dueno })).ok === true, 'el estado de recepción y las estadísticas siguen andando');
const hues = await llamar('admin_huespedes', { p_clave: dueno, p_buscar: null, p_limite: 50, p_antes: null });
ok(hues.ok === true && hues.huespedes.some((h) => h.datos.nombre === 'Ana'), 'y la lista de huéspedes del dueño también');

console.log('\n== 8. Pasar de la versión publicada hoy a esta');
const viejo = await iniciarBackend({ puerto: 54399, estadias: false });
await viejo.sql(`update private.checkin_config set activo = true, usos_max = 20 where id = 1`);
await viejo.sql(SQL_RECEPCION, [CLAVE_RECEPCION]);
await viejo.exec(fs.readFileSync(new URL('./fixtures/estadias-v6.sql', import.meta.url), 'utf8')); // el estadias.sql que hoy está en producción
const llamarV = (nom, x) => viejo.llamar(nom, x, '203.0.113.8');
const recV = (await llamarV('sesion_entrar', { p_clave: CLAVE_RECEPCION })).token;
const duenoV = (await llamarV('sesion_entrar', { p_clave: CLAVE_ADMIN })).token;
const rV = await llamarV('recepcion_reserva_nueva', { p_clave: recV, p_habitacion: '21', p_monto: 50000, p_moneda: 'ARS', p_medio_pago: EFECTIVO, p_fecha: hoy, p_pago_hotel: 50000, p_fecha_sena: null, p_noches: 1, p_canal: DIRECTO, p_categoria: DOBLE, p_huespedes: 2 });
const codV = (await llamarV('recepcion_estado', { p_clave: recV })).codigo.valor;
const sV = await llamarV('checkin_canjear', { p_codigo: codV });
await llamarV('checkin_enviar', { p_token: sV.token, p_datos: DATOS('Antes', 35000000), p_idioma: 'es', p_acepta: true });
const huella = async () => (await viejo.sql(`select md5(string_agg(concat_ws('|', id, habitacion, monto, huespedes_esperados, titular), ';' order by id)) as k from private.estadias`))[0];
const h0 = await huella();
const sql = fs.readFileSync(new URL('../supabase/estadias.sql', import.meta.url), 'utf8');
await viejo.exec(sql);
await viejo.exec(sql);
ok(JSON.stringify(await huella()) === JSON.stringify(h0), 'las reservas quedan idénticas, aun aplicando el archivo dos veces');
const eV = (await llamarV('recepcion_proximas', { p_clave: recV })).estadias;
ok(eV.length === 1 && eV[0].estado === 'faltan' && eV[0].ingresaron.join() === 'Antes Prueba' && eV[0].cerrada_en == null, 'la reserva de antes aparece en la lista nueva: 1 de 2, sin cerrar');
ok((await llamarV('recepcion_estadia_cerrar', { p_clave: recV, p_id: rV.id })).ok === true && (await llamarV('recepcion_proximas', { p_clave: recV })).estadias[0].estado === 'cerrada', 'y se puede cerrar');
ok((await llamarV('admin_estadia_reabrir', { p_clave: duenoV, p_id: rV.id })).ok === true && (await llamarV('recepcion_proximas', { p_clave: recV })).estadias[0].estado === 'faltan', 'y reabrir');
await viejo.cerrar();

await back.cerrar();
console.log(fallas ? `\n${fallas} fallas` : '\nTodo bien');
process.exit(fallas ? 1 : 0);
