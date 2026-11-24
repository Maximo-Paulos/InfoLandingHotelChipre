import { useEffect, useMemo, useRef, useState } from 'react';
import { aCobrar, medioSugerido, reservaDeLlegada } from './cobro.js';
import { ACobrar, cuando, fechaCorta } from './Llegadas.jsx';
import Modal from './Modal.jsx';
import { numeroTexto } from './proximas.js';
import { leerMonto, hoyAR, nochesTexto, plata } from './ReservaForm.jsx';

// El check-in de una reserva anotada: tres pasos, en este orden, y cada uno habilita al siguiente. No hay forma de saltearse el cobro ni de dar el código por error.
//   1. La reserva: la habitación (lo primero), cuándo llega y sale, cuántos son, la nota. Es lo que está anotado: acá no se cambia nada.
//   2. El cobro, de a una cosa por vez: (a) cómo paga lo que resta —efectivo, transferencia o dólares; arranca SIN elegir—, (b) con qué medio de pago entra la plata y
//      (c) la confirmación «Ya cobré…». Si cambia la forma o el medio, hay que volver a confirmar. Si en el mostrador se cobró otro monto, «Cobré otro monto» deja
//      escribir SOLO cuánto se cobró (la habitación, las noches y los huéspedes no se tocan: eso se corrige en la reserva, con «Corregir los datos de la reserva»).
//   3. El check-in: un resumen de lo que se va a registrar y el botón, que sigue apagado hasta que el cobro esté confirmado y dice qué falta.
//   a: la reserva anotada · venta: dólar oficial de hoy (o null) · medios: los medios de pago [{ id, nombre }] · apagado: el check-in digital está apagado
//   onIniciar(r) -> { ok, mensaje? }: arma la reserva con ese cobro (ver reservaDeLlegada) · onEditar(a): corregir los datos anotados (si viene)
const FORMAS = [['efectivo', 'Efectivo'], ['transferencia', 'Transferencia'], ['usd', 'Dólares']];
const COMO = { efectivo: 'en efectivo', transferencia: 'por transferencia', usd: 'en dólares' };

export default function CobroLlegada({ a, venta, medios, apagado = false, onIniciar, onEditar = null, onUnir = null, onCerrar }) {
  const cobra = a.canal_cobra !== false;
  const [forma, setForma] = useState(null);
  const [medio, setMedio] = useState('');
  const [otroMonto, setOtroMonto] = useState(false);
  const [texto, setTexto] = useState('');
  const [confirmado, setConfirmado] = useState(false);
  const [distinta, setDistinta] = useState(false); // «no es la misma persona»: se sigue con el check-in aunque haya una reserva parecida
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState('');
  const vivo = useRef(true);
  // En desarrollo React monta, desmonta y vuelve a montar: hay que "reabrir" al montar.
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);

  const c = useMemo(() => (cobra ? aCobrar(a, venta) : null), [a, venta, cobra]);
  const x = forma ? c?.[forma] ?? null : null; // lo anotado para esta forma de pago
  const moneda = forma === 'usd' ? 'USD' : 'ARS';
  const nadaQueCobrar = cobra && !!x && x.resta === 0; // la seña ya pagó todo: no hay nada para cobrar ni para corregir
  const montoLeido = otroMonto ? leerMonto(texto) : null;
  const montoValido = !otroMonto || (montoLeido != null && montoLeido > 0 && montoLeido < 1e9);
  const cobrado = otroMonto && montoValido ? montoLeido : null; // null = se cobra lo anotado
  const aCobrarTexto = x ? plata(otroMonto && montoValido ? montoLeido : x.resta, moneda) : '';
  const monto = (f) => (c?.[f] ? plata(c[f].resta, f === 'usd' ? 'USD' : 'ARS') : 'sin cotización');

  const elegirForma = (f) => { setForma(f); setMedio(String(medioSugerido(medios, f) ?? '')); setOtroMonto(false); setTexto(''); setConfirmado(false); setAviso(''); };
  const elegirMedio = (id) => { setMedio(id); setConfirmado(false); setAviso(''); };
  const cambiarMonto = (t) => { setTexto(t); setConfirmado(false); setAviso(''); };
  const activarOtroMonto = (si) => { setOtroMonto(si); setTexto(''); setConfirmado(false); setAviso(''); };

  // Qué falta para poder hacer el check-in (en este orden): lo que dice el cartel de abajo.
  const falta = !cobra ? null
    : !forma ? 'Elegí cómo paga lo que resta (paso 2).'
      : !medio ? 'Elegí el medio de pago (paso 2).'
        : !montoValido ? 'Escribí cuánto cobraste (paso 2).'
          : !nadaQueCobrar && !confirmado ? 'Tildá «Ya cobré…» para confirmar el cobro (paso 2).' : null;
  const candidatas = a.candidatas ?? [];
  const duda = candidatas.length > 0 && !distinta && !!onUnir; // hay una reserva en la misma habitación: primero se decide si ya llegó
  const puede = !apagado && !falta && !enviando && !duda;

  const hacer = async () => {
    if (!puede) return;
    const r = reservaDeLlegada(a, forma ?? 'efectivo', venta, medio ? Number(medio) : null, hoyAR(), cobrado);
    if (!r) { setAviso('No se pudo calcular el cobro. Revisá el monto o probá con otra forma de pago.'); return; }
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

  const unir = async (e) => {
    if (enviando) return;
    setEnviando(true);
    setAviso('');
    try {
      const res = await onUnir(a, e);
      if (vivo.current && !res.ok && res.mensaje) setAviso(res.mensaje);
    } catch {
      if (vivo.current) setAviso('No se pudo conectar. Revisá tu conexión e intentá de nuevo.');
    } finally {
      if (vivo.current) setEnviando(false);
    }
  };

  const medioNombre = medios.find((m) => String(m.id) === medio)?.nombre;
  return (
    <Modal titulo={a.titular} onCerrar={onCerrar}>
      <section className="paso" aria-labelledby="paso-1">
        <h3 className="paso-tit" id="paso-1"><span className="paso-n">1</span>La reserva</h3>
        <p className="paso-hab">Habitación <b>{a.habitacion}</b>{a.numero != null && <span className="pp-num">{numeroTexto(a)}</span>}</p>
        <p className="ll-cuando"><b>{cuando(a.dias_para)}</b> · llega {fechaCorta(a.fecha_ingreso)} · sale {fechaCorta(a.salida)}</p>
        <p className="ll-det">{[a.categoria, nochesTexto(a.noches), `${a.esperados} ${a.esperados === 1 ? 'huésped' : 'huéspedes'}`, a.canal].filter(Boolean).join(' · ')}</p>
        {a.nota && <p className="ll-nota"><span>Nota</span> {a.nota}</p>}
        {onEditar && <button type="button" className="btn mini claro" onClick={() => onEditar(a)} disabled={enviando}>Corregir los datos de la reserva</button>}
      </section>

      {duda && (
        <section className="paso dup" aria-labelledby="paso-0">
          <h3 className="paso-tit" id="paso-0"><span className="paso-n">?</span>¿Esta reserva ya llegó?</h3>
          <p className="ayuda">En la Hab. {a.habitacion} ya hay {candidatas.length === 1 ? 'una reserva abierta aparte' : 'reservas abiertas aparte'}. Si es la misma persona, <b>no hagas el check-in de nuevo</b>: unilas y queda una sola reserva, con su nombre.</p>
          <ul className="dup-lista">
            {candidatas.map((e) => (
              <li key={e.id} className="dup-card">
                <p><b>Hab. {e.habitacion}</b>{e.numero != null && <> · <b>{numeroTexto(e)}</b></>} · {e.titular || 'Reserva rápida'} · {nochesTexto(e.noches)} · {e.esperados} {e.esperados === 1 ? 'huésped' : 'huéspedes'}</p>
                <p className="ll-det">{Number(e.con_checkin) > 0 ? `Ya ingresaron ${e.con_checkin}: ${(e.ingresaron ?? []).join(', ')}` : 'Todavía no ingresó nadie (tiene el código dado).'}{e.cargado_por ? ` · la abrió ${e.cargado_por}` : ''}</p>
                <button type="button" className="btn mini" onClick={() => unir(e)} disabled={enviando}>Es la misma: unir</button>
              </li>
            ))}
          </ul>
          {aviso && <p className="ed-error" role="alert">{aviso}</p>}
          <button type="button" className="btn mini claro" onClick={() => setDistinta(true)} disabled={enviando}>No es la misma persona: seguir con el check-in</button>
        </section>
      )}

      {!duda && (<>
      <section className="paso" aria-labelledby="paso-2">
        <h3 className="paso-tit" id="paso-2"><span className="paso-n">2</span>Cobro</h3>
        {cobra ? (
          <>
            {!nadaQueCobrar && (
              <ul className="pasos-cobro" aria-label="Lo que hay que hacer en el cobro">
                <li className={forma ? 'hecho' : ''}>Elegir cómo paga</li>
                <li className={medio ? 'hecho' : ''}>Elegir el medio de pago</li>
                <li className={confirmado ? 'hecho' : ''}>Confirmar que ya cobró</li>
              </ul>
            )}
            <ACobrar a={a} venta={venta} />
            <div className="campo">
              <span className="etq" id="forma-etq">¿Cómo paga lo que resta?</span>
              <div className="fichas" role="radiogroup" aria-labelledby="forma-etq">
                {FORMAS.map(([id, t]) => (
                  <button key={id} type="button" role="radio" aria-checked={forma === id} className={forma === id ? 'activa' : ''} disabled={enviando || !c?.[id]} onClick={() => elegirForma(id)}>
                    {t}<small>{monto(id)}</small>
                  </button>
                ))}
              </div>
              {!forma && <p className="ayuda">Elegí una para seguir.</p>}
            </div>
            {forma && (
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
                {nadaQueCobrar ? <p className="paso-ok" role="status">Con la seña ya está todo pagado: no hay nada para cobrar.</p> : medio && (
                  <>
                    {otroMonto && (
                      <div className={`campo${montoValido ? '' : ' error'}`}>
                        <label htmlFor="otro-monto">Cuánto cobraste en el hotel ({moneda})</label>
                        <input id="otro-monto" inputMode="decimal" autoComplete="off" maxLength={14} placeholder={`Anotado: ${x.resta}`} value={texto} disabled={enviando} onChange={(e) => cambiarMonto(e.target.value)} />
                        <p className="ayuda">Solo lo que cobraste ahora, sin la seña. La reserva queda registrada con este monto.</p>
                        {texto.trim() !== '' && !montoValido && <p className="msg" role="alert">Escribí solo números, mayor que cero. Por ejemplo 80000.</p>}
                      </div>
                    )}
                    <label className={`confirma${confirmado ? ' si' : ''}`}>
                      <input type="checkbox" checked={confirmado} disabled={enviando || !montoValido || (otroMonto && texto.trim() === '')} onChange={(e) => setConfirmado(e.target.checked)} />
                      <span>Ya cobré <b>{aCobrarTexto}</b> {COMO[forma]}{otroMonto && montoValido && montoLeido !== x.resta ? ` (lo anotado era ${plata(x.resta, moneda)})` : ''}{Number(a.sena) > 0 ? ' · la seña ya estaba pagada' : ''}</span>
                    </label>
                    <button type="button" className="enlace" onClick={() => activarOtroMonto(!otroMonto)} disabled={enviando}>{otroMonto ? 'Volver al monto anotado' : 'Cobré otro monto'}</button>
                  </>
                )}
              </>
            )}
          </>
        ) : <p className="paso-ok" role="status">Sin cobro: esta reserva se factura aparte. No hay nada para cobrar.</p>}
      </section>

      <section className="paso" aria-labelledby="paso-3">
        <h3 className="paso-tit" id="paso-3"><span className="paso-n">3</span>Check-in</h3>
        {apagado && <p className="in-aviso" role="status">El check-in digital está apagado. Lo prende el dueño desde su panel.</p>}
        <p className="resumen-checkin">Se va a registrar: <b>Hab. {a.habitacion} · {a.titular}</b>{a.numero != null && <> (<b>{numeroTexto(a)}</b>)</>} · {a.esperados} {a.esperados === 1 ? 'huésped' : 'huéspedes'}
          {cobra ? (falta ? ' · cobro: todavía sin confirmar' : nadaQueCobrar ? ` · cobro: ya pagado con la seña (${medioNombre ?? 'medio de pago'})` : ` · cobro: ${aCobrarTexto} ${COMO[forma]} (${medioNombre ?? 'medio de pago'})`) : ' · sin cobro'}.</p>
        {!apagado && falta && <p className="ayuda" role="status">{falta}</p>}
        {aviso && <p className="ed-error" role="alert">{aviso}</p>}
        <div className="btns modal-pie">
          <button type="button" className="btn" onClick={hacer} disabled={!puede}>{enviando ? 'Un momento…' : 'Hacer el check-in y dar el código'}</button>
          <button type="button" className="btn claro" onClick={onCerrar} disabled={enviando}>Volver</button>
        </div>
      </section>
      </>)}
      {duda && <div className="btns modal-pie"><button type="button" className="btn claro" onClick={onCerrar} disabled={enviando}>Volver</button></div>}
    </Modal>
  );
}
