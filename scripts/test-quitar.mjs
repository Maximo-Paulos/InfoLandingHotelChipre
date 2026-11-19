// El dueño corrige, quita y elimina (sin borrar nada): corregir la cantidad de huéspedes, mover un huésped a otra reserva, quitar a un huésped,
// anular una reserva CON huéspedes (se van con ella y vuelven al restaurarla) y que lo quitado no cuente en ninguna lista ni estadística.
//   node scripts/test-quitar.mjs
// Usa la base de prueba en memoria con schema.sql + checkin.sql + estadias.sql y llama a las funciones como lo hace la guía (rol "anon").
import fs from 'node:fs';
import { CLAVE_ADMIN, CLAVE_RECEPCION, SQL_RECEPCION, iniciarBackend } from './backend-local.mjs';

let fallas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK    ' : 'FALLA '}${m}`); if (!c) fallas += 1; };

const back = await iniciarBackend({ puerto: 54394, estadias: true });
await back.sql(`update private.checkin_config set activo = true, usos_max = 20 where id = 1`);
await back.sql(SQL_RECEPCION, [CLAVE_RECEPCION]);
const llamar = (n, a, ip = '203.0.113.7') => back.llamar(n, a, ip);
const rec = (await llamar('sesion_entrar', { p_clave: CLAVE_RECEPCION })).token;
const dueno = (await llamar('sesion_entrar', { p_clave: CLAVE_ADMIN })).token;
const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
const idDe = async (tipo, nombre) => (await back.sql(`select id from private.catalogo where tipo = $1 and nombre = $2`, [tipo, nombre]))[0].id;
const CANAL = await idDe('canal', 'Directo');
const CAT = await idDe('categoria', 'Doble');
const reserva = (extra = {}) => ({ p_clave: rec, p_habitacion: '107', p_monto: 100000, p_moneda: 'ARS', p_medio_pago: 2, p_fecha: hoy, p_noches: 2, p_canal: CANAL, p_categoria: CAT, p_huespedes: 3, ...extra });
const DATOS = (n, doc) => ({ nombre: n, apellido: 'Prueba', email: `${n.toLowerCase()}@correo.com`, telefono: '+541155551234', nacionalidad: 'Argentina', localidad: 'Capital Federal', domicilio: 'Av. Corrientes 1234 5° B', doc_tipo: 'DNI', doc_numero: String(doc), anio_nac: 1990 });
let ipN = 10;
let docN = 31000000;
const checkin = async (codigo, nombre, doc = docN++) => {
  const s = await llamar('checkin_canjear', { p_codigo: String(codigo) }, `198.51.100.${ipN++}`);
  return s.ok ? llamar('checkin_enviar', { p_token: s.token, p_datos: DATOS(nombre, doc), p_idioma: 'es', p_acepta: true }) : s;
};
const nueva = async (extra) => { const r = await llamar('recepcion_reserva_nueva', reserva(extra)); return r.id; };
// una reserva con N huéspedes ya adentro; devuelve { id, hu: {nombre: idCheckin} }
const conGente = async (hab, esperados, nombres, extra = {}) => {
  const id = await nueva({ p_habitacion: hab, p_huespedes: esperados, ...extra });
  const hu = {};
  for (const n of nombres) {
    const cod = (await llamar('recepcion_estado', { p_clave: rec })).codigo?.valor ?? (await (async () => { await llamar('recepcion_reserva_abrir', { p_clave: rec, p_id: id }); return (await llamar('recepcion_estado', { p_clave: rec })).codigo.valor; })());
    const e = await checkin(cod, n);
    if (!e.ok) throw new Error(`no se pudo cargar a ${n}: ${JSON.stringify(e)}`);
    hu[n] = (await back.sql(`select id from private.checkins where datos->>'nombre' = $1`, [n]))[0].id;
  }
  return { id, hu };
};
const stats = () => llamar('admin_estadisticas', { p_clave: dueno });
const lista = async () => (await llamar('admin_huespedes', { p_clave: dueno })).huespedes;
const nombresVisibles = async () => (await lista()).map((h) => h.datos.nombre).sort();
const abiertas = async () => (await llamar('recepcion_estado', { p_clave: rec })).reservas_abiertas;
const fila = async (id) => (await back.sql(`select * from private.estadias where id = $1`, [id]))[0];
const n = async (sql, p = []) => (await back.sql(sql, p))[0].n;

console.log('\n== 1. Recepción puso mal la cantidad de huéspedes: el dueño la corrige');
const A = await conGente('107', 2, ['Ana', 'Beto']); // recepción puso 2, pero eran 3
ok((await abiertas()).every((x) => x.id !== A.id), 'con 2 de 2 la reserva está completa y recepción no la ve');
let r = await llamar('admin_estadia_editar', { p_clave: dueno, p_id: A.id, p_habitacion: '107', p_monto: 100000, p_moneda: 'ARS', p_medio_pago: 2, p_fecha: hoy, p_noches: 2, p_canal: CANAL, p_categoria: CAT, p_huespedes: 3 });
ok(r.ok && (await abiertas()).some((x) => x.id === A.id && x.estadia.esperados === 3 && x.estadia.con_checkin === 2), 'el dueño la sube a 3: vuelve a estar abierta (2 de 3)');
r = await llamar('admin_estadia_editar', { p_clave: dueno, p_id: A.id, p_habitacion: '108', p_monto: 120000, p_moneda: 'USD', p_medio_pago: 1, p_fecha: hoy, p_noches: 3, p_canal: CANAL, p_categoria: CAT, p_huespedes: 3 });
const fa = await fila(A.id);
ok(r.ok && fa.habitacion === '108' && Number(fa.monto) === 120000 && fa.moneda === 'USD' && fa.noches === 3, 'y puede corregir también habitación, monto, moneda, noches y medio de pago');
ok((await n(`select count(*)::int n from private.checkins where estadia_id = $1 and habitacion = '108'`, [A.id])) === 2, 'la habitación nueva pasa a los huéspedes');

console.log('\n== 2. Quitar a una persona de una reserva');
const B = await conGente('204', 3, ['Caro', 'Dani', 'Eli']); // completa: 3 de 3
const antes = await n('select count(*)::int n from private.checkins');
ok((await llamar('admin_huesped_quitar', { p_clave: rec, p_id: B.hu.Dani })).ok === false, 'recepción no puede quitar a nadie');
ok((await llamar('admin_huesped_quitar', { p_clave: 'clave-mala', p_id: B.hu.Dani })).ok === false, 'ni con una clave mala');
r = await llamar('admin_huesped_quitar', { p_clave: dueno, p_id: B.hu.Dani });
ok(r.ok === true, 'el dueño quita a Dani');
ok(!(await nombresVisibles()).includes('Dani') && (await nombresVisibles()).includes('Caro'), 'Dani deja de verse en la lista de huéspedes (Caro y Eli siguen)');
const estR = await llamar('recepcion_estado', { p_clave: rec });
ok(!estR.huespedes.some((h) => h.datos.nombre === 'Dani'), 'ni en la planilla de recepción');
ok((await abiertas()).some((x) => x.id === B.id && x.estadia.con_checkin === 2 && x.estadia.esperados === 3 && x.huespedes.length === 2), 'la reserva pasa a 2 de 3 y vuelve a estar abierta (para cargar al que corresponde)');
let st = await stats();
ok(st.reservas.find((x) => x.id === B.id).huespedes === 2 && !st.huespedes.some((h) => h.id === B.hu.Dani), 'las estadísticas ya no cuentan a Dani');
ok(await n('select count(*)::int n from private.checkins') === antes, 'no se borró nada: la fila de Dani sigue en la base');
const dani = (await back.sql(`select quitado_en, quitado_por from private.checkins where id = $1`, [B.hu.Dani]))[0];
ok(dani.quitado_en && dani.quitado_por === 'Dueño', 'quedó marcado con cuándo y quién');
let q = await llamar('admin_huespedes_quitados', { p_clave: dueno });
ok(q.ok && q.huespedes.length === 1 && q.huespedes[0].nombre === 'Dani' && q.huespedes[0].reserva_anulada === false, 'el dueño ve a Dani en la lista de quitados');
ok((await llamar('admin_huespedes_quitados', { p_clave: rec })).ok === false, 'recepción no ve esa lista');
ok((await llamar('admin_huesped_quitar', { p_clave: dueno, p_id: B.hu.Dani })).ok === true && await n('select count(*)::int n from private.checkin_auditoria where accion = $1', ['huesped_quitar']) === 1, 'quitar dos veces no hace nada raro ni repite el historial');
// entra el que correspondía con un código de la reserva reabierta
await llamar('recepcion_reserva_abrir', { p_clave: rec, p_id: B.id });
const codB = (await llamar('recepcion_estado', { p_clave: rec })).codigo.valor;
ok((await checkin(codB, 'Fede')).ok === true, 'entra Fede, el que correspondía, por el lugar que quedó libre');
ok((await llamar('recepcion_estado', { p_clave: rec })).codigo === null, 'y al completarse la reserva el código se apaga');
r = await llamar('admin_huesped_quitar', { p_clave: dueno, p_id: B.hu.Dani, p_quitar: false });
ok(r.ok && (await nombresVisibles()).includes('Dani'), 'el dueño restaura a Dani');
ok((await lista()).filter((h) => h.estadia_id === B.id).length === 4 && (await abiertas()).every((x) => x.id !== B.id), 'la reserva queda con 4 (más de lo esperado: pasa cuando el dueño decide), y cerrada');
ok(await n('select count(*)::int n from private.checkin_auditoria where accion = $1', ['huesped_restaurar']) === 1, 'todo queda en el historial');
ok((await llamar('admin_huesped_quitar', { p_clave: dueno, p_id: 999999 })).error === 'no_existe', 'un huésped que no existe → no_existe');

console.log('\n== 3. Mover a un huésped a otra reserva (o dejarlo sin reserva)');
const C = await conGente('301', 2, ['Gabi']); // Gabi quedó en la 301, pero era de la 302
const D = await nueva({ p_habitacion: '302', p_huespedes: 2 }); // la 302 todavía no tiene a nadie
let lh = await llamar('admin_huespedes', { p_clave: dueno });
ok(lh.reservas.some((x) => x.id === D && x.con_checkin === 0), 'el dueño recibe también las reservas sin huéspedes para mover gente a ellas');
r = await llamar('admin_huesped_estadia', { p_clave: dueno, p_id: C.hu.Gabi, p_estadia: D });
const gabi = (await back.sql(`select estadia_id, habitacion from private.checkins where id = $1`, [C.hu.Gabi]))[0];
ok(r.ok && gabi.estadia_id === D && gabi.habitacion === '302', 'Gabi pasa a la 302 y toma su habitación');
st = await stats();
ok(!st.reservas.some((x) => x.id === C.id) && st.pendientes.some((x) => x.id === C.id) && st.reservas.some((x) => x.id === D && x.huespedes === 1), 'la 301 quedó sin huéspedes (no suma) y la 302 pasó a sumar');
ok((await abiertas()).some((x) => x.id === C.id && x.estadia.con_checkin === 0), 'la 301 vuelve a estar abierta en recepción');
r = await llamar('admin_huesped_estadia', { p_clave: dueno, p_id: C.hu.Gabi, p_estadia: null });
ok(r.ok && (await n('select estadia_id is null as n from private.checkins where id = $1', [C.hu.Gabi])) === true, 'también se puede dejar a un huésped sin reserva');
ok((await llamar('admin_huesped_estadia', { p_clave: rec, p_id: C.hu.Gabi, p_estadia: D })).ok === false, 'recepción no puede mover a nadie');
await llamar('admin_huesped_estadia', { p_clave: dueno, p_id: C.hu.Gabi, p_estadia: D });
await llamar('admin_huesped_quitar', { p_clave: dueno, p_id: C.hu.Gabi });
ok((await llamar('admin_huesped_estadia', { p_clave: dueno, p_id: C.hu.Gabi, p_estadia: C.id })).error === 'no_existe', 'un huésped quitado no se puede mover');
await llamar('admin_huesped_quitar', { p_clave: dueno, p_id: C.hu.Gabi, p_quitar: false });

console.log('\n== 4. Eliminar una reserva CON huéspedes (se van con ella y vuelven al restaurarla)');
const E = await conGente('401', 3, ['Hugo', 'Ines', 'Juan']);
await llamar('admin_huesped_quitar', { p_clave: dueno, p_id: E.hu.Juan }); // a Juan ya lo había quitado antes, por separado
st = await stats();
const sumaAntes = st.reservas.length;
ok(st.reservas.find((x) => x.id === E.id).huespedes === 2, '(la 401 tenía 3; Juan ya estaba quitado: cuenta 2)');
r = await llamar('recepcion_reserva_anular', { p_clave: rec, p_id: E.id });
ok(r.ok === false && r.error === 'tiene_huespedes', 'recepción NO puede anular una reserva con huéspedes');
await llamar('recepcion_reserva_abrir', { p_clave: dueno, p_id: E.id }); // el dueño tiene un código a la vista de esa reserva
const eliminados = await n('select count(*)::int n from private.checkins');
r = await llamar('admin_reserva_anular', { p_clave: dueno, p_id: E.id });
ok(r.ok === true, 'el dueño elimina la reserva 401');
const nv = await nombresVisibles();
ok(!nv.includes('Hugo') && !nv.includes('Ines') && !nv.includes('Juan'), 'sus huéspedes desaparecen de la lista');
st = await stats();
ok(!st.reservas.some((x) => x.id === E.id) && st.reservas.length === sumaAntes - 1 && !st.huespedes.some((h) => [E.hu.Hugo, E.hu.Ines].includes(h.id)), 'la reserva y sus huéspedes no cuentan en las estadísticas');
ok(st.pendientes.find((x) => x.id === E.id)?.anulada_en, 'el dueño la ve entre las anuladas (para restaurarla)');
ok((await abiertas()).every((x) => x.id !== E.id), 'recepción no la ve');
ok((await llamar('recepcion_estado', { p_clave: dueno })).codigo === null, 'el código que mostraba se apagó');
ok(await n('select count(*)::int n from private.checkins') === eliminados && await n('select count(*)::int n from private.estadias where id = $1', [E.id]) === 1, 'no se borró nada: ni la reserva ni los huéspedes');
q = await llamar('admin_huespedes_quitados', { p_clave: dueno });
ok(['Hugo', 'Ines', 'Juan'].every((x) => q.huespedes.some((h) => h.nombre === x && h.reserva_anulada === true)), 'los tres figuran como quitados, marcando que su reserva está anulada');
r = await llamar('admin_huesped_quitar', { p_clave: dueno, p_id: E.hu.Hugo, p_quitar: false });
ok(r.ok === false && r.error === 'reserva_anulada', 'a uno solo no se lo puede restaurar mientras su reserva esté anulada (se restaura la reserva)');
ok((await llamar('admin_huesped_estadia', { p_clave: dueno, p_id: A.hu.Ana, p_estadia: E.id })).error === 'reserva_anulada', 'tampoco se puede mover a nadie a una reserva anulada');
ok((await llamar('recepcion_reserva_abrir', { p_clave: rec, p_id: E.id })).error === 'reserva_anulada', 'ni darle código');
r = await llamar('admin_reserva_anular', { p_clave: dueno, p_id: E.id, p_anular: false });
ok(r.ok === true, 'el dueño restaura la reserva');
const nv2 = await nombresVisibles();
ok(nv2.includes('Hugo') && nv2.includes('Ines') && !nv2.includes('Juan'), 'vuelven Hugo e Ines; Juan, que se había quitado antes por separado, sigue quitado');
st = await stats();
ok(st.reservas.find((x) => x.id === E.id)?.huespedes === 2 && st.reservas.length === sumaAntes, 'la reserva vuelve a contar como antes');
ok(await n(`select count(*)::int n from private.checkin_auditoria where accion in ('reserva_anular', 'reserva_restaurar') and detalle::text like '%huespedes%'`) >= 1, 'y todo queda en el historial');

console.log('\n== 5. Eliminar una reserva sin huéspedes y lo quitado no cuenta en «visitas»');
const F = await nueva({ p_habitacion: '501', p_huespedes: 1 });
ok((await llamar('admin_reserva_anular', { p_clave: dueno, p_id: F })).ok === true, 'el dueño elimina una reserva sin huéspedes (como antes)');
// misma persona (mismo documento) en dos estadías: es una visita recurrente; si se quita una, deja de serlo
const G = await conGente('502', 1, ['Zeta'], {}); const docZ = (await back.sql(`select datos->>'doc_numero' d from private.checkins where id = $1`, [G.hu.Zeta]))[0].d;
const H = await conGente('503', 1, ['Zetb']);
await back.sql(`update private.checkins set datos = jsonb_set(datos, '{doc_numero}', to_jsonb($1::text)) where id = $2`, [docZ, H.hu.Zetb]);
st = await stats();
ok(st.huespedes.find((h) => h.id === G.hu.Zeta).visitas === 2, 'la misma persona en dos reservas cuenta como visita recurrente (2)');
await llamar('admin_huesped_quitar', { p_clave: dueno, p_id: H.hu.Zetb });
st = await stats();
ok(st.huespedes.find((h) => h.id === G.hu.Zeta).visitas === 1, 'al quitar la segunda deja de contar como recurrente');

console.log('\n== 6. Si todos los huéspedes se quitan, la reserva queda «en espera» y no suma');
const I = await conGente('601', 2, ['Kiko', 'Lola']);
await llamar('admin_huesped_quitar', { p_clave: dueno, p_id: I.hu.Kiko });
await llamar('admin_huesped_quitar', { p_clave: dueno, p_id: I.hu.Lola });
st = await stats();
ok(!st.reservas.some((x) => x.id === I.id) && st.pendientes.some((x) => x.id === I.id && !x.anulada_en), 'la 601 pasa a «sin huéspedes todavía»: no suma y el dueño la ve');
ok((await abiertas()).some((x) => x.id === I.id && x.huespedes.length === 0), 'y recepción la ve abierta, para cargar a los correctos');

console.log('\n== 7. Pasar de la versión publicada hoy: nada cambia y nadie queda quitado');
const viejo = await iniciarBackend({ puerto: 54393, estadias: false });
await viejo.sql(`update private.checkin_config set activo = true, usos_max = 20 where id = 1`);
await viejo.sql(SQL_RECEPCION, [CLAVE_RECEPCION]);
await viejo.exec(fs.readFileSync(new URL('./fixtures/estadias-v2.sql', import.meta.url), 'utf8'));
const llamarV = (nom, a) => viejo.llamar(nom, a, '203.0.113.8');
const recV = (await llamarV('sesion_entrar', { p_clave: CLAVE_RECEPCION })).token;
const duenoV = (await llamarV('sesion_entrar', { p_clave: CLAVE_ADMIN })).token;
const v1 = await llamarV('recepcion_reserva_nueva', { p_clave: recV, p_habitacion: '201', p_monto: 100000, p_moneda: 'ARS', p_medio_pago: 2, p_fecha: hoy, p_noches: 2, p_canal: CANAL, p_categoria: CAT });
for (const nm of ['P1', 'P2']) await viejo.sql(`insert into private.checkins (grupo, datos, consentimiento, habitacion, estadia_id) values (1, $1::jsonb, '{"aceptado":true}'::jsonb, '201', $2)`, [JSON.stringify(DATOS(nm, docN++)), v1.id]);
const sql = fs.readFileSync(new URL('../supabase/estadias.sql', import.meta.url), 'utf8');
await viejo.exec(sql);
await viejo.exec(sql);
ok((await viejo.sql(`select count(*)::int n from private.checkins where quitado_en is not null`))[0].n === 0 && (await viejo.sql(`select count(*)::int n from private.checkins`))[0].n === 2, 'después de migrar nadie figura como quitado y no se perdió ningún huésped');
const lv = await llamarV('admin_huespedes', { p_clave: duenoV });
ok(lv.huespedes.length === 2 && lv.reservas.length === 1, 'la lista del dueño trae a los dos huéspedes y la reserva');
ok((await llamarV('admin_huesped_quitar', { p_clave: duenoV, p_id: lv.huespedes[0].id })).ok === true && (await llamarV('admin_huespedes', { p_clave: duenoV })).huespedes.length === 1, 'y sobre una base migrada se puede quitar y desaparece de la lista');
await viejo.cerrar();

await back.cerrar();
console.log(fallas ? `\n${fallas} fallas` : '\nTodo bien');
process.exit(fallas ? 1 : 0);
