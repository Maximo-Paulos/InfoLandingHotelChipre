import { rpc } from '../data/api.js';
import { TIPOS_BASE, TIPOS_DOC } from './campos.js';

// Todo pasa por funciones de la base que revisan quién llama (ver supabase/checkin.sql).
// Cada una devuelve { ok, error?, ... }.

// Los tipos de documento que acepta la base. Una base sin migrar (sin supabase/documentos.sql) no lo informa: se ofrecen DNI y pasaporte.
// Se recuerdan unos minutos para no consultar en cada formulario; si no se pudo consultar, no se recuerda nada y se prueba de nuevo después.
const VIGENCIA_TIPOS_MS = 5 * 60 * 1000;
let tiposRecordados = null; // { lista, en }
const tiposDeEstado = (e) => {
  const lista = Array.isArray(e?.tipos_doc) ? TIPOS_DOC.filter((t) => e.tipos_doc.includes(t)) : [];
  return lista.length ? lista : TIPOS_BASE;
};
export const tiposConocidos = () => tiposRecordados?.lista ?? TIPOS_BASE;

// Huésped
export const estadoCheckin = async () => {
  const e = await rpc('checkin_estado', {});
  tiposRecordados = { lista: tiposDeEstado(e), en: Date.now() };
  return e;
};
export const tiposDocumento = async () => {
  if (tiposRecordados && Date.now() - tiposRecordados.en < VIGENCIA_TIPOS_MS) return tiposRecordados.lista;
  try { await estadoCheckin(); } catch { /* sin conexión: se sigue con lo último que se supo, o con DNI y pasaporte */ }
  return tiposConocidos();
};
export const canjearCodigo = (codigo) => rpc('checkin_canjear', { p_codigo: codigo });
export const sesionCheckin = (token) => rpc('checkin_sesion', { p_token: token });
export const enviarCheckin = (token, datos, idioma, acepta) =>
  rpc('checkin_enviar', { p_token: token, p_datos: datos, p_idioma: idioma, p_acepta: acepta });

// Recepción
export const recepcionEntrar = (clave) => rpc('recepcion_entrar', { p_clave: clave });
export const recepcionEstado = (clave) => rpc('recepcion_estado', { p_clave: clave });
export const recepcionCodigoNuevo = (clave) => rpc('recepcion_codigo_nuevo', { p_clave: clave });
// El medio de pago (el id) viaja dentro de los datos; si no se manda, la base deja el que ya tenía.
const conMedio = (datos, medioPago) => (medioPago ? { ...datos, medio_pago: medioPago } : datos);
export const recepcionEditar = (clave, id, datos, habitacion, medioPago) =>
  rpc('recepcion_editar', { p_clave: clave, p_id: id, p_datos: conMedio(datos, medioPago), p_habitacion: habitacion || null });

// Admin general
export const adminConfig = (clave) => rpc('admin_checkin_config', { p_clave: clave });
export const adminConfigGuardar = (clave, config) => rpc('admin_checkin_config_guardar', { p_clave: clave, p_config: config });
export const adminClaveRecepcion = (clave, nueva) => rpc('admin_checkin_clave_recepcion', { p_clave: clave, p_nueva: nueva });
export const adminHuespedes = (clave, buscar, limite = 50, antes = null) =>
  rpc('admin_huespedes', { p_clave: clave, p_buscar: buscar || null, p_limite: limite, p_antes: antes });
export const adminHuespedEditar = (clave, id, datos, habitacion, medioPago) =>
  rpc('admin_huesped_editar', { p_clave: clave, p_id: id, p_datos: conMedio(datos, medioPago), p_habitacion: habitacion || null });
// Medios de pago que elige recepción: el dueño los ve todos (también los quitados) y guarda la lista completa.
export const adminMediosPago = (clave) => rpc('admin_medios_pago', { p_clave: clave });
export const adminMediosPagoGuardar = (clave, lista) => rpc('admin_medios_pago_guardar', { p_clave: clave, p_lista: lista });
export const adminAuditoria = (clave, limite = 40) => rpc('admin_checkin_auditoria', { p_clave: clave, p_limite: limite });
// Fotos del documento: el dueño ve todas las de un huésped (también las quitadas), pide permiso para subir una y quita o vuelve a poner.
// Quitar nunca borra: la foto sigue en Drive y en la base.
export const adminFotos = (clave, id) => rpc('admin_fotos', { p_clave: clave, p_id: id });
export const adminFotoPermiso = (clave, id) => rpc('admin_foto_permiso', { p_clave: clave, p_id: id });
export const adminFotoQuitar = (clave, fotoId, quitar = true) => rpc('admin_foto_quitar', { p_clave: clave, p_foto: fotoId, p_quitar: quitar });

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
  foto_requerida: 'Falta la foto del documento.',
  sin_drive: 'Para subir fotos primero hay que conectar Drive (más arriba, en «Conectar Drive para las fotos»).',
  limite_fotos: 'Este huésped ya tiene 10 fotos. Quitá alguna para poder agregar otra.'
};

export const textoError = (e) => (e?.codigo ? MENSAJES[e.codigo] ?? e.codigo : 'No se pudo conectar. Revisá tu conexión e intentá de nuevo.');
export const textoCodigo = (codigo) => MENSAJES[codigo] ?? 'No se pudo completar. Intentá de nuevo.';
