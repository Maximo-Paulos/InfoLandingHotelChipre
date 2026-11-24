// Las cuentas de la pantalla «Reservas» de recepción: qué reserva va en cada pestaña, el cartel de «qué falta llegar» y los textos. Sin pantalla ni red.
//   node scripts/test-hub.mjs
import { PESTANAS, candidatasPara, cierreTexto, clasificarHub, controlLlegadas, diasEntre, dudaTexto, parecidaTexto, parecidas } from '../src/checkin/hub.js';

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
ok(PESTANAS.map((p) => p.texto).join() === 'Faltan llegar,Falta cerrar,Cerradas,Próximas,Historial,Eliminadas', 'son seis, en este orden: Faltan llegar, Falta cerrar, Cerradas, Próximas, Historial y Eliminadas');
ok(PESTANAS.filter((p) => p.soloDueno).map((p) => p.id).join() === 'eliminadas', '«Eliminadas» es solo del dueño; las otras las ven todos');

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

console.log('\n== 7. Reservas duplicadas: ¿esta anotada ya llegó por otro lado?');
const ana = A(30, 'Maldonado Gianfranco', -1, { habitacion: '202', fecha_ingreso: '2026-11-19' });
const lista = [
  E(40, null, 'completa', 2, 2, '2026-11-19', '2026-11-19T22:00:00Z', { habitacion: '202', anotada_id: null, cargado_por: 'Donato' }),
  E(41, null, 'sin_ingresos', 0, 2, '2026-11-20', '2026-11-20T10:00:00Z', { habitacion: '202', anotada_id: null }),
  E(42, 'Ya unida', 'completa', 1, 1, '2026-11-19', '2026-11-19T20:00:00Z', { habitacion: '202', anotada_id: 99 }),
  E(43, null, 'completa', 1, 1, '2026-11-19', '2026-11-19T20:00:00Z', { habitacion: '203', anotada_id: null }),
  E(44, null, 'completa', 1, 1, '2026-11-01', '2026-11-01T20:00:00Z', { habitacion: '202', anotada_id: null })
];
ok(JSON.stringify(ids(candidatasPara(ana, lista))) === '[40,41]', 'son candidatas las reservas sin anotada de la misma habitación y con fechas cercanas: la 202 con 2 huéspedes y la 202 con el código dado (las que ya tienen huéspedes, primero)');
ok(!ids(candidatasPara(ana, lista)).includes(42) && !ids(candidatasPara(ana, lista)).includes(43) && !ids(candidatasPara(ana, lista)).includes(44), 'no lo son: una que ya está unida a otra anotada, una de otra habitación ni una de hace 18 días');
ok(candidatasPara({ ...ana, habitacion: ' 202 ' }, lista).length === 2, 'la habitación se compara sin importar espacios');
ok(candidatasPara(A(31, 'Sin parecidas', 0, { habitacion: '999' }), lista).length === 0 && candidatasPara(ana, []).length === 0 && candidatasPara(ana, undefined).length === 0, 'si no hay parecidas (o no hay lista) no hay candidatas');
ok(dudaTexto([lista[0]], '202') === 'Puede que ya haya llegado: en la Hab. 202 hay una reserva con 2 huéspedes ingresados.', 'el aviso dice cuántos huéspedes ya ingresaron');
ok(dudaTexto([{ con_checkin: 1 }], '7') === 'Puede que ya haya llegado: en la Hab. 7 hay una reserva con 1 huésped ingresado.', 'con uno: «1 huésped ingresado»');
ok(dudaTexto([lista[1]], '202').includes('con el código dado'), 'si todavía no entró nadie, dice que es otra reserva abierta con el código dado');

ok(dudaTexto([{ ...lista[0], numero: 55 }], '202') === 'Puede que ya haya llegado: en la Hab. 202 hay una reserva (N.º 55) con 2 huéspedes ingresados.', 'con el número de la otra reserva: «hay una reserva (N.º 55)…»');

console.log('\n== 8. Número de reserva y eliminadas');
const conNumero = {
  hoy: '2026-11-20',
  reservas: [A(1, 'Ana', 0, { numero: 41 }), A(2, 'Beto', 1, { numero: 42 })],
  estadias: [E(10, 'Cata', 'completa', 1, 1, '2026-11-20', '2026-11-20T10:00:00Z', { numero: 43 })],
  eliminadas: [
    { tipo: 'estadia', id: 7, numero: 44, titular: null, habitacion: '202', llegada: '2026-11-19', huespedes: 2, cuando: '2026-11-20T09:00:00Z', por: 'Dueño' },
    { tipo: 'anotada', id: 8, numero: 45, titular: 'Dani', habitacion: '305', llegada: '2026-11-25', huespedes: 0, cuando: '2026-11-20T08:00:00Z', por: 'Dueño' }
  ]
};
ok(ids(clasificarHub(conNumero, '41').faltan.hoy).join() === '1' && clasificarHub(conNumero, '41').conteo.proximas === 0, 'escribir «41» en el buscador encuentra la reserva N.º 41 (y solo esa)');
ok(clasificarHub(conNumero, '43').conteo.cerradas === 1, '«43» encuentra la reserva armada N.º 43');
ok(clasificarHub(conNumero).eliminadas.length === 2 && clasificarHub(conNumero).conteo.eliminadas === 2, 'las eliminadas (solo si la base se las manda al dueño) van en su pestaña, con su cantidad');
ok(clasificarHub(conNumero, '45').eliminadas.map((x) => x.id).join() === '8' && clasificarHub(conNumero, '202').eliminadas.map((x) => x.id).join() === '7', 'y se buscan por número o por habitación');
ok(clasificarHub(datos).eliminadas.length === 0 && clasificarHub(undefined).conteo.eliminadas === 0, 'si la base no manda eliminadas (recepción), la pestaña queda vacía');

console.log('\n== 9. Parecidas: dos reservas que pueden ser la misma cargada dos veces');
const R = (id, hab, llegada, noches, extra = {}) => ({ id, habitacion: hab, llegada, noches, anotada_id: null, numero: 100 + id, titular: null, ...extra });
const par = parecidas({
  reservas: [A(1, 'Maldonado', -1, { habitacion: '202', fecha_ingreso: '2026-11-19', numero: 41, noches: 1 }), A(2, 'Pérez', 0, { habitacion: '305', fecha_ingreso: '2026-11-20', noches: 2, numero: 61 }), A(3, 'Pérez bis', 0, { habitacion: '305', fecha_ingreso: '2026-11-21', noches: 2, numero: 62 }),
             A(4, 'Seguida uno', 0, { habitacion: '401', fecha_ingreso: '2026-11-20', noches: 1 }), A(5, 'Seguida dos', 1, { habitacion: '401', fecha_ingreso: '2026-11-21', noches: 1 })],
  estadias: [R(10, '202', '2026-11-19', 1, { numero: 55 }), R(11, '202', '2026-11-19', 1, { numero: 56 }), R(12, '202', '2026-11-19', 1, { anotada_id: 9, numero: 57 }),
             R(13, '500', '2026-11-19', 3), R(14, '500', '2026-11-22', 1), R(15, '500', '2026-11-20', 1)]
});
ok(JSON.stringify((par.e10 ?? []).map((x) => x.id).sort()) === '[1,11,12]' || JSON.stringify((par.e10 ?? []).map((x) => x.id).sort((a, b) => a - b)) === '[1,11,12]', 'dos reservas armadas de la 202 con los mismos días se señalan entre sí; la reserva rápida también apunta a la anotada que sigue esperando');
ok((par.e12 ?? []).map((x) => x.id).sort((a, b) => a - b).join() === '10,11', 'la que ya salió de una anotada no apunta a otras anotadas, pero sí a las armadas que se le pisan');
ok(JSON.stringify((par.a2 ?? []).map((x) => x.id)) === '[3]' && JSON.stringify((par.a3 ?? []).map((x) => x.id)) === '[2]', 'dos anotadas de la 305 que se pisan (20 al 22 y 21 al 23) se señalan entre sí');
ok(!par.a4 && !par.a5, 'dos anotadas seguidas de la misma habitación (una noche y la siguiente) NO se señalan: no se pisan');
ok(!par.e14 && (par.e13 ?? []).map((x) => x.id).join() === '15' && (par.e15 ?? []).map((x) => x.id).join() === '13', 'en la 500: la estadía del 19 al 22 se pisa con la del 20, pero no con la del 22');
const lejos = parecidas({ reservas: [A(8, 'Lejana', 10, { habitacion: '600', fecha_ingreso: '2026-11-30', noches: 1 })], estadias: [R(16, '600', '2026-11-20', 1), R(17, '600', '2026-11-26', 1)] });
ok(!lejos.e16 && (lejos.e17 ?? []).map((x) => x.id).join() === '8', 'una anotada que llega 10 días después no se señala con la reserva armada (hasta 5 días sí: la del 26 con la anotada del 30)');
ok(!par.a1 || par.a1.length === 0, 'la anotada que espera no se señala por este camino (ella ya avisa con «Puede que ya haya llegado»)');
ok(Object.keys(parecidas(undefined)).length === 0 && Object.keys(parecidas({})).length === 0, 'sin datos no hay parecidas');
const tx = parecidaTexto([{ numero: 55, titular: 'Maldonado' }]);
ok(tx.includes('la N.º 55 (Maldonado)') && tx.includes('el dueño elimina la que sobra'), `el aviso nombra a la otra por su número: «${tx.slice(0, 60)}…»`);

console.log(fallas ? `\n${fallas} fallas` : '\nTodo bien');
process.exit(fallas ? 1 : 0);
