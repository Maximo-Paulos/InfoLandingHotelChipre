import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../components/Icon.jsx';
import FotosHuesped from '../admin/FotosHuesped.jsx';
import BarraPersonal from '../BarraPersonal.jsx';
import { useNoIndexar } from '../personal.js';
import { cerrarSesion, entrarConClave, leerSesion } from '../sesion.js';
import { cargarCotizaciones } from '../admin/cotizaciones.js';
import { recepcionCodigoNuevo, recepcionEditar, recepcionEstadiaEditar, recepcionEstado, recepcionLlegadaIniciar, recepcionReservaAbrir, recepcionReservaAnular, recepcionReservaCerrar, recepcionReservaNueva, textoCodigo } from './checkinApi.js';
import CobroLlegada from './CobroLlegada.jsx';
import EditarHuesped from './EditarHuesped.jsx';
import { TarjetaLlegada, ventaDeHoy } from './Llegadas.jsx';
import Modal from './Modal.jsx';
import Planilla from './Planilla.jsx';
import ReservaForm, { cobroLinea, detalleTexto, huespedesTexto } from './ReservaForm.jsx';
import { agruparCodigo, minSeg, tiempoCorto, useAhora } from './util.js';

const CADA_MS = 3000;

// Pantalla de recepción: ingreso con la clave propia de cada persona (o la del dueño, desde su panel). Tiene dos pestañas: «Código»
// (las reservas abiertas y el código para el huésped, que es de quien está en sesión) y «Huéspedes» (la planilla de los últimos días).
// «Código» tiene tres vistas: el código de una reserva (mientras dura), la lista (las LLEGADAS que el dueño anotó por adelantado, con cuánto cobrar, y las
// reservas abiertas, las que todavía esperan huéspedes, de todo el equipo: así el turno de la tarde atiende al que llega tarde) y el formulario de reserva nueva.
// La sesión queda abierta en el dispositivo (ver sesion.js).
export default function Recepcion({ vista = 'codigo' }) {
  useNoIndexar('Recepción');
  const [sesion, setSesion] = useState(leerSesion); // { token, rol } o null
  const salir = useCallback(() => { cerrarSesion(); setSesion(null); }, []);
  if (!sesion) return <Ingreso alEntrar={setSesion} />;
  return <Panel clave={sesion.token} rol={sesion.rol} vista={vista} salir={salir} />;
}

function Ingreso({ alEntrar }) {
  const [error, setError] = useState('');
  const [entrando, setEntrando] = useState(false);
  const entrar = async (e) => {
    e.preventDefault();
    const k = e.currentTarget.elements.clave.value;
    setEntrando(true);
    setError('');
    try {
      alEntrar(await entrarConClave(k));
    } catch (err) {
      setError(err.codigo ? textoCodigo(err.codigo) : 'No se pudo conectar. Revisá tu conexión.');
    } finally {
      setEntrando(false);
    }
  };
  return (
    <div className="page">
      <main className="card login">
        <h1>Recepción</h1>
        <form onSubmit={entrar}>
          <p className="lead">Ingresá la clave de recepción para ver el código y los huéspedes.</p>
          <label className="caja">
            <span>Clave</span>
            <input name="clave" type="password" autoComplete="current-password" autoFocus required />
          </label>
          {error && <p className="ed-error" role="alert">{error}</p>}
          <div className="btns"><button type="submit" className="btn" disabled={entrando}>{entrando ? 'Entrando…' : 'Entrar'}</button></div>
        </form>
      </main>
    </div>
  );
}

function Panel({ clave, rol, vista, salir }) {
  const [estado, setEstado] = useState(null); // la última respuesta + { recibido }
  const [error, setError] = useState('');
  const [editando, setEditando] = useState(null);
  const [nuevo, setNuevo] = useState(false);
  const [otraReserva, setOtraReserva] = useState(false); // el formulario de reserva nueva, aunque haya una abierta
  const [trabajando, setTrabajando] = useState(null); // la reserva de la lista a la que se le está dando código o que se está anulando
  const [editandoReserva, setEditandoReserva] = useState(null);
  const [haciendoCheckin, setHaciendoCheckin] = useState(null); // la llegada anotada a la que se le está haciendo el check-in (se elige cómo paga)
  const [cotizaciones, setCotizaciones] = useState(null); // el dólar oficial, para decir cuánto cobrar en dólares (solo se pide si hay llegadas)
  const [fotos, setFotos] = useState(null);
  const ahora = useAhora(250);
  const reloj = useRef(null);
  const ultimoVencido = useRef(0);

  const refrescar = useCallback(async () => {
    try {
      const r = await recepcionEstado(clave);
      if (!r.ok) {
        if (r.error === 'clave_incorrecta') { salir(); return; }
        setError(textoCodigo(r.error));
        return;
      }
      setEstado({ ...r, recibido: Date.now() });
      setError('');
    } catch {
      setError('Sin conexión. Reintentando…');
    }
  }, [clave, salir]);

  // Consulta cada pocos segundos mientras la pantalla se ve; al volver a la pestaña consulta enseguida.
  useEffect(() => {
    let vivo = true;
    const vuelta = async () => {
      if (document.visibilityState !== 'hidden') await refrescar();
      if (vivo) reloj.current = setTimeout(vuelta, CADA_MS);
    };
    vuelta();
    const alVolver = () => { if (document.visibilityState === 'visible') { clearTimeout(reloj.current); vuelta(); } };
    document.addEventListener('visibilitychange', alVolver);
    return () => { vivo = false; clearTimeout(reloj.current); document.removeEventListener('visibilitychange', alVolver); };
  }, [refrescar]);

  const restanteCodigo = estado?.codigo ? Math.max(0, estado.codigo.vence_seg - (ahora - estado.recibido) / 1000) : 0;
  const duracion = estado?.config?.codigo_seg ?? 15;

  // Cuando el código se termina de contar, pide otro enseguida (sin esperar al próximo ciclo).
  useEffect(() => {
    if (estado?.activo && estado.codigo && restanteCodigo <= 0 && ultimoVencido.current !== estado.recibido) {
      ultimoVencido.current = estado.recibido;
      refrescar();
    }
  }, [estado, restanteCodigo, refrescar]);

  const codigoNuevo = async () => {
    setNuevo(true);
    try {
      const r = await recepcionCodigoNuevo(clave);
      if (r.ok) await refrescar(); else setError(textoCodigo(r.error));
    } catch {
      setError('No se pudo conectar. Revisá tu conexión.');
    } finally {
      setNuevo(false);
    }
  };

  // Cuando la reserva se termina de contar, se vuelve a consultar: el código desaparece y vuelve el formulario.
  const restanteReserva = estado?.reserva ? Math.max(0, estado.reserva.vence_seg - (ahora - estado.recibido) / 1000) : 0;
  const reservaVencida = useRef(0);
  useEffect(() => {
    if (estado?.reserva && restanteReserva <= 0 && reservaVencida.current !== estado.recibido) {
      reservaVencida.current = estado.recibido;
      refrescar();
    }
  }, [estado, restanteReserva, refrescar]);

  // Hace el check-in de una llegada anotada con el cobro elegido: arma la reserva y deja el código a la vista.
  const iniciarLlegada = async (r) => {
    const res = await recepcionLlegadaIniciar(clave, haciendoCheckin.id, r);
    if (!res.ok) {
      if (['anotada_ya_empezo', 'anotada_cancelada', 'llegada_fuera_de_fecha', 'no_existe'].includes(res.error)) { setHaciendoCheckin(null); setError(textoCodigo(res.error)); await refrescar(); }
      return { ok: false, mensaje: textoCodigo(res.error), campos: res.campos };
    }
    setHaciendoCheckin(null);
    setOtraReserva(false);
    setError('');
    await refrescar();
    return { ok: true };
  };
  const abrirReserva = async (r) => {
    const res = await recepcionReservaNueva(clave, r);
    if (!res.ok) return { ok: false, mensaje: textoCodigo(res.error), campos: res.campos };
    setOtraReserva(false);
    await refrescar();
    return { ok: true };
  };
  const cerrarReserva = async (extender) => {
    try {
      const r = await recepcionReservaCerrar(clave, extender);
      if (r.ok) await refrescar(); else setError(textoCodigo(r.error));
    } catch {
      setError('No se pudo conectar. Revisá tu conexión.');
    }
  };
  // Le vuelve a dar código a una reserva abierta de la lista (por ejemplo, para el huésped que llegó más tarde).
  const darCodigo = async (id) => {
    setTrabajando(id);
    try {
      const r = await recepcionReservaAbrir(clave, id);
      setError(r.ok ? '' : textoCodigo(r.error));
      await refrescar();
    } catch {
      setError('No se pudo conectar. Revisá tu conexión.');
    } finally {
      setTrabajando(null);
    }
  };
  // Anula una reserva que no tiene ningún huésped (una de prueba, o a la que al final no llegó nadie). No se borra: queda marcada.
  const anular = async (est) => {
    if (!window.confirm(`¿Anular la reserva de la habitación ${est.habitacion}? Todavía no tiene huéspedes. Deja de verse y no suma en nada.`)) return;
    setTrabajando(est.id);
    try {
      const r = await recepcionReservaAnular(clave, est.id);
      setError(r.ok ? '' : textoCodigo(r.error));
      await refrescar();
    } catch {
      setError('No se pudo conectar. Revisá tu conexión.');
    } finally {
      setTrabajando(null);
    }
  };
  const guardarReserva = async (r) => {
    const res = await recepcionEstadiaEditar(clave, editandoReserva.id, r);
    if (!res.ok) return { ok: false, mensaje: textoCodigo(res.error), campos: res.campos };
    setEditandoReserva(null);
    await refrescar();
    return { ok: true };
  };

  const segundosEdicion = (f) => (estado?.config?.edicion_activa ? Math.max(0, f.editable_seg - (ahora - estado.recibido) / 1000) : 0);

  const guardar = async (datos, habitacion, medioPago) => {
    const r = await recepcionEditar(clave, editando.id, datos, habitacion, medioPago);
    if (r.ok) return { ok: true };
    return { ok: false, mensaje: textoCodigo(r.error), campos: r.campos };
  };

  const activo = estado?.activo;
  const huespedes = estado?.huespedes ?? [];
  const abiertas = estado?.reservas_abiertas ?? [];
  const llegadas = estado?.llegadas ?? [];
  const venta = ventaDeHoy(cotizaciones);
  const hayLlegadas = llegadas.length > 0;
  useEffect(() => {
    if (!hayLlegadas) return undefined;
    let vivo = true;
    cargarCotizaciones().then((c) => { if (vivo) setCotizaciones(c); }).catch(() => { /* sin dólar oficial: se avisa en cada llegada */ });
    return () => { vivo = false; };
  }, [hayLlegadas]);
  const segundosReserva = (e) => (e.editable_seg == null ? Infinity : Math.max(0, e.editable_seg - (ahora - estado.recibido) / 1000));

  // Si no hay nada abierto, la pantalla es el formulario. Se «fija» ahí: si mientras alguien lo está llenando un compañero abre otra reserva,
  // la pantalla no salta a la lista (se perdería lo escrito); aparece el botón Cancelar para ir a la lista cuando quiera.
  const sinNada = !!activo && !!estado && !estado.reserva && abiertas.length === 0 && llegadas.length === 0;
  useEffect(() => { if (sinNada) setOtraReserva(true); }, [sinNada]);
  const pct = Math.max(0, Math.min(100, (restanteCodigo / duracion) * 100));

  return (
    <div className="page personal">
      <BarraPersonal titulo={vista === 'codigo' ? 'Código' : 'Huéspedes'} actual={vista === 'codigo' ? 'codigo' : rol === 'admin' ? 'huespedes' : 'huespedesRec'} salir={salir} ancha={vista !== 'codigo'} />
      <main className={`card${vista === 'codigo' ? '' : ' ancha'}`}>
        <header>
          <p className="eyebrow">Recepción</p>
          <h1>{vista === 'codigo' ? 'Código para el huésped' : 'Huéspedes cargados'}</h1>
        </header>

        {!estado && !error && <p className="intro" role="status">Cargando…</p>}
        {error && <p className="ed-error" role="alert">{error}</p>}

        {estado && vista === 'codigo' && (
          <section className={`codigo-panel${activo && (!estado.reserva || otraReserva) ? ' con-form' : ''}`} aria-label="Código para el huésped">
            {activo ? (
              estado.reserva && !otraReserva ? (
                <>
                  <p className="reserva-cab"><b>Hab. {estado.reserva.estadia.habitacion}</b> · {detalleTexto(estado.reserva.estadia)}<br />{cobroLinea(estado.reserva.estadia)}</p>
                  {estado.reserva.estadia.nota && <p className="reserva-nota"><b>Nota:</b> {estado.reserva.estadia.nota}</p>}
                  <p className="reserva-prog">
                    <b>{huespedesTexto(estado.reserva.estadia, estado.reserva.huespedes.length)}</b> {estado.reserva.huespedes.length < estado.reserva.estadia.esperados ? `· faltan ${estado.reserva.estadia.esperados - estado.reserva.huespedes.length}` : ''}
                  </p>
                  <p className="etq">Dáselo al próximo huésped de esta habitación</p>
                  {restanteCodigo > 0
                    ? <p className="codigo-grande" aria-label={`Código ${estado.codigo.valor.split('').join(' ')}`}>{agruparCodigo(estado.codigo.valor)}</p>
                    : <p className="codigo-grande generando" role="status">Generando…</p>}
                  <div className="barra" role="progressbar" aria-valuemin={0} aria-valuemax={duracion} aria-valuenow={Math.ceil(restanteCodigo)} aria-label="Tiempo que le queda al código">
                    <span style={{ width: `${pct}%` }} />
                  </div>
                  <p className="codigo-meta">
                    Cambia en {Math.ceil(restanteCodigo)} s · Usado {estado.codigo.usos} de {estado.codigo.usos_max}
                  </p>
                  <p className="codigo-meta">El código se apaga en {minSeg(restanteReserva)}. La reserva sigue abierta hasta que entren todos: si falta alguien, la encontrás en «Reservas abiertas».</p>
                  {estado.reserva.huespedes.length > 0 && (
                    <>
                      <p className="etq">Ya hicieron el check-in ({estado.reserva.huespedes.length})</p>
                      <ul className="reserva-lista">{estado.reserva.huespedes.map((h) => <li key={h.id}>{h.nombre} {h.apellido}</li>)}</ul>
                    </>
                  )}
                  <div className="btns reserva-btns">
                    <button type="button" className="btn mini claro" onClick={codigoNuevo} disabled={nuevo}><Icon name="refrescar" size={18} sw={1.8} /> {nuevo ? 'Generando…' : 'Código nuevo ahora'}</button>
                    <button type="button" className="btn mini claro" onClick={() => cerrarReserva(true)}>Dar {estado.config.reserva_min} min más</button>
                    {segundosReserva(estado.reserva.estadia) > 0 && <button type="button" className="btn mini claro" onClick={() => setEditandoReserva(estado.reserva.estadia)}>Corregir reserva</button>}
                    <button type="button" className="btn mini claro" onClick={() => cerrarReserva(false)}>Volver a la lista</button>
                    {estado.reserva.huespedes.length === 0 && <button type="button" className="btn mini claro" onClick={() => anular(estado.reserva.estadia)} disabled={trabajando === estado.reserva.estadia.id}>Anular reserva</button>}
                    <button type="button" className="btn mini" onClick={() => setOtraReserva(true)}>Nueva reserva (otra habitación)</button>
                  </div>
                  {segundosReserva(estado.reserva.estadia) <= 0 && <p className="codigo-quien">Para corregir esta reserva, avisale al dueño.</p>}
                  {estado.quien && <p className="codigo-quien">Es tu código: los check-ins que se hagan con él quedan a nombre de <b>{estado.quien}</b>.</p>}
                </>
              ) : (abiertas.length > 0 || hayLlegadas) && !otraReserva ? (
                <div className="abiertas">
                  {hayLlegadas && (
                    <>
                      <h2>Llegadas</h2>
                      <p className="aclara">Reservas que el dueño anotó para estos días. Cuando llegue el huésped, tocá <b>Hacer el check-in</b>: elegís cómo paga y se genera el código.</p>
                      <ul className="ll-lista">
                        {llegadas.map((a) => (
                          <TarjetaLlegada key={a.id} a={a} venta={venta}>
                            <div className="btns ab-btns"><button type="button" className="btn mini" onClick={() => setHaciendoCheckin(a)}>Hacer el check-in</button></div>
                          </TarjetaLlegada>
                        ))}
                      </ul>
                    </>
                  )}
                  {abiertas.length > 0 && <h2>Reservas abiertas</h2>}
                  {abiertas.length > 0 && <p className="aclara">Habitaciones a las que todavía les faltan huéspedes. Tocá <b>Dar código</b> cuando llegue alguien. Una reserva sin ningún huésped no suma en las estadísticas.</p>}
                  {abiertas.length > 0 && <ul className="ab-lista">
                    {abiertas.map((a) => {
                      const e = a.estadia;
                      const con = a.huespedes.length;
                      const quedan = Math.max(0, a.quedan_seg - (ahora - estado.recibido) / 1000);
                      return (
                        <li key={a.id} className={con === 0 ? 'espera' : ''}>
                          <div className="ab-cab"><b>Hab. {e.habitacion}</b><span>{detalleTexto(e)}</span></div>
                          <p className="ab-prog">{con === 0 ? <>Todavía sin huéspedes · <b>no suma en las estadísticas</b></> : <><b>{huespedesTexto(e, con)}</b> ya hicieron el check-in</>}</p>
                          {con > 0 && <p className="ab-nombres">{a.huespedes.map((h) => `${h.nombre} ${h.apellido}`).join(', ')}</p>}
                          <p className="ab-meta">Cargó {e.cargado_por} · se oculta en {tiempoCorto(quedan)}</p>
                          <div className="btns ab-btns">
                            <button type="button" className="btn mini" onClick={() => darCodigo(a.id)} disabled={trabajando === a.id}>{trabajando === a.id ? 'Un momento…' : 'Dar código'}</button>
                            {con === 0 && <button type="button" className="btn mini claro" onClick={() => anular(e)} disabled={trabajando === a.id}>Anular</button>}
                          </div>
                        </li>
                      );
                    })}
                  </ul>}
                  <div className="btns"><button type="button" className="btn" onClick={() => setOtraReserva(true)}>Nueva reserva (sin anotar antes)</button></div>
                </div>
              ) : (
                <div className="reserva-nueva">
                  <h2>Nueva reserva</h2>
                  <p className="aclara">Cargá todo: habitación, noches, huéspedes y lo que se cobró. Recién ahí aparece el código. Los huéspedes entran de a uno, y la reserva queda abierta hasta que estén todos.</p>
                  <ReservaForm medios={estado.medios_pago} canales={estado.canales ?? []} categorias={estado.categorias ?? []} onGuardar={abrirReserva} texto="Generar códigos" alCancelar={estado.reserva || abiertas.length || hayLlegadas ? () => setOtraReserva(false) : null} />
                </div>
              )
            ) : (
              <p className="codigo-apagado" role="status">El check-in digital está apagado. Lo prende el administrador desde su panel.</p>
            )}
          </section>
        )}

        {estado && vista !== 'codigo' && (
          <>
            <div className="head-row">
              <span className="muted">Últimos {estado.config.dias} {estado.config.dias === 1 ? 'día' : 'días'}</span>
            </div>
            <p className="aclara">
              {estado.config.edicion_activa
                ? `Podés corregir los datos y la reserva durante ${estado.config.edicion_min} minutos desde que el huésped envía el formulario.`
                : 'Por ahora recepción no puede editar los datos. Si hay que corregir algo, avisale al administrador.'}
            </p>
            <Planilla filas={huespedes} restante={estado.config.edicion_activa ? segundosEdicion : () => 0} onEditar={(f) => setEditando({ ...f, venceEn: estado.recibido + f.editable_seg * 1000 })} onEditarReserva={(e) => setEditandoReserva(e)} reservaEditable={(e) => (estado.config.edicion_activa ? Math.max(0, e.editable_seg - (ahora - estado.recibido) / 1000) : 0) > 0} onFotos={setFotos} vacio="Todavía no hay huéspedes cargados en estos días." />
          </>
        )}
      </main>

      {haciendoCheckin && (
        <CobroLlegada a={haciendoCheckin} venta={venta} medios={estado?.medios_pago ?? []} canales={estado?.canales ?? []} categorias={estado?.categorias ?? []} onIniciar={iniciarLlegada} onCerrar={() => setHaciendoCheckin(null)} />
      )}

      {fotos && <FotosHuesped modo="recepcion" clave={clave} fila={fotos} onCerrar={() => setFotos(null)} alCambiar={refrescar} />}

      {editandoReserva && (
        <Modal titulo={`Corregir la reserva de la ${editandoReserva.habitacion}`} onCerrar={() => setEditandoReserva(null)}>
          <ReservaForm inicial={editandoReserva} medios={estado?.medios_pago ?? []} canales={estado?.canales ?? []} categorias={estado?.categorias ?? []} onGuardar={guardarReserva} texto="Guardar cambios" alCancelar={() => setEditandoReserva(null)} />
        </Modal>
      )}

      {editando && (
        <EditarHuesped
          fila={editando}
          venceEn={editando.venceEn}
          medios={estado?.medios_pago ?? null}
          onGuardar={guardar}
          onCerrar={(guardado) => { setEditando(null); if (guardado) refrescar(); }}
        />
      )}
    </div>
  );
}
