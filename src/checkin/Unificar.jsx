import { useState } from 'react';
import { motivosTexto } from './hub.js';
import { fechaCorta } from './Llegadas.jsx';
import Modal from './Modal.jsx';
import { numeroTexto } from './proximas.js';
import { nochesTexto, plata } from './ReservaForm.jsx';

// Ventana para UNIFICAR dos reservas que parecen la misma cargada dos veces. Solo la usa el dueño: él aprueba.
// Muestra las dos (número, nombre, quién ingresó, lo cobrado), por qué se sospecha (habitación, día, nombre), deja elegir cuál se queda cuando hay que elegir y
// dice, antes de tocar nada, qué va a pasar. Nada se borra: la que sobra queda en «Eliminadas» como «unificada con la N.º …».
//   par: una pareja de hub.js (repetidas / paraUnir) · onUnificar(par, conservar) -> { ok, mensaje? } · onDescartar(par): «no son la misma» · onCerrar()
const tipoTexto = (x) => (x.tipo === 'anotada' ? 'Reserva anotada' : x.anotada_id ? 'Reserva armada (sale de una anotada)' : 'Reserva armada');

function Lado({ x, elegible, elegida, onElegir, bloqueada }) {
  return (
    <label className={`uni-lado${elegida ? ' elegida' : ''}${bloqueada ? ' bloqueada' : ''}`}>
      {elegible && <input type="radio" name="conservar" checked={elegida} onChange={onElegir} disabled={bloqueada} />}
      <span className="uni-datos">
        <span className="pp-cab"><b>{x.numero != null ? numeroTexto(x) : 'Sin número'}</b><span className="pp-titular">{x.titular || 'Reserva rápida'}</span></span>
        <span className="pp-det">{[tipoTexto(x), x.desde && `llega ${fechaCorta(x.desde)}`, nochesTexto(x.noches)].filter(Boolean).join(' · ')}</span>
        <span className="pp-det">{x.tipo === 'estadia' ? (x.con > 0 ? `Ingresaron ${x.con} de ${x.esperados}: ${(x.ingresaron ?? []).join(', ')}` : 'Todavía no ingresó nadie') : 'Todavía no llegó'}</span>
        {x.tipo === 'estadia' && x.monto != null && <span className="pp-det">Cobrado: {plata(x.monto, x.moneda)}{x.cargado_por ? ` · la abrió ${x.cargado_por}` : ''}</span>}
        {elegible && <span className="uni-se-queda">{elegida ? 'Esta es la que se queda' : 'Esta se une a la otra'}</span>}
        {bloqueada && <span className="pp-det">Se queda esta: sale de una reserva anotada.</span>}
      </span>
    </label>
  );
}

export default function Unificar({ par, onUnificar, onDescartar, onCerrar }) {
  const mismaClase = par.a.tipo === par.b.tipo; // armada + armada, o anotada + anotada: hay que elegir cuál se queda
  const fija = par.a.tipo === 'estadia' && par.b.tipo === 'estadia' ? (par.a.anotada_id ? par.a.clave : par.b.anotada_id ? par.b.clave : null) : null;
  const [conservar, setConservar] = useState(fija ?? par.conservar ?? par.a.clave);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState('');
  const queda = par.a.clave === conservar ? par.a : par.b;
  const sobra = queda === par.a ? par.b : par.a;
  const num = (x) => (x.numero != null ? numeroTexto(x) : 'la otra');

  const explicacion = !mismaClase
    ? `La reserva anotada ${num(par.a)} pasa a ser la reserva armada ${num(par.b)}: queda con el nombre y el número de la anotada. No cambia lo cobrado ni los huéspedes.`
    : par.a.tipo === 'estadia'
      ? `${(sobra.con ?? 0) > 0 ? `Los ${sobra.con} huéspedes de la ${num(sobra)} pasan a la ${num(queda)}. ` : ''}La ${num(sobra)} queda eliminada, «unificada con la ${num(queda)}», y no se borra: la podés restaurar. Lo cobrado es el de la ${num(queda)}${queda.monto != null ? ` (${plata(queda.monto, queda.moneda)})` : ''}${sobra.monto != null ? `; el cobro de la ${num(sobra)} (${plata(sobra.monto, sobra.moneda)}) no se suma` : ''}.`
      : `Se queda la ${num(queda)}. La ${num(sobra)} se cancela, «unificada con la ${num(queda)}», y no se borra: la podés restaurar.`;

  const unificar = async () => {
    if (trabajando) return;
    setTrabajando(true);
    setError('');
    try {
      const res = await onUnificar(par, mismaClase ? conservar : null);
      if (!res.ok) setError(res.mensaje || 'No se pudo unificar.');
    } catch {
      setError('No se pudo conectar. Revisá tu conexión e intentá de nuevo.');
    } finally {
      setTrabajando(false);
    }
  };

  return (
    <Modal titulo={`Unificar · Hab. ${par.a.habitacion}`} onCerrar={onCerrar}>
      <p className="ayuda">¿Son la misma reserva cargada dos veces? Esto es lo que se sospecha:</p>
      <ul className="rep-motivos" aria-label="Por qué parecen la misma">
        {motivosTexto(par).map((m) => <li key={m.texto} className={m.bien ? 'bien' : 'duda'}>{m.texto}</li>)}
      </ul>
      <div className="uni-par" role="radiogroup" aria-label={mismaClase ? 'Cuál se queda' : 'Las dos reservas'}>
        <Lado x={par.a} elegible={mismaClase && !fija} elegida={queda === par.a} bloqueada={!!fija && fija === par.a.clave} onElegir={() => setConservar(par.a.clave)} />
        <Lado x={par.b} elegible={mismaClase && !fija} elegida={queda === par.b} bloqueada={!!fija && fija === par.b.clave} onElegir={() => setConservar(par.b.clave)} />
      </div>
      <p className="aparte">{explicacion}</p>
      {error && <p className="ed-error" role="alert">{error}</p>}
      <div className="btns modal-pie">
        <button type="button" className="btn" onClick={unificar} disabled={trabajando}>{trabajando ? 'Un momento…' : 'Unificar'}</button>
        <button type="button" className="btn claro" onClick={() => onDescartar(par)} disabled={trabajando}>No son la misma</button>
        <button type="button" className="btn claro" onClick={onCerrar} disabled={trabajando}>Cancelar</button>
      </div>
    </Modal>
  );
}
