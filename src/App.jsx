import { useCallback, useEffect, useRef, useState } from 'react';
import Menu from './Menu.jsx';
import Admin from './admin/Admin.jsx';
import DatosGenerales from './admin/DatosGenerales.jsx';
import Idioma from './components/Idioma.jsx';
import { ToastContext } from './components/ui.jsx';
import { PublicoProvider, useDatos } from './data/DataContext.jsx';
import { SECCIONES } from './secciones.jsx';

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
        {seccion ? <seccion.Vista /> : datos ? <DatosGenerales /> : <Menu />}
      </main>
      <p className="pie"><span translate="no">{D.hotel.nombre}</span> · {D.hotel.pie}</p>
    </div>
  );
}

export default function App() {
  const hash = useHash();
  const esAdmin = hash === 'admin' || hash.startsWith('admin/');
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
      {esAdmin ? <Admin ruta={ruta} /> : <PublicoProvider><Pantalla ruta={ruta} /></PublicoProvider>}
      {aviso && <p className="toast" role="status">{aviso}</p>}
    </ToastContext.Provider>
  );
}
