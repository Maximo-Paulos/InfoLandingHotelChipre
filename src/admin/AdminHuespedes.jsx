import { useCallback, useEffect, useRef, useState } from 'react';
import BarraPersonal from '../BarraPersonal.jsx';
import Icon from '../components/Icon.jsx';
import { adminEstadiaEditar, adminHuespedEditar, adminHuespedEstadia, adminHuespedes, adminMediosPago, textoCodigo } from '../checkin/checkinApi.js';
import EditarHuesped from '../checkin/EditarHuesped.jsx';
import Modal from '../checkin/Modal.jsx';
import Planilla from '../checkin/Planilla.jsx';
import ReservaForm from '../checkin/ReservaForm.jsx';
import FotosHuesped from './FotosHuesped.jsx';
import { LoginAdmin, useSesionAdmin } from './sesionAdmin.jsx';

const POR_PAGINA = 50;
const MAX_PEDIDO = 200; // lo máximo que la base entrega de una vez

// Huéspedes (todos), configuración del check-in y conexión con Drive.
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
  const [medios, setMedios] = useState(null); // todos los medios de pago (también los quitados); null = todavía no cargaron
  const pedido = useRef(0);
  const filasRef = useRef([]); // lo que se ve ahora: de acá sale desde qué huésped seguir al tocar "Cargar más"

  // Si la base todavía no tiene los medios de pago, la pantalla sigue andando sin ellos.
  useEffect(() => {
    let vivo = true;
    adminMediosPago(clave).then((r) => { if (vivo && r?.ok) setMedios(r.medios); }).catch(() => {});
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
      if (res.ok) { setAviso('Huésped asignado a la reserva.'); cargar('refrescar'); } else setError(textoCodigo(res.error));
    } catch {
      setError('No se pudo conectar. Revisá tu conexión.');
    }
  };
  // Las reservas que se ven ahora (sin repetir), para asignarles huéspedes de antes.
  const reservas = [...new Map(filas.filter((f) => f.estadia).map((f) => [f.estadia.id, f.estadia])).values()];

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

      </main>

      {editando && (
        <EditarHuesped
          fila={editando}
          medios={medios ? medios.filter((m) => m.activo).map(({ id, nombre }) => ({ id, nombre })) : null}
          onGuardar={guardar}
          onCerrar={(guardado) => { setEditando(null); if (guardado) { setAviso('Cambios guardados.'); cargar('refrescar'); } }}
        />
      )}
      {editandoReserva && (
        <Modal titulo={`Corregir la reserva de la ${editandoReserva.habitacion}`} onCerrar={() => setEditandoReserva(null)}>
          <ReservaForm inicial={editandoReserva} medios={medios ? medios.filter((m) => m.activo).map(({ id, nombre }) => ({ id, nombre })) : []} onGuardar={guardarReserva} texto="Guardar cambios" alCancelar={() => setEditandoReserva(null)} />
        </Modal>
      )}
      {fotosDe && <FotosHuesped clave={clave} fila={fotosDe} onCerrar={() => setFotosDe(null)} alCambiar={() => cargar('refrescar')} />}
    </div>
  );
}
