import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { recepcionProximas, textoCodigo } from './checkinApi.js';
import { cuando, fechaCorta } from './Llegadas.jsx';
import { agruparPorDia, filtrarProximas, soloEsperando } from './proximas.js';
import { nochesTexto } from './ReservaForm.jsx';

const CADA_MS = 15000;

// «Próximas reservas» de recepción: las reservas que el dueño (o un compañero) anotó y todavía esperan al huésped, de la más cercana a la más lejana, con un
// buscador por nombre (o habitación). Recepción solo ve las de los días que el dueño configuró (N atrás y N adelante): lo de otras fechas no aparece ni buscando.
// Al tocar una se abre el detalle: la habitación, cuánto hay que cobrar y recién ahí el check-in (ver CobroLlegada).
//   clave: la sesión · version: sube cada vez que algo cambió (se anotó, se hizo un check-in) y la lista se vuelve a pedir · salir(): si la sesión ya no vale
//   onAbrir(reserva): abre el detalle · onAnotar(): anotar una reserva nueva (a nombre de…, por ejemplo la persona que llega de la calle)
export default function Proximas({ clave, version = 0, salir, onAbrir, onAnotar }) {
  const [datos, setDatos] = useState(null); // la última respuesta de la base
  const [error, setError] = useState('');
  const [buscar, setBuscar] = useState('');
  const reloj = useRef(null);

  const cargar = useCallback(async () => {
    try {
      const r = await recepcionProximas(clave);
      if (!r.ok) {
        if (r.error === 'clave_incorrecta') { salir(); return; }
        setError(textoCodigo(r.error));
        return;
      }
      setDatos(r);
      setError('');
    } catch {
      setError('Sin conexión. Reintentando…');
    }
  }, [clave, salir]);

  // Se pide al abrir, cada tanto mientras la pantalla se ve (para que aparezcan las que anotan los demás) y cada vez que `version` cambia.
  useEffect(() => {
    let vivo = true;
    const vuelta = async () => {
      if (document.visibilityState !== 'hidden') await cargar();
      if (vivo) reloj.current = setTimeout(vuelta, CADA_MS);
    };
    vuelta();
    const alVolver = () => { if (document.visibilityState === 'visible') { clearTimeout(reloj.current); vuelta(); } };
    document.addEventListener('visibilitychange', alVolver);
    return () => { vivo = false; clearTimeout(reloj.current); document.removeEventListener('visibilitychange', alVolver); };
  }, [cargar, version]);

  const todas = useMemo(() => soloEsperando(datos?.reservas ?? []), [datos]);
  const visibles = useMemo(() => filtrarProximas(todas, buscar), [todas, buscar]);
  const grupos = useMemo(() => agruparPorDia(visibles), [visibles]);
  const buscando = buscar.trim() !== '';

  return (
    <div className="proximas">
      <p className="aclara">Buscá a la persona, tocá su reserva y mirá la habitación y cuánto hay que cobrar. Después se hace el check-in y se da el código.</p>
      {datos?.limitada && <p className="pp-rango" role="note">Se ven las reservas desde hace <b>{datos.dias} {datos.dias === 1 ? 'día' : 'días'}</b> hasta dentro de <b>{datos.dias} {datos.dias === 1 ? 'día' : 'días'}</b>.</p>}
      <div className="campo pp-buscar">
        <label htmlFor="pp-buscar">Buscar por nombre o habitación</label>
        <input id="pp-buscar" type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)} autoComplete="off" placeholder="Ej. Pérez o 107" enterKeyHint="search" />
      </div>
      {error && <p className="ed-error" role="alert">{error}</p>}
      {!datos && !error && <p className="intro" role="status">Cargando…</p>}
      {datos && todas.length === 0 && <p className="ab-vacio" role="status">No hay reservas anotadas para estos días. Las que anote el dueño o tus compañeros aparecen acá.</p>}
      {datos && todas.length > 0 && visibles.length === 0 && <p className="ab-vacio" role="status">Ninguna reserva coincide con «{buscar.trim()}». Probá con solo el apellido o con la habitación.{datos.limitada ? ` Si la reserva es de otra fecha (más de ${datos.dias} ${datos.dias === 1 ? 'día' : 'días'} atrás o adelante), no se muestra: avisale al dueño.` : ''}</p>}
      {buscando && visibles.length > 0 && <p className="pp-cuenta" role="status">{visibles.length} {visibles.length === 1 ? 'reserva encontrada' : 'reservas encontradas'}</p>}

      {grupos.map((g) => (
        <section key={g.fecha} className="pp-dia" aria-label={`${cuando(g.dias)}, ${fechaCorta(g.fecha)}`}>
          <h2 className="pp-dia-tit"><b>{cuando(g.dias)}</b> · {fechaCorta(g.fecha)}</h2>
          <ul className="ll-lista">
            {g.items.map((a) => (
              <li key={a.id}>
                <button type="button" className={`pp-fila${a.dias_para < 0 ? ' pasada' : ''}`} onClick={() => onAbrir(a)}>
                  <span className="pp-datos">
                    <span className="pp-cab"><b className="pp-hab">Hab. {a.habitacion}</b><span className="pp-titular">{a.titular}</span></span>
                    <span className="pp-det">{[nochesTexto(a.noches), `${a.esperados} ${a.esperados === 1 ? 'huésped' : 'huéspedes'}`, a.categoria].filter(Boolean).join(' · ')}</span>
                    {a.dias_para < 0 && <span className="pp-estado">Todavía no llegó</span>}
                  </span>
                  <Icon name="adelante" size={22} sw={2} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {datos?.mas > 0 && <p className="ayuda">Se muestran las 300 más cercanas; hay {datos.mas} más.</p>}
      <div className="btns">
        <button type="button" className="btn" onClick={onAnotar}>Anotar una reserva (a nombre de…)</button>
      </div>
    </div>
  );
}
