// Las cuentas del check-in a mano que no necesitan base: la marca, qué datos faltan, el nombre, las estadísticas de «qué datos dejan» y que «Sin nombre» no se tome como nombre al buscar repetidas.
//   node scripts/test-mano.mjs
import { compararNombres } from '../src/checkin/hub.js';
import { esMano, faltantes, marcaMano, nombreCompleto } from '../src/checkin/mano.js';
import { calcular, datosQueDejan } from '../src/admin/estadisticas.js';

let fallas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK    ' : 'FALLA '}${m}`); if (!c) fallas += 1; };

console.log('\n== 1. La marca «a mano»');
ok(esMano({ origen: 'manual' }) && !esMano({ origen: 'huesped' }) && !esMano({}) && !esMano(null), 'solo el origen «manual» es a mano (y nada falla con datos vacíos)');
ok(marcaMano({ origen: 'manual', cargado_por: 'Maxi' }) === 'A mano · Maxi', 'dice «A mano · quién lo cargó»');
ok(marcaMano({ origen: 'manual' }) === 'A mano' && marcaMano({ origen: 'huesped', cargado_por: 'x' }) === '', 'sin quién, solo «A mano»; un check-in del huésped no lleva marca');

console.log('\n== 2. Qué datos le faltan');
ok(faltantes({}).length === 9 && faltantes(null).length === 9, 'sin nada, faltan los 9 datos');
ok(faltantes({ nombre: 'Ana', apellido: 'Paz', email: 'ana@correo.com', telefono: '+5491155551234', doc_numero: '30111222', nacionalidad: 'Argentina', localidad: 'Rosario', domicilio: 'Calle 1', anio_nac: 1980 }).length === 0, 'con todo, no falta nada');
ok(faltantes({ nombre: 'Ana', email: '  ', telefono: '' }).join() === 'apellido,mail,teléfono,documento,nacionalidad,localidad,domicilio,año de nacimiento', 'un texto vacío o con espacios cuenta como que falta, y se nombra en castellano');

console.log('\n== 3. El nombre que se ve');
ok(nombreCompleto({ datos: { nombre: 'Ana', apellido: 'Paz' } }) === 'Paz, Ana', 'apellido, nombre');
ok(nombreCompleto({ datos: { nombre: 'Ana' } }) === 'Ana' && nombreCompleto({ datos: { apellido: 'Paz' } }) === 'Paz', 'con solo uno de los dos, ese');
ok(nombreCompleto({ datos: {} }) === 'Sin nombre' && nombreCompleto({}) === 'Sin nombre' && nombreCompleto(null) === 'Sin nombre', 'sin ninguno, «Sin nombre» (nunca vacío ni «, »)');

console.log('\n== 4. «Sin nombre» no sirve para decir que dos reservas son la misma');
ok(compararNombres(['Sin nombre'], ['Sin nombre']) === 'sin', 'dos huéspedes sin nombre no son «el mismo nombre»: no hay nada para comparar');
ok(compararNombres(['Perez Juan', 'Sin nombre'], ['Juan Perez']) === 'igual', 'pero los que sí tienen nombre se siguen comparando');
ok(compararNombres(['Perez Juan'], ['Gomez Luis', 'Sin nombre']) === 'distinto', 'y los distintos siguen siendo distintos');

console.log('\n== 5. Estadísticas: qué datos dejan');
const H = (id, a_mano, extra = {}) => ({ id, fecha: '2026-11-10', hora: 10, a_mano, estadia_id: null, visitas: 1, con_nombre: true, con_documento: true, con_email: true, con_telefono: true, con_domicilio: true, nacionalidad: 'Argentina', anio_nac: 1980, localidad: 'Rosario', doc_tipo: 'DNI', ...extra });
const huespedes = [
  H(1, false), H(2, false), H(3, false, { con_email: false }), H(4, false),
  H(5, true, { con_email: false, con_telefono: false, con_domicilio: false, nacionalidad: null, anio_nac: null, localidad: null }),
  H(6, true, { con_nombre: false, con_documento: false, con_email: false, con_telefono: true, con_domicilio: false, nacionalidad: null, anio_nac: null, localidad: null, doc_tipo: null })
];
const d = datosQueDejan(huespedes);
const fila = (c) => d.filas.find((f) => f.campo === c);
ok(d.total === 6 && d.aMano === 2 && d.propios === 4 && Math.round(d.pctAMano) === 33, 'cuenta cuántos son, cuántos a mano y qué porcentaje');
ok(Math.round(fila('con_email').todos) === 50 && Math.round(fila('con_email').propios) === 75 && fila('con_email').mano === 0, 'mail: 3 de 6 en total, 3 de 4 de los que hicieron el check-in y 0 de los 2 a mano');
ok(Math.round(fila('con_telefono').todos) === 83 && Math.round(fila('con_telefono').mano) === 50, 'teléfono: 5 de 6 en total y 1 de 2 de los a mano');
ok(Math.round(fila('con_documento').todos) === 83 && fila('con_documento').propios === 100 && Math.round(fila('con_documento').mano) === 50, 'documento: 5 de 6 en total, todos los que hicieron el check-in y 1 de los 2 a mano');
ok(Math.round(fila('nacionalidad').todos) === 67 && fila('nacionalidad').mano === 0, 'nacionalidad: los a mano sin ese dato no se cuentan como argentinos ni como extranjeros');
ok(datosQueDejan([]).total === 0 && datosQueDejan([]).pctAMano === null && datosQueDejan([]).filas.every((f) => f.todos === null), 'sin huéspedes no hay porcentajes (se ve «—», no 0% ni un error)');
const solos = datosQueDejan(huespedes.filter((h) => !h.a_mano));
ok(solos.aMano === 0 && solos.filas.every((f) => f.mano === null), 'si nadie se cargó a mano, esa columna queda vacía');

const rango = { desde: '2026-11-01', hasta: '2026-11-30' };
const r = calcular({ reservas: [], huespedes }, null, rango);
ok(r.datos.total === 6 && r.datos.aMano === 2, 'las estadísticas del período traen lo mismo');
ok(r.paises.some((p) => p.texto === 'Sin dato' && p.n === 2), 'los que no tienen nacionalidad figuran como «Sin dato» en países, sin cambiar a los demás');
ok(Math.round(r.pctExtranjeros) === 0 && r.edadesN === 4, 'y no entran en extranjeros ni en edades (sin año de nacimiento no hay edad)');

if (fallas) { console.log(`\n${fallas} FALLA(S)`); process.exit(1); }
console.log('\nTodo bien.');
