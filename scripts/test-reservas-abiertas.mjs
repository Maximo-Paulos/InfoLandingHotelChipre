// Reservas abiertas: cantidad de huéspedes obligatoria, reservas «en espera» que no suman, huéspedes que llegan a destiempo, cierre automático
// cuando entra el último, anular, 3 días de vida en recepción y reabrir (solo el dueño).
//   node scripts/test-reservas-abiertas.mjs
// Usa la base de prueba en memoria con schema.sql + checkin.sql + estadias.sql y llama a las funciones como lo hace la guía (rol "anon").
// La parte 9 arma una base como la que está publicada hoy (scripts/fixtures/estadias-v2.sql), con una reserva de prueba sin huéspedes, y le
// aplica el archivo nuevo dos veces.
import fs from 'node:fs';
import { CLAVE_ADMIN, CLAVE_RECEPCION, SQL_RECEPCION, iniciarBackend } from './backend-local.mjs';

let fallas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK    ' : 'FALLA '}${m}`); if (!c) fallas += 1; };

const back = await iniciarBackend({ puerto: 54397, estadias: true });
await back.sql(`update private.checkin_config set activo = true, usos_max = 20 where id = 1`);
await back.sql(SQL_RECEPCION, [CLAVE_RECEPCION]);
const llamar = (n, a, ip = '203.0.113.7') => back.llamar(n, a, ip);
const lucia = (await llamar('sesion_entrar', { p_clave: CLAVE_RECEPCION })).token; // «Recepción»: el turno de la mañana
const dueno = (await llamar('sesion_entrar', { p_clave: CLAVE_ADMIN })).token;
await llamar('admin_equipo_guardar', { p_clave: dueno, p_id: null, p_alias: 'Martín', p_rol: 'recepcion', p_clave_usuario: 'martin-clave-1234', p_activo: true });
const martin = (await llamar('sesion_entrar', { p_clave: 'martin-clave-1234' }, '203.0.113.9')).token; // el turno de la tarde
const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date()); // el «hoy» del hotel (hora argentina), como lo usan el formulario y las estadísticas
const idDe = async (tipo, nombre) => (await back.sql(`select id from private.catalogo where tipo = $1 and nombre = $2`, [tipo, nombre]))[0].id;
const CANAL = await idDe('canal', 'Directo');
const CAT = await idDe('categoria', 'Doble');
const reserva = (quien, extra = {}) => ({ p_clave: quien, p_habitacion: '107', p_monto: 100000, p_moneda: 'ARS', p_medio_pago: 2, p_fecha: hoy, p_noches: 2, p_canal: CANAL, p_categoria: CAT, p_huespedes: 3, ...extra });
const DATOS = (n, doc) => ({ nombre: n, apellido: 'Prueba', email: `${n.toLowerCase()}@correo.com`, telefono: '+541155551234', nacionalidad: 'Argentina', localidad: 'Capital Federal', domicilio: 'Av. Corrientes 1234 5° B', doc_tipo: 'DNI', doc_numero: String(doc), anio_nac: 1990 });
let ipN = 10;
let docN = 30000000;
const canjear = (codigo) => llamar('checkin_canjear', { p_codigo: String(codigo) }, `198.51.100.${ipN++}`);
const enviar = (token, nombre) => llamar('checkin_enviar', { p_token: token, p_datos: DATOS(nombre, docN++), p_idioma: 'es', p_acepta: true });
const checkin = async (codigo, nombre) => {
  const s = await canjear(codigo);
  return s.ok ? enviar(s.token, nombre) : s;
};
const estado = (quien) => llamar('recepcion_estado', { p_clave: quien });
const abiertas = async (quien) => (await estado(quien)).reservas_abiertas;
const stats = () => llamar('admin_estadisticas', { p_clave: dueno });
const fila = async (id) => (await back.sql(`select * from private.estadias where id = $1`, [id]))[0];
const numero = async (sql, p = []) => (await back.sql(sql, p))[0].n;

console.log('\n== 1. Es obligatorio cargar la cantidad de huéspedes (y todo lo demás)');
for (const [m, extra] of [
  ['sin cantidad de huéspedes', { p_huespedes: null }],
  ['cero huéspedes', { p_huespedes: 0 }],
  ['más de 12 huéspedes', { p_huespedes: 13 }],
  ['una cantidad negativa', { p_huespedes: -2 }]
]) {
  const r = await llamar('recepcion_reserva_nueva', reserva(lucia, extra));
  ok(r.ok === false && r.error === 'datos_invalidos' && r.campos.includes('huespedes'), `${m} → no se abre (huespedes)`);
}
let r = await llamar('recepcion_reserva_nueva', { p_clave: lucia, p_habitacion: '107', p_monto: 100000, p_moneda: 'ARS', p_medio_pago: 2, p_fecha: hoy });
ok(r.ok === false && ['noches', 'canal', 'categoria', 'huespedes'].every((c) => r.campos.includes(c)), 'sin noches, canal, categoría ni huéspedes (como la guía de antes) tampoco se abre');
ok(await numero('select count(*)::int n from private.estadias') === 0, 'ningún intento inválido dejó una reserva');
ok((await estado(lucia)).codigo === null, 'y sin reserva completa no hay código');

console.log('\n== 2. Una reserva sin huéspedes está «en espera»: no suma en nada, pero se ve');
const base = await stats();
r = await llamar('recepcion_reserva_nueva', reserva(lucia));
const R1 = r.id;
ok(r.ok === true && (await fila(R1)).huespedes_esperados === 3, 'se abre la reserva de la 107 para 3 huéspedes');
let st = await stats();
ok(!st.reservas.some((x) => x.id === R1) && st.reservas.length === base.reservas.length, 'las estadísticas NO la cuentan (no hay nadie adentro)');
const pend = st.pendientes.find((x) => x.id === R1);
ok(pend && pend.huespedes === 0 && pend.esperados === 3 && Number(pend.monto) === 100000 && !pend.anulada_en, 'el dueño la ve en «pendientes», con todo lo que cargó recepción');
let est = await estado(lucia);
ok(est.reserva?.estadia.id === R1 && est.reserva.estadia.esperados === 3 && est.reserva.estadia.con_checkin === 0 && est.codigo?.valor?.length === 6, 'recepción ve el código y «0 de 3»');
ok(est.reservas_abiertas.length === 1 && est.reservas_abiertas[0].id === R1 && est.reservas_abiertas[0].huespedes.length === 0, 'y la reserva está en su lista de reservas abiertas, sin huéspedes');
ok(est.reservas_abiertas[0].quedan_seg > 3 * 86400 - 60 && est.reservas_abiertas[0].quedan_seg <= 3 * 86400, 'que se ve 3 días');
ok(!(await estado(martin)).reserva && (await abiertas(martin)).length === 1, 'otra persona del equipo no ve el código de Lucía, pero sí la reserva abierta');

console.log('\n== 3. Dejarla en espera: apagar el código no cierra la reserva');
r = await llamar('recepcion_reserva_cerrar', { p_clave: lucia });
est = await estado(lucia);
ok(r.ok && est.codigo === null && est.reserva === null, 'recepción deja de mostrar el código');
ok(est.reservas_abiertas.length === 1 && est.reservas_abiertas[0].id === R1, 'pero la reserva sigue abierta en la lista');
ok((await stats()).reservas.length === base.reservas.length, 'y sigue sin sumar en las estadísticas');

console.log('\n== 4. Llega el primero: desde ese momento la reserva cuenta');
r = await llamar('recepcion_reserva_abrir', { p_clave: lucia, p_id: R1 });
est = await estado(lucia);
const cod = est.codigo.valor;
ok(r.ok && est.reserva?.estadia.id === R1 && est.reserva.vence_seg > 9 * 60, 'recepción le vuelve a dar código a la reserva abierta (10 minutos)');
ok((await checkin(cod, 'Ana')).ok === true, 'Ana hace el check-in');
st = await stats();
const e1 = st.reservas.find((x) => x.id === R1);
ok(e1 && e1.huespedes === 1 && e1.esperados === 3 && Number(e1.monto) === 100000, 'ahora la reserva SÍ cuenta (1 habitación, con su monto completo)');
ok(!st.pendientes.some((x) => x.id === R1), 'y deja de estar entre las pendientes');
est = await estado(lucia);
ok(est.reservas_abiertas.length === 1 && est.reservas_abiertas[0].estadia.con_checkin === 1 && est.reservas_abiertas[0].huespedes[0].nombre === 'Ana', 'sigue abierta: 1 de 3, con el nombre de Ana');

console.log('\n== 5. Los demás llegan a destiempo y los atiende otra persona');
await back.sql(`update private.codigos_usuario set estadia_vence = now() - interval '1 second'`); // pasaron los 10 minutos del código
ok((await checkin(cod, 'Beto')).error === 'codigo_invalido', 'el código apagado no deja entrar a nadie');
r = await llamar('recepcion_reserva_abrir', { p_clave: martin, p_id: R1 });
ok(r.ok === true, 'a la tarde, Martín le da código a la misma reserva');
const codM = (await estado(martin)).codigo.valor;
ok(codM !== cod, 'con un código propio');
ok((await checkin(codM, 'Beto')).ok === true, 'Beto hace el check-in');
const beto = (await back.sql(`select habilitado_por, habitacion, estadia_id from private.checkins where datos->>'nombre' = 'Beto'`))[0];
ok(beto.habilitado_por === 'Martín' && beto.habitacion === '107' && beto.estadia_id === R1, 'queda en la 107, habilitado por Martín');
ok((await numero('select count(*)::int n from private.estadias where id = $1', [R1])) === 1 && (await abiertas(martin)).length === 1, 'la reserva sigue abierta: faltan 1 de 3');
ok((await stats()).reservas.filter((x) => x.id === R1).length === 1, 'y cuenta una sola vez en las estadísticas');

console.log('\n== 6. Cuando entra el último, la reserva se cierra sola');
const codM2 = (await estado(martin)).codigo.valor;
ok((await checkin(codM2, 'Caro')).ok === true, 'Caro es la tercera');
est = await estado(martin);
ok(est.codigo === null && est.reserva === null, 'el código de Martín se apaga solo');
ok((await estado(lucia)).codigo === null, 'y ninguna otra persona sigue mostrando código de esa reserva');
ok((await abiertas(lucia)).length === 0 && (await abiertas(martin)).length === 0, 'la reserva sale de la lista de abiertas');
ok((await canjear(codM2)).error === 'codigo_invalido', 'el último código ya no sirve');
r = await llamar('recepcion_reserva_abrir', { p_clave: martin, p_id: R1 });
ok(r.ok === false && r.error === 'reserva_completa', 'recepción no puede volver a abrirla');
ok((await numero('select count(*)::int n from private.checkins where estadia_id = $1', [R1])) === 3, 'tiene exactamente 3 huéspedes');
ok((await stats()).reservas.find((x) => x.id === R1).huespedes === 3, 'y las estadísticas ven los 3');

console.log('\n== 7. Nadie se cuela de más (ni siquiera con el formulario ya empezado)');
r = await llamar('recepcion_reserva_nueva', reserva(lucia, { p_habitacion: '204', p_huespedes: 2 }));
const R2 = r.id;
const codR2 = (await estado(lucia)).codigo.valor;
const sA = await canjear(codR2);
const sB = await canjear(codR2);
const sC = await canjear(codR2); // tres personas con el formulario abierto para una habitación de 2
ok(sA.ok && sB.ok && sC.ok, 'tres personas canjean el código de una reserva de 2 antes de que se complete');
ok((await enviar(sA.token, 'Dani')).ok === true && (await enviar(sB.token, 'Eli')).ok === true, 'los dos primeros envían');
const tercera = await enviar(sC.token, 'Fede');
ok(tercera.ok === false && tercera.error === 'reserva_completa', 'el tercero recibe «reserva completa»');
ok((await numero('select count(*)::int n from private.checkins where estadia_id = $1', [R2])) === 2, 'y no se guarda: la habitación queda con 2');
ok((await numero(`select count(*)::int n from private.checkins where datos->>'nombre' = 'Fede'`)) === 0, 'Fede no quedó registrado en ninguna parte');
ok((await llamar('checkin_enviar', { p_token: sC.token, p_datos: DATOS('Fede', docN++), p_idioma: 'es', p_acepta: true })).ok === false, 'y su sesión tampoco sirve para reintentar');

console.log('\n== 8. Anular una reserva de prueba (sin huéspedes): SOLO el dueño');
r = await llamar('recepcion_reserva_nueva', reserva(lucia, { p_habitacion: '999', p_huespedes: 2, p_monto: 1 }));
const R3 = r.id;
const codR3 = (await estado(lucia)).codigo.valor;
const sP = await canjear(codR3); // alguien ya había canjeado el código
const totalAntes = await numero('select count(*)::int n from private.estadias');
r = await llamar('recepcion_reserva_anular', { p_clave: lucia, p_id: R3 });
ok(r.ok === false && r.error === 'sin_permiso', 'recepción NO puede anular ni una reserva sin huéspedes (eliminar es del dueño)');
ok(!(await fila(R3)).anulada_en && (await abiertas(lucia)).some((x) => x.id === R3), 'y la reserva sigue como estaba, en la lista de abiertas');
ok((await llamar('admin_reserva_anular', { p_clave: lucia, p_id: R3 })).ok === false, 'ni por la puerta del dueño con la clave de recepción');
r = await llamar('admin_reserva_anular', { p_clave: dueno, p_id: R3 });
ok(r.ok === true, 'el dueño la anula');
est = await estado(lucia);
ok(est.codigo === null && est.reserva === null && !est.reservas_abiertas.some((x) => x.id === R3), 'el código se apaga y sale de la lista');
ok(await numero('select count(*)::int n from private.estadias') === totalAntes, 'no se borra nada: la fila sigue en la base');
const anul = await fila(R3);
ok(anul.anulada_en && anul.anulada_por !== 'Recepción', 'queda marcada con cuándo y quién (el dueño)');
ok((await canjear(codR3)).error === 'codigo_invalido', 'su código ya no sirve');
const envA = await enviar(sP.token, 'Gabi');
ok(envA.ok === false && envA.error === 'reserva_cerrada', 'quien ya había canjeado el código y la manda recibe «reserva cerrada»');
st = await stats();
ok(!st.reservas.some((x) => x.id === R3) && st.pendientes.find((x) => x.id === R3)?.anulada_en, 'las estadísticas no la cuentan; el dueño la ve entre las anuladas');
ok((await numero(`select count(*)::int n from private.checkin_auditoria where accion = 'reserva_anular'`)) === 1, 'queda en el historial');
r = await llamar('recepcion_reserva_anular', { p_clave: lucia, p_id: R1 });
ok(r.ok === false && r.error === 'sin_permiso', 'una reserva con huéspedes tampoco la puede anular recepción');
// (el dueño sí puede anular una reserva con huéspedes: ver scripts/test-quitar.mjs)
ok((await llamar('admin_reserva_anular', { p_clave: lucia, p_id: R3, p_anular: false })).ok === false, 'recepción no puede restaurar una anulada (puerta del dueño)');
ok((await llamar('recepcion_reserva_abrir', { p_clave: lucia, p_id: R3 })).error === 'reserva_anulada', 'ni darle código a una anulada');
r = await llamar('admin_reserva_anular', { p_clave: dueno, p_id: R3, p_anular: false });
ok(r.ok === true && !(await fila(R3)).anulada_en, 'el dueño la restaura');
ok((await abiertas(lucia)).some((x) => x.id === R3), 'y vuelve a la lista de abiertas');
ok((await llamar('recepcion_reserva_anular', { p_clave: 'clave-mala', p_id: R3 })).ok === false, 'sin clave de recepción no se anula nada');
await llamar('admin_reserva_anular', { p_clave: dueno, p_id: R3 });

console.log('\n== 9. A los 3 días desaparece de recepción (el dueño la sigue viendo)');
r = await llamar('recepcion_reserva_nueva', reserva(lucia, { p_habitacion: '305', p_huespedes: 3 }));
const R4 = r.id;
await checkin((await estado(lucia)).codigo.valor, 'Hugo');
const viejoDias = async (id, dias) => { await back.sql(`update private.estadias set creado = now() - make_interval(days => $2) where id = $1`, [id, dias]); await back.sql(`update private.checkins set creado = now() - make_interval(days => $2) where estadia_id = $1`, [id, dias]); };
ok((await abiertas(lucia)).some((x) => x.id === R4), 'la reserva 305 (1 de 3) está en la lista');
await viejoDias(R4, 4);
ok(!(await abiertas(lucia)).some((x) => x.id === R4), 'pasados 3 días sin que llegue nadie, desaparece de la lista de recepción');
r = await llamar('recepcion_reserva_abrir', { p_clave: lucia, p_id: R4 });
ok(r.ok === false && r.error === 'reserva_vencida', 'y recepción ya no puede darle código');
ok((await stats()).reservas.some((x) => x.id === R4), 'sigue contando en las estadísticas (tiene un huésped)');
await back.sql(`update private.checkins set creado = now() - interval '1 day' where estadia_id = $1`, [R4]);
ok((await abiertas(lucia)).some((x) => x.id === R4), 'si el último huésped entró hace 1 día, la reserva sigue visible (cuenta desde la última actividad)');
await viejoDias(R4, 4);
r = await llamar('recepcion_reserva_abrir', { p_clave: dueno, p_id: R4 });
ok(r.ok === true, 'el dueño sí puede darle código a una reserva vieja');
r = await llamar('recepcion_reserva_nueva', reserva(lucia, { p_habitacion: '306' }));
const R5 = r.id;
await viejoDias(R5, 5);
ok(!(await abiertas(lucia)).some((x) => x.id === R5) && !(await abiertas(martin)).some((x) => x.id === R5), 'una reserva en espera de hace 5 días tampoco se ve en recepción');
ok((await stats()).pendientes.some((x) => x.id === R5), 'pero el dueño la sigue viendo');
r = await llamar('recepcion_reserva_anular', { p_clave: lucia, p_id: R5 });
ok(r.ok === false && r.error === 'sin_permiso', 'recepción no anula nada (tampoco lo que ya no ve)');
ok((await llamar('admin_reserva_anular', { p_clave: dueno, p_id: R5 })).ok === true, 'el dueño sí');

console.log('\n== 10. Solo el dueño la reabre (subiendo la cantidad de huéspedes)');
const hab204 = await fila(R2); // completa: 2 de 2
await viejoDias(R2, 9);
const editar = (quien, id, extra = {}) => llamar(quien === dueno ? 'admin_estadia_editar' : 'recepcion_estadia_editar', { p_clave: quien, p_id: id, p_habitacion: '204', p_monto: 100000, p_moneda: 'ARS', p_medio_pago: 2, p_fecha: hoy, p_noches: 2, p_canal: CANAL, p_categoria: CAT, ...extra });
r = await editar(lucia, R2, { p_huespedes: 3 });
ok(r.ok === false && r.error === 'fuera_de_tiempo', 'recepción no puede tocar una reserva completa pasada la ventana de edición');
r = await editar(dueno, R2, { p_huespedes: 0 });
ok(r.ok === false && r.campos.includes('huespedes'), 'la cantidad tiene que ser de 1 a 12 también al corregir');
ok((await abiertas(lucia)).every((x) => x.id !== R2), 'la reserva completa no está en la lista');
r = await editar(dueno, R2, { p_huespedes: 3 });
ok(r.ok === true && (await fila(R2)).huespedes_esperados === 3, 'el dueño sube la cantidad a 3');
ok((await abiertas(lucia)).some((x) => x.id === R2 && x.estadia.con_checkin === 2 && x.estadia.esperados === 3), 'la reserva vuelve a aparecer en recepción (2 de 3), aunque sea vieja');
r = await llamar('recepcion_reserva_abrir', { p_clave: lucia, p_id: R2 });
ok(r.ok === true, 'y recepción le puede dar código para el que falta');
ok((await checkin((await estado(lucia)).codigo.valor, 'Ines')).ok === true && !(await abiertas(lucia)).some((x) => x.id === R2), 'entra el tercero y se vuelve a cerrar');
r = await editar(dueno, R2, { p_huespedes: 2 });
ok(r.ok === true && (await fila(R2)).huespedes_esperados === 2, 'el dueño también puede bajar la cantidad');
r = await editar(dueno, R2, {});
ok(r.ok === true && (await fila(R2)).huespedes_esperados === 2, 'y si al corregir no se manda la cantidad, queda la que tenía');
ok((await numero(`select count(*)::int n from private.checkin_auditoria where accion = 'estadia_editar' and detalle::text like '%huespedes%'`)) >= 2, 'los cambios de cantidad quedan en el historial');

console.log('\n== 11. Pasar de la versión publicada hoy a esta: las reservas de prueba sin huéspedes dejan de sumar');
const viejo = await iniciarBackend({ puerto: 54395, estadias: false });
await viejo.sql(`update private.checkin_config set activo = true, usos_max = 20 where id = 1`);
await viejo.sql(SQL_RECEPCION, [CLAVE_RECEPCION]);
await viejo.exec(fs.readFileSync(new URL('./fixtures/estadias-v2.sql', import.meta.url), 'utf8')); // el estadias.sql que hoy está en producción
const llamarV = (n, a) => viejo.llamar(n, a, '203.0.113.8');
const recV = (await llamarV('sesion_entrar', { p_clave: CLAVE_RECEPCION })).token;
const duenoV = (await llamarV('sesion_entrar', { p_clave: CLAVE_ADMIN })).token;
const nuevaV = (extra) => llamarV('recepcion_reserva_nueva', { p_clave: recV, p_habitacion: '201', p_monto: 100000, p_moneda: 'ARS', p_medio_pago: 2, p_fecha: hoy, p_noches: 2, p_canal: CANAL, p_categoria: CAT, ...extra });
const real = await nuevaV({ p_habitacion: '201' }); // una reserva de verdad, con 2 huéspedes
for (const n of ['Real1', 'Real2']) {
  await viejo.sql(`insert into private.checkins (grupo, datos, consentimiento, habitacion, estadia_id) values (1, $1::jsonb, '{"aceptado":true}'::jsonb, '201', $2)`, [JSON.stringify(DATOS(n, docN++)), real.id]);
}
const prueba1 = await nuevaV({ p_habitacion: '999', p_monto: 5 }); // las dos reservas de prueba del empleado, sin check-in
const prueba2 = await nuevaV({ p_habitacion: '998', p_monto: 7 });
const antes = await llamarV('admin_estadisticas', { p_clave: duenoV });
ok(antes.reservas.length === 3, 'con la versión de hoy las tres cuentan (ese es el problema: las de prueba suman)');
const huella = async () => (await viejo.sql(`select md5(string_agg(concat_ws('|', id, habitacion, monto, moneda, pago_hotel, fecha_cobro, cargado_por, medio_pago_id, noches, canal_id, categoria_id, creado), ';' order by id)) as k, (select md5(string_agg(concat_ws('|', id, estadia_id, datos::text), ';' order by id)) from private.checkins) as h from private.estadias`))[0];
const h0 = await huella();
const nuevoSql = fs.readFileSync(new URL('../supabase/estadias.sql', import.meta.url), 'utf8');
await viejo.exec(nuevoSql);
await viejo.exec(nuevoSql);
ok(JSON.stringify(await huella()) === JSON.stringify(h0), 'las reservas y los huéspedes quedan idénticos, aun aplicando el archivo dos veces');
const mig = await viejo.sql(`select id, huespedes_esperados h, anulada_en from private.estadias order by id`);
ok(mig.find((x) => x.id === real.id).h === 2 && mig.find((x) => x.id === prueba1.id).h === 1 && mig.every((x) => x.anulada_en === null), 'la real queda completa (2 de 2); las de prueba, en espera para 1 huésped; ninguna anulada sola');
const despues = await llamarV('admin_estadisticas', { p_clave: duenoV });
ok(despues.reservas.length === 1 && despues.reservas[0].id === real.id, 'las estadísticas ahora solo cuentan la reserva con huéspedes');
ok(despues.pendientes.length === 2 && despues.pendientes.every((x) => [prueba1.id, prueba2.id].includes(x.id)), 'y las dos de prueba aparecen como pendientes para que el dueño las vea');
const anulaV = await llamarV('admin_reserva_anular', { p_clave: duenoV, p_id: prueba1.id });
const anulaV2 = await llamarV('admin_reserva_anular', { p_clave: duenoV, p_id: prueba2.id });
ok(anulaV.ok && anulaV2.ok, 'el dueño anula las dos de prueba');
ok((await llamarV('admin_estadisticas', { p_clave: duenoV })).reservas.length === 1, 'y las cifras siguen iguales');
const vieja = await nuevaV({ p_habitacion: '202' }); // sin cantidad de huéspedes, como la guía de antes
ok(vieja.ok === false && vieja.campos.includes('huespedes'), 'la guía anterior ya no puede abrir una reserva sin la cantidad (por eso se publica la guía nueva junto con el SQL)');
const estV = await llamarV('recepcion_estado', { p_clave: recV });
ok(estV.ok && Array.isArray(estV.reservas_abiertas) && estV.reservas_abiertas.length === 0, 'recepción no ve reservas abiertas colgadas de antes: la real está completa y las de prueba, anuladas');
await viejo.cerrar();

await back.cerrar();
console.log(fallas ? `\n${fallas} fallas` : '\nTodo bien');
process.exit(fallas ? 1 : 0);
