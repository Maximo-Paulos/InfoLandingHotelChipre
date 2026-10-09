import { ORDEN, TIPOS_DOC, listaPaises } from './campos.js';
import { revisarTelefono } from './telefono.js';

// Mismas reglas que la base (supabase/checkin.sql): acá se avisa campo por campo, allá se vuelve a revisar.
const espacios = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const NOMBRE = /^\p{L}[\p{L} .'-]{1,59}$/u;
const SIN_CONTROL = /^[\p{L}\p{N}][^\p{C}<>]*$/u;

export const MENSAJES = {
  nombre: 'Escribí tu nombre (solo letras, entre 2 y 60).',
  apellido: 'Escribí tu apellido (solo letras, entre 2 y 60).',
  email: 'Escribí un email válido, por ejemplo nombre@correo.com.',
  telefono: 'Ese teléfono no parece válido. Elegí el país y escribí el número completo.',
  nacionalidad: 'Elegí tu nacionalidad.',
  localidad: 'Escribí tu localidad (entre 2 y 80 caracteres).',
  domicilio: 'Escribí tu domicilio: calle y número (entre 5 y 120 caracteres).',
  doc_tipo: 'Elegí si es DNI o pasaporte.',
  doc_numero_DNI: 'El DNI tiene 7 u 8 números, sin letras.',
  doc_numero_Pasaporte: 'El pasaporte tiene entre 6 y 12 letras o números.',
  habitacion: 'La habitación puede tener hasta 12 letras o números.',
  datos: 'Revisá los datos.'
};

export const mensajeDe = (campo, tipoDoc) => (campo === 'doc_numero' ? MENSAJES[`doc_numero_${tipoDoc}`] ?? MENSAJES.doc_numero_DNI : MENSAJES[campo] ?? MENSAJES.datos);

// Revisa los valores del formulario. `lib` es la librería de teléfonos ya cargada.
// Devuelve { errores: { campo: mensaje }, datos } (datos solo si no hay errores).
export function validarHuesped(v, lib, { conHabitacion = false } = {}) {
  const errores = {};
  const nombre = espacios(v.nombre);
  const apellido = espacios(v.apellido);
  const email = String(v.email ?? '').trim().toLowerCase();
  const nac = espacios(v.nacionalidad);
  const loc = espacios(v.localidad);
  const dom = espacios(v.domicilio);
  const tipo = String(v.doc_tipo ?? '').trim();
  let num = String(v.doc_numero ?? '').trim();

  if (!NOMBRE.test(nombre)) errores.nombre = MENSAJES.nombre;
  if (!NOMBRE.test(apellido)) errores.apellido = MENSAJES.apellido;
  if (email.length > 120 || !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) errores.email = MENSAJES.email;

  const tel = lib ? revisarTelefono(lib, v.telefonoPais, v.telefonoNumero) : { ok: false };
  if (!tel.ok) errores.telefono = MENSAJES.telefono;

  if (!nac || !listaPaises().some((p) => p.nombre === nac)) errores.nacionalidad = MENSAJES.nacionalidad;
  if (loc.length < 2 || loc.length > 80 || !SIN_CONTROL.test(loc)) errores.localidad = MENSAJES.localidad;
  if (dom.length < 5 || dom.length > 120 || !SIN_CONTROL.test(dom)) errores.domicilio = MENSAJES.domicilio;

  if (!TIPOS_DOC.includes(tipo)) {
    errores.doc_tipo = MENSAJES.doc_tipo;
  } else if (tipo === 'DNI') {
    num = num.replace(/[\s.-]/g, '');
    if (!/^[0-9]{7,8}$/.test(num)) errores.doc_numero = MENSAJES.doc_numero_DNI;
  } else {
    num = num.replace(/[\s-]/g, '').toUpperCase();
    if (!/^[A-Z0-9]{6,12}$/.test(num)) errores.doc_numero = MENSAJES.doc_numero_Pasaporte;
  }

  let habitacion = null;
  if (conHabitacion) {
    const h = espacios(v.habitacion);
    if (h) {
      if (!/^[\p{L}\p{N}][\p{L}\p{N} ._/-]{0,11}$/u.test(h)) errores.habitacion = MENSAJES.habitacion;
      else habitacion = h;
    }
  }

  if (Object.keys(errores).length) return { errores, datos: null, habitacion: null };
  return {
    errores,
    habitacion,
    datos: { nombre, apellido, email, telefono: tel.numero, nacionalidad: nac, localidad: loc, domicilio: dom, doc_tipo: tipo, doc_numero: num }
  };
}

// El primer campo con error según el orden del formulario.
export const primerError = (errores) => ORDEN.find((c) => errores[c]) ?? Object.keys(errores)[0];

// De lo que guarda la base a lo que muestra el formulario de edición.
export function valoresDesdeDatos(d, habitacion = '') {
  return {
    nombre: d.nombre ?? '', apellido: d.apellido ?? '', email: d.email ?? '',
    telefonoPais: 'AR', telefonoNumero: d.telefono ?? '',
    nacionalidad: d.nacionalidad ?? '', localidad: d.localidad ?? '', domicilio: d.domicilio ?? '',
    doc_tipo: d.doc_tipo ?? 'DNI', doc_numero: d.doc_numero ?? '', habitacion: habitacion ?? ''
  };
}
