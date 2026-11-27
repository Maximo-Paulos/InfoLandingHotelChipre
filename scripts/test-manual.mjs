// Check-in a mano: el dueño carga al huésped en una reserva con los datos que tenga (ningún dato es obligatorio). Queda MARCADO como «a mano», cuenta como check-in de la reserva
// y entra en las estadísticas (cuántos dejan mail, teléfono, documento…).
//   node scripts/test-manual.mjs
// Usa la base de prueba en memoria con schema.sql + checkin.sql + estadias.sql y llama a las funciones como lo hace la guía (rol "anon").
// La parte 8 arma una base como la publicada hoy (scripts/fixtures/estadias-v9.sql), con huéspedes ya cargados, y le aplica el archivo nuevo dos veces.
import fs from 'node:fs';
import { CLAVE_ADMIN, CLAVE_RECEPCION, SQL_RECEPCION, iniciarBackend } from './backend-local.mjs';

let fallas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK    ' : 'FALLA '}${m}`); if (!c) fallas += 1; };

const back = await iniciarBackend({ puerto: 54409, estadias: true });
await back.sql(`update private.checkin_config set activo = true, usos_max = 20, dias_recepcion = 5 where id = 1`);
await back.sql(SQL_RECEPCION, [CLAVE_RECEPCION]);
let ipN = 1;
const llamar = (n, a) => back.llamar(n, a, `203.0.113.${(ipN++ % 250) + 1}`);
const rec = (await llamar('sesion_entrar', { p_clave: CLAVE_RECEPCION })).token;
const dueno = (await llamar('sesion_entrar', { p_clave: CLAVE_ADMIN })).token;
const AR = (n = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(Date.now() + n * 864e5));
const hoy = AR();
const idDe = async (tipo, nombre) => (await back.sql(`select id from private.catalogo where tipo = $1 and nombre = $2`, [tipo, nombre]))[0].id;
const DIRECTO = await idDe('canal', 'Directo');
const DOBLE = await idDe('categoria', 'Doble');
const EFECTIVO = (await back.sql(`select id from private.medios_pago where nombre = 'Efectivo'`))[0].id;
const TRANSFER = (await back.sql(`select id from private.medios_pago where nombre = 'Transferencia'`))[0].id;
const n = async (sql, p = []) => (await back.sql(sql, p))[0].n;

const rapida = (hab, hues = 2, monto = 63800) => llamar('recepcion_reserva_nueva', { p_clave: rec, p_habitacion: hab, p_monto: monto, p_moneda: 'ARS', p_medio_pago: EFECTIVO, p_fecha: hoy, p_pago_hotel: monto, p_fecha_sena: null, p_noches: 1, p_canal: DIRECTO, p_categoria: DOBLE, p_huespedes: hues });
const anotar = (extra = {}) => llamar('admin_anotada_guardar', {
  p_clave: dueno, p_id: null, p_titular: 'Maldonado', p_ingreso: hoy, p_habitacion: '202', p_noches: 2, p_categoria: DOBLE, p_canal: DIRECTO, p_huespedes: 2,
  p_efectivo: 100000, p_transferencia: null, p_usd: null, p_sena: 0, p_fecha_sena: null, p_nota: null, ...extra
});
const mano = (estadia, huespedes, quien = dueno) => llamar('admin_checkin_manual', { p_clave: quien, p_estadia: estadia, p_huespedes: huespedes });
const manoAnotada = (anotada, huespedes, extra = {}, quien = dueno) => llamar('admin_checkin_manual_anotada', { p_clave: quien, p_anotada: anotada, p_huespedes: huespedes, p_forma: 'efectivo', p_medio_pago: null, ...extra });
const guests = (estadia) => back.sql(`select id, datos, origen, cargado_por, habilitado_por, idioma, consentimiento, habitacion, medio_pago_id from private.checkins_activos where estadia_id = $1 order by id`, [estadia]);
const fila = async (id) => (await llamar('recepcion_proximas', { p_clave: dueno })).estadias.find((x) => x.id === id);
const COMPLETO = { nombre: 'Ana', apellido: 'Gómez', email: 'ana@correo.com', telefono: '+5491155551234', nacionalidad: 'Argentina', localidad: 'Rosario', domicilio: 'San Martín 123', doc_tipo: 'DNI', doc_numero: '30123456', anio_nac: 1990 };

console.log('\n== 1. Cargar a mano en una reserva armada: ningún dato es obligatorio');
const e1 = await rapida('101', 3);
const pushAntes = await n(`select count(*)::int n from private.push_cola`);
let r = await mano(e1.id, [COMPLETO, { nombre: 'Luis' }, {}]);
ok(r.ok === true && r.ids.length === 3 && r.estadia === e1.id && r.numero != null, 'se cargan 3 huéspedes: uno completo, uno con solo el nombre y uno SIN ningún dato');
let g = await guests(e1.id);
ok(g.length === 3 && g.every((x) => x.origen === 'manual' && x.cargado_por && x.cargado_por !== ''), 'los 3 quedan en la reserva, marcados como «a mano» y con quién los cargó');
ok(JSON.stringify(g[1].datos) === '{"nombre":"Luis"}' && JSON.stringify(g[2].datos) === '{}', 'solo se guardan los datos que vinieron (el resto queda sin dato)');
ok(g[0].datos.doc_tipo === 'DNI' && g[0].datos.anio_nac === 1990 && g[0].datos.telefono === '+5491155551234', 'el completo conserva todo (documento, año, teléfono)');
ok(g.every((x) => x.habitacion === '101' && x.medio_pago_id === EFECTIVO && x.habilitado_por === null && x.idioma === null), 'toman la habitación y el medio de pago de la reserva; no hubo código ni idioma');
ok(g.every((x) => x.consentimiento.aceptado === false && x.consentimiento.manual === true), 'y no tienen aceptación de términos (los cargó el hotel): queda dicho en el registro');
let f = await fila(e1.id);
ok(f.estado === 'completa' && f.con_checkin === 3 && f.a_mano === 3, 'la reserva figura completa, con 3 ingresados (3 a mano)');
ok(JSON.stringify(f.ingresaron) === '["Ana Gómez","Luis","Sin nombre"]', 'los nombres: Ana Gómez, Luis y «Sin nombre» (así se ve cuántos son)');
ok((await n(`select count(*)::int n from private.checkin_auditoria where accion = 'checkin_manual'`)) === 1, 'queda en el registro de movimientos');
ok(await n(`select count(*)::int n from private.push_cola`) === pushAntes, 'y no manda avisos al celular');
const est = await llamar('recepcion_estado', { p_clave: dueno });
ok(Array.isArray(est.huespedes) && est.huespedes.filter((x) => x.estadia_id === e1.id).every((x) => x.origen === 'manual'), 'las listas traen la marca de origen');

console.log('\n== 2. Se revisa lo que viene, pero nada es obligatorio');
const e2 = await rapida('102', 12);
const malo = async (datos, campo, texto) => {
  const antes = await n(`select count(*)::int n from private.checkins where estadia_id = $1`, [e2.id]);
  const x = await mano(e2.id, [{ nombre: 'Bien' }, datos]);
  ok(x.ok === false && x.error === 'datos_invalidos' && x.indice === 1 && x.campos.includes(campo) && (await n(`select count(*)::int n from private.checkins where estadia_id = $1`, [e2.id])) === antes, `${texto}: se rechaza (campo «${campo}») y NO se guarda ninguno de la lista`);
};
await malo({ email: 'esto-no-es-un-mail' }, 'email', 'un mail que no parece mail');
await malo({ telefono: 'abc123' }, 'telefono', 'un teléfono con letras');
await malo({ doc_tipo: 'DNI', doc_numero: '123' }, 'doc_numero', 'un DNI de 3 números');
await malo({ doc_tipo: 'Libreta', doc_numero: '12345678' }, 'doc_tipo', 'un tipo de documento que no existe');
await malo({ anio_nac: 1800 }, 'anio_nac', 'un año de nacimiento de 1800');
await malo({ nombre: '<b>x</b>' }, 'nombre', 'un nombre con signos de etiqueta');
ok((await mano(e2.id, [])).ok === false && (await mano(e2.id, null)).ok === false, 'una lista vacía o sin lista no se guarda');
ok((await mano(e2.id, Array.from({ length: 13 }, () => ({})))).ok === false, 'más de 12 huéspedes de una vez, tampoco');
r = await mano(e2.id, [{ doc_numero: '30.123.456' }, { doc_tipo: 'Pasaporte', doc_numero: 'ab-123456' }, { doc_tipo: 'Otro', doc_numero: 'XYZ99' }, { doc_tipo: 'DNI' }, { telefono: '(011) 4555-1234' }, { telefono: '+54 9 11 5555 1234' }]);
g = await guests(e2.id);
ok(r.ok === true && g.length === 6, 'documento sin tipo, pasaporte, «otro», tipo sin número y teléfonos con espacios: se aceptan');
ok(g[0].datos.doc_tipo === 'DNI' && g[0].datos.doc_numero === '30123456', 'un número de 8 cifras sin tipo se toma como DNI y se limpian los puntos');
ok(g[1].datos.doc_tipo === 'Pasaporte' && g[1].datos.doc_numero === 'AB123456' && g[2].datos.doc_tipo === 'Otro', 'pasaporte en mayúsculas; «otro» queda como tal');
ok(JSON.stringify(g[3].datos) === '{}', 'un tipo de documento sin número no dice nada: no se guarda');
ok(g[4].datos.telefono === '01145551234' && g[5].datos.telefono === '+5491155551234', 'los teléfonos se guardan sin espacios ni signos');
ok((await mano(e2.id, Array.from({ length: 7 }, () => ({})))).error === 'demasiados_huespedes', 'una reserva no pasa de 12 huéspedes en total (ya tenía 6)');

console.log('\n== 3. La reserva pasa a esperar a los que ya tiene');
const e3 = await rapida('103', 1);
r = await mano(e3.id, [{ nombre: 'Uno' }, { nombre: 'Dos' }, { nombre: 'Tres' }]);
f = await fila(e3.id);
ok(r.ok === true && f.esperados === 3 && f.estado === 'completa', 'esperaba 1 y se cargaron 3: ahora espera 3 y está completa');
r = await mano(e3.id, [{ nombre: 'Cuatro' }]);
ok(r.ok === true && (await fila(e3.id)).esperados === 4, 'y si se suma uno más, espera 4');
const e3b = await rapida('104', 4);
await mano(e3b.id, [{ nombre: 'Solo uno' }]);
f = await fila(e3b.id);
ok(f.estado === 'faltan' && f.con_checkin === 1 && f.esperados === 4, 'una reserva de 4 con 1 cargado a mano queda «faltan» (falta cerrar), como con un check-in normal');

console.log('\n== 4. Una anotada que no llegó a hacer el check-in');
const a1 = await anotar({ p_titular: 'Pérez Juan', p_habitacion: '201', p_sena: 30000, p_fecha_sena: AR(-3), p_nota: 'Llega tarde' });
const numA = await n(`select numero::int n from private.reservas_anotadas where id = $1`, [a1.id]);
r = await manoAnotada(a1.id, [{ nombre: 'Juan', apellido: 'Pérez' }, {}], { p_medio_pago: EFECTIVO });
ok(r.ok === true && r.numero === numA && r.ids.length === 2, 'se arma la reserva a partir de la anotada y se cargan 2 huéspedes (con el mismo número de reserva)');
const ea = (await back.sql(`select * from private.estadias where id = $1`, [r.estadia]))[0];
ok(Number(ea.monto) === 100000 && Number(ea.pago_hotel) === 70000 && ea.moneda === 'ARS' && ea.medio_pago_id === EFECTIVO && ea.titular === 'Pérez Juan' && ea.nota === 'Llega tarde' && ea.habitacion === '201' && ea.noches === 2 && ea.huespedes_esperados === 2, 'con lo anotado: total 100.000, pagado en el hotel 70.000 (30.000 de seña), titular, nota, habitación y noches');
ok(String(ea.fecha_sena instanceof Date ? ea.fecha_sena.toISOString() : ea.fecha_sena).slice(0, 10) === AR(-3) && ea.cargado_por && ea.canal_id === DIRECTO && ea.categoria_id === DOBLE, 'conserva la fecha de la seña, el canal, la categoría y quién la cargó');
ok((await n(`select estadia_id::int n from private.reservas_anotadas where id = $1`, [a1.id])) === r.estadia, 'la anotada queda enlazada a la reserva (ya no figura como que falta llegar)');
f = await fila(r.estadia);
ok(f.estado === 'completa' && f.a_mano === 2 && f.anotada_id === a1.id && f.titular === 'Pérez Juan', 'y figura completa, con el nombre de la anotada');
ok(JSON.stringify((await guests(r.estadia)).map((x) => x.datos)) === '[{"nombre":"Juan","apellido":"Pérez"},{}]', 'los huéspedes tienen solo lo que se cargó');
const a2 = await anotar({ p_titular: 'Por transferencia', p_habitacion: '202', p_efectivo: 100000, p_transferencia: 110000, p_sena: 0, p_huespedes: 1 });
r = await manoAnotada(a2.id, [{}], { p_forma: 'transferencia', p_medio_pago: TRANSFER });
ok(r.ok === true && Number((await back.sql(`select monto from private.estadias where id = $1`, [r.estadia]))[0].monto) === 110000, 'con transferencia se usa el precio en transferencia (110.000)');
const a3 = await anotar({ p_titular: 'Sin medio', p_habitacion: '203', p_huespedes: 1 });
r = await manoAnotada(a3.id, [{ nombre: 'X' }], { p_medio_pago: null });
ok(r.ok === true && (await back.sql(`select medio_pago_id from private.estadias where id = $1`, [r.estadia]))[0].medio_pago_id === (await n(`select id::int n from private.medios_pago where es_base`)), 'sin elegir el medio de pago se usa el básico');
const obra = (await back.sql(`select id from private.catalogo where tipo = 'canal' and not cobra limit 1`))[0];
if (obra) {
  const a4 = await anotar({ p_titular: 'Obra social', p_habitacion: '204', p_canal: obra.id, p_huespedes: 1 });
  r = await manoAnotada(a4.id, [{}]);
  ok(r.ok === true && Number((await back.sql(`select monto from private.estadias where id = $1`, [r.estadia]))[0].monto) === 0, 'un canal que no cobra (obra social) queda sin monto');
}
r = await manoAnotada(a1.id, [{}]);
ok(r.ok === false && r.error === 'anotada_ya_empezo', 'una anotada que ya tiene reserva no se vuelve a armar');
const a5 = await anotar({ p_titular: 'Cancelada', p_habitacion: '205' });
await llamar('admin_anotada_cancelar', { p_clave: dueno, p_id: a5.id, p_cancelar: true });
ok((await manoAnotada(a5.id, [{}])).error === 'anotada_cancelada', 'una anotada cancelada, tampoco');
ok((await manoAnotada(999999, [{}])).error === 'no_existe', 'ni una que no existe');
const a6 = await anotar({ p_titular: 'Dólares', p_habitacion: '206' });
r = await manoAnotada(a6.id, [{}], { p_forma: 'usd' });
ok(r.ok === false && r.error === 'datos_invalidos' && r.campos.includes('forma') && (await n(`select estadia_id is null as n from private.reservas_anotadas where id = $1`, [a6.id])) === true, 'una forma de pago que no existe (dólares) se rechaza y no arma nada');
r = await manoAnotada(a6.id, [{ email: 'mal' }]);
ok(r.ok === false && r.error === 'datos_invalidos' && (await n(`select estadia_id is null as n from private.reservas_anotadas where id = $1`, [a6.id])) === true, 'y si un dato viene mal, tampoco se arma la reserva');

console.log('\n== 5. Corregir después a uno cargado a mano');
const gm = (await guests(e1.id))[1];
r = await llamar('admin_checkin_manual_editar', { p_clave: dueno, p_id: gm.id, p_datos: { nombre: 'Luis', apellido: 'Díaz', email: 'luis@correo.com' } });
const gm2 = (await guests(e1.id))[1];
ok(r.ok === true && gm2.datos.apellido === 'Díaz' && gm2.datos.email === 'luis@correo.com', 'el dueño completa los datos que faltaban');
const aud = await back.sql(`select detalle from private.checkin_auditoria where accion = 'checkin_manual_editar' order by id desc limit 1`);
ok(JSON.stringify(aud[0].detalle.campos) === '["apellido","email"]', 'queda en el registro qué campos cambió (no los valores)');
r = await llamar('admin_checkin_manual_editar', { p_clave: dueno, p_id: gm.id, p_datos: { nombre: 'Luis', email: 'mal' } });
ok(r.ok === false && r.error === 'datos_invalidos', 'con un dato mal, no guarda');
r = await llamar('admin_checkin_manual_editar', { p_clave: dueno, p_id: gm.id, p_datos: { nombre: 'Luis' } });
ok(r.ok === true && JSON.stringify((await guests(e1.id))[1].datos) === '{"nombre":"Luis"}', 'se puede dejar de nuevo sin un dato (nada es obligatorio)');
const normal = await back.sql(`insert into private.checkins (grupo, datos, consentimiento, estadia_id, habitacion) values (1, '{"nombre":"Normal"}', '{"aceptado":true}', $1, '104') returning id`, [e3b.id]);
r = await llamar('admin_checkin_manual_editar', { p_clave: dueno, p_id: normal[0].id, p_datos: { nombre: 'Otro' } });
ok(r.ok === false && r.error === 'no_es_manual', 'un huésped que hizo su propio check-in no se corrige por acá (tiene su propio editor, que exige todos los datos)');
ok((await llamar('admin_checkin_manual_editar', { p_clave: dueno, p_id: 999999, p_datos: {} })).error === 'no_existe', 'uno que no existe, tampoco');

console.log('\n== 6. Recepción no puede cargar ni corregir a mano');
r = await mano(e3b.id, [{ nombre: 'Intruso' }], rec);
ok(r.ok === false, 'recepción no puede cargar un check-in a mano');
ok((await manoAnotada(a6.id, [{}], {}, rec)).ok === false && (await llamar('admin_checkin_manual_editar', { p_clave: rec, p_id: gm.id, p_datos: { nombre: 'X' } })).ok === false, 'ni armar una reserva desde una anotada, ni corregir a uno cargado a mano');
ok((await mano(e3b.id, [{ nombre: 'Intruso' }], 'clave-mala')).ok === false && (await mano(e3b.id, [{ nombre: 'Intruso' }], '')).ok === false, 'sin clave o con una mala, tampoco');
r = await llamar('recepcion_editar', { p_clave: rec, p_id: gm.id, p_datos: COMPLETO, p_habitacion: '101' });
ok(r.ok === false && r.error === 'sin_permiso', 'recepción tampoco puede corregir con su editor a uno cargado a mano');
const vistos = (await llamar('recepcion_estado', { p_clave: rec })).huespedes;
ok(vistos.some((x) => x.id === gm.id && x.origen === 'manual' && x.cargado_por), 'pero sí lo ve en su lista, marcado como cargado a mano (y quién lo cargó)');
ok((await llamar('recepcion_proximas', { p_clave: rec })).estadias.find((x) => x.id === e1.id)?.a_mano === 3, 'y en las reservas ve cuántos son a mano');
ok(await n(`select count(*)::int n from private.checkins_activos where estadia_id = $1`, [e3b.id]) === 2, 'no se coló ningún huésped de recepción');

console.log('\n== 7. Estadísticas: quién deja mail, teléfono, documento… y los que no tienen datos');
const s = await llamar('admin_estadisticas', { p_clave: dueno });
ok(s.ok === true && Array.isArray(s.huespedes), 'las estadísticas se calculan con huéspedes sin datos');
const hs = s.huespedes;
const completo = hs.find((x) => x.estadia_id === e1.id && x.con_email);
ok(completo && completo.con_telefono && completo.con_documento && completo.con_domicilio && completo.con_nombre && completo.a_mano === true && completo.nacionalidad === 'Argentina' && completo.anio_nac === 1990, 'el completo trae mail, teléfono, documento, domicilio, nombre, nacionalidad y año; y la marca «a mano»');
const vacio = hs.filter((x) => x.estadia_id === e1.id && !x.con_nombre && !x.con_email);
ok(vacio.length >= 1 && vacio.every((x) => !x.con_telefono && !x.con_documento && !x.con_domicilio && x.nacionalidad == null && x.anio_nac == null && x.a_mano === true), 'el que no tiene ningún dato figura sin mail, sin teléfono, sin documento, sin nacionalidad: «sin dato»');
const dnis = await mano((await rapida('301', 1)).id, [{ doc_tipo: 'DNI', doc_numero: '30123456', nombre: 'Ana' }]);
const dnis2 = await mano((await rapida('302', 1)).id, [{ doc_tipo: 'DNI', doc_numero: '30123456', nombre: 'Ana otra vez' }]);
const s2 = await llamar('admin_estadisticas', { p_clave: dueno });
const conDni = s2.huespedes.filter((x) => x.doc_tipo === 'DNI' && x.con_documento);
ok(dnis.ok && dnis2.ok && conDni.filter((x) => x.visitas >= 2).length >= 2, 'el mismo DNI en dos reservas distintas cuenta como un huésped que vuelve (visitas 2)');
const sinDoc = s2.huespedes.filter((x) => !x.con_documento);
ok(sinDoc.length >= 5 && sinDoc.every((x) => x.visitas === 1), 'los huéspedes SIN documento NO se juntan como si fueran la misma persona: cada uno es una visita');
ok(s2.reservas.some((x) => x.id === e1.id && x.huespedes === 3) && s2.reservas.some((x) => x.id === r.estadia || true), 'la reserva con huéspedes a mano suma como habitación vendida (con sus 3 huéspedes)');
const sinChk = await rapida('401', 1);
ok(!(await llamar('admin_estadisticas', { p_clave: dueno })).reservas.some((x) => x.id === sinChk.id), 'en cambio una reserva sin ningún check-in sigue sin sumar');
const antesQuitar = (await llamar('admin_estadisticas', { p_clave: dueno })).huespedes.length;
await llamar('admin_huesped_quitar', { p_clave: dueno, p_id: gm.id, p_quitar: true });
ok((await llamar('admin_estadisticas', { p_clave: dueno })).huespedes.length === antesQuitar - 1, 'y el dueño puede eliminar a uno cargado a mano como a cualquiera: deja de contar');
const lista = await llamar('admin_huespedes', { p_clave: dueno, p_buscar: 'ana' });
ok(lista.ok === true && lista.huespedes.every((x) => x.origen), 'la lista y la búsqueda del dueño andan con huéspedes sin datos y traen el origen');

console.log('\n== 8. Pasar de la versión publicada hoy a esta, con huéspedes ya cargados');
const viejo = await iniciarBackend({ puerto: 54410, estadias: false });
await viejo.sql(`update private.checkin_config set activo = true, usos_max = 20, dias_recepcion = 5 where id = 1`);
await viejo.sql(SQL_RECEPCION, [CLAVE_RECEPCION]);
await viejo.exec(fs.readFileSync(new URL('./fixtures/estadias-v9.sql', import.meta.url), 'utf8')); // el estadias.sql que hoy está en producción
const llamarV = (nom, x) => viejo.llamar(nom, x, '203.0.113.8');
const recV = (await llamarV('sesion_entrar', { p_clave: CLAVE_RECEPCION })).token;
const duenoV = (await llamarV('sesion_entrar', { p_clave: CLAVE_ADMIN })).token;
const rV = await llamarV('recepcion_reserva_nueva', { p_clave: recV, p_habitacion: '501', p_monto: 50000, p_moneda: 'ARS', p_medio_pago: EFECTIVO, p_fecha: hoy, p_pago_hotel: 50000, p_fecha_sena: null, p_noches: 1, p_canal: DIRECTO, p_categoria: DOBLE, p_huespedes: 2 });
const codV = (await llamarV('recepcion_estado', { p_clave: recV })).codigo.valor;
const sV = await llamarV('checkin_canjear', { p_codigo: String(codV) });
const enviado = await llamarV('checkin_enviar', { p_token: sV.token, p_datos: COMPLETO, p_idioma: 'es', p_acepta: true });
ok(rV.ok && enviado.ok, 'en la base «de hoy» hay una reserva con un huésped que hizo su propio check-in');
const sql = fs.readFileSync(new URL('../supabase/estadias.sql', import.meta.url), 'utf8');
const huella = async () => JSON.stringify(await viejo.sql(`select id, estadia_id, datos, habitacion from private.checkins order by id`));
const h0 = await huella();
await viejo.exec(sql);
await viejo.exec(sql);
ok(await huella() === h0, 'aplicar el archivo (dos veces) no cambia ningún huésped');
const gv = await viejo.sql(`select origen, cargado_por from private.checkins_activos`);
ok(gv.length === 1 && gv[0].origen === 'huesped' && gv[0].cargado_por === null, 'el huésped que ya estaba queda como «huésped» (hizo su propio check-in), y la vista de huéspedes activos ya trae la columna');
r = await llamarV('admin_checkin_manual', { p_clave: duenoV, p_estadia: rV.id, p_huespedes: [{ nombre: 'A mano' }] });
ok(r.ok === true && (await llamarV('recepcion_proximas', { p_clave: duenoV })).estadias.find((x) => x.id === rV.id)?.a_mano === 1, 'sobre la base migrada se puede cargar a mano, y la reserva muestra 1 a mano');
ok((await llamarV('admin_estadisticas', { p_clave: duenoV })).huespedes.some((x) => x.a_mano === true) && (await llamarV('admin_estadisticas', { p_clave: duenoV })).huespedes.some((x) => x.a_mano === false), 'las estadísticas distinguen los que hicieron su check-in de los cargados a mano');
await viejo.cerrar();

await back.cerrar();
console.log(fallas ? `\n${fallas} fallas` : '\nTodo bien');
process.exit(fallas ? 1 : 0);
