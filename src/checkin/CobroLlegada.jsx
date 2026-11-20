import { useEffect, useMemo, useRef, useState } from 'react';
import { aCobrar, medioSugerido, prefillDe, reservaDeLlegada } from './cobro.js';
import { ACobrar, cuando, fechaCorta } from './Llegadas.jsx';
import Modal from './Modal.jsx';
import { puedeHacerCheckin } from './proximas.js';
import ReservaForm, { hoyAR, nochesTexto, plata } from './ReservaForm.jsx';

// El check-in de una reserva anotada, en tres pasos y en este orden, para que nadie dé el código sin haber cobrado:
//   1. La reserva: la habitación (lo primero), cuándo llega y sale, cuántos son, la nota.
//   2. El cobro: cuánto hay que cobrar según cómo pague lo que resta (efectivo, transferencia o dólares; la seña ya está descontada), con qué medio de pago
//      entra la plata y la confirmación «Ya cobré…». Sin confirmar el cobro no se puede seguir.
//   3. El check-in: recién ahí el botón arma la reserva con ese cobro y se genera el código para el huésped.
// Si en el mostrador se negoció otro monto o hay que corregir algo, «Cobró otro monto» abre el formulario completo de la reserva (ya completado y editable).
//   a: la reserva anotada (de la base: trae `en_ventana` / `checkin_desde`) · venta: dólar oficial de hoy (o null) · medios / canales / categorías: las listas de siempre
//   apagado: el check-in digital está apagado (no se puede dar código) · onIniciar(r) -> { ok, mensaje?, campos? } · onEditar(a): corregir los datos anotados (si viene)
const FORMAS = [['efectivo', 'Efectivo'], ['transferencia', 'Transferencia'], ['usd', 'Dólares']];
const COMO = { efectivo: 'en efectivo', transferencia: 'por transferencia', usd: 'en dólares' };

export default function CobroLlegada({ a, venta, medios, canales, categorias, apagado = false, onIniciar, onEditar = null, onCerrar }) {
  const cobra = a.canal_cobra !== false;
  const enVentana = puedeHacerCheckin(a);
  const [forma, setForma] = useState('efectivo');
  const [medio, setMedio] = useState(() => String(medioSugerido(medios, 'efectivo') ?? ''));
  const [confirmado, setConfirmado] = useState(false);
  const [corrigiendo, setCorrigiendo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState('');
  const vivo = useRef(true);
  // En desarrollo React monta, desmonta y vuelve a montar: hay que "reabrir" al montar.
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);

  const c = useMemo(() => (cobra ? aCobrar(a, venta) : null), [a, venta, cobra]);
  const x = c?.[forma] ?? null; // lo que se cobra de esta forma (null: dólares sin cotización)
  const nadaQueCobrar = cobra && !!x && x.resta === 0; // la seña ya pagó todo
  const monto = (f) => (c?.[f] ? plata(c[f].resta, f === 'usd' ? 'USD' : 'ARS') : 'sin cotización');
  const elegirForma = (f) => { setForma(f); setMedio(String(medioSugerido(medios, f) ?? '')); setConfirmado(false); setAviso(''); };
  const elegirMedio = (id) => { setMedio(id); setConfirmado(false); setAviso(''); };
  const cobroListo = !cobra || (!!x && !!medio && (nadaQueCobrar || confirmado));
  const puede = enVentana && !apagado && cobroListo && !enviando;

  const hacer = async () => {
    if (!puede) return;
    const r = reservaDeLlegada(a, forma, venta, medio ? Number(medio) : null, hoyAR());
    if (!r) { setAviso('No se pudo calcular el cobro. Probá con otra forma de pago.'); return; }
    setEnviando(true);
    setAviso('');
    try {
      const res = await onIniciar(r);
      if (vivo.current && !res.ok) setAviso(res.mensaje || 'No se pudo hacer el check-in.');
    } catch {
      if (vivo.current) setAviso('No se pudo conectar. Revisá tu conexión e intentá de nuevo.');
    } finally {
      if (vivo.current) setEnviando(false);
    }
  };

  return (
    <Modal titulo={a.titular} onCerrar={onCerrar}>
      <section className="paso" aria-labelledby="paso-1">
        <h3 className="paso-tit" id="paso-1"><span className="paso-n">1</span>La reserva</h3>
        <p className="paso-hab">Habitación <b>{a.habitacion}</b></p>
        <p className="ll-cuando"><b>{cuando(a.dias_para)}</b> · llega {fechaCorta(a.fecha_ingreso)} · sale {fechaCorta(a.salida)}</p>
        <p className="ll-det">{[a.categoria, nochesTexto(a.noches), `${a.esperados} ${a.esperados === 1 ? 'huésped' : 'huéspedes'}`, a.canal].filter(Boolean).join(' · ')}</p>
        {a.nota && <p className="ll-nota"><span>Nota</span> {a.nota}</p>}
        {onEditar && enVentana && <button type="button" className="btn mini claro" onClick={() => onEditar(a)}>Corregir los datos de la reserva</button>}
      </section>

      <section className="paso" aria-labelledby="paso-2">
        <h3 className="paso-tit" id="paso-2"><span className="paso-n">2</span>Cobro</h3>
        {cobra ? (
          <>
            <ACobrar a={a} venta={venta} />
            <div className="campo">
              <span className="etq" id="forma-etq">¿Cómo paga lo que resta?</span>
              <div className="fichas" role="radiogroup" aria-labelledby="forma-etq">
                {FORMAS.map(([id, texto]) => (
                  <button key={id} type="button" role="radio" aria-checked={forma === id} className={forma === id ? 'activa' : ''} disabled={enviando || !c?.[id]} onClick={() => elegirForma(id)}>
                    {texto}<small>{monto(id)}</small>
                  </button>
                ))}
              </div>
            </div>
            {!corrigiendo && (
              <>
                <div className="campo">
                  <span className="etq" id="medio-etq">Medio de pago con el que entra la plata</span>
                  <div className="fichas" role="radiogroup" aria-labelledby="medio-etq">
                    {medios.map((m) => (
                      <button key={m.id} type="button" role="radio" aria-checked={medio === String(m.id)} className={medio === String(m.id) ? 'activa' : ''} disabled={enviando} onClick={() => elegirMedio(String(m.id))}>{m.nombre}</button>
                    ))}
                  </div>
                  {!medio && <p className="ayuda">Elegí con qué medio de pago se cobró.</p>}
                </div>
                {nadaQueCobrar
                  ? <p className="paso-ok" role="status">Con la seña ya está todo pagado: no hay nada para cobrar.</p>
                  : (
                    <label className={`confirma${confirmado ? ' si' : ''}`}>
                      <input type="checkbox" checked={confirmado} disabled={enviando || !x || !medio} onChange={(e) => setConfirmado(e.target.checked)} />
                      <span>Ya cobré <b>{monto(forma)}</b> {COMO[forma]}{Number(a.sena) > 0 ? ' (la seña ya estaba pagada)' : ''}</span>
                    </label>
                  )}
              </>
            )}
          </>
        ) : <p className="paso-ok" role="status">Sin cobro: esta reserva se factura aparte. No hay nada para cobrar.</p>}
      </section>

      <section className="paso" aria-labelledby="paso-3">
        <h3 className="paso-tit" id="paso-3"><span className="paso-n">3</span>Check-in</h3>
        {apagado && <p className="in-aviso" role="status">El check-in digital está apagado. Lo prende el dueño desde su panel.</p>}
        {!apagado && !enVentana && <p className="in-aviso" role="status">Todavía no se puede hacer el check-in de esta reserva: recepción lo hace desde {a.checkin_desde ? `el ${fechaCorta(a.checkin_desde)}` : 'unos días antes de la llegada'}. Podés mirar los datos y el cobro.</p>}
        {corrigiendo ? (
          <>
            <p className="ayuda">Corregí lo que haga falta: el cobro de abajo viene completado con lo anotado.</p>
            <ReservaForm key={forma} prefill={prefillDe(a, forma, venta, medios)} medios={medios} canales={canales} categorias={categorias} onGuardar={onIniciar} texto="Generar códigos" alCancelar={() => setCorrigiendo(false)} />
          </>
        ) : (
          <>
            {!cobroListo && enVentana && !apagado && <p className="ayuda">{!x ? 'Elegí otra forma de pago: dólares no se puede calcular ahora.' : !medio ? 'Elegí el medio de pago y confirmá el cobro para seguir.' : 'Confirmá que ya cobraste para seguir.'}</p>}
            {aviso && <p className="ed-error" role="alert">{aviso}</p>}
            <div className="btns modal-pie">
              <button type="button" className="btn" onClick={hacer} disabled={!puede}>{enviando ? 'Un momento…' : 'Hacer el check-in y dar el código'}</button>
              {cobra && enVentana && !apagado && <button type="button" className="btn claro" onClick={() => setCorrigiendo(true)} disabled={enviando}>Cobró otro monto o hay que corregir algo</button>}
              <button type="button" className="btn claro" onClick={onCerrar} disabled={enviando}>Volver</button>
            </div>
          </>
        )}
      </section>
    </Modal>
  );
}
