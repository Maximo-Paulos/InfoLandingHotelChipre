import { SUPABASE_KEY, SUPABASE_URL } from '../config.js';

// La guía habla directo con Supabase:
//   - leer el contenido es público (una fila de la tabla `contenido`)
//   - guardar y cambiar la clave pasan por funciones de la base que exigen la clave del dueño

// Tope de espera: si la red se traba, se corta y se avisa en vez de quedar esperando.
const TOPE_MS = 30000;

const cabeceras = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };

export const MENSAJES = {
  clave_incorrecta: 'Clave incorrecta.',
  demasiados_intentos: 'Demasiados intentos. Esperá un minuto.',
  contenido_invalido: 'El contenido no tiene el formato esperado.',
  clave_corta: 'La clave nueva debe tener al menos 10 caracteres.'
};

// Convierte cualquier error en un texto para mostrar.
export function textoError(e) {
  if (e?.codigo) return MENSAJES[e.codigo] || e.codigo;
  return 'No se pudo conectar con la base de datos. Revisá tu conexión.';
}

async function rpc(nombre, cuerpo) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${nombre}`, {
    method: 'POST', headers: cabeceras, body: JSON.stringify(cuerpo), cache: 'no-store', signal: AbortSignal.timeout(TOPE_MS)
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export async function leerContenido(signal) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/contenido?id=eq.1&select=data,actualizado`, {
    headers: { apikey: SUPABASE_KEY }, signal: signal ?? AbortSignal.timeout(TOPE_MS), cache: 'no-store'
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const filas = await r.json();
  if (!filas.length) throw new Error('Todavía no hay contenido guardado');
  return { contenido: filas[0].data, actualizado: filas[0].actualizado };
}

// Las tres devuelven { ok, error?, ... }
export const verificarClave = (clave) => rpc('verificar_clave', { p_clave: clave });
export const guardarContenido = (clave, data) => rpc('guardar_contenido', { p_clave: clave, p_data: data });
export const cambiarClave = (actual, nueva) => rpc('cambiar_clave', { p_actual: actual, p_nueva: nueva });
