import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { recepcionProximas, textoCodigo } from './checkinApi.js';
import { PESTANAS, candidatasPara, cierreTexto, clasificarHub, controlLlegadas, dudaTexto, parecidaTexto, parecidas } from './hub.js';
import { cuando, fechaCorta } from './Llegadas.jsx';
import { agruparPorDia, ingresoTexto, numeroTexto } from './proximas.js';
import { nochesTexto } from './ReservaForm.jsx';

const CADA_MS = 15000;
const personas = (n) => `${n} ${n === 1 ? 'huésped' : 'huéspedes'}`;

// La pantalla «Reservas» de recepción: todo lo de las reservas en un solo lugar.
//   · Arriba, un cartel que dice si todavía falta llegar alguien («estar atento») o si ya llegaron todas las de hoy («quedarse tranquilo»).
//   · Para crear: anotar una reserva a nombre de alguien o abrir una reserva rápida (sin nombre); al crearla se da el código para el huésped.
//   · Un buscador (por nombre, habitación o quien ya ingresó) y las pestañas: Faltan llegar · Falta cerrar · Cerradas · Próximas · Historial (por día).
// Recepción solo ve lo de los días que el dueño configuró (N atrás y N adelante); el dueño ve todo.
//   Cada reserva muestra su NÚMERO («N.º 41») para distinguir una de otra; el buscador también la encuentra por número. Si dos parecen la misma, se avisa.
//   El DUEÑO además puede eliminar cualquier reserva (no se borra: va a la pestaña «Eliminadas», desde donde la restaura).
//   clave: la sesión · version: sube cuando algo cambió y la lista se vuelve a pedir · salir(): si la sesión ya no vale · dueno: puede reabrir una reserva cerrada, eliminar y restaurar
//   onAbrir(anotada): abre el detalle para cobrar y hacer el check-in · onAnotar() / onRapida(): crear · onDarCodigo(estadiaId) · onCerrar(estadia) · onReabrir(estadia) · onAnular(estadia)
//   onEliminar({ tipo: 'anotada' | 'estadia', …la reserva }) · onRestaurar({ tipo, …lo eliminado }): solo el dueño
//   trabajando: el id de la reserva a la que se le está haciendo algo (para apagar sus botones)
export default function Reservas({ clave, version = 0, salir, dueno = false, apagado = false, trabajando = null, onAbrir, onAnotar, onRapida, onDarCodigo, onCerrar, onReabrir, onAnular, onEliminar, onRestaurar }) {
  const [datos, setDatos] = useState(null); // la última respuesta de la base
  const [error, setError] = useState('');
  const [buscar, setBuscar] = useState('');
  const [pestana, setPestana] = useState('faltan');
  const reloj = useRef(null);
  const botones = useRef({});

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

  // Se pide al abrir, cada tanto mientras la pantalla se ve (para que aparezcan las que cargan los demás) y cada vez que `version` cambia.
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

  const c = useMemo(() => clasificarHub(datos, buscar), [datos, buscar]);
  const k = useMemo(() => controlLlegadas(datos), [datos]);
  const par = useMemo(() => parecidas(datos), [datos]); // reservas que pueden ser la misma cargada dos veces
  const pestanas = PESTANAS.filter((p) => !p.soloDueno || dueno);
  const buscando = buscar.trim() !== '';
  const hayAlgo = (datos?.reservas?.length ?? 0) + (datos?.estadias?.length ?? 0) > 0;
  const total = Object.entries(c.conteo).filter(([id]) => id !== 'eliminadas').reduce((s, [, x]) => s + x, 0);

  // Flechas para pasar de una pestaña a otra, como en las estadísticas.
  const alTecla = (e) => {
    const i = pestanas.findIndex((p) => p.id === pestana);
    const ir = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: pestanas.length - 1 }[e.key];
    if (ir == null) return;
    e.preventDefault();
    const sig = pestanas[(ir + pestanas.length) % pestanas.length].id;
    setPestana(sig);
    botones.current[sig]?.focus();
  };

  // Una reserva anotada que todavía no empezó el check-in: se toca para ver la habitación, cobrar y hacer el check-in.
  // Si en esa misma habitación ya hay una reserva abierta aparte (sin anotada), puede que sea la misma persona y la anotada quedó duplicada: se avisa y el detalle pide decidirlo.
  const filaAnotada = (a) => {
    const candidatas = candidatasPara(a, datos?.estadias);
    const repetidas = par[`a${a.id}`] ?? [];
    return (
      <li key={a.id} className="pp-item">
        <button type="button" className={`pp-fila${a.dias_para < 0 ? ' pasada' : ''}${candidatas.length || repetidas.length ? ' duda' : ''}`} onClick={() => onAbrir({ ...a, candidatas })}>
          <span className="pp-datos">
            <span className="pp-cab"><b className="pp-hab">Hab. {a.habitacion}</b><span className="pp-titular">{a.titular}</span>{a.numero != null && <span className="pp-num">{numeroTexto(a)}</span>}</span>
            <span className="pp-det">{[nochesTexto(a.noches), personas(a.esperados), a.categoria].filter(Boolean).join(' · ')}</span>
            {a.dias_para < 0 && <span className="pp-estado">Todavía no llegó</span>}
            {candidatas.length > 0 && <span className="pp-duda">{dudaTexto(candidatas, a.habitacion)} Tocá para ver y unirlas.</span>}
            {candidatas.length === 0 && repetidas.length > 0 && <span className="pp-duda">{parecidaTexto(repetidas)}</span>}
          </span>
          <Icon name="adelante" size={22} sw={2} />
        </button>
        {dueno && (
          <div className="pp-solo">
            <button type="button" className="btn mini claro" onClick={() => onEliminar({ tipo: 'anotada', ...a })} disabled={trabajando === `a${a.id}`}>{trabajando === `a${a.id}` ? 'Un momento…' : 'Eliminar'}</button>
          </div>
        )}
      </li>
    );
  };

  // Una reserva que ya está armada (anotada que empezó o reserva rápida): cuántos entraron y quiénes, y lo que se puede hacer según cómo esté.
  const filaEstadia = (e) => {
    const clase = { sin_ingresos: 'nadie', faltan: 'faltan', completa: 'completa', cerrada: 'cerrada' }[e.estado];
    const texto = e.estado === 'sin_ingresos' ? 'Todavía no entró nadie' : e.estado === 'faltan' ? ingresoTexto(e) : cierreTexto(e);
    const ocupado = trabajando === e.id;
    const repetidas = par[`e${e.id}`] ?? [];
    return (
      <li key={e.id} className={`pp-card ${clase}`}>
        <div className="pp-datos">
          <span className="pp-cab"><b className="pp-hab">Hab. {e.habitacion}</b><span className="pp-titular">{e.titular || 'Reserva rápida'}</span>{e.numero != null && <span className="pp-num">{numeroTexto(e)}</span>}</span>
          <span className="pp-det">{[nochesTexto(e.noches), personas(e.esperados), e.categoria].filter(Boolean).join(' · ')}</span>
          <span className={`pp-ingreso ${clase}`}>{texto}</span>
          {e.ingresaron?.length > 0 && <span className="pp-nombres">{e.ingresaron.join(', ')}</span>}
          {repetidas.length > 0 && <span className="pp-duda">{parecidaTexto(repetidas)}</span>}
        </div>
        <div className="pp-acciones">
          {(e.estado === 'sin_ingresos' || e.estado === 'faltan') && <button type="button" className="btn mini" onClick={() => onDarCodigo(e.id)} disabled={ocupado || apagado}>{ocupado ? 'Un momento…' : 'Dar código'}</button>}
          {e.estado === 'faltan' && <button type="button" className="btn mini claro" onClick={() => onCerrar(e)} disabled={ocupado}>Cerrar reserva</button>}
          {e.estado === 'sin_ingresos' && !dueno && <button type="button" className="btn mini claro" onClick={() => onAnular(e)} disabled={ocupado}>Anular</button>}
          {e.estado === 'cerrada' && dueno && <button type="button" className="btn mini claro" onClick={() => onReabrir(e)} disabled={ocupado}>Reabrir</button>}
          {dueno && <button type="button" className="btn mini claro" onClick={() => onEliminar({ tipo: 'estadia', ...e })} disabled={ocupado}>Eliminar</button>}
        </div>
      </li>
    );
  };

  const grupo = (titulo, items, fila, ayuda) => items.length > 0 && (
    <div className="pp-dia">
      <h3 className="pp-dia-tit"><b>{titulo}</b> ({items.length})</h3>
      {ayuda && <p className="sec-ayuda">{ayuda}</p>}
      <ul className="ll-lista">{items.map(fila)}</ul>
    </div>
  );
  const vacio = (texto) => <p className="ab-vacio" role="status">{buscando ? `Nada en esta sección coincide con «${buscar.trim()}».` : texto}</p>;

  return (
    <div className="reservas-hub">
      {datos && (
        <section className={`hub-resumen ${k.estado}`} aria-label="Llegadas de hoy">
          {k.estado === 'esperando' ? (
            <>
              <b>Faltan llegar {k.faltan} {k.faltan === 1 ? 'reserva' : 'reservas'}</b>
              <span>{[k.hoy > 0 && `${k.hoy} de hoy`, k.atrasadas > 0 && `${k.atrasadas} ${k.atrasadas === 1 ? 'atrasada' : 'atrasadas'}`, k.sinIngresos > 0 && `${k.sinIngresos} con el código dado y nadie adentro`].filter(Boolean).join(' · ')}</span>
              <span className="hub-quienes">Estate atento: {k.quienes.join(' · ')}{k.faltan > k.quienes.length ? ' y más' : ''}</span>
            </>
          ) : (
            <>
              <b>Ya llegaron todas las de hoy</b>
              <span>Podés quedarte tranquilo.{k.manana > 0 ? ` Mañana ${k.manana === 1 ? 'llega 1 reserva' : `llegan ${k.manana} reservas`}.` : ''}</span>
            </>
          )}
          {k.cerrar > 0 && <span className="hub-aparte">{k.cerrar} {k.cerrar === 1 ? 'reserva con huéspedes por llegar o cerrar' : 'reservas con huéspedes por llegar o cerrar'} (pestaña «Falta cerrar»)</span>}
        </section>
      )}

      <div className="btns hub-acciones">
        <button type="button" className="btn" onClick={onAnotar}>Anotar reserva (con nombre)</button>
        <button type="button" className="btn claro" onClick={onRapida} disabled={apagado}>Reserva rápida (sin nombre)</button>
      </div>
      {apagado && <p className="in-aviso" role="status">El check-in digital está apagado: no se pueden dar códigos. Lo prende el dueño desde su panel.</p>}

      {datos?.limitada && <p className="pp-rango" role="note">Se ven las reservas desde hace <b>{datos.dias} {datos.dias === 1 ? 'día' : 'días'}</b> hasta dentro de <b>{datos.dias} {datos.dias === 1 ? 'día' : 'días'}</b>.</p>}
      <div className="campo pp-buscar">
        <label htmlFor="pp-buscar">Buscar por nombre, habitación o N.º de reserva</label>
        <input id="pp-buscar" type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)} autoComplete="off" placeholder="Ej. Pérez, 107 o 41" enterKeyHint="search" />
      </div>
      {error && <p className="ed-error" role="alert">{error}</p>}
      {!datos && !error && <p className="intro" role="status">Cargando…</p>}
      {buscando && datos && <p className="pp-cuenta" role="status">{total} {total === 1 ? 'reserva encontrada' : 'reservas encontradas'} en total</p>}
      {buscando && datos && total === 0 && hayAlgo && <p className="ab-vacio" role="status">Ninguna reserva coincide con «{buscar.trim()}». Probá con solo el apellido o con la habitación.{datos.limitada ? ` Si la reserva es de otra fecha (más de ${datos.dias} ${datos.dias === 1 ? 'día' : 'días'} atrás o adelante), no se muestra: avisale al dueño.` : ''}</p>}

      {datos && (
        <>
          <div className="hub-tabs" role="tablist" aria-label="Secciones de reservas" onKeyDown={alTecla}>
            {pestanas.map((p) => (
              <button key={p.id} type="button" role="tab" id={`hub-tab-${p.id}`} aria-selected={pestana === p.id} aria-controls="hub-panel" tabIndex={pestana === p.id ? 0 : -1}
                ref={(el) => { botones.current[p.id] = el; }} className={pestana === p.id ? 'activa' : ''} onClick={() => setPestana(p.id)}>
                {p.texto}<span className="hub-n">{c.conteo[p.id]}</span>
              </button>
            ))}
          </div>

          <div id="hub-panel" role="tabpanel" aria-labelledby={`hub-tab-${pestana}`} className="hub-panel">
            {pestana === 'faltan' && (
              <>
                <p className="sec-ayuda">Todavía no llegó nadie. Tocá una para ver la habitación, cobrar y hacer el check-in.</p>
                {c.conteo.faltan === 0 && vacio('No falta llegar nadie.')}
                {grupo('Atrasadas', c.faltan.atrasadas, filaAnotada, 'Tenían que llegar antes y todavía no hicieron el check-in.')}
                {grupo('Hoy', c.faltan.hoy, filaAnotada)}
                {grupo('Con el código dado', c.faltan.sinIngresos, filaEstadia, 'Se empezó el check-in pero todavía no entró ningún huésped.')}
              </>
            )}
            {pestana === 'cerrar' && (
              <>
                <p className="sec-ayuda">Ya ingresó alguien y faltan otros. Dales el código o, si no van a venir, cerrá la reserva.</p>
                {c.cerrar.length === 0 && vacio('No hay reservas por cerrar.')}
                {c.cerrar.length > 0 && <ul className="ll-lista">{c.cerrar.map(filaEstadia)}</ul>}
              </>
            )}
            {pestana === 'cerradas' && (
              <>
                <p className="sec-ayuda">Ya terminaron: entraron todos o se cerraron a mano.{dueno ? ' Si se cerró una por error, la podés reabrir.' : ''}</p>
                {c.cerradas.length === 0 && vacio('Todavía no hay reservas cerradas en estos días.')}
                {c.cerradas.length > 0 && <ul className="ll-lista">{c.cerradas.map(filaEstadia)}</ul>}
              </>
            )}
            {pestana === 'proximas' && (
              <>
                <p className="sec-ayuda">Las que llegan de mañana en adelante.</p>
                {c.proximas.length === 0 && vacio('No hay reservas anotadas para los próximos días.')}
                {agruparPorDia(c.proximas).map((g) => (
                  <div key={g.fecha} className="pp-dia">
                    <h3 className="pp-dia-tit"><b>{cuando(g.dias)}</b> · {fechaCorta(g.fecha)}</h3>
                    <ul className="ll-lista">{g.items.map(filaAnotada)}</ul>
                  </div>
                ))}
              </>
            )}
            {pestana === 'eliminadas' && dueno && (
              <>
                <p className="sec-ayuda">Lo que eliminaste en los últimos 60 días. No se borró nada: tocá «Restaurar» y vuelve a su lugar (con sus huéspedes y su número).</p>
                {c.eliminadas.length === 0 && vacio('No hay reservas eliminadas.')}
                {c.eliminadas.length > 0 && (
                  <ul className="ll-lista">
                    {c.eliminadas.map((x) => {
                      const ocupado = trabajando === (x.tipo === 'anotada' ? `a${x.id}` : x.id);
                      return (
                        <li key={`${x.tipo}${x.id}`} className="pp-card eliminada">
                          <div className="pp-datos">
                            <span className="pp-cab"><b className="pp-hab">Hab. {x.habitacion}</b><span className="pp-titular">{x.titular || 'Reserva rápida'}</span>{x.numero != null && <span className="pp-num">{numeroTexto(x)}</span>}</span>
                            <span className="pp-det">{[x.tipo === 'anotada' ? 'Reserva anotada' : 'Reserva armada', nochesTexto(x.noches), personas(x.esperados), x.llegada && `llegada ${fechaCorta(x.llegada)}`].filter(Boolean).join(' · ')}</span>
                            <span className="pp-det">Eliminada{x.por ? ` por ${x.por}` : ''}{x.cuando ? ` el ${fechaCorta(String(x.cuando).slice(0, 10))}` : ''}{x.huespedes > 0 ? ` · se fueron con ella ${personas(x.huespedes)}` : ''}</span>
                          </div>
                          <div className="pp-acciones">
                            <button type="button" className="btn mini" onClick={() => onRestaurar(x)} disabled={ocupado}>{ocupado ? 'Un momento…' : 'Restaurar'}</button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
            {pestana === 'historial' && (
              <>
                <p className="sec-ayuda">Las que ya llegaron, por día.</p>
                {c.historial.length === 0 && vacio('Todavía no llegó ninguna en estos días.')}
                {c.historial.map((d) => (
                  <div key={d.fecha} className="pp-dia">
                    <h3 className="pp-dia-tit"><b>{cuando(d.dias)}</b> · {fechaCorta(d.fecha)} <span className="pp-dia-n">{d.items.length} {d.items.length === 1 ? 'reserva' : 'reservas'} · {personas(d.huespedes)}</span></h3>
                    <ul className="ll-lista">{d.items.map(filaEstadia)}</ul>
                  </div>
                ))}
              </>
            )}
          </div>
        </>
      )}

      {datos?.mas > 0 && <p className="ayuda">Se muestran las 300 más cercanas; hay {datos.mas} más.</p>}
    </div>
  );
}
