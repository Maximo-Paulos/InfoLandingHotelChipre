// El número de reserva: cada reserva tiene un número propio («N.º 41») que se ve en todas las pantallas, para distinguir una de otra aunque se parezcan.
//   node scripts/test-numero.mjs
// Usa la base de prueba en memoria con schema.sql + checkin.sql + estadias.sql y llama a las funciones como lo hace la guía (rol "anon").
// La parte 4 arma una base como la publicada hoy (scripts/fixtures/estadias-v7.sql), con reservas ya cargadas, y le aplica el archivo nuevo dos veces.
import fs from 'node:fs';
import { CLAVE_ADMIN, CLAVE_RECEPCION, SQL_RECEPCION, iniciarBackend } from './backend-local.mjs';

let fallas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK    ' : 'FALLA '}${m}`); if (!c) fallas += 1; };

const back = await iniciarBackend({ puerto: 54404, estadias: true });
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

const DATOS = (nom, doc) => ({ nombre: nom, apellido: 'Prueba', email: `${nom.toLowerCase()}@correo.com`, telefono: '+541155551234', nacionalidad: 'Argentina', localidad: 'Capital Federal', domicilio: 'Av. Corrientes 1234 5° B', doc_tipo: 'DNI', doc_numero: String(doc), anio_nac: 1990 });
let ipN = 10;
let docN = 36000000;
const entra = async (nom) => {
  const codigo = (await llamar('recepcion_estado', { p_clave: rec })).codigo.valor;
  const s = await llamar('checkin_canjear', { p_codigo: String(codigo) }, `198.51.100.${ipN++}`);
  return s.ok ? llamar('checkin_enviar', { p_token: s.token, p_datos: DATOS(nom, docN++), p_idioma: 'es', p_acepta: true }) : s;
};
const rapida = (hab, hues = 2, monto = 63800) => llamar('recepcion_reserva_nueva', { p_clave: rec, p_habitacion: hab, p_monto: monto, p_moneda: 'ARS', p_medio_pago: EFECTIVO, p_fecha: hoy, p_pago_hotel: monto, p_fecha_sena: null, p_noches: 1, p_canal: DIRECTO, p_categoria: DOBLE, p_huespedes: hues });
const anotar = (extra = {}) => llamar('admin_anotada_guardar', {
  p_clave: dueno, p_id: null, p_titular: 'Maldonado Gianfranco', p_ingreso: hoy, p_habitacion: '202', p_noches: 1, p_categoria: DOBLE, p_canal: DIRECTO, p_huespedes: 2,
  p_efectivo: 63800, p_transferencia: null, p_usd: null, p_sena: 0, p_fecha_sena: null, p_nota: null, ...extra
});
const iniciar = (id, hab, hues = 2) => llamar('recepcion_llegada_iniciar', { p_clave: rec, p_id: id, p_habitacion: hab, p_monto: 63800, p_moneda: 'ARS', p_medio_pago: EFECTIVO, p_fecha: hoy, p_pago_hotel: 63800, p_fecha_sena: null, p_noches: 1, p_canal: DIRECTO, p_categoria: DOBLE, p_huespedes: hues });
const datos = async (quien = rec) => llamar('recepcion_proximas', { p_clave: quien });
const numeroAnotada = async (id) => (await back.sql(`select numero::int as n from private.reservas_anotadas where id = $1`, [id]))[0].n;
const numeroEstadia = async (id) => (await back.sql(`select numero::int as n from private.estadias where id = $1`, [id]))[0].n;

console.log('\n== 1. Cada reserva recibe su número, de a uno, sin saltos');
const a1 = await anotar({ p_titular: 'Ana', p_habitacion: '101' });
const q1 = await rapida('102', 1);
const a2 = await anotar({ p_titular: 'Beto', p_habitacion: '103' });
const n1 = await numeroAnotada(a1.id);
const nq = await numeroEstadia(q1.id);
const n2 = await numeroAnotada(a2.id);
ok(Number.isInteger(n1) && nq === n1 + 1 && n2 === nq + 1, `una anotada (${n1}), una reserva rápida (${nq}) y otra anotada (${n2}) usan el mismo contador, una tras otra`);
const ini = await iniciar(a1.id, '101', 1);
ok(ini.ok && (await numeroEstadia(ini.id)) === n1, 'al hacer el check-in de la anotada, la reserva que sale de ella conserva su número');
const q2 = await rapida('104', 1);
ok((await numeroEstadia(q2.id)) === n2 + 1, 'y la próxima reserva toma el número que sigue: hacer el check-in de una anotada no gasta números');

console.log('\n== 2. El número llega a las pantallas');
const d = await datos();
ok(d.reservas.find((x) => x.id === a2.id)?.numero === n2, 'recepcion_proximas: la reserva anotada trae su número');
ok(d.estadias.find((x) => x.id === q1.id)?.numero === nq && d.estadias.find((x) => x.id === ini.id)?.numero === n1, 'recepcion_proximas: las reservas armadas (rápida y la que salió de una anotada) traen su número');
const est = await llamar('recepcion_estado', { p_clave: rec });
ok(est.reserva?.estadia?.numero != null, 'la tarjeta del código trae el número de la reserva');
ok((await llamar('admin_anotadas', { p_clave: dueno })).reservas?.every((x) => x.numero != null) ?? (await llamar('admin_anotadas', { p_clave: dueno })).anotadas?.every((x) => x.numero != null), 'las reservas anotadas del dueño traen su número');
await entra('Luz');
const est2 = await llamar('recepcion_estado', { p_clave: rec });
ok(est2.huespedes?.some((g) => g.estadia?.numero != null), 'la lista de huéspedes trae el número de la reserva de cada uno');
const stats = await llamar('admin_estadisticas', { p_clave: dueno });
ok(stats.reservas.every((x) => x.numero != null) && stats.pendientes.every((x) => x.numero != null), 'la caja del dueño (reservas y pendientes) trae el número');

console.log('\n== 3. Unir: la reserva toma el número de la anotada');
const aU = await anotar({ p_titular: 'Maldonado Gianfranco', p_habitacion: '202', p_ingreso: AR(-1) });
const eU = await rapida('202', 2);
const nA = await numeroAnotada(aU.id);
const nE = await numeroEstadia(eU.id);
ok(nA !== nE, `antes de unir son dos números distintos: anotada N.º ${nA} y reserva rápida N.º ${nE} (así se nota que son dos)`);
const u = await llamar('recepcion_anotada_unir', { p_clave: dueno, p_anotada: aU.id, p_estadia: eU.id });
ok(u.ok === true && (await numeroEstadia(eU.id)) === nA, 'después de unir queda una sola reserva, con el número de la anotada');

console.log('\n== 4. Eliminar y restaurar (solo el dueño ve «eliminadas»)');
const aE = await anotar({ p_titular: 'Cancelada Carla', p_habitacion: '301', p_ingreso: AR(2) });
const eE = await rapida('302', 2);
await entra('Uno');
await entra('Dos');
const nAE = await numeroAnotada(aE.id);
const nEE = await numeroEstadia(eE.id);
ok((await llamar('admin_anotada_cancelar', { p_clave: dueno, p_id: aE.id, p_cancelar: true })).ok === true, 'el dueño cancela una anotada');
ok((await llamar('admin_reserva_anular', { p_clave: dueno, p_id: eE.id, p_anular: true })).ok === true, 'y elimina una reserva con 2 huéspedes');
let dd = await datos(dueno);
const elA = dd.eliminadas.find((x) => x.tipo === 'anotada' && x.id === aE.id);
const elE = dd.eliminadas.find((x) => x.tipo === 'estadia' && x.id === eE.id);
ok(elA?.numero === nAE && elA.titular === 'Cancelada Carla' && elA.habitacion === '301', 'el dueño ve la anotada cancelada en «eliminadas», con su número, nombre y habitación');
ok(elE?.numero === nEE && elE.huespedes === 2 && elE.habitacion === '302' && elE.por, 'y la reserva eliminada con su número, cuántos huéspedes se fueron con ella (2) y quién la eliminó');
ok(!dd.estadias.some((x) => x.id === eE.id), 'la reserva eliminada ya no figura en las reservas');
ok(Array.isArray((await datos(rec)).eliminadas) && (await datos(rec)).eliminadas.length === 0, 'recepción no ve lo eliminado (le llega una lista vacía)');
ok((await llamar('admin_reserva_anular', { p_clave: dueno, p_id: eE.id, p_anular: false })).ok === true && (await llamar('admin_anotada_cancelar', { p_clave: dueno, p_id: aE.id, p_cancelar: false })).ok === true, 'el dueño restaura las dos');
dd = await datos(dueno);
ok(dd.eliminadas.every((x) => x.id !== eE.id && x.id !== aE.id) && dd.estadias.find((x) => x.id === eE.id)?.con_checkin === 2, 'dejan de estar en «eliminadas» y la reserva vuelve con sus 2 huéspedes');
ok((await numeroEstadia(eE.id)) === nEE && (await numeroAnotada(aE.id)) === nAE, 'conservan el mismo número');
await back.sql(`update private.estadias set anulada_en = now() - interval '70 days', anulada_por = 'x' where id = $1`, [q2.id]);
ok((await datos(dueno)).eliminadas.every((x) => x.id !== q2.id), 'lo eliminado hace más de 60 días no se lista');

console.log('\n== 5. El número no se repite');
let error = null;
try { await back.sql(`update private.reservas_anotadas set numero = $1 where id = $2`, [n1, a2.id]); } catch (e) { error = e; }
ok(error != null, 'no puede haber dos reservas anotadas con el mismo número');
error = null;
try { await back.sql(`update private.estadias set numero = null where id = $1`, [q1.id]); } catch (e) { error = e; }
ok(error != null, 'ni una reserva sin número');
const fns = await back.sql(`select count(*)::int as n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'private' and p.proname = 'estadia_crear'`);
ok(fns[0].n === 1, 'queda una sola función estadia_crear (no hay una versión vieja que cree reservas sin número)');

console.log('\n== 6. Pasar de la versión publicada hoy a esta, con reservas ya cargadas');
const viejo = await iniciarBackend({ puerto: 54405, estadias: false });
await viejo.sql(`update private.checkin_config set activo = true, usos_max = 20, dias_recepcion = 5 where id = 1`);
await viejo.sql(SQL_RECEPCION, [CLAVE_RECEPCION]);
await viejo.exec(fs.readFileSync(new URL('./fixtures/estadias-v7.sql', import.meta.url), 'utf8')); // el estadias.sql que hoy está en producción
const llamarV = (nom, x) => viejo.llamar(nom, x, '203.0.113.8');
const recV = (await llamarV('sesion_entrar', { p_clave: CLAVE_RECEPCION })).token;
const duenoV = (await llamarV('sesion_entrar', { p_clave: CLAVE_ADMIN })).token;
const anotarV = (titular, hab, ingreso = hoy) => llamarV('admin_anotada_guardar', { p_clave: duenoV, p_id: null, p_titular: titular, p_ingreso: ingreso, p_habitacion: hab, p_noches: 1, p_categoria: DOBLE, p_canal: DIRECTO, p_huespedes: 1, p_efectivo: 50000, p_transferencia: null, p_usd: null, p_sena: 0, p_fecha_sena: null, p_nota: null });
const rapidaV = (hab) => llamarV('recepcion_reserva_nueva', { p_clave: recV, p_habitacion: hab, p_monto: 50000, p_moneda: 'ARS', p_medio_pago: EFECTIVO, p_fecha: hoy, p_pago_hotel: 50000, p_fecha_sena: null, p_noches: 1, p_canal: DIRECTO, p_categoria: DOBLE, p_huespedes: 1 });
const vA1 = await anotarV('Primera', '401'); // se va a empezar: tendrá reserva
const vQ = await rapidaV('402');
const vA2 = await anotarV('Segunda', '403'); // sigue esperando
const vA3 = await anotarV('Tercera', '404'); // se cancela
await llamarV('admin_anotada_cancelar', { p_clave: duenoV, p_id: vA3.id, p_cancelar: true });
const vI = await llamarV('recepcion_llegada_iniciar', { p_clave: recV, p_id: vA1.id, p_habitacion: '401', p_monto: 50000, p_moneda: 'ARS', p_medio_pago: EFECTIVO, p_fecha: hoy, p_pago_hotel: 50000, p_fecha_sena: null, p_noches: 1, p_canal: DIRECTO, p_categoria: DOBLE, p_huespedes: 1 });
const vQ2 = await rapidaV('405');
await llamarV('admin_reserva_anular', { p_clave: duenoV, p_id: vQ2.id, p_anular: true });
ok([vA1, vQ, vA2, vA3, vI, vQ2].every((x) => x.ok), 'en la base «de hoy» (sin números) hay anotadas, reservas rápidas, una cancelada, una anulada y una anotada con reserva armada');
const todo = async () => ({
  a: await viejo.sql(`select id, numero::int as n from private.reservas_anotadas order by id`),
  e: await viejo.sql(`select id, numero::int as n from private.estadias order by id`)
});
const sql = fs.readFileSync(new URL('../supabase/estadias.sql', import.meta.url), 'utf8');
await viejo.exec(sql);
const m1 = await todo();
const nAn = (id) => m1.a.find((x) => x.id === id).n;
const nEs = (id) => m1.e.find((x) => x.id === id).n;
ok(m1.a.every((x) => x.n > 0) && m1.e.every((x) => x.n > 0), 'todas las reservas que ya existían quedaron con número');
ok(nEs(vI.id) === nAn(vA1.id), 'la anotada y la reserva armada a partir de ella comparten número');
const propios = [...m1.a.map((x) => x.n), ...m1.e.filter((x) => x.id !== vI.id).map((x) => x.n)];
ok(new Set(propios).size === propios.length, 'el resto tiene todos números distintos');
ok(nAn(vA1.id) < nEs(vQ.id) && nEs(vQ.id) < nAn(vA2.id) && nAn(vA2.id) < nAn(vA3.id) && nAn(vA3.id) < nEs(vQ2.id), 'se numeraron en el orden en que se cargaron (de la más vieja a la más nueva)');
const maximo = Math.max(...propios);
await viejo.exec(sql);
const m2 = await todo();
ok(JSON.stringify(m2) === JSON.stringify(m1), 'aplicar el archivo una segunda vez no cambia ningún número');
const nueva = await rapidaV('406');
const nuevaN = (await viejo.sql(`select numero::int as n from private.estadias where id = $1`, [nueva.id]))[0].n;
ok(nueva.ok && nuevaN === maximo + 1, 'la próxima reserva sigue la cuenta (último número + 1), sin repetir ni saltear');
const dV = await llamarV('recepcion_proximas', { p_clave: recV });
ok(dV.reservas.find((x) => x.id === vA2.id)?.numero === nAn(vA2.id) && dV.estadias.find((x) => x.id === vQ.id)?.numero === nEs(vQ.id), 'y las pantallas ya traen los números de las reservas de antes');
await viejo.cerrar();

await back.cerrar();
console.log(fallas ? `\n${fallas} fallas` : '\nTodo bien');
process.exit(fallas ? 1 : 0);
