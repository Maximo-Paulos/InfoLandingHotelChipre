import { rpc } from '../data/api.js';

// Todo pasa por funciones de la base que revisan quién llama (ver supabase/checkin.sql).
// Cada una devuelve { ok, error?, ... }.

// Huésped
export const estadoCheckin = () => rpc('checkin_estado', {});
export const canjearCodigo = (codigo) => rpc('checkin_canjear', { p_codigo: codigo });
export const sesionCheckin = (token) => rpc('checkin_sesion', { p_token: token });
export const enviarCheckin = (token, datos, idioma, acepta) =>
  rpc('checkin_enviar', { p_token: token, p_datos: datos, p_idioma: idioma, p_acepta: acepta });

// Recepción
export const recepcionEntrar = (clave) => rpc('recepcion_entrar', { p_clave: clave });
export const recepcionEstado = (clave) => rpc('recepcion_estado', { p_clave: clave });
export const recepcionCodigoNuevo = (clave) => rpc('recepcion_codigo_nuevo', { p_clave: clave });
export const recepcionEditar = (clave, id, datos, habitacion) =>
  rpc('recepcion_editar', { p_clave: clave, p_id: id, p_datos: datos, p_habitacion: habitacion || null });

// Admin general
export const adminConfig = (clave) => rpc('admin_checkin_config', { p_clave: clave });
export const adminConfigGuardar = (clave, config) => rpc('admin_checkin_config_guardar', { p_clave: clave, p_config: config });
export const adminClaveRecepcion = (clave, nueva) => rpc('admin_checkin_clave_recepcion', { p_clave: clave, p_nueva: nueva });
export const adminHuespedes = (clave, buscar, limite = 50, antes = null) =>
  rpc('admin_huespedes', { p_clave: clave, p_buscar: buscar || null, p_limite: limite, p_antes: antes });
export const adminHuespedEditar = (clave, id, datos, habitacion) =>
  rpc('admin_huesped_editar', { p_clave: clave, p_id: id, p_datos: datos, p_habitacion: habitacion || null });
export const adminAuditoria = (clave, limite = 40) => rpc('admin_checkin_auditoria', { p_clave: clave, p_limite: limite });

export const MENSAJES = {
  clave_incorrecta: 'Clave incorrecta.',
  demasiados_intentos: 'Demasiados intentos. Esperá un minuto y probá de nuevo.',
  no_disponible: 'El check-in digital está apagado.',
  sesion_invalida: 'La sesión venció.',
  datos_invalidos: 'Hay datos que no son válidos. Revisalos.',
  habitacion_invalida: 'La habitación puede tener hasta 12 letras o números.',
  fuera_de_tiempo: 'Ya pasó el tiempo para editar este huésped. Pedile al administrador que lo corrija.',
  no_existe: 'Ese huésped ya no está en la lista. Actualizá la pantalla.',
  clave_corta: 'La clave nueva debe tener al menos 8 caracteres.',
  config_invalida: 'Algún valor de la configuración no es válido.',
  consentimiento: 'Tenés que aceptar para poder enviar.',
  foto_requerida: 'Falta la foto del documento.'
};

export const textoError = (e) => (e?.codigo ? MENSAJES[e.codigo] ?? e.codigo : 'No se pudo conectar. Revisá tu conexión e intentá de nuevo.');
export const textoCodigo = (codigo) => MENSAJES[codigo] ?? 'No se pudo completar. Intentá de nuevo.';
