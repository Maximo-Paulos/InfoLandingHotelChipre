// El buscador y la agrupación de «Próximas reservas» de recepción (cuentas puras, sin pantalla ni red).
//   node scripts/test-buscar.mjs
import { agruparPorDia, filtrarProximas, normalizar } from '../src/checkin/proximas.js';

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

console.log(fallas ? `\n${fallas} fallas` : '\nTodo bien');
process.exit(fallas ? 1 : 0);
