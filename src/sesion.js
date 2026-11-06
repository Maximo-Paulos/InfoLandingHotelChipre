import { rpc } from './data/api.js';

// El ingreso del personal (dueño, codueño y recepción): se escribe la clave una vez y el celular recibe un código de dispositivo
// (sd_…) que vale 60 días de uso. Ese código es lo que se guarda en el teléfono; la clave nunca se guarda en ningún lado.
// Se puede cerrar desde "Salir" o desde el panel del dueño (Dispositivos con sesión abierta).
const LLAVE = 'chipre-sesion';
let enMemoria = null; // si el navegador no deja guardar (ventana privada), vale mientras la pestaña siga abierta

export function leerSesion() {
  try {
    const s = JSON.parse(localStorage.getItem(LLAVE) ?? 'null');
    if (s?.token && s?.rol) return s;
  } catch { /* sin almacenamiento */ }
  return enMemoria;
}
function guardarSesion(s) {
  enMemoria = s;
  try { localStorage.setItem(LLAVE, JSON.stringify(s)); } catch { /* sin almacenamiento */ }
}
export function borrarSesion() {
  enMemoria = null;
  try { localStorage.removeItem(LLAVE); } catch { /* sin almacenamiento */ }
}

// "iPhone · Safari", "Android · Chrome (app)": para reconocer el dispositivo en la lista del dueño.
export function etiquetaDispositivo() {
  const ua = navigator.userAgent;
  const so = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Dispositivo';
  const nav = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\/|FxiOS/.test(ua) ? 'Firefox' : /Chrome\/|CriOS/.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  const app = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone ? ' (app)' : '';
  return `${so}${nav ? ` · ${nav}` : ''}${app}`;
}

// Cambia la clave por un código de dispositivo y lo guarda. Devuelve { token, rol } o lanza un error con `codigo`.
export async function entrarConClave(clave) {
  const r = await rpc('sesion_entrar', { p_clave: clave, p_etiqueta: etiquetaDispositivo() });
  if (!r.ok) throw Object.assign(new Error(r.error), { codigo: r.error });
  const s = { token: r.token, rol: r.rol };
  guardarSesion(s);
  return s;
}

// Cierra la sesión de este dispositivo (en la base queda marcada como cerrada, no se borra).
export async function cerrarSesion() {
  const s = leerSesion();
  borrarSesion();
  if (s) { try { await rpc('sesion_cerrar', { p_token: s.token }); } catch { /* sin conexión: igual se cerró acá */ } }
}

export const estadoSesion = (token) => rpc('sesion_estado', { p_token: token });
export const adminSesiones = (clave) => rpc('admin_sesiones', { p_clave: clave });
export const adminSesionCerrar = (clave, id = null) => rpc('admin_sesion_cerrar', { p_clave: clave, p_id: id });
