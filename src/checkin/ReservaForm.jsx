import { useId, useRef, useState } from 'react';
import { enfocarPrimerError } from './util.js';

const MENSAJES = {
  habitacion: 'Escribí la habitación (hasta 12 letras o números).',
  monto: 'Escribí el valor total de la habitación, solo números. Por ejemplo 85000 o 60,50.',
  pago_hotel: 'Escribí cuánto pagó en el hotel. No puede ser más que el valor total.',
  fecha_sena: 'La fecha de la seña no puede ser después del día del cobro en el hotel.',
  moneda: 'Elegí la moneda.',
  medio_pago: 'Elegí un medio de pago de la lista.',
  fecha_cobro: 'La fecha tiene que ser de este último año.',
  noches: 'Escribí cuántas noches se queda, de 1 a 365.',
  canal: 'Elegí el canal de venta.',
  categoria: 'Elegí la categoría de la habitación.'
};

// Hoy en Argentina (YYYY-MM-DD), para la fecha del cobro.
export const hoyAR = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());

// "85.000,50" / "85000.5" / "85000" -> 85000.5 (null si no es un monto)
export const leerMonto = (t) => {
  const s = String(t ?? '').trim().replace(/\s/g, '');
  if (!/^[0-9][0-9.,]*$/.test(s)) return null;
  // coma = decimal ("85.000,50"); un solo punto con 1-2 decimales también ("60.5"); si no, los puntos son de miles
  const normal = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : /^[0-9]+\.[0-9]{1,2}$/.test(s) ? s : s.replace(/\./g, '');
  const n = Number(normal);
  return Number.isFinite(n) && n >= 0 && n < 1e12 ? n : null;
};

const miles = (n) => Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2 });
export const plata = (monto, moneda) => `${moneda} ${miles(monto)}`;
// Lo cobrado de una reserva en una línea: «ARS 100.000» o, con seña, «ARS 100.000 (seña 30.000 + hotel 70.000)».
export const cobroTexto = (e) => {
  const sena = Number(e.monto) - Number(e.pago_hotel ?? e.monto);
  return sena > 0 ? `${plata(e.monto, e.moneda)} (seña ${miles(sena)} + hotel ${miles(e.pago_hotel)})` : plata(e.monto, e.moneda);
};
// Cuánto y cómo se cobró, para los encabezados: una reserva de un canal sin cobro (obra social) no lleva monto, se factura aparte.
export const cobroLinea = (e) => (e.canal_cobra === false ? 'Sin cobro: se factura aparte' : `${cobroTexto(e)} · ${e.medio_pago}`);
export const nochesTexto = (n) => (n == null ? null : `${n} ${n === 1 ? 'noche' : 'noches'}`);
// Qué es la reserva: «Doble · 4 noches · Directo» (lo que falte, no se muestra).
export const detalleTexto = (e) => [e.categoria, nochesTexto(e.noches), e.canal].filter(Boolean).join(' · ');

// Habitación, categoría, noches, canal de venta y, si el canal cobra, monto, moneda, medio de pago y fecha. Se usa para abrir una reserva y para corregirla.
//   inicial: la reserva (o null para una nueva) · medios: [{ id, nombre }] · canales: [{ id, nombre, cobra, base }] · categorias: [{ id, nombre }]
//   onGuardar({ habitacion, monto, moneda, medioPago, fecha, pagoHotel, fechaSena, noches, canal, categoria }) -> { ok, mensaje?, campos? }
//   monto = valor TOTAL de la habitación · pagoHotel = lo que pagó en el hotel (con seña es menos que el total; la seña es la diferencia)
//   Un canal que no cobra (obra social) no pide monto: la reserva se guarda en 0 y se factura aparte.
export default function ReservaForm({ inicial = null, medios, canales = [], categorias = [], onGuardar, texto = 'Guardar', alCancelar = null }) {
  const id = useId();
  const opciones = inicial && !medios.some((m) => m.id === inicial.medio_pago_id)
    ? [...medios, { id: inicial.medio_pago_id, nombre: `${inicial.medio_pago} (ya no se ofrece)` }]
    : medios;
  // Lo que ya tenía la reserva se sigue mostrando aunque el dueño lo haya quitado de la lista.
  const opcionesCanal = inicial?.canal_id != null && !canales.some((c) => c.id === inicial.canal_id)
    ? [...canales, { id: inicial.canal_id, nombre: `${inicial.canal} (ya no se ofrece)`, cobra: inicial.canal_cobra !== false }]
    : canales;
  const opcionesCat = inicial?.categoria_id != null && !categorias.some((c) => c.id === inicial.categoria_id)
    ? [...categorias, { id: inicial.categoria_id, nombre: `${inicial.categoria} (ya no se ofrece)` }]
    : categorias;
  const conSenaInicial = inicial != null && Number(inicial.pago_hotel ?? inicial.monto) < Number(inicial.monto);
  const [v, setV] = useState(() => ({
    habitacion: inicial?.habitacion ?? '', monto: inicial && inicial.canal_cobra !== false ? String(Number(inicial.monto)).replace('.', ',') : '', moneda: inicial?.moneda ?? 'ARS',
    medio_pago: String(inicial?.medio_pago_id ?? medios[0]?.id ?? ''), fecha: inicial?.fecha_cobro ?? hoyAR(),
    sena: conSenaInicial, pago: conSenaInicial ? String(Number(inicial.pago_hotel)).replace('.', ',') : '', fecha_sena: inicial?.fecha_sena ?? '',
    noches: inicial?.noches != null ? String(inicial.noches) : '', categoria: inicial?.categoria_id != null ? String(inicial.categoria_id) : '',
    canal: String(inicial?.canal_id ?? (canales.find((c) => c.base) ?? canales[0])?.id ?? '')
  }));
  const canalElegido = opcionesCanal.find((c) => String(c.id) === v.canal);
  const cobra = canalElegido ? canalElegido.cobra !== false : true;
  // La categoría es obligatoria (mientras haya alguna en la lista), salvo al corregir una reserva vieja que nunca la tuvo.
  const pideCategoria = opcionesCat.length > 0 && !(inicial && inicial.categoria_id == null);
  // Con seña: lo que falta para llegar al total (ya se cobró antes).
  const totalLeido = leerMonto(v.monto);
  const pagoLeido = leerMonto(v.pago);
  const senaCalculada = v.sena && totalLeido != null && pagoLeido != null && pagoLeido < totalLeido ? totalLeido - pagoLeido : null;
  const nochesLeidas = /^[0-9]{1,3}$/.test(v.noches.trim()) && Number(v.noches) >= 1 && Number(v.noches) <= 365 ? Number(v.noches) : null;
  const porNoche = cobra && totalLeido != null && totalLeido > 0 && nochesLeidas ? totalLeido / nochesLeidas : null;
  const [errores, setErrores] = useState({});
  const [aviso, setAviso] = useState('');
  const [enviando, setEnviando] = useState(false);
  const form = useRef(null);
  const cambia = (k) => (e) => { setV((x) => ({ ...x, [k]: e.target.value })); setErrores((x) => ({ ...x, [k]: undefined })); };
  const elegir = (k, valor) => { setV((x) => ({ ...x, [k]: valor })); setErrores((x) => ({ ...x, [k]: undefined })); };
  const campo = (k, etq, control, ayuda) => (
    <div className={`campo${errores[k] ? ' error' : ''}`}>
      <label htmlFor={`${id}-${k}`}>{etq}</label>
      {control}
      {ayuda && !errores[k] && <p className="ayuda">{ayuda}</p>}
      {errores[k] && <p className="msg" role="alert">{errores[k]}</p>}
    </div>
  );
  const p = (k, extra = {}) => ({ id: `${id}-${k}`, value: v[k], onChange: cambia(k), disabled: enviando, 'aria-invalid': errores[k] ? 'true' : undefined, autoComplete: 'off', ...extra });
  // Una fila de fichas para elegir una opción (categoría, canal, medio de pago).
  const fichas = (k, etq, lista, error, extra = null) => (
    <div className={`campo${error ? ' error' : ''}`}>
      <span className="etq" id={`${id}-${k}-etq`}>{etq}</span>
      <div className="fichas" role="radiogroup" aria-labelledby={`${id}-${k}-etq`}>
        {lista.map((m) => (
          <button key={m.id} type="button" role="radio" aria-checked={v[k] === String(m.id)} className={v[k] === String(m.id) ? 'activa' : ''} disabled={enviando} onClick={() => elegir(k, String(m.id))}>{m.nombre}</button>
        ))}
      </div>
      {extra}
      {error && <p className="msg" role="alert">{error}</p>}
    </div>
  );

  const enviar = async (e) => {
    e.preventDefault();
    if (enviando) return;
    const err = {};
    const hab = v.habitacion.replace(/\s+/g, ' ').trim();
    const monto = cobra ? leerMonto(v.monto) : 0;
    if (!/^[\p{L}\p{N}][\p{L}\p{N} ._/-]{0,11}$/u.test(hab)) err.habitacion = MENSAJES.habitacion;
    if (pideCategoria && !opcionesCat.some((c) => String(c.id) === v.categoria)) err.categoria = MENSAJES.categoria;
    if (nochesLeidas === null) err.noches = MENSAJES.noches;
    if (!canalElegido) err.canal = MENSAJES.canal;
    if (monto === null) err.monto = MENSAJES.monto;
    const pago = cobra ? (v.sena ? leerMonto(v.pago) : monto) : 0;
    if (cobra && v.sena && (pago === null || (monto !== null && pago > monto))) err.pago_hotel = MENSAJES.pago_hotel;
    if (cobra && v.sena && v.fecha_sena && v.fecha && v.fecha_sena > v.fecha) err.fecha_sena = MENSAJES.fecha_sena;
    if (!v.fecha) err.fecha_cobro = MENSAJES.fecha_cobro;
    if (cobra && !opciones.some((m) => String(m.id) === v.medio_pago)) err.medio_pago = MENSAJES.medio_pago;
    if (Object.keys(err).length) { setErrores(err); setAviso('Revisá los campos marcados en rojo.'); enfocarPrimerError(form.current); return; }
    setEnviando(true);
    setAviso('');
    try {
      const r = await onGuardar({
        habitacion: hab, monto, moneda: cobra ? v.moneda : 'ARS', medioPago: v.medio_pago ? Number(v.medio_pago) : null, fecha: v.fecha, pagoHotel: pago,
        fechaSena: cobra && v.sena && pago < monto && v.fecha_sena ? v.fecha_sena : null,
        noches: nochesLeidas, canal: Number(v.canal), categoria: v.categoria ? Number(v.categoria) : null
      });
      if (r.ok) return;
      if (r.campos?.length) setErrores(Object.fromEntries(r.campos.map((c) => [c, MENSAJES[c] ?? 'Revisalo.'])));
      setAviso(r.mensaje || 'No se pudo guardar.');
      enfocarPrimerError(form.current);
    } catch {
      setAviso('No se pudo conectar. Revisá tu conexión e intentá de nuevo.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <form onSubmit={enviar} noValidate ref={form} className="reserva-form">
      {campo('habitacion', 'Habitación', <input {...p('habitacion', { maxLength: 12, placeholder: 'Ej. 107', autoFocus: !inicial, enterKeyHint: 'next' })} />)}
      {opcionesCat.length > 0 && fichas('categoria', 'Categoría de la habitación', opcionesCat, errores.categoria)}
      {campo('noches', 'Cantidad de noches', <input {...p('noches', { inputMode: 'numeric', maxLength: 3, placeholder: 'Ej. 4' })} />, 'Cuántas noches se queda. Con eso se calcula lo que sale cada noche.')}
      {opcionesCanal.length > 1 && fichas('canal', 'Canal de venta', opcionesCanal, errores.canal)}
      {cobra ? (
        <>
          <div className="fila-monto">
            {campo('monto', 'Valor total de la habitación', <input {...p('monto', { inputMode: 'decimal', maxLength: 16, placeholder: 'Ej. 100000' })} />,
              porNoche ? `Son ${plata(porNoche, v.moneda)} por noche (${miles(totalLeido)} ÷ ${nochesLeidas} ${nochesLeidas === 1 ? 'noche' : 'noches'}). Si no te cierra, revisá el valor o las noches.` : 'Lo que sale la habitación en total (todas las noches), no por persona.')}
            <div className="campo">
              <span className="etq" id={`${id}-moneda`}>Moneda</span>
              <div className="seg" role="radiogroup" aria-labelledby={`${id}-moneda`}>
                {[['ARS', 'Pesos'], ['USD', 'Dólares']].map(([k, t]) => (
                  <button key={k} type="button" role="radio" aria-checked={v.moneda === k} className={v.moneda === k ? 'activa' : ''} disabled={enviando} onClick={() => setV((x) => ({ ...x, moneda: k }))}>{t}</button>
                ))}
              </div>
            </div>
          </div>
          <div className="campo">
            <span className="etq" id={`${id}-sena`}>¿Dejó una seña antes?</span>
            <div className="seg" role="radiogroup" aria-labelledby={`${id}-sena`}>
              {[[false, 'No, pagó todo en el hotel'], [true, 'Sí, dejó seña']].map(([k, t]) => (
                <button key={String(k)} type="button" role="radio" aria-checked={v.sena === k} className={v.sena === k ? 'activa' : ''} disabled={enviando} onClick={() => setV((x) => ({ ...x, sena: k }))}>{t}</button>
              ))}
            </div>
          </div>
          {v.sena && (
            <div className="sena-datos">
              {campo('pago_hotel', 'Pagó en el hotel', <input {...p('pago', { id: `${id}-pago_hotel`, inputMode: 'decimal', maxLength: 16, placeholder: 'Ej. 70000', 'aria-invalid': errores.pago_hotel ? 'true' : undefined, onChange: (e) => { setV((x) => ({ ...x, pago: e.target.value })); setErrores((x) => ({ ...x, pago_hotel: undefined })); } })} />,
                senaCalculada != null ? `La seña ya cobrada es ${plata(senaCalculada, v.moneda)} (el total menos lo que pagó en el hotel).` : 'Lo que pagó en el hotel, sin la seña. La seña es lo que falta para llegar al total.')}
              {campo('fecha_sena', 'Fecha de la seña (si la sabés)', <input {...p('fecha_sena', { type: 'date', 'aria-invalid': errores.fecha_sena ? 'true' : undefined })} />, 'Sirve para pasar la seña a dólares con la cotización de ese día. Si no la sabés, dejala vacía: se usa el día del cobro.')}
            </div>
          )}
          {fichas('medio_pago', v.sena ? 'Medio de pago en el hotel' : 'Medio de pago', opciones, errores.medio_pago)}
          {campo('fecha_cobro', v.sena ? 'Fecha del cobro en el hotel' : 'Fecha del cobro', <input {...p('fecha', { type: 'date' })} />, 'El día que pagó en el hotel. Sirve para pasar el monto a dólares con la cotización de ese día.')}
        </>
      ) : (
        <>
          <p className="sin-cobro" role="note"><b>Sin cobro.</b> Esta reserva se factura aparte, así que no se carga monto ni medio de pago. Cuenta en habitaciones, noches, edades y países, pero no en cobros ni tarifas.</p>
          {campo('fecha_cobro', 'Fecha de la estadía', <input {...p('fecha', { type: 'date' })} />, 'El día que llegó. Ubica la reserva en el mes y la semana que corresponden.')}
        </>
      )}
      {aviso && <p className="ed-error" role="alert">{aviso}</p>}
      <div className="btns modal-pie">
        <button type="submit" className="btn" disabled={enviando}>{enviando ? 'Guardando…' : texto}</button>
        {alCancelar && <button type="button" className="btn claro" onClick={alCancelar} disabled={enviando}>Cancelar</button>}
      </div>
    </form>
  );
}
