import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { recepcionProximas, textoCodigo } from './checkinApi.js';
import { cuando, fechaCorta } from './Llegadas.jsx';
import { agruparPorDia, filtrarProximas, ingresoTexto, seccionesDe } from './proximas.js';
import { nochesTexto } from './ReservaForm.jsx';

const CADA_MS = 15000;

// «Reservas» de recepción, separadas en dos secciones para ver de un vistazo qué falta y qué ya pasó, con un buscador por nombre (o habitación):
//   FALTA INGRESAR: las reservas anotadas que todavía no empezaron el check-in (de la más cercana a la más lejana; al tocar una se abre el detalle: la habitación, cuánto
//     hay que cobrar y recién ahí el check-in, ver CobroLlegada) y las que ya tienen el código dado pero todavía no entró nadie (se les puede volver a dar el código).
//   YA INGRESARON: las que tienen al menos un check-in: con cuántos entraron y quiénes, las que todavía esperan huéspedes (se les puede dar el código) y las completas.
// Recepción solo ve las de los días que el dueño configuró (N atrás y N adelante): lo de otras fechas no aparece ni buscando.
//   clave: la sesión · version: sube cada vez que algo cambió (se anotó, se hizo un check-in) y la lista se vuelve a pedir · salir(): si la sesión ya no vale
//   onAbrir(reserva): abre el detalle de una que falta ingresar · onAnotar(): anotar una reserva nueva (a nombre de…, por ejemplo la persona que llega de la calle)
//   onDarCodigo(estadiaId): le vuelve a dar código a una reserva en curso · trabajando: el id de la reserva a la que se le está dando código
export default function Proximas({ clave, version = 0, salir, onAbrir, onAnotar, onDarCodigo, trabajando = null }) {
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

  const todas = datos?.reservas ?? [];
  const visibles = useMemo(() => filtrarProximas(todas, buscar), [todas, buscar]);
  const sec = useMemo(() => seccionesDe(visibles), [visibles]);
  const pendientes = useMemo(() => [...sec.pasadas, ...sec.porLlegar], [sec]); // por fecha: primero las que se pasaron, después hoy y las que vienen
  const grupos = useMemo(() => agruparPorDia(pendientes), [pendientes]);
  const buscando = buscar.trim() !== '';
  const personas = (n) => `${n} ${n === 1 ? 'huésped' : 'huéspedes'}`;

  // Una reserva que ya empezó el check-in: cuántos entraron y quiénes; si todavía faltan, el botón para darle el código.
  const filaEnCurso = (a) => {
    const faltan = Number(a.con_checkin) < Number(a.esperados);
    const clase = Number(a.con_checkin) === 0 ? 'nadie' : faltan ? 'faltan' : 'completa';
    return (
      <li key={a.id} className={`pp-card ${clase}`}>
        <div className="pp-datos">
          <span className="pp-cab"><b className="pp-hab">Hab. {a.habitacion}</b><span className="pp-titular">{a.titular}</span></span>
          <span className="pp-det">{[nochesTexto(a.noches), personas(a.esperados), a.categoria].filter(Boolean).join(' · ')}</span>
          <span className={`pp-ingreso ${clase}`}>{ingresoTexto(a)}</span>
          {a.ingresaron?.length > 0 && <span className="pp-nombres">{a.ingresaron.join(', ')}</span>}
        </div>
        {faltan && <button type="button" className="btn mini" onClick={() => onDarCodigo(a.estadia_id)} disabled={trabajando === a.estadia_id}>{trabajando === a.estadia_id ? 'Un momento…' : 'Dar código'}</button>}
      </li>
    );
  };

  return (
    <div className="proximas">
      <p className="aclara">Buscá a la persona. Las reservas están separadas en las que todavía <b>falta ingresar</b> y las que <b>ya ingresaron</b> (al menos una persona hizo el check-in).</p>
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

      {datos && visibles.length > 0 && (
        <>
          <section className="sec sec-falta" aria-labelledby="sec-falta">
            <h2 className="sec-tit" id="sec-falta">Falta ingresar <span className="sec-n">{sec.faltaIngresar}</span></h2>
            <p className="sec-ayuda">Todavía no ingresó nadie.</p>
            {sec.faltaIngresar === 0 && <p className="ab-vacio" role="status">No hay reservas por ingresar en estos días.</p>}
            {grupos.map((g) => (
              <div key={g.fecha} className="pp-dia">
                <h3 className="pp-dia-tit"><b>{cuando(g.dias)}</b> · {fechaCorta(g.fecha)}</h3>
                <ul className="ll-lista">
                  {g.items.map((a) => (
                    <li key={a.id}>
                      <button type="button" className={`pp-fila${a.dias_para < 0 ? ' pasada' : ''}`} onClick={() => onAbrir(a)}>
                        <span className="pp-datos">
                          <span className="pp-cab"><b className="pp-hab">Hab. {a.habitacion}</b><span className="pp-titular">{a.titular}</span></span>
                          <span className="pp-det">{[nochesTexto(a.noches), personas(a.esperados), a.categoria].filter(Boolean).join(' · ')}</span>
                          {a.dias_para < 0 && <span className="pp-estado">Todavía no llegó</span>}
                        </span>
                        <Icon name="adelante" size={22} sw={2} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {sec.sinNadie.length > 0 && (
              <div className="pp-dia">
                <h3 className="pp-dia-tit"><b>Con el código dado</b> · todavía no entró nadie ({sec.sinNadie.length})</h3>
                <ul className="ll-lista">{sec.sinNadie.map(filaEnCurso)}</ul>
              </div>
            )}
          </section>

          <section className="sec sec-ingresaron" aria-labelledby="sec-ingresaron">
            <h2 className="sec-tit" id="sec-ingresaron">Ya ingresaron <span className="sec-n">{sec.yaIngresaron}</span></h2>
            <p className="sec-ayuda">Al menos una persona ya hizo el check-in.</p>
            {sec.yaIngresaron === 0 && <p className="ab-vacio" role="status">Todavía no ingresó nadie en estos días.</p>}
            {sec.faltanHuespedes.length > 0 && (
              <div className="pp-dia">
                <h3 className="pp-dia-tit"><b>Faltan huéspedes</b> ({sec.faltanHuespedes.length})</h3>
                <ul className="ll-lista">{sec.faltanHuespedes.map(filaEnCurso)}</ul>
              </div>
            )}
            {sec.completas.length > 0 && (
              <div className="pp-dia">
                <h3 className="pp-dia-tit"><b>Completas</b> · ingresaron todos ({sec.completas.length})</h3>
                <ul className="ll-lista">{sec.completas.map(filaEnCurso)}</ul>
              </div>
            )}
          </section>
        </>
      )}

      {datos?.mas > 0 && <p className="ayuda">Se muestran las 300 más cercanas; hay {datos.mas} más.</p>}
      <div className="btns">
        <button type="button" className="btn" onClick={onAnotar}>Anotar una reserva (a nombre de…)</button>
      </div>
    </div>
  );
}
