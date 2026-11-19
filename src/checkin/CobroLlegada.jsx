import { useMemo, useState } from 'react';
import { aCobrar, prefillDe } from './cobro.js';
import { ACobrar } from './Llegadas.jsx';
import Modal from './Modal.jsx';
import ReservaForm, { plata } from './ReservaForm.jsx';

// El check-in de una reserva anotada: recepción ve cuánto cobrar según cómo pague lo que resta, elige la forma y el formulario de la reserva queda completado
// con esos montos (la seña ya pagada incluida). Todo se puede corregir antes de generar el código (por ejemplo, si en el mostrador se negoció otro monto).
//   a: la reserva anotada · venta: dólar oficial de hoy (o null) · medios / canales / categorías: las listas de siempre · onIniciar(r) -> { ok, mensaje?, campos? }
const FORMAS = [['efectivo', 'Efectivo'], ['transferencia', 'Transferencia'], ['usd', 'Dólares']];

export default function CobroLlegada({ a, venta, medios, canales, categorias, onIniciar, onCerrar }) {
  const cobra = a.canal_cobra !== false;
  const [forma, setForma] = useState('efectivo');
  const c = useMemo(() => (cobra ? aCobrar(a, venta) : null), [a, venta, cobra]);
  const prefill = useMemo(() => prefillDe(a, forma, venta, medios), [a, forma, venta, medios]);
  const monto = (f) => (c?.[f] ? plata(c[f].resta, f === 'usd' ? 'USD' : 'ARS') : 'sin cotización');
  return (
    <Modal titulo={`Check-in de ${a.titular}`} onCerrar={onCerrar}>
      <p className="ll-hab">Hab. {a.habitacion} · {a.esperados} {a.esperados === 1 ? 'huésped' : 'huéspedes'}</p>
      {a.nota && <p className="ll-nota"><span>Nota</span> {a.nota}</p>}
      {cobra && <ACobrar a={a} venta={venta} />}
      {cobra && (
        <div className="campo">
          <span className="etq" id="forma-etq">¿Cómo paga lo que resta?</span>
          <div className="fichas" role="radiogroup" aria-labelledby="forma-etq">
            {FORMAS.map(([id, texto]) => (
              <button key={id} type="button" role="radio" aria-checked={forma === id} className={forma === id ? 'activa' : ''} onClick={() => setForma(id)}>
                {texto}<small>{monto(id)}</small>
              </button>
            ))}
          </div>
          <p className="ayuda">Completa el cobro de abajo. Si cobrás otro monto, corregilo antes de generar el código.</p>
        </div>
      )}
      <ReservaForm key={forma} prefill={prefill} medios={medios} canales={canales} categorias={categorias} onGuardar={onIniciar} texto="Generar códigos" alCancelar={onCerrar} />
    </Modal>
  );
}
