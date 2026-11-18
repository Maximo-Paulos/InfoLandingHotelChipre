import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../components/Icon.jsx';
import FotosHuesped from '../admin/FotosHuesped.jsx';
import BarraPersonal from '../BarraPersonal.jsx';
import { useNoIndexar } from '../personal.js';
import { cerrarSesion, entrarConClave, leerSesion } from '../sesion.js';
import { recepcionCodigoNuevo, recepcionEditar, recepcionEstadiaEditar, recepcionEstado, recepcionReservaCerrar, recepcionReservaNueva, textoCodigo } from './checkinApi.js';
import EditarHuesped from './EditarHuesped.jsx';
import Modal from './Modal.jsx';
import Planilla from './Planilla.jsx';
import ReservaForm, { cobroTexto } from './ReservaForm.jsx';
import { agruparCodigo, minSeg, useAhora } from './util.js';

const CADA_MS = 3000;

// Pantalla de recepción: ingreso con la clave propia de cada persona (o la del dueño, desde su panel). Tiene dos pestañas: «Código»
// (el código para el huésped, que es de quien está en sesión) y «Huéspedes» (la planilla de los últimos días).
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
  const [editandoReserva, setEditandoReserva] = useState(null);
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
                  <p className="reserva-cab"><b>Hab. {estado.reserva.estadia.habitacion}</b> · {cobroTexto(estado.reserva.estadia)} · {estado.reserva.estadia.medio_pago}</p>
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
                  <p className="codigo-meta">La reserva se cierra en {minSeg(restanteReserva)}.</p>
                  {estado.reserva.huespedes.length > 0 && (
                    <>
                      <p className="etq">Ya hicieron el check-in ({estado.reserva.huespedes.length})</p>
                      <ul className="reserva-lista">{estado.reserva.huespedes.map((h) => <li key={h.id}>{h.nombre} {h.apellido}</li>)}</ul>
                    </>
                  )}
                  <div className="btns reserva-btns">
                    <button type="button" className="btn mini claro" onClick={codigoNuevo} disabled={nuevo}><Icon name="refrescar" size={18} sw={1.8} /> {nuevo ? 'Generando…' : 'Código nuevo ahora'}</button>
                    <button type="button" className="btn mini claro" onClick={() => cerrarReserva(true)}>Dar {estado.config.reserva_min} min más</button>
                    <button type="button" className="btn mini claro" onClick={() => setEditandoReserva(estado.reserva.estadia)}>Corregir reserva</button>
                    <button type="button" className="btn mini claro" onClick={() => cerrarReserva(false)}>Terminar reserva</button>
                    <button type="button" className="btn mini" onClick={() => setOtraReserva(true)}>Nueva reserva (otra habitación)</button>
                  </div>
                  {estado.quien && <p className="codigo-quien">Es tu código: los check-ins que se hagan con él quedan a nombre de <b>{estado.quien}</b>.</p>}
                </>
              ) : (
                <div className="reserva-nueva">
                  <h2>Nueva reserva</h2>
                  <p className="aclara">Cargá la habitación y lo que se cobró. Recién ahí aparece el código para los huéspedes.</p>
                  <ReservaForm medios={estado.medios_pago} onGuardar={abrirReserva} texto="Generar códigos" alCancelar={estado.reserva ? () => setOtraReserva(false) : null} />
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

      {fotos && <FotosHuesped modo="recepcion" clave={clave} fila={fotos} onCerrar={() => setFotos(null)} alCambiar={refrescar} />}

      {editandoReserva && (
        <Modal titulo={`Corregir la reserva de la ${editandoReserva.habitacion}`} onCerrar={() => setEditandoReserva(null)}>
          <ReservaForm inicial={editandoReserva} medios={estado?.medios_pago ?? []} onGuardar={guardarReserva} texto="Guardar cambios" alCancelar={() => setEditandoReserva(null)} />
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
