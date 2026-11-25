// Las cuentas de la pantalla «Reservas» de recepción: qué reserva va en cada pestaña, el cartel de «qué falta llegar» y los textos. Sin pantalla ni red.
//   node scripts/test-hub.mjs
import { PESTANAS, candidatasDe, cierreTexto, clasificarHub, compararNombres, controlLlegadas, diasEntre, dudaTexto, motivosTexto, parecidaTexto, parecidas, repetidas } from '../src/checkin/hub.js';

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
ok(PESTANAS.map((p) => p.texto).join() === 'Faltan llegar,Falta cerrar,Cerradas,Próximas,Historial,Repetidas,Eliminadas', 'son siete, en este orden: Faltan llegar, Falta cerrar, Cerradas, Próximas, Historial, Repetidas y Eliminadas');
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

console.log('\n== 7. Los nombres: ¿es la misma persona?');
ok(compararNombres(['Maldonado Gianfranco'], ['Gianfranco Maldonado']) === 'igual', '«Maldonado Gianfranco» y «Gianfranco Maldonado» son el mismo (cualquier orden)');
ok(compararNombres(['Juan Pérez'], ['juan PEREZ']) === 'igual' && compararNombres(['José Núñez'], ['Jose Nunez']) === 'igual', 'sin importar mayúsculas ni tildes');
ok(compararNombres(['Pérez'], ['Juan Pérez']) === 'igual', 'una sola palabra (el apellido) que está en el otro nombre, también');
ok(compararNombres(['Juan Pérez'], ['Juan Gómez']) === 'distinto' && compararNombres(['Ana Prueba'], ['Marcos Díaz']) === 'distinto', 'solo el nombre de pila en común NO alcanza: «Juan Pérez» y «Juan Gómez» son personas distintas');
ok(compararNombres(['Marcos Díaz'], ['Ana Prueba', 'Díaz Marcos']) === 'igual', 'con varios nombres (el titular y los que ingresaron) alcanza con que uno coincida');
ok(compararNombres(['Marcos Díaz'], ['Gianfranco Díaz']) === 'distinto', 'el mismo apellido con otro nombre de pila son personas distintas (hermanos, por ejemplo)');
ok(compararNombres([null], ['Ana Prueba']) === 'sin' && compararNombres([], []) === 'sin' && compararNombres(undefined, ['Ana Prueba']) === 'sin', 'si una de las dos no tiene ningún nombre, no hay con qué comparar');
ok(compararNombres(['de la Cruz'], ['Juan de la Cruz']) === 'igual' && compararNombres(['Juan de'], ['Pedro de']) === 'distinto', 'las partículas «de», «la», «del»… no cuentan como coincidencia');

console.log('\n== 8. Reservas repetidas: habitación, día y nombre');
const R = (id, hab, llegada, noches, extra = {}) => ({ id, habitacion: hab, llegada, noches, anotada_id: null, numero: 100 + id, titular: null, ingresaron: [], con_checkin: 0, ultima: `${llegada}T10:00:00Z`, ...extra });
const AN = (id, titular, hab, fecha, noches, extra = {}) => ({ id, titular, habitacion: hab, fecha_ingreso: fecha, noches, estado: 'anotada', numero: 40 + id, ...extra });
const ids2 = (ps) => ps.map((p) => p.id).sort();
// el caso del dueño: anotada «Maldonado» (ayer) y una reserva armada en la misma habitación con 2 huéspedes, uno con su nombre
let reps = repetidas({ reservas: [AN(1, 'Maldonado Gianfranco', '202', '2026-11-19', 2)], estadias: [R(10, '202', '2026-11-20', 1, { ingresaron: ['Johanna Paniagua', 'Gianfranco Maldonado'], con_checkin: 2 })] });
ok(reps.length === 1 && reps[0].nivel === 'alta' && reps[0].tipo === 'anotada-estadia' && reps[0].id === 'a1|e10', 'anotada + armada de la misma habitación, el mismo día y con el mismo nombre (aunque esté entre los que ingresaron): sugerencia segura');
ok(reps[0].a.clave === 'a1' && reps[0].b.clave === 'e10' && reps[0].motivos.nombre === 'igual' && reps[0].motivos.dia === 'mismo', 'la anotada va primero y los motivos dicen habitación, día y nombre');
ok(motivosTexto(reps[0]).map((m) => m.texto).join() === 'Misma habitación,Mismo día,Mismo nombre' && motivosTexto(reps[0]).every((m) => m.bien), 'y se pueden mostrar como etiquetas');
// el mismo caso pero la armada no tiene el nombre del titular
reps = repetidas({ reservas: [AN(1, 'Marcos Díaz', '202', '2026-11-19', 2)], estadias: [R(10, '202', '2026-11-20', 1, { ingresaron: ['Ana Prueba', 'Luis Prueba'], con_checkin: 2 })] });
ok(reps.length === 1 && reps[0].nivel === 'media' && reps[0].motivos.nombre === 'distinto', 'anotada + armada con otro nombre (el titular puede no ser quien ingresó): sugerencia posible, no segura');
reps = repetidas({ reservas: [AN(1, 'Marcos Díaz', '202', '2026-11-19', 1)], estadias: [R(10, '202', '2026-11-20', 1)] });
ok(reps.length === 1 && reps[0].motivos.dia === 'cercano' && reps[0].motivos.nombre === 'sin' && reps[0].nivel === 'media' && motivosTexto(reps[0])[1].texto === 'Días cercanos', 'una noche (el 19) y la armada del 20, sin nombres: «días cercanos» (llegan con un día de diferencia)');
reps = repetidas({ reservas: [AN(1, 'Marcos Díaz', '202', '2026-11-10', 1)], estadias: [R(10, '202', '2026-11-20', 1)] });
ok(reps.length === 0, 'diez días de diferencia: no se sospecha');
reps = repetidas({ reservas: [AN(1, 'Marcos Díaz', '203', '2026-11-20', 1)], estadias: [R(10, '202', '2026-11-20', 1)] });
ok(reps.length === 0, 'otra habitación: no');
reps = repetidas({ reservas: [AN(1, 'Marcos Díaz', '202', '2026-11-20', 1)], estadias: [R(10, '202', '2026-11-20', 1, { anotada_id: 5 })] });
ok(reps.length === 0, 'una armada que ya sale de otra anotada no es la de esta');
// dos armadas
reps = repetidas({ reservas: [], estadias: [R(10, '114', '2026-11-20', 2), R(11, '114', '2026-11-20', 2)] });
ok(reps.length === 1 && reps[0].tipo === 'estadia-estadia' && reps[0].nivel === 'media' && reps[0].motivos.nombre === 'sin', 'dos reservas rápidas vacías de la 114 el mismo día: sugerencia posible (sin nombres)');
ok(reps[0].a.id === 10 && reps[0].b.id === 11 && reps[0].conservar === 'e10', 'se propone conservar la más vieja');
reps = repetidas({ reservas: [], estadias: [R(10, '114', '2026-11-20', 2, { ingresaron: ['Ana Prueba'], con_checkin: 1 }), R(11, '114', '2026-11-20', 2, { ingresaron: ['Ana Prueba'], con_checkin: 1 })] });
ok(reps.length === 1 && reps[0].nivel === 'alta' && reps[0].motivos.nombre === 'igual', 'dos armadas con el mismo huésped: sugerencia segura');
reps = repetidas({ reservas: [], estadias: [R(10, '114', '2026-11-20', 2, { ingresaron: ['Ana Prueba'], con_checkin: 1 }), R(11, '114', '2026-11-20', 2, { ingresaron: ['Beto Gómez'], con_checkin: 1 })] });
ok(reps.length === 0, 'dos armadas con huéspedes de otro nombre NO se sospechan: son otras personas');
reps = repetidas({ reservas: [], estadias: [R(10, '114', '2026-11-20', 2), R(11, '114', '2026-11-20', 2, { ingresaron: ['Ana Prueba', 'Luis Prueba'], con_checkin: 2 })] });
ok(reps.length === 1 && reps[0].conservar === 'e11', 'una vacía y otra con huéspedes: se propone conservar la que tiene huéspedes');
reps = repetidas({ reservas: [], estadias: [R(10, '114', '2026-11-20', 2, { ingresaron: ['Ana'], con_checkin: 1 }), R(11, '114', '2026-11-20', 2, { anotada_id: 3, ingresaron: [], con_checkin: 0 })] });
ok(reps.length === 1 && reps[0].conservar === 'e11', 'si una sale de una anotada, se propone esa (la anotada no puede quedar sin su reserva)');
reps = repetidas({ reservas: [], estadias: [R(10, '401', '2026-11-20', 1), R(11, '401', '2026-11-21', 1)] });
ok(reps.length === 0, 'dos estadías seguidas de una noche cada una (20 y 21) NO se sospechan: no se pisan');
// dos anotadas
reps = repetidas({ reservas: [AN(1, 'Pérez Juan', '305', '2026-11-20', 2), AN(2, 'Juan Pérez', '305', '2026-11-21', 2)], estadias: [] });
ok(reps.length === 1 && reps[0].tipo === 'anotada-anotada' && reps[0].nivel === 'alta' && reps[0].conservar === 'a1', 'dos anotadas del mismo nombre que se pisan (20 al 22 y 21 al 23): sugerencia segura, se propone la más vieja');
reps = repetidas({ reservas: [AN(1, 'Pérez Juan', '305', '2026-11-20', 2), AN(2, 'Ana Gómez', '305', '2026-11-21', 2)], estadias: [] });
ok(reps.length === 0, 'dos anotadas de nombres distintos que se pisan: es un choque de habitación, no una repetida');
reps = repetidas({ reservas: [AN(1, 'Pérez Juan', '305', '2026-11-20', 1), AN(2, 'Juan Pérez', '305', '2026-11-21', 1)], estadias: [] });
ok(reps.length === 0, 'dos anotadas seguidas (una noche y la siguiente), aunque sea la misma persona, no se pisan: no se sospechan');
reps = repetidas({ reservas: [{ ...AN(1, 'Pérez', '305', '2026-11-20', 1), estado: 'cancelada' }, AN(2, 'Pérez', '305', '2026-11-20', 1)], estadias: [] });
ok(reps.length === 0, 'una anotada cancelada o ya empezada no cuenta');
// orden y descartadas
reps = repetidas({ reservas: [], estadias: [R(10, '114', '2026-11-20', 2), R(11, '114', '2026-11-20', 2), R(20, '500', '2026-11-22', 1, { ingresaron: ['Ana Prueba'], con_checkin: 1 }), R(21, '500', '2026-11-22', 1, { ingresaron: ['Ana Prueba'], con_checkin: 1 })] });
ok(reps.map((p) => p.nivel).join() === 'alta,media', 'las seguras van primero');
ok(repetidas({ reservas: [], estadias: [R(10, '114', '2026-11-20', 2), R(11, '114', '2026-11-20', 2)], descartadas: ['e10|e11'] }).length === 0 && repetidas({ reservas: [], estadias: [R(10, '114', '2026-11-20', 2), R(11, '114', '2026-11-20', 2)], descartadas: ['e11|e10'] }).length === 0, 'las que el dueño descartó («no son la misma») no vuelven a aparecer, en el orden que vengan');
ok(repetidas({ reservas: [], estadias: [R(10, '114', '2026-11-20', 2), R(11, '114', '2026-11-20', 2)], descartadas: ['e10|e99'] }).length === 1, 'descartar otra pareja no afecta a esta');
ok(repetidas(undefined).length === 0 && repetidas({}).length === 0, 'sin datos no hay nada');

console.log('\n== 9. Dónde se ve: pestaña, filas y el detalle de una anotada');
const dd = { hoy: '2026-11-20', reservas: [AN(1, 'Maldonado Gianfranco', '202', '2026-11-19', 2), AN(3, 'Sola', '999', '2026-11-20', 1)], estadias: [R(10, '202', '2026-11-20', 1, { ingresaron: ['Gianfranco Maldonado'], con_checkin: 1, estado: 'faltan' }), R(11, '114', '2026-11-20', 2, { estado: 'sin_ingresos' }), R(12, '114', '2026-11-20', 2, { estado: 'sin_ingresos' })] };
const hub = clasificarHub(dd);
ok(hub.repetidas.length === 2 && hub.conteo.repetidas === 2, 'la pestaña «Repetidas» tiene las 2 parejas y su cantidad');
ok(clasificarHub(dd, 'maldonado').repetidas.length === 1 && clasificarHub(dd, '114').repetidas.length === 1 && clasificarHub(dd, 'zzz').repetidas.length === 0, 'el buscador las filtra (por nombre, habitación o número)');
const mapa = parecidas(dd);
ok(Object.keys(mapa).sort().join() === 'a1,e10,e11,e12' && mapa.e11.map((x) => x.id).join() === '12' && mapa.a1[0].id === 10, 'cada fila sabe con cuál se parece (las dos de la 114 entre sí; la anotada con la armada y al revés)');
ok(JSON.stringify(candidatasDe(dd.reservas[0], hub.repetidas).map((e) => e.id)) === '[10]' && candidatasDe(dd.reservas[1], hub.repetidas).length === 0, 'al abrir la anotada, las candidatas son las reservas armadas que se le parecen (y una sola sin parecidas no tiene)');
ok(dudaTexto([{ con_checkin: 2, numero: 55 }], '202') === 'Puede que ya haya llegado: en la Hab. 202 hay una reserva (N.º 55) con 2 huéspedes ingresados.', 'el aviso de la anotada nombra a la otra por su número y dice cuántos ingresaron');
ok(dudaTexto([{ con_checkin: 1 }], '7') === 'Puede que ya haya llegado: en la Hab. 7 hay una reserva con 1 huésped ingresado.' && dudaTexto([{ con_checkin: 0 }], '7').includes('con el código dado'), 'con uno, sin número, o sin huéspedes todavía');
const tx = parecidaTexto([{ numero: 55, titular: 'Maldonado' }]);
ok(tx.includes('la N.º 55 (Maldonado)') && tx.includes('Mirala en «Repetidas»'), 'el aviso de la fila nombra a la otra por su número y manda a «Repetidas»');
ok(motivosTexto({ motivos: { dia: 'mismo', nombre: 'sin' } })[2].texto === 'Sin nombre para comparar' && motivosTexto({ motivos: { dia: 'mismo', nombre: 'distinto' } })[2].bien === false, 'las etiquetas dicen cuándo el nombre no coincide o no se puede comparar');

console.log('\n== 10. Número de reserva y eliminadas');
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

console.log(fallas ? `\n${fallas} fallas` : '\nTodo bien');
process.exit(fallas ? 1 : 0);
