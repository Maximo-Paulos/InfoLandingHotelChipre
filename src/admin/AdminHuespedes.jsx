import { useCallback, useEffect, useRef, useState } from 'react';
import BarraPersonal from '../BarraPersonal.jsx';
import Icon from '../components/Icon.jsx';
import { adminCatalogos, adminEstadiaEditar, adminHuespedEditar, adminHuespedEstadia, adminHuespedQuitar, adminHuespedes, adminHuespedesQuitados, adminMediosPago, adminReservaAnular, textoCodigo } from '../checkin/checkinApi.js';
import EditarHuesped from '../checkin/EditarHuesped.jsx';
import Modal from '../checkin/Modal.jsx';
import Planilla from '../checkin/Planilla.jsx';
import ReservaForm from '../checkin/ReservaForm.jsx';
import FotosHuesped from './FotosHuesped.jsx';
import { LoginAdmin, useSesionAdmin } from './sesionAdmin.jsx';

const POR_PAGINA = 50;
const MAX_PEDIDO = 200; // lo máximo que la base entrega de una vez

// Huéspedes (todos), agrupados por reserva. El dueño corrige una reserva (cantidad de huéspedes incluida), mueve a un huésped a otra reserva, y puede ELIMINAR
// a un huésped o una reserva entera. Eliminar no borra nada: lo eliminado deja de verse y de contar en las estadísticas, queda guardado y se restaura
// desde «Huéspedes eliminados» (los huéspedes) o desde Datos → Caja → Reservas anuladas (las reservas).
export default function AdminHuespedes() {
  const sesion = useSesionAdmin();
  if (sesion.fase !== 'ok') return <LoginAdmin sesion={sesion} />;
  return <Contenido clave={sesion.clave} salir={sesion.salir} />;
}

function Contenido({ clave, salir }) {
  const [filas, setFilas] = useState([]);
  const [hayMas, setHayMas] = useState(false);
  const [escrito, setEscrito] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [editando, setEditando] = useState(null);
  const [fotosDe, setFotosDe] = useState(null); // el huésped cuyas fotos se están viendo
  const [aviso, setAviso] = useState('');
  const [editandoReserva, setEditandoReserva] = useState(null);
  const [destinos, setDestinos] = useState(null); // las reservas a las que se puede mover un huésped (también las que todavía no tienen a nadie)
  const [quitados, setQuitados] = useState(null); // los huéspedes eliminados (null = todavía no se abrió la lista)
  const [abierto, setAbierto] = useState(false);
  const avisoPendiente = useRef('');
  const [medios, setMedios] = useState(null); // todos los medios de pago (también los quitados); null = todavía no cargaron
  const [catalogos, setCatalogos] = useState({ categorias: [], canales: [] }); // lo que se puede elegir al corregir una reserva
  const pedido = useRef(0);
  const filasRef = useRef([]); // lo que se ve ahora: de acá sale desde qué huésped seguir al tocar "Cargar más"

  // Si la base todavía no tiene los medios de pago, la pantalla sigue andando sin ellos.
  useEffect(() => {
    let vivo = true;
    adminMediosPago(clave).then((r) => { if (vivo && r?.ok) setMedios(r.medios); }).catch(() => {});
    adminCatalogos(clave).then((r) => { if (vivo && r?.ok) setCatalogos({ categorias: r.categorias.filter((c) => c.activo), canales: r.canales.filter((c) => c.activo) }); }).catch(() => {});
    return () => { vivo = false; };
  }, [clave]);

  // modo: 'inicio' = los primeros 50 (al entrar o al cambiar la búsqueda) · 'mas' = los 50 que siguen a los que ya se ven
  //       · 'refrescar' = vuelve a pedir lo que ya se ve (después de guardar un cambio), sin mandar al principio.
  // Lo que se ve se lee de filasRef y no de `filas`: esta función se guarda entre dibujos y `filas` quedaría con el valor del
  // primer dibujo (vacío), y "Cargar más" volvería a pedir siempre los primeros 50.
  const cargar = useCallback(async (modo = 'inicio') => {
    const n = ++pedido.current;
    setCargando(true);
    setError('');
    try {
      const vistas = filasRef.current;
      const antes = modo === 'mas' && vistas.length ? vistas[vistas.length - 1].id : null;
      const limite = modo === 'refrescar' ? Math.min(MAX_PEDIDO, Math.max(POR_PAGINA, vistas.length)) : POR_PAGINA;
      const r = await adminHuespedes(clave, busqueda, limite, antes);
      if (n !== pedido.current) return;
      if (!r.ok) {
        if (r.error === 'clave_incorrecta') { salir(); return; }
        setError(textoCodigo(r.error));
        return;
      }
      // Cada tanda sigue donde terminó la anterior; si alguien ya está en la lista no se repite.
      const base = modo === 'mas' ? vistas : [];
      const ya = new Set(base.map((h) => h.id));
      const lista = [...base, ...r.huespedes.filter((h) => !ya.has(h.id))];
      filasRef.current = lista;
      setFilas(lista);
      setHayMas(!!r.hay_mas);
      if (Array.isArray(r.reservas)) setDestinos(r.reservas);
    } catch {
      if (n === pedido.current) setError('No se pudo conectar. Revisá tu conexión.');
    } finally {
      if (n === pedido.current) setCargando(false);
    }
  }, [clave, busqueda, salir]);

  // Carga al entrar y cada vez que cambia la búsqueda.
  useEffect(() => { cargar('inicio'); }, [busqueda]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setTimeout(() => setBusqueda(escrito.trim()), 350);
    return () => clearTimeout(t);
  }, [escrito]);

  // Si la base todavía no tiene la lista de fotos de cada huésped, la planilla sigue andando sin el botón de fotos.
  const fotosListas = filas.some((f) => Array.isArray(f.fotos));

  const guardar = async (datos, habitacion, medioPago) => {
    const r = await adminHuespedEditar(clave, editando.id, datos, habitacion, medioPago);
    if (r.ok) return { ok: true };
    return { ok: false, mensaje: textoCodigo(r.error), campos: r.campos };
  };

  const recargarQuitados = async () => {
    try {
      const r = await adminHuespedesQuitados(clave);
      if (r.ok) setQuitados(r.huespedes);
    } catch { /* la lista queda como estaba */ }
  };
  const guardarReserva = async (r) => {
    const res = await adminEstadiaEditar(clave, editandoReserva.id, r);
    if (!res.ok) return { ok: false, mensaje: textoCodigo(res.error), campos: res.campos };
    setEditandoReserva(null);
    setAviso('Reserva guardada.');
    cargar('refrescar');
    return { ok: true };
  };
  const asignar = async (fila, estadia) => {
    setAviso('');
    try {
      const res = await adminHuespedEstadia(clave, fila.id, estadia);
      if (res.ok) { setAviso(estadia == null ? 'Huésped dejado sin reserva.' : 'Huésped movido a la reserva.'); cargar('refrescar'); } else setError(textoCodigo(res.error));
    } catch {
      setError('No se pudo conectar. Revisá tu conexión.');
    }
  };
  // Elimina a un huésped (no se borra: se puede restaurar).
  const quitarHuesped = async () => {
    const res = await adminHuespedQuitar(clave, editando.id, true);
    if (!res.ok) return { ok: false, mensaje: textoCodigo(res.error) };
    avisoPendiente.current = 'Huésped eliminado. Dejó de verse y de contar; lo podés restaurar desde «Huéspedes eliminados».';
    return { ok: true };
  };
  const restaurarHuesped = async (h) => {
    setAviso('');
    setError('');
    try {
      const res = await adminHuespedQuitar(clave, h.id, false);
      if (res.ok) { setAviso('Huésped restaurado.'); cargar('refrescar'); recargarQuitados(); } else setError(textoCodigo(res.error));
    } catch {
      setError('No se pudo conectar. Revisá tu conexión.');
    }
  };
  // Elimina una reserva entera, con sus huéspedes (no se borra nada: se restaura desde Datos → Caja → Reservas anuladas).
  const eliminarReserva = async () => {
    const e = editandoReserva;
    const n = e.con_checkin ?? 0;
    if (!window.confirm(`¿Eliminar la reserva de la habitación ${e.habitacion}?${n ? ` Se eliminan también sus ${n} ${n === 1 ? 'huésped' : 'huéspedes'}.` : ''} Dejan de verse y de contar en las estadísticas. No se borra nada: la podés restaurar desde Datos → Caja → Reservas anuladas.`)) return;
    setAviso('');
    try {
      const res = await adminReservaAnular(clave, e.id, true);
      if (res.ok) { setEditandoReserva(null); setAviso('Reserva eliminada. La podés restaurar desde Datos → Caja → Reservas anuladas.'); cargar('refrescar'); recargarQuitados(); } else setError(textoCodigo(res.error));
    } catch {
      setError('No se pudo conectar. Revisá tu conexión.');
    }
  };
  // Las reservas a las que se puede mover un huésped: las recientes que trae la base (también las sin huéspedes) o, si todavía no llegaron, las que se ven.
  const reservas = destinos ?? [...new Map(filas.filter((f) => f.estadia).map((f) => [f.estadia.id, f.estadia])).values()];

  return (
    <div className="page personal">
      <BarraPersonal titulo="Huéspedes" actual="huespedes" salir={salir} ancha />
      <main className="card ancha">
        <header>
          <h1>Huéspedes</h1>
          <p className="lead">Quiénes hicieron el check-in, agrupados por habitación.</p>
        </header>

        <div className="head-row">
          <h2>Todos los huéspedes</h2>
          <button type="button" className="btn mini claro" onClick={() => cargar('refrescar')} disabled={cargando}><Icon name="refrescar" size={16} sw={1.8} /> Actualizar</button>
        </div>
        <div className="campo buscador">
          <label htmlFor="buscar">Buscar por nombre, documento, email, teléfono, localidad o habitación</label>
          <input id="buscar" type="search" value={escrito} onChange={(e) => setEscrito(e.target.value)} autoComplete="off" placeholder="Buscar por nombre, documento o habitación" />
        </div>
        {aviso && <p className="ed-ok" role="status">{aviso}</p>}
        {error && <p className="ed-error" role="alert">{error}</p>}
        {cargando && !filas.length ? <p className="intro" role="status">Cargando…</p> : (
          <Planilla filas={filas} onEditarReserva={setEditandoReserva} reservas={reservas} onAsignar={asignar} onEditar={(f) => { setAviso(''); setEditando(f); }} onFotos={fotosListas ? (f) => { setAviso(''); setFotosDe(f); } : undefined} vacio={busqueda ? 'No hay huéspedes que coincidan con la búsqueda.' : 'Todavía no hay huéspedes cargados.'} />
        )}
        {filas.length > 0 && <p className="ayuda" role="status">Mostrando {filas.length} {filas.length === 1 ? 'huésped' : 'huéspedes'}{hayMas ? '. Tocá «Cargar más» para ver a los anteriores.' : '.'}</p>}
        {hayMas && <div className="btns"><button type="button" className="btn claro" onClick={() => cargar('mas')} disabled={cargando}>{cargando ? 'Cargando…' : 'Cargar más'}</button></div>}

        <details className="caja-anuladas" onToggle={(e) => { setAbierto(e.currentTarget.open); if (e.currentTarget.open) recargarQuitados(); }}>
          <summary>Huéspedes eliminados{quitados ? ` (${quitados.length})` : ''}</summary>
          <p className="ayuda">No se ven en las listas ni cuentan en las estadísticas, pero no se borraron: podés restaurarlos. Si se eliminaron junto con su reserva, se restauran restaurando la reserva (Datos → Caja → Reservas anuladas).</p>
          {abierto && quitados === null && <p className="ayuda" role="status">Cargando…</p>}
          {quitados && !quitados.length && <p className="ayuda">No hay huéspedes eliminados.</p>}
          {quitados?.length > 0 && (
            <ul>
              {quitados.map((h) => (
                <li key={h.id}>
                  <span className="caja-hab">{h.habitacion || '—'}</span>
                  <span className="caja-cuerpo">
                    <b>{h.apellido}, {h.nombre}</b>
                    <small>{h.reserva_anulada ? 'Eliminado con su reserva · ' : ''}{`eliminó ${h.quitado_por ?? '—'}`}</small>
                  </span>
                  {h.reserva_anulada ? null : <button type="button" className="btn mini claro" onClick={() => restaurarHuesped(h)}>Restaurar</button>}
                </li>
              ))}
            </ul>
          )}
        </details>

      </main>

      {editando && (
        <EditarHuesped
          fila={editando}
          medios={medios ? medios.filter((m) => m.activo).map(({ id, nombre }) => ({ id, nombre })) : null}
          onGuardar={guardar}
          onQuitar={quitarHuesped}
          onCerrar={(guardado) => {
            setEditando(null);
            if (guardado) {
              setAviso(avisoPendiente.current || 'Cambios guardados.');
              if (avisoPendiente.current) recargarQuitados();
              avisoPendiente.current = '';
              cargar('refrescar');
            }
          }}
        />
      )}
      {editandoReserva && (
        <Modal titulo={`Corregir la reserva de la ${editandoReserva.habitacion}`} onCerrar={() => setEditandoReserva(null)}>
          <ReservaForm inicial={editandoReserva} medios={medios ? medios.filter((m) => m.activo).map(({ id, nombre }) => ({ id, nombre })) : []} canales={catalogos.canales} categorias={catalogos.categorias} onGuardar={guardarReserva} texto="Guardar cambios" alCancelar={() => setEditandoReserva(null)} />
          <div className="zona-quitar">
            <p className="ayuda">Si la reserva no corresponde (una prueba, o se cargó por error), la podés eliminar{editandoReserva.con_checkin ? `: se van con ella sus ${editandoReserva.con_checkin} ${editandoReserva.con_checkin === 1 ? 'huésped' : 'huéspedes'}` : ''}. No se borra nada: queda guardada y la podés restaurar.</p>
            <button type="button" className="btn mini claro" onClick={eliminarReserva}>Eliminar reserva</button>
          </div>
        </Modal>
      )}
      {fotosDe && <FotosHuesped clave={clave} fila={fotosDe} onCerrar={() => setFotosDe(null)} alCambiar={() => cargar('refrescar')} />}
    </div>
  );
}
