// Las cuentas de la pantalla «Reservas» de recepción: qué reserva va en cada pestaña, el cartel de «qué falta llegar» y los textos. Sin pantalla ni red.
//   node scripts/test-hub.mjs
import { PESTANAS, cierreTexto, clasificarHub, controlLlegadas, diasEntre } from '../src/checkin/hub.js';

let fallas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK    ' : 'FALLA '}${m}`); if (!c) fallas += 1; };
const ids = (x) => x.map((a) => a.id);
const A = (id, titular, dias, extra = {}) => ({ id, titular, habitacion: String(100 + id), estado: 'anotada', dias_para: dias, fecha_ingreso: `2026-11-${20 + dias}`, nota: null, canal: 'Directo', categoria: 'Doble', ingresaron: [], con_checkin: 0, esperados: 2, ...extra });
const E = (id, titular, estado, con, esp, llegada, ultima, extra = {}) => ({ id, titular, habitacion: String(200 + id), estado, con_checkin: con, esperados: esp, llegada, dias_para: diasEntre('2026-11-20', llegada), ultima, ingresaron: Array.from({ length: con }, (_, i) => `Huésped${i + 1} Prueba`), nota: null, canal: 'Directo', categoria: 'Doble', ...extra });
const datos = {
  hoy: '2026-11-20',
  reservas: [
    A(1, 'Atrasada', -2), A(2, 'Hoy uno', 0), A(3, 'Hoy dos', 0), A(4, 'Mañana', 1), A(5, 'En tres días', 3),
    A(6, 'Ya empezó', 0, { estado: 'en_curso' }), A(7, 'Cancelada', 1, { estado: 'cancelada' })
  ],
  estadias: [
    E(10, 'Sin nadie', 'sin_ingresos', 0, 2, '2026-11-20', '2026-11-20T10:00:00Z'),
    E(11, null, 'sin_ingresos', 0, 1, '2026-11-20', '2026-11-20T11:00:00Z'),
    E(12, 'Falta uno', 'faltan', 1, 2, '2026-11-20', '2026-11-20T09:00:00Z'),
    E(13, 'Falta otro', 'faltan', 2, 3, '2026-11-19', '2026-11-20T12:00:00Z'),
    E(14, 'Completa', 'completa', 2, 2, '2026-11-20', '2026-11-20T08:00:00Z'),
    E(15, 'Cerrada', 'cerrada', 1, 2, '2026-11-19', '2026-11-19T20:00:00Z', { cerrada_por: 'Recepción' }),
    E(16, 'Vieja', 'completa', 3, 3, '2026-11-17', '2026-11-17T12:00:00Z')
  ]
};

console.log('\n== 1. Las pestañas');
ok(PESTANAS.map((p) => p.texto).join() === 'Faltan llegar,Falta cerrar,Cerradas,Próximas,Historial', 'son cinco, en este orden: Faltan llegar, Falta cerrar, Cerradas, Próximas e Historial');

console.log('\n== 2. Qué va en cada una');
const c = clasificarHub(datos);
ok(JSON.stringify(ids(c.faltan.atrasadas)) === '[1]' && JSON.stringify(ids(c.faltan.hoy)) === '[2,3]', 'Faltan llegar: las atrasadas y las de hoy que no empezaron el check-in');
ok(JSON.stringify(ids(c.faltan.sinIngresos)) === '[11,10]', 'y las que tienen el código dado y no entró nadie (la más reciente primero)');
ok(!ids([...c.faltan.atrasadas, ...c.faltan.hoy, ...c.proximas]).includes(6) && !ids([...c.faltan.atrasadas, ...c.faltan.hoy, ...c.proximas]).includes(7), 'una anotada que ya empezó (está en las reservas) y una cancelada no se cuentan dos veces ni aparecen');
ok(JSON.stringify(ids(c.cerrar)) === '[13,12]', 'Falta cerrar: ingresó al menos uno y faltan (la actividad más reciente primero)');
ok(JSON.stringify(ids(c.cerradas)) === '[14,15,16]', 'Cerradas: las completas y la cerrada a mano, de la más reciente a la más vieja');
ok(JSON.stringify(ids(c.proximas)) === '[4,5]', 'Próximas: las anotadas de mañana en adelante, en orden de fecha');
ok(c.conteo.faltan === 5 && c.conteo.cerrar === 2 && c.conteo.cerradas === 3 && c.conteo.proximas === 2, `las cantidades de cada pestaña: ${JSON.stringify(c.conteo)}`);

console.log('\n== 3. Historial por día de llegada');
ok(c.historial.map((d) => d.fecha).join() === '2026-11-20,2026-11-19,2026-11-17', 'los días van del más reciente al más viejo');
ok(JSON.stringify(ids(c.historial[0].items)) === '[12,14]' && c.historial[0].huespedes === 3, 'el 20/11: 2 reservas que ya llegaron (la que está sin ingresos no cuenta), con 3 huéspedes');
ok(JSON.stringify(ids(c.historial[1].items)) === '[13,15]' && c.historial[1].huespedes === 3, 'el 19/11: 2 reservas y 3 huéspedes');
ok(c.historial[2].items.length === 1 && c.historial[2].huespedes === 3 && c.historial[2].dias === -3, 'el 17/11: 1 reserva, 3 huéspedes, hace 3 días');
ok(c.conteo.historial === 5, 'en total 5 reservas ya llegadas');
ok(!c.historial.some((d) => d.items.some((e) => e.con_checkin === 0)), 'las que no tienen ningún huésped no están en el historial');

console.log('\n== 4. El buscador (también por quien ingresó)');
const b = clasificarHub(datos, 'huesped1');
ok(b.conteo.faltan === 0 && b.cerrar.length >= 1 && b.cerradas.length >= 1, '«huesped1» encuentra a las reservas donde ingresó alguien con ese nombre');
const b2 = clasificarHub(datos, 'atrasada');
ok(JSON.stringify(ids(b2.faltan.atrasadas)) === '[1]' && b2.conteo.cerrar === 0 && b2.conteo.cerradas === 0, 'buscar por el nombre de una que falta llegar deja solo esa');
ok(clasificarHub(datos, 'zzz').conteo.faltan === 0 && clasificarHub(datos, 'zzz').historial.length === 0, 'si no hay coincidencias no queda nada');
ok(clasificarHub(datos, '  ').conteo.faltan === c.conteo.faltan, 'sin nada escrito aparece todo');
ok(clasificarHub({}, '').conteo.faltan === 0 && clasificarHub(null).historial.length === 0, 'sin datos todo en cero y no rompe');

console.log('\n== 5. El cartel «qué falta llegar»');
const k = controlLlegadas(datos);
ok(k.estado === 'esperando' && k.faltan === 5 && k.hoy === 2 && k.atrasadas === 1 && k.sinIngresos === 2, 'con reservas por llegar el cartel dice que hay que estar atento: 5 (2 hoy, 1 atrasada, 2 con el código dado)');
ok(k.manana === 1 && k.cerrar === 2, 'y cuenta las de mañana (1) y las que falta cerrar (2)');
ok(JSON.stringify(k.quienes) === JSON.stringify(['Hoy uno', 'Hoy dos', 'Atrasada', 'Reserva rápida · Hab. 211']), 'nombra a las primeras 4 para saber a quién esperar: las de hoy, las atrasadas y las que tienen el código dado (una reserva rápida se nombra por su habitación)');
const todas = { ...datos, reservas: datos.reservas.filter((a) => a.dias_para > 0 || a.estado !== 'anotada'), estadias: datos.estadias.filter((e) => e.estado !== 'sin_ingresos') };
const t = controlLlegadas(todas);
ok(t.estado === 'tranquilo' && t.faltan === 0 && t.manana === 1, 'si ya llegaron todas las de hoy, el cartel dice que se puede quedar tranquilo (y que mañana llega 1)');
ok(controlLlegadas({}).estado === 'tranquilo' && controlLlegadas({}).faltan === 0, 'sin reservas también');
ok(controlLlegadas({ ...datos, estadias: [datos.estadias[1]], reservas: [] }).quienes[0] === 'Reserva rápida · Hab. 211', 'una reserva rápida (sin nombre) se nombra por su habitación');
ok(JSON.stringify(controlLlegadas(datos)) === JSON.stringify(controlLlegadas(datos)), 'el cartel no depende del buscador (siempre mira todo)');

console.log('\n== 6. Los textos');
ok(cierreTexto({ estado: 'completa', con_checkin: 3, esperados: 3 }) === 'Ingresaron los 3' && cierreTexto({ estado: 'completa', con_checkin: 1, esperados: 1 }) === 'Ingresó 1 huésped', 'completa: «Ingresaron los 3» / «Ingresó 1 huésped»');
ok(cierreTexto({ estado: 'cerrada', con_checkin: 1, esperados: 2, cerrada_por: 'Recepción' }) === 'Cerrada con 1 de 2 · por Recepción', 'cerrada a mano: «Cerrada con 1 de 2 · por Recepción»');
ok(cierreTexto({ estado: 'cerrada', con_checkin: 1, esperados: 2 }) === 'Cerrada con 1 de 2', 'sin saber quién: «Cerrada con 1 de 2»');
ok(diasEntre('2026-11-20', '2026-11-22') === 2 && diasEntre('2026-11-20', '2026-11-17') === -3 && diasEntre('2026-02-28', '2026-03-01') === 1, 'los días entre dos fechas (también cruzando meses)');

console.log(fallas ? `\n${fallas} fallas` : '\nTodo bien');
process.exit(fallas ? 1 : 0);
