import { VAPID_PUBLICA } from './config.js';
import { pushDesuscribir, pushEstado, pushPrueba, pushSuscribir } from './checkin/checkinApi.js';
import { etiquetaDispositivo, leerSesion } from './sesion.js';

// Avisos en el celular (notificaciones push) para el personal. Se activan con un botón en cada celular (lo exigen iPhone y Android), y cada celular queda
// atado a su sesión en la base: si la sesión se cierra o vence, deja de recibir. El texto de los avisos lo manda la base (ver supabase/estadias.sql y api/push.js).
//   iPhone: hace falta iOS 16.4 o más y abrir la app desde el ícono de la pantalla de inicio (no desde Safari).

const error = (codigo) => Object.assign(new Error(codigo), { codigo });
let atadoCon = null; // la sesión con la que este celular quedó atado en esta carga (ver iniciarAvisos)

export const soportaAvisos = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const esIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const instaladaComoApp = () => !!(window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone);

// La clave pública viene en base64 «url-safe»; el navegador la pide en bytes.
const aBytes = (b64) => {
  const relleno = '='.repeat((4 - (b64.length % 4)) % 4);
  const crudo = atob((b64 + relleno).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(crudo, (c) => c.charCodeAt(0));
};
const mismaClave = (sub) => {
  const k = sub.options?.applicationServerKey;
  if (!k) return true;
  const a = new Uint8Array(k);
  const b = aBytes(VAPID_PUBLICA);
  return a.length === b.length && a.every((x, i) => x === b[i]);
};

async function registro() {
  const reg = await navigator.serviceWorker.register(new URL('sw.js', document.baseURI).href);
  await navigator.serviceWorker.ready;
  return reg;
}
export async function suscripcionActual() {
  if (!soportaAvisos()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}
async function anotarEnBase(token, sub) {
  const j = sub.toJSON();
  const r = await pushSuscribir(token, j.endpoint, j.keys?.p256dh, j.keys?.auth, etiquetaDispositivo());
  if (!r.ok) throw error(r.error);
}

// Cómo está este celular: { soportado, ios, instalada, permiso, activo, configurado }. configurado: el envío ya está conectado en el servidor.
export async function estadoAvisos() {
  const ios = esIOS();
  const instalada = instaladaComoApp();
  if (!soportaAvisos()) return { soportado: false, ios, instalada, permiso: 'no_soportado', activo: false, configurado: true };
  const permiso = Notification.permission; // default | granted | denied
  let sub = null;
  try { sub = permiso === 'granted' ? await suscripcionActual() : null; } catch { /* sin registro */ }
  let configurado = true;
  const s = leerSesion();
  if (s) { try { const r = await pushEstado(s.token, sub?.endpoint); if (r.ok) configurado = r.configurado; } catch { /* sin conexión */ } }
  return { soportado: true, ios, instalada, permiso, activo: !!sub, configurado };
}

// Lo llama el botón «Activar avisos»: tiene que ejecutarse directo al tocar (el permiso solo se puede pedir ante un toque de la persona).
export async function activarAvisos() {
  const sesion = leerSesion();
  if (!sesion) throw error('sin_sesion');
  if (!soportaAvisos()) throw error(esIOS() && !instaladaComoApp() ? 'instalar' : 'no_soportado');
  const permiso = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permiso !== 'granted') throw error('permiso_denegado');
  const reg = await registro();
  let sub = await reg.pushManager.getSubscription();
  if (sub && !mismaClave(sub)) { await sub.unsubscribe(); sub = null; } // quedó de otra clave: se rehace
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: aBytes(VAPID_PUBLICA) });
    } catch {
      throw error('no_se_pudo');
    }
  }
  await anotarEnBase(sesion.token, sub);
  atadoCon = sesion.token;
}

// «Desactivar»: se saca de la lista y se apaga la suscripción del navegador.
export async function desactivarAvisos() {
  const sesion = leerSesion();
  const sub = await suscripcionActual();
  if (sub) {
    if (sesion) { try { await pushDesuscribir(sesion.token, sub.endpoint); } catch { /* sin conexión: igual se apaga acá */ } }
    await sub.unsubscribe();
  }
}

// Al salir de la sesión: se saca este celular de la lista (el permiso del navegador queda; al volver a entrar se ata solo).
export async function apagarAlSalir(token) {
  atadoCon = null;
  const sub = await suscripcionActual();
  if (sub) await pushDesuscribir(token, sub.endpoint);
}

export async function probarAviso() {
  const sesion = leerSesion();
  const sub = await suscripcionActual();
  if (!sesion || !sub) throw error('no_activo');
  const r = await pushPrueba(sesion.token, sub.endpoint);
  if (!r.ok) throw error(r.error);
  return r;
}

// Si los avisos ya estaban activos en este celular, se vuelven a atar a la sesión de ahora. La sesión cambia cada vez que se entra con la clave (también si se
// sale y se vuelve a entrar sin cerrar la app), así que se rehace cada vez que cambia: si no, esa persona se quedaría sin avisos sin darse cuenta.
// También escucha cuando se toca un aviso y la app ya estaba abierta: el programita le dice a dónde ir.
let escuchando = false;
export function iniciarAvisos() {
  if (!soportaAvisos()) return;
  if (!escuchando) {
    escuchando = true;
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.tipo === 'abrir' && typeof e.data.url === 'string' && /^#\/[\w/-]*$/.test(e.data.url)) location.hash = e.data.url;
    });
  }
  const s = leerSesion();
  if (!s || Notification.permission !== 'granted' || atadoCon === s.token) return;
  atadoCon = s.token;
  suscripcionActual().then((sub) => { if (sub) return anotarEnBase(s.token, sub); return null; }).catch(() => { atadoCon = null; /* se reintenta la próxima vez */ });
}

export const MENSAJES_AVISOS = {
  instalar: 'En iPhone los avisos funcionan solo desde el ícono de la pantalla de inicio. Cerrá esto y abrí la app desde ese ícono.',
  no_soportado: 'Este navegador no permite avisos. Probá con Chrome, o instalá la app en la pantalla de inicio.',
  permiso_denegado: 'Los avisos están bloqueados. Para activarlos: Ajustes del celular → Notificaciones → buscá esta app y permitilas. Después volvé acá y tocá «Activar avisos».',
  no_se_pudo: 'No se pudieron activar los avisos en este celular. Probá de nuevo; si sigue igual, cerrá y volvé a abrir la app.',
  sin_sesion: 'Tenés que entrar con tu clave para activar los avisos.',
  no_activo: 'Primero activá los avisos en este celular.',
  demasiados_intentos: 'Probaste muchas veces. Esperá un minuto.',
  no_existe: 'Este celular no está registrado: tocá «Activar avisos» de nuevo.',
  sesion_requerida: 'Salí y volvé a entrar con tu clave, y probá de nuevo.'
};
