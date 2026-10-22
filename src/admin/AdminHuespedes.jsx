import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { adminAuditoria, adminHuespedEditar, adminHuespedes, adminMediosPago, textoCodigo } from '../checkin/checkinApi.js';
import EditarHuesped from '../checkin/EditarHuesped.jsx';
import Planilla from '../checkin/Planilla.jsx';
import { fechaHora } from '../checkin/util.js';
import FotosHuesped from './FotosHuesped.jsx';
import { ConectarDrive, ConfigCheckin, useConfigCheckin } from './PanelCheckin.jsx';
import PanelMediosPago from './PanelMediosPago.jsx';
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
  const { config, error: errorConfig, recargar } = useConfigCheckin(clave);
  const [filas, setFilas] = useState([]);
  const [hayMas, setHayMas] = useState(false);
  const [escrito, setEscrito] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [editando, setEditando] = useState(null);
  const [fotosDe, setFotosDe] = useState(null); // el huésped cuyas fotos se están viendo
  const [aviso, setAviso] = useState('');
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
        <PanelMediosPago clave={clave} medios={medios} alGuardar={(lista) => { setMedios(lista); cargar('refrescar'); }} />
        <ConectarDrive clave={clave} config={config} recargar={recargar} />

        <div className="head-row">
          <h2>Todos los huéspedes</h2>
          <button type="button" className="btn mini claro" onClick={() => cargar('refrescar')} disabled={cargando}><Icon name="refrescar" size={16} sw={1.8} /> Actualizar</button>
        </div>
        <div className="campo buscador">
          <label htmlFor="buscar">Buscar por nombre, documento, email, teléfono, localidad o habitación</label>
          <input id="buscar" type="search" value={escrito} onChange={(e) => setEscrito(e.target.value)} autoComplete="off" />
        </div>
        {aviso && <p className="ed-ok" role="status">{aviso}</p>}
        {error && <p className="ed-error" role="alert">{error}</p>}
        {cargando && !filas.length ? <p className="intro" role="status">Cargando…</p> : (
          <Planilla filas={filas} onEditar={(f) => { setAviso(''); setEditando(f); }} onFotos={fotosListas ? (f) => { setAviso(''); setFotosDe(f); } : undefined} vacio={busqueda ? 'No hay huéspedes que coincidan con la búsqueda.' : 'Todavía no hay huéspedes cargados.'} />
        )}
        {filas.length > 0 && <p className="ayuda" role="status">Mostrando {filas.length} {filas.length === 1 ? 'huésped' : 'huéspedes'}{hayMas ? '. Tocá «Cargar más» para ver a los anteriores.' : '.'}</p>}
        {hayMas && <div className="btns"><button type="button" className="btn claro" onClick={() => cargar('mas')} disabled={cargando}>{cargando ? 'Cargando…' : 'Cargar más'}</button></div>}

        <Historial clave={clave} />
      </main>

      {editando && (
        <EditarHuesped
          fila={editando}
          medios={medios ? medios.filter((m) => m.activo).map(({ id, nombre }) => ({ id, nombre })) : null}
          onGuardar={guardar}
          onCerrar={(guardado) => { setEditando(null); if (guardado) { setAviso('Cambios guardados.'); cargar('refrescar'); } }}
        />
      )}
      {fotosDe && <FotosHuesped clave={clave} fila={fotosDe} onCerrar={() => setFotosDe(null)} alCambiar={() => cargar('refrescar')} />}
    </div>
  );
}

const ACCIONES = { editar: 'editó a un huésped', config: 'cambió la configuración', clave_recepcion: 'cambió la clave de recepción', codigo_nuevo: 'generó un código nuevo', medios_pago: 'cambió los medios de pago', foto_agregada: 'agregó una foto', foto_quitada: 'quitó una foto', foto_repuesta: 'volvió a poner una foto' };
const CAMPOS = { nombre: 'nombre', apellido: 'apellido', email: 'email', telefono: 'teléfono', nacionalidad: 'nacionalidad', localidad: 'localidad', domicilio: 'domicilio', doc_tipo: 'tipo de documento', doc_numero: 'número de documento', habitacion: 'habitación', medio_pago: 'medio de pago' };

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
