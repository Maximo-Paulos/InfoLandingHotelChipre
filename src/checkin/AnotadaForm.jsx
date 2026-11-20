import { useId, useRef, useState } from 'react';
import { ACobrar, ventaDeHoy } from './Llegadas.jsx';
import { leerMonto } from './ReservaForm.jsx';
import { enfocarPrimerError } from './util.js';

// El formulario con el que el dueño anota una reserva por adelantado (o la corrige): a nombre de quién, cuándo llega, habitación, categoría, cuántos son, los
// precios (efectivo, transferencia y, si quiere, dólares), la seña que ya pagó y una nota. Abajo se ve cuánto queda por cobrar de cada manera.
//   inicial: la reserva anotada (null = nueva) · cotizaciones: la lista del dólar oficial (o null) · canales / categorias: las listas del dueño
//   ingresoInicial: la fecha de ingreso con la que arranca una reserva nueva (recepción: hoy, para el que llega de la calle; el dueño la elige)
//   onGuardar({ titular, ingreso, habitacion, noches, categoria, canal, huespedes, efectivo, transferencia, usd, sena, fechaSena, nota }) -> { ok, mensaje?, campos? }
const MENSAJES = {
  titular: 'Escribí a nombre de quién está la reserva (hasta 60 letras).',
  fecha_ingreso: 'Elegí la fecha de ingreso (de hace dos meses a dos años).',
  habitacion: 'Escribí la habitación (hasta 12 letras o números).',
  noches: 'Escribí cuántas noches se queda, de 1 a 365.',
  huespedes: 'Escribí cuántos huéspedes van a venir, de 1 a 12.',
  categoria: 'Elegí la categoría de la habitación.',
  canal: 'Elegí el canal de venta.',
  precio_efectivo: 'Escribí el precio total en efectivo, solo números. Por ejemplo 100000.',
  precio_transferencia: 'Si lo cargás, escribí el precio total en transferencia, solo números. Si no, se cobra igual que en efectivo.',
  precio_usd: 'Si lo cargás, escribí el precio total en dólares, solo números. Si no, se calcula con el dólar oficial.',
  sena: 'La seña no puede ser más que el precio más bajo.',
  fecha_sena: 'La fecha de la seña tiene que ser de hoy o antes.',
  nota: 'La nota puede tener hasta 500 letras.'
};
const texto = (x) => (x == null ? '' : String(Number(x)).replace('.', ','));

export default function AnotadaForm({ inicial = null, ingresoInicial = '', canales = [], categorias = [], cotizaciones = null, onGuardar, alCancelar }) {
  const id = useId();
  const opcionesCanal = inicial?.canal_id != null && !canales.some((c) => c.id === inicial.canal_id) ? [...canales, { id: inicial.canal_id, nombre: `${inicial.canal} (ya no se ofrece)`, cobra: inicial.canal_cobra !== false }] : canales;
  const opcionesCat = inicial?.categoria_id != null && !categorias.some((c) => c.id === inicial.categoria_id) ? [...categorias, { id: inicial.categoria_id, nombre: `${inicial.categoria} (ya no se ofrece)` }] : categorias;
  const [v, setV] = useState(() => ({
    titular: inicial?.titular ?? '', ingreso: inicial?.fecha_ingreso ?? ingresoInicial, noches: inicial ? String(inicial.noches) : '', habitacion: inicial?.habitacion ?? '',
    huespedes: inicial ? String(inicial.esperados) : '', categoria: inicial?.categoria_id != null ? String(inicial.categoria_id) : '',
    canal: String(inicial?.canal_id ?? (canales.find((c) => c.base) ?? canales[0])?.id ?? ''),
    efectivo: inicial && inicial.canal_cobra !== false ? texto(inicial.precio_efectivo) : '', transferencia: texto(inicial?.precio_transferencia), usd: texto(inicial?.precio_usd),
    sena: inicial && Number(inicial.sena) > 0 ? texto(inicial.sena) : '', fecha_sena: inicial?.fecha_sena ?? '', nota: inicial?.nota ?? ''
  }));
  const [errores, setErrores] = useState({});
  const [aviso, setAviso] = useState('');
  const [enviando, setEnviando] = useState(false);
  const form = useRef(null);
  const canalElegido = opcionesCanal.find((c) => String(c.id) === v.canal);
  const cobra = canalElegido ? canalElegido.cobra !== false : true;
  const pideCategoria = opcionesCat.length > 0 && !(inicial && inicial.categoria_id == null);
  const cambia = (k) => (e) => { setV((x) => ({ ...x, [k]: e.target.value })); setErrores((x) => ({ ...x, [k]: undefined })); };
  const elegir = (k, valor) => { setV((x) => ({ ...x, [k]: valor })); setErrores((x) => ({ ...x, [k]: undefined })); };
  const p = (k, extra = {}) => ({ id: `${id}-${k}`, value: v[k], onChange: cambia(k), disabled: enviando, 'aria-invalid': errores[k] ? 'true' : undefined, autoComplete: 'off', ...extra });
  const campo = (k, etq, control, ayuda) => (
    <div className={`campo${errores[k] ? ' error' : ''}`}>
      <label htmlFor={`${id}-${k}`}>{etq}</label>
      {control}
      {ayuda && !errores[k] && <p className="ayuda">{ayuda}</p>}
      {errores[k] && <p className="msg" role="alert">{errores[k]}</p>}
    </div>
  );
  const fichas = (k, etq, lista, error) => (
    <div className={`campo${error ? ' error' : ''}`}>
      <span className="etq" id={`${id}-${k}-etq`}>{etq}</span>
      <div className="fichas" role="radiogroup" aria-labelledby={`${id}-${k}-etq`}>
        {lista.map((m) => <button key={m.id} type="button" role="radio" aria-checked={v[k] === String(m.id)} className={v[k] === String(m.id) ? 'activa' : ''} disabled={enviando} onClick={() => elegir(k, String(m.id))}>{m.nombre}</button>)}
      </div>
      {error && <p className="msg" role="alert">{error}</p>}
    </div>
  );

  // Lo que se va leyendo mientras se escribe, para mostrar abajo cuánto queda por cobrar.
  const ef = leerMonto(v.efectivo);
  const tr = v.transferencia.trim() ? leerMonto(v.transferencia) : null;
  const us = v.usd.trim() ? leerMonto(v.usd) : null;
  const se = v.sena.trim() ? leerMonto(v.sena) : 0;
  const vistaPrevia = cobra && ef != null && ef > 0 && se != null && se <= Math.min(ef, tr ?? ef)
    ? { precio_efectivo: ef, precio_transferencia: tr, precio_usd: us, sena: se, canal_cobra: true } : null;

  const enviar = async (e) => {
    e.preventDefault();
    if (enviando) return;
    const err = {};
    const t = v.titular.replace(/\s+/g, ' ').trim();
    const hab = v.habitacion.replace(/\s+/g, ' ').trim();
    const noches = /^[0-9]{1,3}$/.test(v.noches.trim()) && Number(v.noches) >= 1 && Number(v.noches) <= 365 ? Number(v.noches) : null;
    const hues = /^[0-9]{1,2}$/.test(v.huespedes.trim()) && Number(v.huespedes) >= 1 && Number(v.huespedes) <= 12 ? Number(v.huespedes) : null;
    if (!t || t.length > 60) err.titular = MENSAJES.titular;
    if (!v.ingreso) err.fecha_ingreso = MENSAJES.fecha_ingreso;
    if (!/^[\p{L}\p{N}][\p{L}\p{N} ._/-]{0,11}$/u.test(hab)) err.habitacion = MENSAJES.habitacion;
    if (noches === null) err.noches = MENSAJES.noches;
    if (hues === null) err.huespedes = MENSAJES.huespedes;
    if (pideCategoria && !opcionesCat.some((c) => String(c.id) === v.categoria)) err.categoria = MENSAJES.categoria;
    if (!canalElegido) err.canal = MENSAJES.canal;
    if (cobra) {
      if (ef == null || ef <= 0) err.precio_efectivo = MENSAJES.precio_efectivo;
      if (v.transferencia.trim() && (tr == null || tr <= 0)) err.precio_transferencia = MENSAJES.precio_transferencia;
      if (v.usd.trim() && (us == null || us <= 0)) err.precio_usd = MENSAJES.precio_usd;
      if (se == null || (ef != null && ef > 0 && se > Math.min(ef, tr ?? ef))) err.sena = MENSAJES.sena;
    }
    if (v.nota.length > 500) err.nota = MENSAJES.nota;
    if (Object.keys(err).length) { setErrores(err); setAviso('Revisá los campos marcados en rojo.'); enfocarPrimerError(form.current); return; }
    setEnviando(true);
    setAviso('');
    try {
      const r = await onGuardar({
        titular: t, ingreso: v.ingreso, habitacion: hab, noches, categoria: v.categoria ? Number(v.categoria) : null, canal: Number(v.canal), huespedes: hues,
        efectivo: cobra ? ef : 0, transferencia: cobra ? tr : null, usd: cobra ? us : null, sena: cobra ? se : 0, fechaSena: cobra && se > 0 && v.fecha_sena ? v.fecha_sena : null, nota: v.nota.trim() || null
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
      {campo('titular', 'A nombre de', <input {...p('titular', { maxLength: 60, placeholder: 'Ej. Juan Pérez', autoFocus: !inicial })} />, 'La persona que hizo la reserva: así la identifica recepción.')}
      {campo('ingreso', 'Fecha de ingreso', <input {...p('ingreso', { type: 'date' })} />)}
      <div className="fila-monto">
        {campo('habitacion', 'Habitación', <input {...p('habitacion', { maxLength: 12, placeholder: 'Ej. 107' })} />)}
        {campo('huespedes', 'Huéspedes', <input {...p('huespedes', { inputMode: 'numeric', maxLength: 2, placeholder: 'Ej. 3' })} />)}
      </div>
      {opcionesCat.length > 0 && fichas('categoria', 'Categoría de la habitación', opcionesCat, errores.categoria)}
      {campo('noches', 'Cantidad de noches', <input {...p('noches', { inputMode: 'numeric', maxLength: 3, placeholder: 'Ej. 4' })} />)}
      {opcionesCanal.length > 1 && fichas('canal', 'Canal de venta', opcionesCanal, errores.canal)}
      {cobra ? (
        <>
          <h3 className="sub-form">Precio total de la estadía</h3>
          {campo('efectivo', 'Precio en efectivo (pesos)', <input {...p('efectivo', { inputMode: 'decimal', maxLength: 16, placeholder: 'Ej. 100000' })} />)}
          {campo('transferencia', 'Precio en transferencia (pesos)', <input {...p('transferencia', { inputMode: 'decimal', maxLength: 16, placeholder: 'Ej. 110000' })} />, 'Opcional. Si lo dejás vacío se cobra igual que en efectivo.')}
          {campo('usd', 'Precio en dólares', <input {...p('usd', { inputMode: 'decimal', maxLength: 12, placeholder: 'Ej. 90' })} />, 'Opcional. Si lo dejás vacío se calcula con el dólar oficial del día.')}
          {campo('sena', 'Seña que ya pagó (pesos)', <input {...p('sena', { inputMode: 'decimal', maxLength: 16, placeholder: 'Ej. 30000' })} />, 'No importa cómo la pagó: se descuenta de lo que resta en cualquier forma de pago.')}
          {se > 0 && campo('fecha_sena', 'Fecha de la seña (si la sabés)', <input {...p('fecha_sena', { type: 'date' })} />)}
          {vistaPrevia && <ACobrar a={vistaPrevia} venta={ventaDeHoy(cotizaciones)} />}
        </>
      ) : (
        <p className="sin-cobro" role="note"><b>Sin cobro.</b> Esta reserva se factura aparte: no lleva precios ni seña.</p>
      )}
      {campo('nota', 'Nota para recepción', <textarea {...p('nota', { rows: 3, maxLength: 500, placeholder: 'Ej. Llega a las 18 h, pide cama extra' })} />, 'Opcional: horario de llegada, pedidos, lo que tenga que saber recepción.')}
      {aviso && <p className="ed-error" role="alert">{aviso}</p>}
      <div className="btns modal-pie">
        <button type="submit" className="btn" disabled={enviando}>{enviando ? 'Guardando…' : inicial ? 'Guardar cambios' : 'Anotar reserva'}</button>
        <button type="button" className="btn claro" onClick={alCancelar} disabled={enviando}>Cancelar</button>
      </div>
    </form>
  );
}
