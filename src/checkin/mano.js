// Check-in cargado A MANO por el dueño: cuentas puras (sin pantalla ni red) para marcarlo y decir qué datos le faltan. Se prueban con node.
//   Un huésped cargado a mano trae origen = 'manual' y cargado_por (quién lo cargó); ningún dato es obligatorio, así que cualquier campo puede faltar.

export const esMano = (f) => f?.origen === 'manual';

// Lo que se le pide a un huésped (clave del dato, cómo se nombra al decir que falta).
const DATOS = [['nombre', 'nombre'], ['apellido', 'apellido'], ['email', 'mail'], ['telefono', 'teléfono'], ['doc_numero', 'documento'], ['nacionalidad', 'nacionalidad'], ['localidad', 'localidad'], ['domicilio', 'domicilio'], ['anio_nac', 'año de nacimiento']];

// Qué datos no tiene: ['mail', 'teléfono', …]. Un número 0 o un texto vacío o solo con espacios cuenta como que falta.
export const faltantes = (datos) => DATOS.filter(([k]) => datos?.[k] == null || String(datos[k]).trim() === '').map(([, t]) => t);

// La marca que se ve en las listas: «A mano» o «A mano · Maxi».
export const marcaMano = (f) => (esMano(f) ? `A mano${f.cargado_por ? ` · ${f.cargado_por}` : ''}` : '');

// El nombre para mostrar: «Apellido, Nombre», o «Sin nombre» si no se cargó ninguno.
export const nombreCompleto = (f) => `${f?.datos?.apellido ?? ''}, ${f?.datos?.nombre ?? ''}`.replace(/^, |, $/g, '').trim() || 'Sin nombre';
