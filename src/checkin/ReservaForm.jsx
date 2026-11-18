import { useId, useRef, useState } from 'react';
import { enfocarPrimerError } from './util.js';

const MENSAJES = {
  habitacion: 'Escribí la habitación (hasta 12 letras o números).',
  monto: 'Escribí el valor total de la habitación, solo números. Por ejemplo 85000 o 60,50.',
  pago_hotel: 'Escribí cuánto pagó en el hotel. No puede ser más que el valor total.',
  fecha_sena: 'La fecha de la seña no puede ser después del día del cobro en el hotel.',
  moneda: 'Elegí la moneda.',
  medio_pago: 'Elegí un medio de pago de la lista.',
  fecha_cobro: 'La fecha del cobro tiene que ser de este último año.'
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

// Habitación, monto, moneda, medio de pago y fecha del cobro. Se usa para abrir una reserva y para corregirla.
//   inicial: la reserva (o null para una nueva) · medios: [{ id, nombre }]
//   onGuardar({ habitacion, monto, moneda, medioPago, fecha, pagoHotel, fechaSena }) -> { ok, mensaje?, campos? }
//   monto = valor TOTAL de la habitación · pagoHotel = lo que pagó en el hotel (con seña es menos que el total; la seña es la diferencia)
export default function ReservaForm({ inicial = null, medios, onGuardar, texto = 'Guardar', alCancelar = null }) {
  const id = useId();
  const opciones = inicial && !medios.some((m) => m.id === inicial.medio_pago_id)
    ? [...medios, { id: inicial.medio_pago_id, nombre: `${inicial.medio_pago} (ya no se ofrece)` }]
    : medios;
  const conSenaInicial = inicial != null && Number(inicial.pago_hotel ?? inicial.monto) < Number(inicial.monto);
  const [v, setV] = useState(() => ({
    habitacion: inicial?.habitacion ?? '', monto: inicial ? String(Number(inicial.monto)).replace('.', ',') : '', moneda: inicial?.moneda ?? 'ARS',
    medio_pago: String(inicial?.medio_pago_id ?? medios[0]?.id ?? ''), fecha: inicial?.fecha_cobro ?? hoyAR(),
    sena: conSenaInicial, pago: conSenaInicial ? String(Number(inicial.pago_hotel)).replace('.', ',') : '', fecha_sena: inicial?.fecha_sena ?? ''
  }));
  // Con seña: lo que falta para llegar al total (ya se cobró antes).
  const totalLeido = leerMonto(v.monto);
  const pagoLeido = leerMonto(v.pago);
  const senaCalculada = v.sena && totalLeido != null && pagoLeido != null && pagoLeido < totalLeido ? totalLeido - pagoLeido : null;
  const [errores, setErrores] = useState({});
  const [aviso, setAviso] = useState('');
  const [enviando, setEnviando] = useState(false);
  const form = useRef(null);
  const cambia = (k) => (e) => { setV((x) => ({ ...x, [k]: e.target.value })); setErrores((x) => ({ ...x, [k]: undefined })); };
  const campo = (k, etq, control, ayuda) => (
    <div className={`campo${errores[k] ? ' error' : ''}`}>
      <label htmlFor={`${id}-${k}`}>{etq}</label>
      {control}
      {ayuda && !errores[k] && <p className="ayuda">{ayuda}</p>}
      {errores[k] && <p className="msg" role="alert">{errores[k]}</p>}
    </div>
  );
  const p = (k, extra = {}) => ({ id: `${id}-${k}`, value: v[k], onChange: cambia(k), disabled: enviando, 'aria-invalid': errores[k] ? 'true' : undefined, autoComplete: 'off', ...extra });

  const enviar = async (e) => {
    e.preventDefault();
    if (enviando) return;
    const err = {};
    const hab = v.habitacion.replace(/\s+/g, ' ').trim();
    const monto = leerMonto(v.monto);
    if (!/^[\p{L}\p{N}][\p{L}\p{N} ._/-]{0,11}$/u.test(hab)) err.habitacion = MENSAJES.habitacion;
    if (monto === null) err.monto = MENSAJES.monto;
    const pago = v.sena ? leerMonto(v.pago) : monto;
    if (v.sena && (pago === null || (monto !== null && pago > monto))) err.pago_hotel = MENSAJES.pago_hotel;
    if (v.sena && v.fecha_sena && v.fecha && v.fecha_sena > v.fecha) err.fecha_sena = MENSAJES.fecha_sena;
    if (!v.fecha) err.fecha_cobro = MENSAJES.fecha_cobro;
    if (!opciones.some((m) => String(m.id) === v.medio_pago)) err.medio_pago = MENSAJES.medio_pago;
    if (Object.keys(err).length) { setErrores(err); setAviso('Revisá los campos marcados en rojo.'); enfocarPrimerError(form.current); return; }
    setEnviando(true);
    setAviso('');
    try {
      const r = await onGuardar({ habitacion: hab, monto, moneda: v.moneda, medioPago: Number(v.medio_pago), fecha: v.fecha, pagoHotel: pago, fechaSena: v.sena && pago < monto && v.fecha_sena ? v.fecha_sena : null });
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
      <div className="fila-monto">
        {campo('monto', 'Valor total de la habitación', <input {...p('monto', { inputMode: 'decimal', maxLength: 16, placeholder: 'Ej. 100000' })} />, 'Lo que sale la habitación en total, no por persona.')}
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
      <div className={`campo${errores.medio_pago ? ' error' : ''}`}>
        <span className="etq" id={`${id}-medio`}>{v.sena ? 'Medio de pago en el hotel' : 'Medio de pago'}</span>
        <div className="fichas" role="radiogroup" aria-labelledby={`${id}-medio`}>
          {opciones.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={v.medio_pago === String(m.id)} className={v.medio_pago === String(m.id) ? 'activa' : ''} disabled={enviando}
              onClick={() => { setV((x) => ({ ...x, medio_pago: String(m.id) })); setErrores((x) => ({ ...x, medio_pago: undefined })); }}>{m.nombre}</button>
          ))}
        </div>
        {errores.medio_pago && <p className="msg" role="alert">{errores.medio_pago}</p>}
      </div>
      {campo('fecha_cobro', v.sena ? 'Fecha del cobro en el hotel' : 'Fecha del cobro', <input {...p('fecha', { type: 'date' })} />, 'El día que pagó en el hotel. Sirve para pasar el monto a dólares con la cotización de ese día.')}
      {aviso && <p className="ed-error" role="alert">{aviso}</p>}
      <div className="btns modal-pie">
        <button type="submit" className="btn" disabled={enviando}>{enviando ? 'Guardando…' : texto}</button>
        {alCancelar && <button type="button" className="btn claro" onClick={alCancelar} disabled={enviando}>Cancelar</button>}
      </div>
    </form>
  );
}
