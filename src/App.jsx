import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Menu from './Menu.jsx';
import Admin from './admin/Admin.jsx';
import DatosGenerales from './admin/DatosGenerales.jsx';
import Idioma from './components/Idioma.jsx';
import { ToastContext } from './components/ui.jsx';
import { PublicoProvider, useDatos } from './data/DataContext.jsx';
import { SECCIONES } from './secciones.jsx';

// Pantallas del personal: se descargan solo cuando se abren.
const Recepcion = lazy(() => import('./checkin/Recepcion.jsx'));
const AdminInicio = lazy(() => import('./admin/AdminInicio.jsx'));
const AdminHuespedes = lazy(() => import('./admin/AdminHuespedes.jsx'));
const cargando = <div className="page"><main className="card"><p style={{ margin: 0 }} role="status">Cargando…</p></main></div>;

const leerHash = () => location.hash.replace(/^#\/?/, '').split('?')[0];

function useHash() {
  const [hash, setHash] = useState(leerHash);
  useEffect(() => {
    const alCambiar = () => setHash(leerHash());
    window.addEventListener('hashchange', alCambiar);
    return () => window.removeEventListener('hashchange', alCambiar);
  }, []);
  return hash;
}

// La tarjeta de una pantalla (menú o sección). Sirve igual para la guía y para el panel del dueño.
export function Pantalla({ ruta }) {
  const { D, editing } = useDatos();
  const seccion = SECCIONES.find((s) => s.id === ruta);
  const datos = editing && ruta === 'datos';
  const tarjeta = useRef(null);

  useEffect(() => {
    const parte = seccion ? `${D[seccion.id].titulo} · ` : datos ? 'Datos generales · ' : 'Guía del huésped · ';
    document.title = `${editing ? 'Panel · ' : ''}${parte}${D.hotel.nombre}`;
    window.scrollTo(0, 0);
    tarjeta.current?.focus({ preventScroll: true });
    // Solo al cambiar de pantalla, no al editar un texto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ruta]);

  return (
    <div className="page">
      {!editing && <Idioma />}
      <main ref={tarjeta} tabIndex={-1} className={`card${seccion?.oscuro ? ' oscuro' : ''}`}>
        {seccion ? <Suspense fallback={<p className="intro" role="status">Cargando…</p>}><seccion.Vista /></Suspense> : datos ? <DatosGenerales /> : <Menu />}
      </main>
      <p className="pie"><span translate="no">{D.hotel.nombre}</span> · {D.hotel.pie}</p>
    </div>
  );
}

export default function App() {
  const hash = useHash();
  const esAdmin = hash === 'admin' || hash.startsWith('admin/');
  const esRecepcion = hash === 'recepcion' || hash.startsWith('recepcion/');
  const ruta = esAdmin ? hash.slice(6).replace(/^\//, '') : hash;

  const [aviso, setAviso] = useState('');
  const toast = useCallback((msg) => setAviso(msg), []);
  useEffect(() => {
    if (!aviso) return undefined;
    const t = setTimeout(() => setAviso(''), 2600);
    return () => clearTimeout(t);
  }, [aviso]);

  return (
    <ToastContext.Provider value={toast}>
      <Suspense fallback={cargando}>
        {esRecepcion && <Recepcion />}
        {!esRecepcion && esAdmin && ruta === '' && <AdminInicio />}
        {!esRecepcion && esAdmin && ruta === 'huespedes' && <AdminHuespedes />}
        {/* El editor de la guía: #/admin/editar/… (los links viejos #/admin/wifi siguen andando) */}
        {!esRecepcion && esAdmin && ruta !== '' && ruta !== 'huespedes' && (
          <Admin ruta={ruta === 'editar' || ruta.startsWith('editar/') ? ruta.slice(6).replace(/^\//, '') : ruta} />
        )}
        {!esRecepcion && !esAdmin && <PublicoProvider><Pantalla ruta={ruta} /></PublicoProvider>}
      </Suspense>
      {aviso && <p className="toast" role="status">{aviso}</p>}
    </ToastContext.Provider>
  );
}
