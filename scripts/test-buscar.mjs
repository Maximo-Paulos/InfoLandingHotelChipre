// El buscador y la agrupación de «Próximas reservas» de recepción (cuentas puras, sin pantalla ni red).
//   node scripts/test-buscar.mjs
import { agruparPorDia, filtrarProximas, ingresoTexto, normalizar, seccionesDe } from '../src/checkin/proximas.js';

let fallas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK    ' : 'FALLA '}${m}`); if (!c) fallas += 1; };
const R = (id, titular, hab, extra = {}) => ({ id, titular, habitacion: hab, nota: null, canal: 'Directo', categoria: 'Doble', fecha_ingreso: '2026-11-21', dias_para: 1, ...extra });
const lista = [
  R(1, 'Juan Pérez', '107'),
  R(2, 'María José Núñez', '203', { nota: 'Pide cuna', fecha_ingreso: '2026-11-21' }),
  R(3, 'Pedro Pérez Gómez', '12B', { canal: 'Booking', fecha_ingreso: '2026-11-25', dias_para: 5 }),
  R(4, 'Ana García', '107', { categoria: 'Suite', fecha_ingreso: '2026-12-30', dias_para: 40 })
];
const ids = (x) => x.map((a) => a.id);

console.log('\n== 1. Normalizar');
ok(normalizar('  JOSÉ   Pérez ') === 'jose perez', 'sin tildes, en minúsculas y con un solo espacio');
ok(normalizar(null) === '' && normalizar(undefined) === '' && normalizar(107) === '107', 'lo que no es texto no rompe');

console.log('\n== 2. Buscar');
ok(filtrarProximas(lista, '') === lista && filtrarProximas(lista, '   ') === lista, 'sin nada escrito aparecen todas');
ok(JSON.stringify(ids(filtrarProximas(lista, 'perez'))) === '[1,3]', '«perez» encuentra a las dos Pérez (aunque el nombre tenga tilde)');
ok(JSON.stringify(ids(filtrarProximas(lista, 'PÉREZ'))) === '[1,3]', 'en mayúsculas y con tilde también');
ok(JSON.stringify(ids(filtrarProximas(lista, 'maria jose'))) === '[2]' && JSON.stringify(ids(filtrarProximas(lista, 'jose maria'))) === '[2]', 'varias palabras, en cualquier orden');
ok(JSON.stringify(ids(filtrarProximas(lista, 'perez 107'))) === '[1]', 'nombre y habitación juntos');
ok(JSON.stringify(ids(filtrarProximas(lista, '107'))) === '[1,4]', 'por habitación');
ok(JSON.stringify(ids(filtrarProximas(lista, 'cuna'))) === '[2]', 'también por lo que dice la nota');
ok(JSON.stringify(ids(filtrarProximas(lista, 'booking'))) === '[3]' && JSON.stringify(ids(filtrarProximas(lista, 'suite'))) === '[4]', 'por canal y por categoría');
ok(filtrarProximas(lista, 'zzz').length === 0, 'si no hay coincidencia, no queda ninguna');
ok(JSON.stringify(ids(filtrarProximas(lista, 'gar'))) === '[4]', 'con una parte del nombre alcanza: «gar» encuentra solo a García');

console.log('\n== 3. Agrupar por día');
const g = agruparPorDia(lista);
ok(g.length === 3 && g[0].fecha === '2026-11-21' && ids(g[0].items).join() === '1,2' && g[1].fecha === '2026-11-25' && g[2].fecha === '2026-12-30', 'las que llegan el mismo día quedan juntas, en el orden en que vienen');
ok(g[0].dias === 1 && g[1].dias === 5 && g[2].dias === 40, 'cada grupo trae cuántos días faltan');
ok(agruparPorDia([]).length === 0, 'sin reservas no hay grupos');

console.log('\n== 4. Buscar también por quien ya ingresó');
const con = [
  R(10, 'Familia Gómez', '77', { estado: 'en_curso', con_checkin: 2, esperados: 3, ingresaron: ['Ana Prueba', 'Luis Pérez'], ultima: '2026-11-20T15:00:00Z' }),
  R(11, 'Otra', '12', { estado: 'en_curso', con_checkin: 1, esperados: 1, ingresaron: ['Mario Ruiz'] })
];
ok(JSON.stringify(ids(filtrarProximas(con, 'luis'))) === '[10]' && JSON.stringify(ids(filtrarProximas(con, 'ruiz'))) === '[11]', 'el buscador encuentra la reserva por el nombre de alguien que ya ingresó');

console.log('\n== 5. Secciones: falta ingresar / ya ingresaron');
const E = (id, titular, extra) => R(id, titular, String(id), extra);
const todas = [
  E(20, 'Por llegar 1', { estado: 'anotada', dias_para: 0 }),
  E(21, 'Por llegar 2', { estado: 'anotada', dias_para: 3 }),
  E(22, 'Pasó la fecha', { estado: 'anotada', dias_para: -2 }),
  E(23, 'Código sin nadie', { estado: 'en_curso', con_checkin: 0, esperados: 2, ultima: '2026-11-20T10:00:00Z' }),
  E(24, 'Faltan viejo', { estado: 'en_curso', con_checkin: 1, esperados: 3, ultima: '2026-11-19T10:00:00Z' }),
  E(25, 'Faltan nuevo', { estado: 'en_curso', con_checkin: 2, esperados: 3, ultima: '2026-11-20T18:00:00Z' }),
  E(26, 'Completa', { estado: 'en_curso', con_checkin: 3, esperados: 3, ultima: '2026-11-20T12:00:00Z' }),
  E(27, 'Completa vieja', { estado: 'en_curso', con_checkin: 2, esperados: 2, ultima: '2026-11-18T12:00:00Z' }),
  E(28, 'Cancelada', { estado: 'cancelada' })
];
const sc = seccionesDe(todas);
ok(JSON.stringify(ids(sc.porLlegar)) === '[20,21]' && JSON.stringify(ids(sc.pasadas)) === '[22]', 'las que esperan se reparten en por llegar (hoy y futuras) y pasó la fecha, en el orden en que vienen');
ok(JSON.stringify(ids(sc.sinNadie)) === '[23]', 'se dio el código y todavía no entró nadie: sigue siendo «falta ingresar»');
ok(JSON.stringify(ids(sc.faltanHuespedes)) === '[25,24]', 'ya ingresó alguien pero faltan: de la actividad más reciente a la más vieja');
ok(JSON.stringify(ids(sc.completas)) === '[26,27]', 'completas (ingresaron todos): también de la más reciente a la más vieja');
ok(JSON.stringify(ids(sc.canceladas)) === '[28]', 'las canceladas van aparte');
ok(sc.faltaIngresar === 4 && sc.yaIngresaron === 4, 'los totales: 4 faltan ingresar (2 por llegar, 1 pasada, 1 con código) y 4 ya ingresaron');
ok(sc.faltaIngresar + sc.yaIngresaron + sc.canceladas.length === todas.length, 'no se pierde ninguna reserva: cada una está en una sola sección');
const vacias = seccionesDe([]);
ok(vacias.faltaIngresar === 0 && vacias.yaIngresaron === 0, 'sin reservas, todo en cero');
ok(seccionesDe([E(30, 'Sin dato', { estado: 'en_curso', esperados: 2 })]).sinNadie.length === 1, 'una reserva en curso sin el dato de cuántos entraron cuenta como que no entró nadie');

console.log('\n== 6. El cartelito de cuántos ingresaron');
ok(ingresoTexto({ con_checkin: 0, esperados: 3 }) === 'Todavía no entró nadie', 'ninguno: «Todavía no entró nadie»');
ok(ingresoTexto({ con_checkin: 2, esperados: 3 }) === 'Ingresaron 2 de 3 (falta 1)', 'dos de tres: «Ingresaron 2 de 3 (falta 1)»');
ok(ingresoTexto({ con_checkin: 1, esperados: 4 }) === 'Ingresaron 1 de 4 (faltan 3)', 'uno de cuatro: «Ingresaron 1 de 4 (faltan 3)»');
ok(ingresoTexto({ con_checkin: 3, esperados: 3 }) === 'Ingresaron los 3' && ingresoTexto({ con_checkin: 1, esperados: 1 }) === 'Ingresó 1 huésped', 'completas: «Ingresaron los 3» / «Ingresó 1 huésped»');

console.log(fallas ? `\n${fallas} fallas` : '\nTodo bien');
process.exit(fallas ? 1 : 0);
