import { useCallback, useEffect, useRef, useState } from 'react';
import Menu from './Menu.jsx';
import { ToastContext } from './components/ui.jsx';
import { Checkin, Wifi, Emergencias, Checkout } from './sections/Esenciales.jsx';
import { Habitacion, Instalaciones, Normas, Preguntas } from './sections/Estadia.jsx';
import { Comer, Hacer, Compras, Resena } from './sections/Alrededores.jsx';
import { H } from './lib.js';

// Orden y datos del menú. `id` es el link directo (#/wifi) para los QR.
const SECCIONES = [
  { id: 'checkin', titulo: 'Check-in', icono: 'llave', hot: true, Vista: Checkin },
  { id: 'wifi', titulo: 'Wi-Fi', icono: 'wifi', hot: true, Vista: Wifi },
  { id: 'habitacion', titulo: 'Tu habitación', icono: 'cama', Vista: Habitacion },
  { id: 'instalaciones', titulo: 'Instalaciones', icono: 'olas', Vista: Instalaciones },
  { id: 'normas', titulo: 'Normas', icono: 'normas', Vista: Normas },
  { id: 'comer', titulo: 'Dónde comer', icono: 'cubierto', Vista: Comer },
  { id: 'hacer', titulo: 'Qué hacer', icono: 'brujula', Vista: Hacer },
  { id: 'compras', titulo: 'Compras', icono: 'bolsa', Vista: Compras },
  { id: 'emergencias', titulo: 'Emergencias', icono: 'alerta', oscuro: true, Vista: Emergencias },
  { id: 'preguntas', titulo: 'Preguntas', icono: 'duda', Vista: Preguntas },
  { id: 'checkout', titulo: 'Check-out', icono: 'valija', Vista: Checkout },
  { id: 'resena', titulo: 'Tu reseña', icono: 'estrella', Vista: Resena }
];

const leerRuta = () => location.hash.replace(/^#\/?/, '').split('?')[0];

function useRuta() {
  const [ruta, setRuta] = useState(leerRuta);
  useEffect(() => {
    const alCambiar = () => setRuta(leerRuta());
    window.addEventListener('hashchange', alCambiar);
    return () => window.removeEventListener('hashchange', alCambiar);
  }, []);
  return ruta;
}

export default function App() {
  const ruta = useRuta();
  const seccion = SECCIONES.find((s) => s.id === ruta);
  const tarjeta = useRef(null);
  const [aviso, setAviso] = useState('');

  const toast = useCallback((msg) => setAviso(msg), []);
  useEffect(() => {
    if (!aviso) return undefined;
    const t = setTimeout(() => setAviso(''), 2600);
    return () => clearTimeout(t);
  }, [aviso]);

  useEffect(() => {
    document.title = `${seccion ? `${seccion.titulo} · ` : 'Guía del huésped · '}${H.nombre}`;
    window.scrollTo(0, 0);
    tarjeta.current?.focus({ preventScroll: true });
  }, [seccion]);

  return (
    <ToastContext.Provider value={toast}>
      <div className="page">
        <main ref={tarjeta} tabIndex={-1} className={`card${seccion?.oscuro ? ' oscuro' : ''}`}>
          {seccion ? <seccion.Vista /> : <Menu secciones={SECCIONES} />}
        </main>
        <p className="pie">{H.nombre} · Recepción abierta las 24 h</p>
      </div>
      {aviso && <p className="toast" role="status">{aviso}</p>}
    </ToastContext.Provider>
  );
}
