import { ventaEn } from '../admin/estadisticas.js';
import { aCobrar } from './cobro.js';
import { ingresoTexto } from './proximas.js';
import { hoyAR, nochesTexto, plata } from './ReservaForm.jsx';

// Las reservas anotadas por adelantado, como las ven recepción («Llegadas») y el dueño: a nombre de quién, cuándo llega, qué habitación y cuántos son,
// la nota, y CUÁNTO HAY QUE COBRAR según cómo pague lo que resta (efectivo, transferencia o dólares).

const ddmm = (iso) => iso.split('-').reverse().slice(0, 2).join('/');
const diaSemana = (iso) => new Intl.DateTimeFormat('es-AR', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));
export const fechaCorta = (iso) => `${diaSemana(iso)} ${ddmm(iso)}`;
export const cuando = (dias) => (dias === 0 ? 'Hoy' : dias === 1 ? 'Mañana' : dias === -1 ? 'Ayer' : dias > 1 ? `En ${dias} días` : `Hace ${-dias} días`);

// El dólar oficial (venta) de hoy, o null si todavía no llegó la lista o no se pudo traer.
export const ventaDeHoy = (cotizaciones) => (cotizaciones?.length ? ventaEn(cotizaciones, hoyAR()) : null);

// Lo que queda por cobrar de cada manera. Sin seña, todo; con seña, el precio menos la seña (ya la pagó, no importa cómo).
export function ACobrar({ a, venta }) {
  if (a.canal_cobra === false) return <p className="ll-sin">Sin cobro: se factura aparte.</p>;
  const c = aCobrar(a, venta);
  const sena = c.efectivo.sena;
  return (
    <div className="ll-cobrar">
      <p className="ll-tit">A cobrar al llegar{sena > 0 ? <> · ya pagó <b>{plata(sena, 'ARS')}</b> de seña</> : ''}</p>
      <dl>
        <div><dt>Efectivo</dt><dd>{plata(c.efectivo.resta, 'ARS')}</dd></div>
        <div><dt>Transferencia</dt><dd>{plata(c.transferencia.resta, 'ARS')}</dd></div>
        <div><dt>Dólares</dt><dd>{c.usd ? `${plata(c.usd.resta, 'USD')}${c.usd.estimado ? ' *' : ''}` : 'sin cotización'}</dd></div>
      </dl>
      <p className="ll-total">Precio total: {plata(c.efectivo.total, 'ARS')} en efectivo{c.transferencia.igualEfectivo ? ' (igual en transferencia)' : ` · ${plata(c.transferencia.total, 'ARS')} en transferencia`}{c.usd && !c.usd.estimado ? ` · ${plata(c.usd.total, 'USD')} en dólares` : ''}</p>
      {c.usd?.estimado && <p className="ll-ayuda">* Dólares calculado con el dólar oficial de hoy ($ {Number(venta).toLocaleString('es-AR')}): no hay precio en dólares cargado.</p>}
      {!c.usd && <p className="ll-ayuda">No se pudo traer el dólar oficial: en dólares escribí el monto a mano.</p>}
    </div>
  );
}

// Una reserva anotada. `children`: los botones (hacer el check-in; o editar y cancelar para el dueño).
export function TarjetaLlegada({ a, venta, children }) {
  // El cartelito de la esquina: una reserva cancelada, o cómo viene el check-in de una que ya empezó (código dado sin nadie / faltan huéspedes / completa).
  const falta = a.estado === 'en_curso' ? Number(a.esperados) - Number(a.con_checkin) : 0;
  const estados = { cancelada: 'Cancelada', en_curso: Number(a.con_checkin) === 0 ? 'Código dado' : falta > 0 ? `Faltan ${falta}` : 'Completa' };
  return (
    <li className={`ll-card ${a.estado}${a.estado === 'anotada' && a.dias_para < 0 ? ' pasada' : ''}`}>
      <div className="ll-cab"><b>Hab. {a.habitacion}</b><span className="ll-titular">{a.titular}</span>{a.numero != null && <span className="pp-num">N.º {a.numero}</span>}{estados[a.estado] && <em className="ll-estado">{estados[a.estado]}</em>}</div>
      <p className="ll-cuando"><b>{cuando(a.dias_para)}</b> · llega {fechaCorta(a.fecha_ingreso)} · sale {fechaCorta(a.salida)}</p>
      <p className="ll-det">{[a.categoria, nochesTexto(a.noches), `${a.esperados} ${a.esperados === 1 ? 'huésped' : 'huéspedes'}`, a.canal].filter(Boolean).join(' · ')}</p>
      {a.nota && <p className="ll-nota"><span>Nota</span> {a.nota}</p>}
      {a.estado !== 'cancelada' && !(a.estado === 'en_curso') && <ACobrar a={a} venta={venta} />}
      {a.estado === 'en_curso' && <p className="ll-det">{ingresoTexto(a)}{a.ingresaron?.length ? `: ${a.ingresaron.join(', ')}` : ''}.</p>}
      {children}
    </li>
  );
}
