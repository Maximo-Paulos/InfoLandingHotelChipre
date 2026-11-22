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
// El medio de pago (el id) viaja dentro de los datos; si no se manda, la base deja el que ya tenía.
const conMedio = (datos, medioPago) => (medioPago ? { ...datos, medio_pago: medioPago } : datos);
export const recepcionEditar = (clave, id, datos, habitacion, medioPago) =>
  rpc('recepcion_editar', { p_clave: clave, p_id: id, p_datos: conMedio(datos, medioPago), p_habitacion: habitacion || null });
// Fotos del documento desde recepción: ve las de un huésped y agrega otra. No hay forma de quitar ni cambiar las que ya están.
export const recepcionFotos = (clave, id) => rpc('recepcion_fotos', { p_clave: clave, p_id: id });
export const recepcionFotoPermiso = (clave, id) => rpc('recepcion_foto_permiso', { p_clave: clave, p_id: id });

// Reservas: habitación, categoría, noches, cantidad de huéspedes, canal de venta + valor total + lo pagado en el hotel, antes de dar el código.
// `r` = { habitacion, monto (total), moneda, medioPago, fecha, pagoHotel, fechaSena, noches, canal, categoria, huespedes } (sin pagoHotel se toma como cobrado todo en el hotel;
// con un canal que no cobra, como la obra social, la base ignora el monto y lo deja en 0). `huespedes` = cuántos van a hacer el check-in en la habitación:
// la reserva queda abierta hasta que entren todos.
const deReserva = (r) => ({
  p_habitacion: r.habitacion, p_monto: r.monto, p_moneda: r.moneda, p_medio_pago: r.medioPago, p_fecha: r.fecha, p_pago_hotel: r.pagoHotel ?? null, p_fecha_sena: r.fechaSena ?? null,
  p_noches: r.noches ?? null, p_canal: r.canal ?? null, p_categoria: r.categoria ?? null, p_huespedes: r.huespedes ?? null
});
export const recepcionReservaNueva = (clave, r) => rpc('recepcion_reserva_nueva', { p_clave: clave, ...deReserva(r) });
// Apaga el código que se ve (no cierra la reserva: si faltan huéspedes sigue abierta) o, con extender, le da más minutos.
export const recepcionReservaCerrar = (clave, extender = false) => rpc('recepcion_reserva_cerrar', { p_clave: clave, p_extender: extender });
// Le vuelve a dar código a una reserva abierta (el huésped que llegó después) y anula una que no tiene huéspedes (nunca borra: queda marcada).
export const recepcionReservaAbrir = (clave, id) => rpc('recepcion_reserva_abrir', { p_clave: clave, p_id: id });
export const recepcionReservaAnular = (clave, id) => rpc('recepcion_reserva_anular', { p_clave: clave, p_id: id });
// Reservas anotadas (por adelantado): las carga, corrige y cancela el dueño; recepción las ve en «Llegadas» y hace el check-in eligiendo cómo paga.
// `r` = { titular, ingreso, habitacion, noches, categoria, canal, huespedes, efectivo, transferencia?, usd?, sena?, fechaSena?, nota? } (precios en pesos, salvo usd; seña en pesos).
const deAnotada = (r) => ({
  p_titular: r.titular, p_ingreso: r.ingreso, p_habitacion: r.habitacion, p_noches: r.noches ?? null, p_categoria: r.categoria ?? null, p_canal: r.canal ?? null, p_huespedes: r.huespedes ?? null,
  p_efectivo: r.efectivo ?? null, p_transferencia: r.transferencia ?? null, p_usd: r.usd ?? null, p_sena: r.sena ?? 0, p_fecha_sena: r.fechaSena ?? null, p_nota: r.nota ?? null
});
export const adminAnotadas = (clave) => rpc('admin_anotadas', { p_clave: clave });
export const adminAnotadaGuardar = (clave, id, r) => rpc('admin_anotada_guardar', { p_clave: clave, p_id: id, ...deAnotada(r) });
// Recepción también anota y corrige (por ejemplo, al que llega de la calle sin reserva: a su nombre, con el monto, y sigue con el check-in). Cancelar es solo del dueño.
export const recepcionAnotadaGuardar = (clave, id, r) => rpc('recepcion_anotada_guardar', { p_clave: clave, p_id: id, ...deAnotada(r) });
// «Próximas reservas» de recepción: todas las anotadas que esperan al huésped (cerca o lejos), cada una con si ya se puede hacer su check-in.
export const recepcionProximas = (clave) => rpc('recepcion_proximas', { p_clave: clave });
// Cierra a mano una reserva a la que ya ingresó al menos un huésped y el resto no va a venir. Reabrirla es solo del dueño.
export const recepcionEstadiaCerrar = (clave, id) => rpc('recepcion_estadia_cerrar', { p_clave: clave, p_id: id });
export const adminEstadiaReabrir = (clave, id) => rpc('admin_estadia_reabrir', { p_clave: clave, p_id: id });
export const adminAnotadaCancelar = (clave, id, cancelar = true) => rpc('admin_anotada_cancelar', { p_clave: clave, p_id: id, p_cancelar: cancelar });
// Hace el check-in de una reserva anotada: arma la reserva con el cobro que se eligió (mismos datos que «Nueva reserva») y da el primer código.
export const recepcionLlegadaIniciar = (clave, id, r) => rpc('recepcion_llegada_iniciar', { p_clave: clave, p_id: id, ...deReserva(r) });
// El dueño elimina una reserva (con huéspedes también: se van con ella) o la restaura. Nunca borra: queda guardada y se puede restaurar.
export const adminReservaAnular = (clave, id, anular = true) => rpc('admin_reserva_anular', { p_clave: clave, p_id: id, p_anular: anular });
// El dueño elimina a un huésped (deja de verse y de contar, queda guardado) o lo restaura. Y la lista de los eliminados.
export const adminHuespedQuitar = (clave, id, quitar = true) => rpc('admin_huesped_quitar', { p_clave: clave, p_id: id, p_quitar: quitar });
export const adminHuespedesQuitados = (clave) => rpc('admin_huespedes_quitados', { p_clave: clave });
export const recepcionEstadiaEditar = (clave, id, r) => rpc('recepcion_estadia_editar', { p_clave: clave, p_id: id, ...deReserva(r) });
export const adminEstadiaEditar = (clave, id, r) => rpc('admin_estadia_editar', { p_clave: clave, p_id: id, ...deReserva(r) });
export const adminHuespedEstadia = (clave, id, estadia) => rpc('admin_huesped_estadia', { p_clave: clave, p_id: id, p_estadia: estadia });
export const adminEstadisticas = (clave, desde = null, hasta = null) => rpc('admin_estadisticas', { p_clave: clave, p_desde: desde, p_hasta: hasta });
// Avisos en el celular (notificaciones push): cada celular activa los suyos; el dueño decide si el aviso lleva el nombre y si el check-in le llega también a recepción.
export const pushSuscribir = (clave, endpoint, llave, auth, agente) => rpc('push_suscribir', { p_clave: clave, p_endpoint: endpoint, p_llave: llave, p_auth: auth, p_agente: agente ?? null });
export const pushDesuscribir = (clave, endpoint) => rpc('push_desuscribir', { p_clave: clave, p_endpoint: endpoint });
export const pushEstado = (clave, endpoint) => rpc('push_estado', { p_clave: clave, p_endpoint: endpoint ?? null });
export const pushPrueba = (clave, endpoint) => rpc('push_prueba', { p_clave: clave, p_endpoint: endpoint });
export const adminPushConfig = (clave, nombre = null, checkinRecepcion = null) => rpc('admin_push_config', { p_clave: clave, p_nombre: nombre, p_checkin_recepcion: checkinRecepcion });
export const adminReservaMin = (clave, minutos) => rpc('admin_reserva_min', { p_clave: clave, p_min: minutos });

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
// Categorías de habitación y canales de venta: el dueño ve las dos listas (también lo quitado) y guarda una lista completa (tipo = 'categoria' o 'canal').
export const adminCatalogos = (clave) => rpc('admin_catalogos', { p_clave: clave });
export const adminCatalogoGuardar = (clave, tipo, lista) => rpc('admin_catalogo_guardar', { p_clave: clave, p_tipo: tipo, p_lista: lista });
// Equipo (solo el dueño): cada persona tiene un alias y su propia clave. Con id se cambia lo que se mande (alias, rol, clave nueva, activo);
// sin id se crea. Nada se borra: dar de baja deja a la persona inactiva.
export const adminEquipo = (clave) => rpc('admin_equipo', { p_clave: clave });
export const adminEquipoGuardar = (clave, { id = null, alias = null, rol = null, claveNueva = null, activo = null }) =>
  rpc('admin_equipo_guardar', { p_clave: clave, p_id: id, p_alias: alias, p_rol: rol, p_clave_usuario: claveNueva, p_activo: activo });
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
  clave_corta: 'La clave tiene que tener al menos 8 caracteres.',
  config_invalida: 'Algún valor de la configuración no es válido.',
  consentimiento: 'Tenés que aceptar para poder enviar.',
  foto_requerida: 'Falta la foto del documento.',
  sin_drive: 'Para subir fotos primero hay que conectar Drive (más arriba, en «Conectar Drive para las fotos»).',
  alias_invalido: 'El nombre tiene que tener entre 1 y 30 letras.',
  alias_repetido: 'Ya hay otra persona activa con ese nombre. Elegí otro.',
  clave_repetida: 'Esa clave ya la usa otra persona. Elegí una distinta.',
  rol_invalido: 'Elegí qué puede hacer esta persona.',
  sin_permiso: 'Esto lo puede hacer solamente el dueño.',
  usar_equipo: 'Las claves ahora se manejan desde «Equipo».',
  limite_fotos: 'Este huésped ya tiene 10 fotos. Quitá alguna para poder agregar otra.',
  base_obligatoria: 'Ese canal no se puede quitar ni dejar sin cobro: lo usan las reservas de antes.',
  canal_en_uso: 'Ese canal ya tiene reservas: no se puede cambiar si cobra o no. Creá otro canal si hace falta.',
  nombre_repetido: 'Hay dos opciones con el mismo nombre.',
  nombre_invalido: 'Algún nombre no es válido: hasta 40 letras o números, sin símbolos raros.',
  lista_invalida: 'La lista no es válida. Actualizá la pantalla y probá de nuevo.',
  reserva_anulada: 'Esa reserva está anulada. Solo el dueño la puede restaurar.',
  reserva_completa: 'Esa reserva ya tiene a todos sus huéspedes. Si falta alguien más, el dueño puede subir la cantidad de huéspedes.',
  reserva_vencida: 'Esa reserva ya pasó el tiempo en que recepción la ve. Pedile al dueño que la reabra.',
  reserva_cerrada: 'Esa reserva se cerró. Actualizá la pantalla.',
  sesion_requerida: 'Para activar los avisos tenés que entrar con tu clave (no con una sesión vieja). Salí y volvé a entrar.',
  anotada_cancelada: 'Esa reserva anotada está cancelada. Solo el dueño la puede restaurar.',
  anotada_ya_empezo: 'Esa reserva ya empezó el check-in. Actualizá la pantalla.',
  llegada_fuera_de_fecha: 'Esa reserva llega fuera de los días que ve recepción. Pedile al dueño que haga el check-in.',
  tiene_huespedes: 'Esa reserva ya tiene huéspedes: no se puede anular.',
  sin_huespedes: 'Esa reserva todavía no tiene ningún huésped: no se cierra, se anula.'
};

export const textoError = (e) => (e?.codigo ? MENSAJES[e.codigo] ?? e.codigo : 'No se pudo conectar. Revisá tu conexión e intentá de nuevo.');
export const textoCodigo = (codigo) => MENSAJES[codigo] ?? 'No se pudo completar. Intentá de nuevo.';
