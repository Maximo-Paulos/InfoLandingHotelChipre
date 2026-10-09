import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { adminAuditoria, adminHuespedEditar, adminHuespedes, textoCodigo } from '../checkin/checkinApi.js';
import EditarHuesped from '../checkin/EditarHuesped.jsx';
import Planilla from '../checkin/Planilla.jsx';
import { fechaHora } from '../checkin/util.js';
import { ConectarDrive, ConfigCheckin, useConfigCheckin } from './PanelCheckin.jsx';
import { LoginAdmin, useSesionAdmin } from './sesionAdmin.jsx';

const POR_PAGINA = 50;

// Huéspedes (todos), configuración del check-in y conexión con Drive.
export default function AdminHuespedes() {
  const sesion = useSesionAdmin();
  if (sesion.fase !== 'ok') return <LoginAdmin sesion={sesion} />;
  return <Contenido clave={sesion.clave} salir={sesion.salir} />;
}

function Contenido({ clave, salir }) {
  const { config, error: errorConfig, recargar } = useConfigCheckin(clave);
  const [filas, setFilas] = useState([]);
  const [hayMas, setHayMas] = useState(false);
  const [escrito, setEscrito] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [editando, setEditando] = useState(null);
  const [aviso, setAviso] = useState('');
  const pedido = useRef(0);

  const cargar = useCallback(async (mas = false) => {
    const n = ++pedido.current;
    setCargando(true);
    setError('');
    try {
      const antes = mas && filas.length ? filas[filas.length - 1].id : null;
      const r = await adminHuespedes(clave, busqueda, POR_PAGINA, antes);
      if (n !== pedido.current) return;
      if (!r.ok) {
        if (r.error === 'clave_incorrecta') { salir(); return; }
        setError(textoCodigo(r.error));
        return;
      }
      setFilas((actual) => (mas ? [...actual, ...r.huespedes] : r.huespedes));
      setHayMas(!!r.hay_mas);
    } catch {
      if (n === pedido.current) setError('No se pudo conectar. Revisá tu conexión.');
    } finally {
      if (n === pedido.current) setCargando(false);
    }
    // `filas` solo se usa para saber desde dónde seguir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave, busqueda, salir]);

  // Carga al entrar y cada vez que cambia la búsqueda.
  useEffect(() => { cargar(false); }, [busqueda]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setTimeout(() => setBusqueda(escrito.trim()), 350);
    return () => clearTimeout(t);
  }, [escrito]);

  const guardar = async (datos, habitacion) => {
    const r = await adminHuespedEditar(clave, editando.id, datos, habitacion);
    if (r.ok) return { ok: true };
    return { ok: false, mensaje: textoCodigo(r.error), campos: r.campos };
  };

  return (
    <div className="page">
      <main className="card ancha">
        <header className="rec-cab">
          <div>
            <p className="eyebrow">Solo para el dueño</p>
            <h1>Huéspedes</h1>
          </div>
          <div className="rec-acciones">
            <a className="btn mini claro" href="#/admin">← Inicio</a>
            <button type="button" className="btn mini claro" onClick={salir}>Salir</button>
          </div>
        </header>

        {errorConfig && <p className="ed-error" role="alert">{errorConfig}</p>}
        <ConfigCheckin clave={clave} config={config} recargar={recargar} />
        <ConectarDrive clave={clave} config={config} recargar={recargar} />

        <div className="head-row">
          <h2>Todos los huéspedes</h2>
          <button type="button" className="btn mini claro" onClick={() => cargar(false)} disabled={cargando}><Icon name="refrescar" size={16} sw={1.8} /> Actualizar</button>
        </div>
        <div className="campo buscador">
          <label htmlFor="buscar">Buscar por nombre, documento, email, teléfono, localidad o habitación</label>
          <input id="buscar" type="search" value={escrito} onChange={(e) => setEscrito(e.target.value)} autoComplete="off" />
        </div>
        {aviso && <p className="ed-ok" role="status">{aviso}</p>}
        {error && <p className="ed-error" role="alert">{error}</p>}
        {cargando && !filas.length ? <p className="intro" role="status">Cargando…</p> : (
          <Planilla filas={filas} onEditar={(f) => { setAviso(''); setEditando(f); }} vacio={busqueda ? 'No hay huéspedes que coincidan con la búsqueda.' : 'Todavía no hay huéspedes cargados.'} />
        )}
        {hayMas && <div className="btns"><button type="button" className="btn claro" onClick={() => cargar(true)} disabled={cargando}>{cargando ? 'Cargando…' : 'Cargar más'}</button></div>}

        <Historial clave={clave} />
      </main>

      {editando && (
        <EditarHuesped
          fila={editando}
          onGuardar={guardar}
          onCerrar={(guardado) => { setEditando(null); if (guardado) { setAviso('Cambios guardados.'); cargar(false); } }}
        />
      )}
    </div>
  );
}

const ACCIONES = { editar: 'editó a un huésped', config: 'cambió la configuración', clave_recepcion: 'cambió la clave de recepción', codigo_nuevo: 'generó un código nuevo' };
const CAMPOS = { nombre: 'nombre', apellido: 'apellido', email: 'email', telefono: 'teléfono', nacionalidad: 'nacionalidad', localidad: 'localidad', domicilio: 'domicilio', doc_tipo: 'tipo de documento', doc_numero: 'número de documento', habitacion: 'habitación' };

// Quién cambió qué y cuándo (no guarda los valores, solo los nombres de los campos).
function Historial({ clave }) {
  const [registros, setRegistros] = useState(null);
  const [error, setError] = useState('');
  const abrir = async (e) => {
    if (!e.currentTarget.open || registros) return;
    try {
      const r = await adminAuditoria(clave, 40);
      if (r.ok) setRegistros(r.registros); else setError(textoCodigo(r.error));
    } catch {
      setError('No se pudo conectar. Revisá tu conexión.');
    }
  };
  return (
    <details className="panel" onToggle={abrir}>
      <summary>Historial de cambios</summary>
      {error && <p className="ed-error">{error}</p>}
      {registros && !registros.length && <p className="ayuda">Todavía no hay cambios registrados.</p>}
      {registros?.length > 0 && (
        <ul className="historial">
          {registros.map((r) => (
            <li key={r.id}>
              <b>{fechaHora(r.en)}</b> · {r.quien === 'admin' ? 'Administrador' : 'Recepción'} {ACCIONES[r.accion] ?? r.accion}
              {r.checkin_id ? ` (huésped n.º ${r.checkin_id})` : ''}
              {r.detalle?.campos?.length ? `: ${r.detalle.campos.map((c) => CAMPOS[c] ?? c).join(', ')}` : ''}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
