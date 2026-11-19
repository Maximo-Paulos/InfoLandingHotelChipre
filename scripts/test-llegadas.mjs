// Reservas anotadas (por adelantado): las carga el dueño con precios (efectivo, transferencia, dólares), seña y nota; recepción ve las llegadas de los
// próximos 3 días y hace el check-in eligiendo cómo paga; la reserva sigue como siempre (código, huéspedes de a uno, se cierra sola).
//   node scripts/test-llegadas.mjs
// Usa la base de prueba en memoria con schema.sql + checkin.sql + estadias.sql y llama a las funciones como lo hace la guía (rol "anon").
// La parte 11 arma una base como la publicada hoy (scripts/fixtures/estadias-v3.sql) y le aplica el archivo nuevo dos veces.
import fs from 'node:fs';
import { CLAVE_ADMIN, CLAVE_RECEPCION, SQL_RECEPCION, iniciarBackend } from './backend-local.mjs';

let fallas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK    ' : 'FALLA '}${m}`); if (!c) fallas += 1; };

const back = await iniciarBackend({ puerto: 54392, estadias: true });
await back.sql(`update private.checkin_config set activo = true, usos_max = 20 where id = 1`);
await back.sql(SQL_RECEPCION, [CLAVE_RECEPCION]);
const llamar = (n, a, ip = '203.0.113.7') => back.llamar(n, a, ip);
const rec = (await llamar('sesion_entrar', { p_clave: CLAVE_RECEPCION })).token;
const dueno = (await llamar('sesion_entrar', { p_clave: CLAVE_ADMIN })).token;
await llamar('admin_equipo_guardar', { p_clave: dueno, p_id: null, p_alias: 'Martín', p_rol: 'recepcion', p_clave_usuario: 'martin-clave-1234', p_activo: true });
const martin = (await llamar('sesion_entrar', { p_clave: 'martin-clave-1234' }, '203.0.113.9')).token;
const AR = (n = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(Date.now() + n * 864e5));
const hoy = AR();
const idDe = async (tipo, nombre) => (await back.sql(`select id from private.catalogo where tipo = $1 and nombre = $2`, [tipo, nombre]))[0].id;
const DIRECTO = await idDe('canal', 'Directo');
const OBRA = await idDe('canal', 'Obra social');
const DOBLE = await idDe('categoria', 'Doble');
const EFECTIVO = (await back.sql(`select id from private.medios_pago where nombre = 'Efectivo'`))[0].id;
const TRANSF = (await back.sql(`select id from private.medios_pago where nombre = 'Transferencia'`))[0].id;
const USDM = (await back.sql(`select id from private.medios_pago where nombre = 'USD efectivo'`))[0].id;

const anotar = (extra = {}, quien = dueno) => llamar('admin_anotada_guardar', {
  p_clave: quien, p_id: null, p_titular: 'Juan Pérez', p_ingreso: AR(2), p_habitacion: '107', p_noches: 2, p_categoria: DOBLE, p_canal: DIRECTO, p_huespedes: 3,
  p_efectivo: 100000, p_transferencia: 110000, p_usd: null, p_sena: 30000, p_fecha_sena: AR(-5), p_nota: 'Llega a la tarde, pide cama extra', ...extra
});
const estado = (quien = rec) => llamar('recepcion_estado', { p_clave: quien });
const llegadas = async (quien = rec) => (await estado(quien)).llegadas;
const anotadas = async () => (await llamar('admin_anotadas', { p_clave: dueno })).anotadas;
const fila = async (id) => (await back.sql(`select * from private.reservas_anotadas where id = $1`, [id]))[0];
const n = async (sql, p = []) => (await back.sql(sql, p))[0].n;
const DATOS = (nom, doc) => ({ nombre: nom, apellido: 'Prueba', email: `${nom.toLowerCase()}@correo.com`, telefono: '+541155551234', nacionalidad: 'Argentina', localidad: 'Capital Federal', domicilio: 'Av. Corrientes 1234 5° B', doc_tipo: 'DNI', doc_numero: String(doc), anio_nac: 1990 });
let ipN = 10;
let docN = 33000000;
const checkin = async (codigo, nom) => {
  const s = await llamar('checkin_canjear', { p_codigo: String(codigo) }, `198.51.100.${ipN++}`);
  return s.ok ? llamar('checkin_enviar', { p_token: s.token, p_datos: DATOS(nom, docN++), p_idioma: 'es', p_acepta: true }) : s;
};
// el cobro con el que recepción arma la reserva al hacer el check-in
const cobro = (id, extra = {}, quien = rec) => llamar('recepcion_llegada_iniciar', {
  p_clave: quien, p_id: id, p_habitacion: '107', p_monto: 100000, p_moneda: 'ARS', p_medio_pago: EFECTIVO, p_fecha: hoy, p_pago_hotel: 70000, p_fecha_sena: AR(-5),
  p_noches: 2, p_canal: DIRECTO, p_categoria: DOBLE, p_huespedes: 3, ...extra
});

console.log('\n== 1. Solo el dueño anota, corrige y cancela');
let r = await anotar({}, rec);
ok(r.ok === false, 'recepción no puede anotar una reserva');
ok((await anotar({}, 'clave-mala')).ok === false, 'ni con una clave mala');
ok((await llamar('admin_anotadas', { p_clave: rec })).ok === false, 'ni ver la lista completa del dueño');
ok(await n('select count(*)::int n from private.reservas_anotadas') === 0, 'no se creó nada');

console.log('\n== 2. Todo lo que hace falta (y nada raro)');
for (const [m, extra, campo] of [
  ['sin titular', { p_titular: '  ' }, 'titular'],
  ['titular larguísimo', { p_titular: 'x'.repeat(61) }, 'titular'],
  ['sin fecha de ingreso', { p_ingreso: null }, 'fecha_ingreso'],
  ['ingreso de hace años', { p_ingreso: '2020-01-01' }, 'fecha_ingreso'],
  ['sin habitación', { p_habitacion: '' }, 'habitacion'],
  ['sin noches', { p_noches: null }, 'noches'],
  ['sin cantidad de huéspedes', { p_huespedes: null }, 'huespedes'],
  ['13 huéspedes', { p_huespedes: 13 }, 'huespedes'],
  ['sin categoría', { p_categoria: null }, 'categoria'],
  ['canal que no existe', { p_canal: 9999 }, 'canal'],
  ['sin precio en efectivo', { p_efectivo: null }, 'precio_efectivo'],
  ['precio en efectivo en cero', { p_efectivo: 0 }, 'precio_efectivo'],
  ['precio en transferencia en cero', { p_transferencia: 0 }, 'precio_transferencia'],
  ['precio en dólares en cero', { p_usd: 0 }, 'precio_usd'],
  ['seña mayor que el precio más bajo', { p_sena: 100001 }, 'sena'],
  ['seña negativa', { p_sena: -1 }, 'sena'],
  ['fecha de seña en el futuro', { p_fecha_sena: AR(5) }, 'fecha_sena'],
  ['nota de más de 500 letras', { p_nota: 'a'.repeat(501) }, 'nota']
]) {
  r = await anotar(extra);
  ok(r.ok === false && r.error === 'datos_invalidos' && r.campos.includes(campo), `${m} → ${campo}`);
}
ok(await n('select count(*)::int n from private.reservas_anotadas') === 0, 'ningún intento inválido dejó una reserva anotada');

console.log('\n== 3. Anotar una reserva con dos precios, seña y nota');
r = await anotar();
const A = r.id;
ok(r.ok === true && Array.isArray(r.superpuestas) && r.superpuestas.length === 0, 'el dueño anota la 107 a nombre de Juan Pérez (sin otra reserva que se pise)');
let a = (await anotadas()).find((x) => x.id === A);
ok(a.titular === 'Juan Pérez' && a.habitacion === '107' && a.esperados === 3 && a.dias_para === 2 && a.noches === 2 && a.salida === AR(4) && a.estado === 'anotada', 'queda con titular, habitación, 3 huéspedes, ingreso en 2 días y salida a los 2 días de ingresar');
ok(Number(a.precio_efectivo) === 100000 && Number(a.precio_transferencia) === 110000 && a.precio_usd === null && Number(a.sena) === 30000 && a.fecha_sena === AR(-5) && a.nota.includes('cama extra'), 'con precio en efectivo, en transferencia, sin precio en dólares, seña de 30.000 y la nota');
ok(a.categoria === 'Doble' && a.canal === 'Directo' && a.canal_cobra === true, 'y su categoría y canal');
r = await anotar({ p_habitacion: '108', p_titular: 'Solo efectivo', p_transferencia: null, p_usd: 120, p_sena: 0, p_fecha_sena: null });
const B = r.id;
a = (await anotadas()).find((x) => x.id === B);
ok(r.ok && a.precio_transferencia === null && Number(a.precio_usd) === 120 && Number(a.sena) === 0, 'se puede cargar un solo precio en pesos, el precio en dólares y sin seña');
r = await anotar({ p_habitacion: '109', p_titular: 'Obra Social Mutual', p_canal: OBRA, p_efectivo: 55555, p_transferencia: 66666, p_usd: 77, p_sena: 9999 });
a = (await anotadas()).find((x) => x.id === r.id);
ok(r.ok && Number(a.precio_efectivo) === 0 && a.precio_transferencia === null && a.precio_usd === null && Number(a.sena) === 0, 'obra social: no lleva precios ni seña (lo que mande la pantalla se ignora)');
const OS = r.id;
{
  const st = await llamar('admin_estadisticas', { p_clave: dueno });
  ok(st.reservas.length === 0 && st.pendientes.length === 0, 'las reservas anotadas NO suman en las estadísticas ni figuran como pendientes (todavía no son una estadía)');
}

console.log('\n== 4. Aviso si la misma habitación ya tiene otra reserva que se pisa');
r = await anotar({ p_titular: 'Otro Pérez', p_ingreso: AR(3) });
ok(r.ok && r.superpuestas.length === 1 && r.superpuestas[0].id === A && r.superpuestas[0].titular === 'Juan Pérez', 'anotar la 107 desde el día 3 (la de Juan sale el día 4) avisa que se pisa con la de Juan, pero igual la guarda');
const C = r.id;
r = await anotar({ p_titular: 'Después', p_ingreso: AR(4) });
ok(r.ok && r.superpuestas.every((x) => x.id !== A), 'si ingresa el día que Juan sale (día 4) no se pisa con la de Juan');
const D = r.id;
r = await anotar({ p_titular: 'Otra habitación', p_habitacion: '110', p_ingreso: AR(2) });
ok(r.ok && r.superpuestas.length === 0, 'otra habitación no se pisa con nada');
const E = r.id;

console.log('\n== 5. Recepción ve las llegadas de los próximos 3 días (y las que se pasaron hace poco)');
await back.sql(`update private.reservas_anotadas set fecha_ingreso = $1 where id = $2`, [AR(10), C]);
await back.sql(`update private.reservas_anotadas set fecha_ingreso = $1 where id = $2`, [AR(-2), D]);
await back.sql(`update private.reservas_anotadas set fecha_ingreso = $1 where id = $2`, [AR(-6), E]);
let ll = await llegadas();
const ids = ll.map((x) => x.id);
ok(ids.includes(A) && ids.includes(B) && ids.includes(OS) && ids.includes(D), 've la de Juan (en 2 días), la 108, la de obra social y la de hace 2 días');
ok(!ids.includes(C) && !ids.includes(E), 'no ve la que llega en 10 días ni la que se pasó hace 6 días');
ok(ll.map((x) => x.fecha_ingreso).join() === [...ll.map((x) => x.fecha_ingreso)].sort().join(), 'ordenadas por fecha de ingreso');
const lj = ll.find((x) => x.id === A);
ok(lj.titular === 'Juan Pérez' && Number(lj.precio_efectivo) === 100000 && Number(lj.precio_transferencia) === 110000 && Number(lj.sena) === 30000 && lj.esperados === 3 && lj.categoria === 'Doble' && lj.nota.includes('cama extra'), 'cada llegada trae titular, precios, seña, cantidad de huéspedes, categoría y nota');
ok((await llegadas(martin)).length === ll.length, 'las ve todo el equipo');
ok((await anotadas()).some((x) => x.id === C) && (await anotadas()).some((x) => x.id === E), 'el dueño sí ve todas, también la lejana y la que se pasó');
await back.sql(`update private.checkin_config set dias_recepcion = 1 where id = 1`);
ok((await llegadas()).every((x) => x.dias_para >= -1 && x.dias_para <= 1), 'la ventana sigue lo que el dueño configuró en «Días que ve recepción»');
await back.sql(`update private.checkin_config set dias_recepcion = 3 where id = 1`);

console.log('\n== 6. Hacer el check-in: recepción elige cómo paga y se arma la reserva');
ok((await cobro(A, { p_huespedes: null })).error === 'datos_invalidos', 'sin cantidad de huéspedes no se puede (mismas reglas que «Nueva reserva»)');
ok((await cobro(A, { p_medio_pago: 999 })).error === 'datos_invalidos', 'ni con un medio de pago que no existe');
ok((await cobro(A, {}, 'clave-mala')).ok === false, 'ni sin clave de recepción');
ok(await n('select count(*)::int n from private.estadias') === 0, 'los intentos inválidos no dejaron ninguna reserva');
r = await cobro(A); // paga el resto en efectivo: 100.000 - 30.000 de seña = 70.000
const EA = r.id;
ok(r.ok === true, 'Lucía hace el check-in de Juan y cobra el resto en efectivo');
let est = (await back.sql(`select titular, nota, monto::float m, pago_hotel::float p, fecha_sena::text fs, moneda, medio_pago_id, huespedes_esperados h, habitacion from private.estadias where id = $1`, [EA]))[0];
ok(est.titular === 'Juan Pérez' && est.nota.includes('cama extra') && est.m === 100000 && est.p === 70000 && est.fs === AR(-5) && est.moneda === 'ARS' && est.medio_pago_id === EFECTIVO && est.h === 3, 'la reserva queda a nombre de Juan, con la nota, total 100.000, pagó 70.000 en el hotel (la seña de 30.000 y su fecha) y 3 huéspedes');
ok((await fila(A)).estadia_id === EA, 'la reserva anotada queda enlazada a esa estadía');
ok(!(await llegadas()).some((x) => x.id === A) && (await anotadas()).find((x) => x.id === A).estado === 'en_curso', 'sale de las llegadas y figura «en curso»');
est = await estado();
ok(est.codigo?.valor?.length === 6 && est.reserva.estadia.titular === 'Juan Pérez' && est.reserva.estadia.nota.includes('cama extra') && est.reserva.estadia.esperados === 3, 'recepción ve el código, y la reserva con el nombre de Juan y la nota');
const cod = est.codigo.valor;
ok((await checkin(cod, 'Juan')).ok === true && (await checkin(cod, 'Ana')).ok === true, 'Juan y Ana hacen el check-in');
ok((await abiertas_()).some((x) => x.id === EA && x.estadia.titular === 'Juan Pérez' && x.estadia.con_checkin === 2), 'la reserva abierta se identifica por «Juan Pérez»: 2 de 3');
async function abiertas_() { return (await estado()).reservas_abiertas; }
ok((await cobro(A)).error === 'anotada_ya_empezo', 'otra persona no puede volver a hacer el check-in de la misma reserva');
ok((await cobro(A, {}, martin)).error === 'anotada_ya_empezo', 'ni Martín');
r = await llamar('admin_anotada_guardar', { p_clave: dueno, p_id: A, p_titular: 'Juan', p_ingreso: AR(2), p_habitacion: '107', p_noches: 2, p_categoria: DOBLE, p_canal: DIRECTO, p_huespedes: 3, p_efectivo: 1 });
ok(r.error === 'anotada_ya_empezo', 'ya empezó el check-in: la reserva anotada no se corrige más (se corrige la reserva)');
r = await llamar('admin_anotada_cancelar', { p_clave: dueno, p_id: A });
ok(r.error === 'anotada_ya_empezo', 'ni se cancela (se elimina como cualquier reserva)');
ok((await checkin(cod, 'Beto')).ok === true && (await estado()).codigo === null, 'entra el tercero y la reserva se cierra sola, como siempre');
const stj = await llamar('admin_estadisticas', { p_clave: dueno });
const rj = stj.reservas.find((x) => x.id === EA);
ok(rj && rj.huespedes === 3 && Number(rj.monto) === 100000 && Number(rj.pago_hotel) === 70000 && rj.titular === 'Juan Pérez', 'recién ahora suma en las estadísticas (con los 3 huéspedes y a nombre de Juan)');

console.log('\n== 7. Pagar el resto en transferencia o en dólares');
r = await cobro(B, { p_habitacion: '108', p_monto: 120, p_moneda: 'USD', p_medio_pago: USDM, p_pago_hotel: 120, p_fecha_sena: null, p_huespedes: 2, p_noches: 2 }, martin);
ok(r.ok === true, 'Martín cobra la 108 en dólares: US$ 120');
est = (await back.sql(`select monto::float m, pago_hotel::float p, moneda, medio_pago_id, titular, cargado_por from private.estadias where id = $1`, [r.id]))[0];
ok(est.m === 120 && est.p === 120 && est.moneda === 'USD' && est.medio_pago_id === USDM && est.titular === 'Solo efectivo' && est.cargado_por === 'Martín', 'queda en dólares, a nombre del titular y cargada por quien hizo el cobro (Martín)');
const EB = r.id;
r = await cobro(OS, { p_habitacion: '109', p_monto: 0, p_pago_hotel: 0, p_canal: OBRA, p_fecha_sena: null, p_huespedes: 3 });
ok(r.ok === true && (await n(`select monto::float n from private.estadias where id = $1`, [r.id])) === 0, 'la obra social no cobra: se hace el check-in sin monto');
ok(await n('select count(*)::int n from private.reservas_anotadas where estadia_id is not null') === 3, 'las tres quedaron enlazadas a su estadía');
// transferencia: el total que se cobra es el precio en transferencia (110.000) menos la seña (30.000) = 80.000
const T = (await anotar({ p_habitacion: '201', p_titular: 'Paga transferencia' })).id;
r = await cobro(T, { p_habitacion: '201', p_monto: 110000, p_medio_pago: TRANSF, p_pago_hotel: 80000 });
est = (await back.sql(`select monto::float m, pago_hotel::float p, medio_pago_id from private.estadias where id = $1`, [r.id]))[0];
ok(r.ok && est.m === 110000 && est.p === 80000 && est.medio_pago_id === TRANSF, 'transferencia: total 110.000, seña 30.000 y 80.000 cobrados en el hotel');
const ET = r.id;

console.log('\n== 8. Fuera de la ventana y cancelaciones');
r = await cobro(C, { p_habitacion: '107' }); // llega en 10 días: recepción todavía no la ve
ok(r.ok === false && r.error === 'llegada_fuera_de_fecha', 'recepción no puede hacer el check-in de una reserva que llega en 10 días');
r = await cobro(E, { p_habitacion: '110', p_huespedes: 1 }); // se pasó hace 6 días
ok(r.error === 'llegada_fuera_de_fecha', 'ni de una que se pasó hace 6 días');
r = await cobro(C, { p_habitacion: '107', p_fecha_sena: null, p_pago_hotel: 100000 }, dueno);
ok(r.ok === true, 'el dueño sí, cuando quiera (por ejemplo, si el huésped se adelantó)');
r = await llamar('admin_anotada_cancelar', { p_clave: rec, p_id: D });
ok(r.ok === false, 'recepción no cancela reservas anotadas');
r = await llamar('admin_anotada_cancelar', { p_clave: dueno, p_id: D });
ok(r.ok === true && !(await llegadas()).some((x) => x.id === D), 'el dueño cancela la «Después»: sale de las llegadas');
ok((await fila(D)).cancelada_en && (await fila(D)).cancelada_por === 'Dueño', 'no se borra: queda marcada con quién y cuándo');
ok((await cobro(D, { p_habitacion: '107' }, dueno)).error === 'anotada_cancelada', 'una cancelada no permite hacer el check-in');
ok((await llamar('admin_anotada_guardar', { p_clave: dueno, p_id: D, p_titular: 'X', p_ingreso: AR(1), p_habitacion: '107', p_noches: 1, p_categoria: DOBLE, p_canal: DIRECTO, p_huespedes: 1, p_efectivo: 5 })).error === 'anotada_cancelada', 'ni se corrige');
ok((await anotadas()).find((x) => x.id === D).estado === 'cancelada', 'el dueño la ve como cancelada');
r = await llamar('admin_anotada_cancelar', { p_clave: dueno, p_id: D, p_cancelar: false });
ok(r.ok && (await llegadas()).some((x) => x.id === D), 'y la restaura: vuelve a las llegadas');
ok((await llamar('admin_anotada_cancelar', { p_clave: dueno, p_id: 99999 })).error === 'no_existe', 'cancelar una que no existe → no_existe');

console.log('\n== 9. El dueño corrige una reserva anotada');
r = await llamar('admin_anotada_guardar', { p_clave: dueno, p_id: D, p_titular: 'Después (corregido)', p_ingreso: AR(1), p_habitacion: '111', p_noches: 3, p_categoria: DOBLE, p_canal: DIRECTO, p_huespedes: 2, p_efectivo: 90000, p_transferencia: 99000, p_usd: 95, p_sena: 20000, p_fecha_sena: null, p_nota: null });
a = (await anotadas()).find((x) => x.id === D);
ok(r.ok && a.titular === 'Después (corregido)' && a.habitacion === '111' && a.noches === 3 && a.esperados === 2 && Number(a.precio_efectivo) === 90000 && Number(a.precio_usd) === 95 && Number(a.sena) === 20000 && a.nota === null, 'cambia titular, habitación, noches, huéspedes, precios, seña y nota');
ok((await back.sql(`select editado_por, editado_en is not null e from private.reservas_anotadas where id = $1`, [D]))[0].e === true, 'queda anotado quién y cuándo la corrigió');
ok(await n(`select count(*)::int n from private.checkin_auditoria where accion = 'anotada_guardar' and detalle::text like '%precios%'`) >= 1, 'y el historial dice qué campos se cambiaron');
ok((await llamar('admin_anotada_guardar', { p_clave: rec, p_id: D, p_titular: 'X', p_ingreso: AR(1), p_habitacion: '111', p_noches: 1, p_categoria: DOBLE, p_canal: DIRECTO, p_huespedes: 1, p_efectivo: 5 })).ok === false, 'recepción no corrige');
ok((await llamar('admin_anotada_guardar', { p_clave: dueno, p_id: D, p_titular: 'X', p_ingreso: AR(1), p_habitacion: '111', p_noches: 1, p_categoria: DOBLE, p_canal: DIRECTO, p_huespedes: 1, p_efectivo: 5, p_sena: 6 })).campos?.includes('sena'), 'al corregir también se controla que la seña no pase del precio');

console.log('\n== 10. Si el cobro se cargó mal y se anula la reserva sin huéspedes, vuelve a las llegadas');
r = await cobro(D, { p_habitacion: '111', p_monto: 90000, p_pago_hotel: 70000, p_noches: 3, p_huespedes: 2 });
const ED = r.id;
ok(r.ok === true && !(await llegadas()).some((x) => x.id === D), 'se hace el check-in de la «Después» (cobro 90.000 con seña 20.000)');
r = await llamar('recepcion_reserva_anular', { p_clave: rec, p_id: ED });
ok(r.ok === true, 'recepción se equivocó en el cobro: anula la reserva (todavía sin huéspedes)');
ok((await fila(D)).estadia_id === null && (await llegadas()).some((x) => x.id === D), 'la reserva anotada vuelve a las llegadas para hacer el check-in bien');
r = await cobro(D, { p_habitacion: '111', p_monto: 90000, p_pago_hotel: 70000, p_noches: 3, p_huespedes: 2 });
ok(r.ok === true, 'y se hace de nuevo');
// una reserva con huéspedes eliminada por el dueño queda enlazada (historia)
r = await llamar('admin_reserva_anular', { p_clave: dueno, p_id: EA });
ok(r.ok === true && (await fila(A)).estadia_id === EA, 'si el dueño elimina una reserva con huéspedes, la anotada sigue enlazada (no vuelve a las llegadas)');
await llamar('admin_reserva_anular', { p_clave: dueno, p_id: EA, p_anular: false });

console.log('\n== 11. Pasar de la versión publicada hoy a esta');
const viejo = await iniciarBackend({ puerto: 54391, estadias: false });
await viejo.sql(`update private.checkin_config set activo = true, usos_max = 20 where id = 1`);
await viejo.sql(SQL_RECEPCION, [CLAVE_RECEPCION]);
await viejo.exec(fs.readFileSync(new URL('./fixtures/estadias-v3.sql', import.meta.url), 'utf8')); // el estadias.sql que hoy está en producción
const llamarV = (nom, a2) => viejo.llamar(nom, a2, '203.0.113.8');
const recV = (await llamarV('sesion_entrar', { p_clave: CLAVE_RECEPCION })).token;
const duenoV = (await llamarV('sesion_entrar', { p_clave: CLAVE_ADMIN })).token;
const nuevaV = (extra) => llamarV('recepcion_reserva_nueva', { p_clave: recV, p_habitacion: '201', p_monto: 100000, p_moneda: 'ARS', p_medio_pago: EFECTIVO, p_fecha: hoy, p_noches: 2, p_canal: DIRECTO, p_categoria: DOBLE, p_huespedes: 2, ...extra });
const v1 = await nuevaV({});
for (const nom of ['P1', 'P2']) await viejo.sql(`insert into private.checkins (grupo, datos, consentimiento, habitacion, estadia_id) values (1, $1::jsonb, '{"aceptado":true}'::jsonb, '201', $2)`, [JSON.stringify(DATOS(nom === 'P1' ? 'Pe' : 'Pa', docN++)), v1.id]);
const v2 = await nuevaV({ p_habitacion: '202' }); // una abierta sin huéspedes
const huella = async () => (await viejo.sql(`select md5(string_agg(concat_ws('|', id, habitacion, monto, moneda, pago_hotel, fecha_cobro, cargado_por, medio_pago_id, noches, canal_id, categoria_id, huespedes_esperados, creado, anulada_en), ';' order by id)) as k, (select md5(string_agg(concat_ws('|', id, estadia_id, datos::text, quitado_en), ';' order by id)) from private.checkins) as h from private.estadias`))[0];
const h0 = await huella();
const sql = fs.readFileSync(new URL('../supabase/estadias.sql', import.meta.url), 'utf8');
await viejo.exec(sql);
await viejo.exec(sql);
ok(JSON.stringify(await huella()) === JSON.stringify(h0), 'las reservas y los huéspedes quedan idénticos, aun aplicando el archivo dos veces');
ok((await viejo.sql(`select count(*)::int n from private.estadias where titular is not null or nota is not null`))[0].n === 0 && (await viejo.sql(`select count(*)::int n from private.reservas_anotadas`))[0].n === 0, 'las reservas de antes no tienen titular ni nota, y no hay reservas anotadas');
const eV = await llamarV('recepcion_estado', { p_clave: recV });
ok(eV.ok && Array.isArray(eV.llegadas) && eV.llegadas.length === 0 && eV.reservas_abiertas.some((x) => x.id === v2.id), 'recepción sigue viendo lo de siempre y ahora una lista de llegadas vacía');
const aV = await llamarV('admin_anotada_guardar', { p_clave: duenoV, p_id: null, p_titular: 'Después de migrar', p_ingreso: AR(1), p_habitacion: '301', p_noches: 1, p_categoria: DOBLE, p_canal: DIRECTO, p_huespedes: 1, p_efectivo: 50000 });
ok(aV.ok === true, 'el dueño puede anotar una reserva sobre la base migrada');
const iV = await llamarV('recepcion_llegada_iniciar', { p_clave: recV, p_id: aV.id, p_habitacion: '301', p_monto: 50000, p_moneda: 'ARS', p_medio_pago: EFECTIVO, p_fecha: hoy, p_pago_hotel: 50000, p_noches: 1, p_canal: DIRECTO, p_categoria: DOBLE, p_huespedes: 1 });
ok(iV.ok === true, 'y recepción hace su check-in');
const statsV = await llamarV('admin_estadisticas', { p_clave: duenoV });
ok(statsV.reservas.length === 1 && statsV.reservas[0].id === v1.id, 'las estadísticas siguen contando solo la reserva con huéspedes');
await viejo.cerrar();

await back.cerrar();
console.log(fallas ? `\n${fallas} fallas` : '\nTodo bien');
process.exit(fallas ? 1 : 0);
