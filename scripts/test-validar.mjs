// Prueba las reglas del formulario de check-in (sin navegador). Uso: node scripts/test-validar.mjs
import * as lib from 'libphonenumber-js/max';
import { mensajeDe, validarHuesped, valoresDesdeDatos } from '../src/checkin/validar.js';
import { listaPaises, isoDeNombre, TIPOS_BASE, TIPOS_DOC } from '../src/checkin/campos.js';
import { revisarTelefono } from '../src/checkin/telefono.js';

let fallas = 0;
const ok = (c, m) => { console.log((c ? 'OK    ' : 'FALLA ') + m); if (!c) fallas += 1; };

const base = {
  nombre: 'Ana María', apellido: 'Pérez-García', email: ' ANA@Correo.com ', telefonoPais: 'AR', telefonoNumero: '011 15 5555-1234',
  nacionalidad: 'Argentina', localidad: 'Capital Federal', domicilio: 'Av. Corrientes 1234 5° B', doc_tipo: 'DNI', doc_numero: '30.123.456'
};
const con = (cambios, opc) => validarHuesped({ ...base, ...cambios }, lib, opc);

let r = con({});
ok(Object.keys(r.errores).length === 0, 'datos completos y correctos');
ok(r.datos?.telefono === '+5491155551234' && r.datos?.email === 'ana@correo.com' && r.datos?.doc_numero === '30123456', 'se normalizan teléfono, email y DNI');

ok(con({ nombre: 'A' }).errores.nombre, 'nombre muy corto');
ok(con({ nombre: 'Ana3' }).errores.nombre, 'nombre con número');
ok(con({ apellido: '' }).errores.apellido, 'apellido vacío');
ok(!con({ nombre: "D'Angelo", apellido: 'de la Cruz Jr.' }).errores.nombre, 'apóstrofe y puntos permitidos');
ok(con({ email: 'sin-arroba' }).errores.email, 'email sin @');
ok(con({ email: 'a@b' }).errores.email, 'email sin dominio');
ok(con({ telefonoNumero: '12345' }).errores.telefono, 'teléfono muy corto');
ok(con({ telefonoNumero: 'abcdefgh' }).errores.telefono, 'teléfono con letras');
ok(con({ telefonoNumero: '' }).errores.telefono, 'teléfono vacío');
ok(!con({ telefonoPais: 'BR', telefonoNumero: '11 98765-4321' }).errores.telefono, 'teléfono de Brasil válido');
ok(!con({ telefonoPais: 'AR', telefonoNumero: '+1 415 555 2671' }).errores.telefono, 'con "+" manda el país del número, no el elegido');
ok(con({ telefonoPais: 'AR', telefonoNumero: '+54 9 11 5555 12' }).errores.telefono, 'teléfono argentino incompleto');
ok(con({ nacionalidad: '' }).errores.nacionalidad, 'sin nacionalidad');
ok(con({ nacionalidad: 'Narnia' }).errores.nacionalidad, 'nacionalidad que no está en la lista');
ok(con({ localidad: 'B' }).errores.localidad, 'localidad muy corta');
ok(con({ domicilio: 'abc' }).errores.domicilio, 'domicilio muy corto');
ok(con({ doc_numero: '123' }).errores.doc_numero, 'DNI muy corto');
ok(con({ doc_numero: '1234567A' }).errores.doc_numero, 'DNI con letras');
ok(!con({ doc_numero: '12.345.678' }).errores.doc_numero, 'DNI con puntos');
r = con({ doc_tipo: 'Pasaporte', doc_numero: 'aa 123456' });
ok(!r.errores.doc_numero && r.datos.doc_numero === 'AA123456', 'pasaporte en mayúsculas y sin espacios');
ok(con({ doc_tipo: 'Pasaporte', doc_numero: 'A1' }).errores.doc_numero, 'pasaporte muy corto');
ok(con({ doc_tipo: 'Cédula' }).errores.doc_tipo, 'tipo de documento inválido');
ok(con({ doc_tipo: 'Cédula' }).errores.doc_tipo === 'Elegí el tipo de documento.', 'y el mensaje no habla solo de DNI y pasaporte');
// «Identificación»: cédula, RG, carnet de conducir u otro documento (cada país lo escribe distinto)
r = con({ doc_tipo: 'Identificación', doc_numero: '12.345.678-9' });
ok(!r.errores.doc_numero && r.datos.doc_tipo === 'Identificación' && r.datos.doc_numero === '123456789', 'identificación: se sacan los puntos y el guion');
r = con({ doc_tipo: 'Identificación', doc_numero: ' mg-12.345/678 ' });
ok(!r.errores.doc_numero && r.datos.doc_numero === 'MG12345678', 'identificación: letras en mayúsculas, sin espacios, guiones ni barras');
ok(!con({ doc_tipo: 'Identificación', doc_numero: '1234' }).errores.doc_numero, 'identificación: 4 caracteres alcanzan');
ok(!con({ doc_tipo: 'Identificación', doc_numero: '1'.repeat(20) }).errores.doc_numero, 'identificación: hasta 20');
ok(con({ doc_tipo: 'Identificación', doc_numero: '12-3' }).errores.doc_numero === 'El número de la identificación tiene entre 4 y 20 letras o números.', 'identificación: muy corta (con su propio mensaje)');
ok(con({ doc_tipo: 'Identificación', doc_numero: '1'.repeat(21) }).errores.doc_numero, 'identificación: muy larga');
ok(con({ doc_tipo: 'Identificación', doc_numero: '12345$' }).errores.doc_numero, 'identificación: con símbolos');
ok(con({ doc_tipo: 'Identificación', doc_numero: '' }).errores.doc_numero, 'identificación: vacía');
ok(mensajeDe('doc_numero', 'Identificación') !== mensajeDe('doc_numero', 'DNI') && mensajeDe('doc_numero', 'Pasaporte') !== mensajeDe('doc_numero', 'DNI'), 'cada tipo tiene su mensaje de número');
ok(TIPOS_DOC.join() === 'DNI,Pasaporte,Identificación' && TIPOS_BASE.join() === 'DNI,Pasaporte', 'los tipos: tres en total, y DNI y pasaporte son los de siempre');
ok(valoresDesdeDatos({ doc_tipo: 'Identificación', doc_numero: 'X1234' }).doc_tipo === 'Identificación', 'al editar a alguien con identificación, el formulario la trae');
ok(con({ habitacion: '<b>' }, { conHabitacion: true }).errores.habitacion, 'habitación inválida');
r = con({ habitacion: ' 101 ' }, { conHabitacion: true });
ok(!r.errores.habitacion && r.habitacion === '101', 'habitación válida y limpia');
r = con({ habitacion: '' }, { conHabitacion: true });
ok(!r.errores.habitacion && r.habitacion === null, 'habitación vacía permitida');

const paises = listaPaises();
ok(paises.length > 200 && paises[0].nombre === 'Argentina' && paises[1].nombre === 'Brasil', 'lista de países: Argentina y Brasil primero (' + paises.length + ')');
ok(isoDeNombre('Uruguay') === 'UY', 'de nombre de país a código');
ok(revisarTelefono(lib, 'AR', '11 5555-1234').ok, 'teléfono fijo de Buenos Aires');

if (fallas) { console.log(`\n${fallas} falla(s)`); process.exit(1); }
console.log('\nTodo bien');
