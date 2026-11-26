// Permisos: recepción NO puede eliminar ni quitar nada (reservas, huéspedes, fotos, anotadas…). Eso es solo del dueño, para que ninguna eliminación pase desapercibida.
//   node scripts/test-permisos.mjs
// Usa la base de prueba en memoria con schema.sql + checkin.sql + estadias.sql y llama a las funciones como lo hace la guía (rol "anon").
//   1. Todas las funciones del dueño (admin_*) rechazan una sesión de recepción, una clave mala y la falta de clave. Se arman solas desde la base: una función nueva del dueño queda cubierta.
//   2. La lista de funciones de recepción es CERRADA: si aparece una nueva, esta prueba falla para que se revise que no elimine nada.
//   3. Con una sesión de recepción se intenta eliminar de todas las formas posibles y no cambia nada.
import { CLAVE_ADMIN, CLAVE_RECEPCION, SQL_RECEPCION, iniciarBackend } from './backend-local.mjs';

let fallas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK    ' : 'FALLA '}${m}`); if (!c) fallas += 1; };

const back = await iniciarBackend({ puerto: 54408, estadias: true });
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
const n = async (sql, p = []) => (await back.sql(sql, p))[0].n;

console.log('\n== 1. Ninguna función del dueño sirve con una sesión de recepción');
const funciones = await back.sql(`select p.proname as nombre, p.proargnames as nombres, array(select format_type(t, null) from unnest(p.proargtypes) t) as tipos
  from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'admin\\_%' order by 1`);
const valorDe = (tipo) => ({ text: 'x', bigint: 1, integer: 1, smallint: 1, numeric: 1, boolean: true, date: hoy, jsonb: {}, json: {}, 'text[]': ['x'], 'timestamp with time zone': new Date().toISOString() }[tipo] ?? 'x');
const argumentos = (f, clave) => Object.fromEntries((f.nombres ?? []).map((nom, i) => [nom, nom === 'p_clave' ? clave : valorDe(f.tipos[i])]));
ok(funciones.length >= 30, `hay ${funciones.length} funciones del dueño en la base (todas se prueban)`);
const antes = {
  est: await n(`select count(*)::int n from private.estadias`), anul: await n(`select count(*)::int n from private.estadias where anulada_en is not null`),
  chk: await n(`select count(*)::int n from private.checkins`), chkq: await n(`select count(*)::int n from private.checkins where quitado_en is not null`),
  anot: await n(`select count(*)::int n from private.reservas_anotadas`), anotc: await n(`select count(*)::int n from private.reservas_anotadas where cancelada_en is not null`)
};
const cuentaSesiones = async () => n(`select count(*)::int n from private.sesiones`).catch(() => 0);
const sesAntes = await cuentaSesiones();
const dejaPasar = [];
for (const f of funciones) {
  for (const [que, clave] of [['recepción', rec], ['clave mala', 'clave-mala-123'], ['sin clave', '']]) {
    let r;
    try { r = await llamar(f.nombre, argumentos(f, clave)); } catch { r = { ok: false }; }
    if (r?.ok === true) dejaPasar.push(`${f.nombre} (${que})`);
  }
}
ok(dejaPasar.length === 0, `ninguna de las ${funciones.length} funciones del dueño acepta una sesión de recepción, una clave mala ni la falta de clave${dejaPasar.length ? ` — dejan pasar: ${dejaPasar.join(', ')}` : ''}`);
const despues = {
  est: await n(`select count(*)::int n from private.estadias`), anul: await n(`select count(*)::int n from private.estadias where anulada_en is not null`),
  chk: await n(`select count(*)::int n from private.checkins`), chkq: await n(`select count(*)::int n from private.checkins where quitado_en is not null`),
  anot: await n(`select count(*)::int n from private.reservas_anotadas`), anotc: await n(`select count(*)::int n from private.reservas_anotadas where cancelada_en is not null`)
};
ok(JSON.stringify(antes) === JSON.stringify(despues) && (await cuentaSesiones()) === sesAntes, 'y no se tocó nada en la base');

console.log('\n== 2. La lista de funciones de recepción es cerrada');
const deRecepcion = (await back.sql(`select p.proname as nombre from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'recepcion\\_%' order by 1`)).map((x) => x.nombre);
const permitidas = {
  recepcion_anotada_guardar: 'anota o corrige una reserva anotada (no la cancela)',
  recepcion_anotada_unir: 'SOLO el dueño: unir una anotada con una armada',
  recepcion_codigo_nuevo: 'da un código nuevo',
  recepcion_editar: 'corrige los datos de un huésped (durante la ventana de edición; queda en el registro)',
  recepcion_entrar: 'entra al panel',
  recepcion_estadia_cerrar: 'cierra una reserva con menos huéspedes (no borra nada; solo el dueño la reabre)',
  recepcion_estadia_editar: 'corrige una reserva (durante la ventana de edición; queda en el registro)',
  recepcion_estado: 'lee lo que ve recepción',
  recepcion_foto_permiso: 'pide permiso para subir una foto',
  recepcion_fotos: 've y agrega fotos del documento (no las quita)',
  recepcion_llegada_iniciar: 'hace el check-in de una reserva anotada',
  recepcion_proximas: 'lee las reservas de los días permitidos',
  recepcion_reserva_abrir: 'le vuelve a dar código a una reserva abierta',
  recepcion_reserva_anular: 'SOLO el dueño: elimina (anula) una reserva',
  recepcion_reserva_cerrar: 'apaga o extiende el código que se ve',
  recepcion_reserva_nueva: 'crea una reserva rápida'
};
const nuevas = deRecepcion.filter((x) => !(x in permitidas));
const faltan = Object.keys(permitidas).filter((x) => !deRecepcion.includes(x));
ok(nuevas.length === 0 && faltan.length === 0, `hay ${deRecepcion.length} funciones de recepción, todas revisadas${nuevas.length ? ` — NUEVAS sin revisar: ${nuevas.join(', ')} (revisá que no eliminen nada y agregalas acá)` : ''}${faltan.length ? ` — ya no existen: ${faltan.join(', ')}` : ''}`);
const destructivas = deRecepcion.filter((x) => /anular|quitar|eliminar|borrar|cancelar|restaurar|descartar|unificar/.test(x));
ok(JSON.stringify(destructivas.sort()) === JSON.stringify(['recepcion_reserva_anular']), 'la única función de recepción que suena a eliminar es recepcion_reserva_anular (y ahora solo sirve al dueño)');

console.log('\n== 3. Con una sesión de recepción se intenta eliminar y no cambia nada');
const rapida = (hab, hues = 2) => llamar('recepcion_reserva_nueva', { p_clave: rec, p_habitacion: hab, p_monto: 63800, p_moneda: 'ARS', p_medio_pago: EFECTIVO, p_fecha: hoy, p_pago_hotel: 63800, p_fecha_sena: null, p_noches: 1, p_canal: DIRECTO, p_categoria: DOBLE, p_huespedes: hues });
const DATOS = (nom, doc) => ({ nombre: nom, apellido: 'Prueba', email: `${nom.toLowerCase()}@correo.com`, telefono: '+541155551234', nacionalidad: 'Argentina', localidad: 'Capital Federal', domicilio: 'Av. Corrientes 1234 5° B', doc_tipo: 'DNI', doc_numero: String(doc), anio_nac: 1990 });
let docN = 38000000;
const entra = async (nom) => {
  const codigo = (await llamar('recepcion_estado', { p_clave: rec })).codigo.valor;
  const s = await llamar('checkin_canjear', { p_codigo: String(codigo) });
  return s.ok ? llamar('checkin_enviar', { p_token: s.token, p_datos: DATOS(nom, docN++), p_idioma: 'es', p_acepta: true }) : s;
};
const vacia = await rapida('101', 1);
const conHuespedes = await rapida('102', 2);
await entra('Ana'); await entra('Luis');
const anotada = await llamar('admin_anotada_guardar', { p_clave: dueno, p_id: null, p_titular: 'Pérez', p_ingreso: hoy, p_habitacion: '103', p_noches: 1, p_categoria: DOBLE, p_canal: DIRECTO, p_huespedes: 1, p_efectivo: 50000, p_transferencia: null, p_usd: null, p_sena: 0, p_fecha_sena: null, p_nota: null });
const instantanea = async () => JSON.stringify({
  estadias: await back.sql(`select id, anulada_en is not null as anulada, cerrada_en is not null as cerrada, huespedes_esperados from private.estadias order by id`),
  huespedes: await back.sql(`select id, estadia_id, quitado_en is not null as quitado from private.checkins order by id`),
  anotadas: await back.sql(`select id, cancelada_en is not null as cancelada, estadia_id from private.reservas_anotadas order by id`)
});
const base = await instantanea();
// una función del dueño con una clave dada: los nombres y tipos de los argumentos salen de la base (extra pisa los que importan)
const adm = (nombre, clave, extra = {}) => llamar(nombre, { ...argumentos(funciones.find((f) => f.nombre === nombre), clave), ...extra });
let r = await llamar('recepcion_reserva_anular', { p_clave: rec, p_id: vacia.id });
ok(r.ok === false && r.error === 'sin_permiso', 'recepción no puede anular una reserva sin huéspedes');
r = await llamar('recepcion_reserva_anular', { p_clave: rec, p_id: conHuespedes.id });
ok(r.ok === false && r.error === 'sin_permiso', 'ni una con huéspedes');
r = await adm('admin_reserva_anular', rec, { p_id: vacia.id, p_anular: true });
ok(r.ok === false, 'ni por la puerta del dueño');
r = await adm('admin_huesped_quitar', rec, { p_id: 1, p_quitar: true });
ok(r.ok === false, 'ni quitar un huésped');
r = await adm('admin_anotada_cancelar', rec, { p_id: anotada.id, p_cancelar: true });
ok(r.ok === false, 'ni cancelar una reserva anotada');
r = await adm('admin_foto_quitar', rec, { p_quitar: true });
ok(r.ok === false, 'ni quitar la foto de un documento');
r = await llamar('recepcion_anotada_unir', { p_clave: rec, p_anotada: anotada.id, p_estadia: vacia.id });
ok(r.ok === false && r.error === 'sin_permiso', 'ni unificar reservas (lo aprueba el dueño)');
ok(await instantanea() === base, 'y no cambió ninguna reserva, huésped ni anotada');
r = await llamar('recepcion_estadia_cerrar', { p_clave: rec, p_id: conHuespedes.id });
ok(r.ok === true && (await n(`select count(*)::int n from private.checkins_activos where estadia_id = $1`, [conHuespedes.id])) === 2 && (await n(`select count(*)::int n from private.estadias where id = $1 and anulada_en is not null`, [conHuespedes.id])) === 0, 'cerrar una reserva (lo único parecido que puede) no elimina nada: los huéspedes siguen y no queda anulada');
const datosOwner = await llamar('recepcion_proximas', { p_clave: dueno });
const datosRec = await llamar('recepcion_proximas', { p_clave: rec });
ok(Array.isArray(datosRec.eliminadas) && datosRec.eliminadas.length === 0, 'recepción no ve las reservas eliminadas');
ok(await n(`select count(*)::int n from private.estadias`) === antes.est + 2 && datosOwner.ok === true, 'y las dos reservas siguen en la base');
r = await llamar('admin_reserva_anular', { p_clave: dueno, p_id: vacia.id });
ok(r.ok === true, 'el dueño, en cambio, sí puede (queda en el registro con su nombre)');
ok((await n(`select count(*)::int n from private.checkin_auditoria where accion = 'reserva_anular'`)) === 1, 'y la eliminación queda en el historial');

await back.cerrar();
console.log(fallas ? `\n${fallas} fallas` : '\nTodo bien');
process.exit(fallas ? 1 : 0);
