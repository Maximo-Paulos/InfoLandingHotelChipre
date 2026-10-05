import { useEffect } from 'react';
import { useDatos } from '../data/DataContext.jsx';
import { IDIOMAS, IDIOMAS_POR_DEFECTO, cambiarIdioma, idiomaActual, iniciarTraductor } from '../idioma.js';
import { useToast } from './ui.jsx';

// Selector de idioma de la guía. Traduce toda la página con el traductor de Google.
export default function Idioma() {
  const { D } = useDatos();
  const toast = useToast();
  const permitidos = Array.isArray(D.hotel.idiomas) ? D.hotel.idiomas : IDIOMAS_POR_DEFECTO;
  const actual = idiomaActual();

  useEffect(() => {
    iniciarTraductor(permitidos, () => toast('No se pudo traducir ahora · Translation unavailable'));
    // Una sola vez al abrir la guía.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lista = IDIOMAS.filter((i) => i.code === 'es' || permitidos.includes(i.code));
  if (lista.length < 2) return null;
  return (
    <div className="idioma notranslate" translate="no">
      <label>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
        <span className="solo-lector">Idioma / Language</span>
        <select value={actual} onChange={(e) => cambiarIdioma(e.target.value)} aria-label="Idioma / Language">
          {lista.map((i) => <option key={i.code} value={i.code}>{i.nombre}</option>)}
        </select>
      </label>
    </div>
  );
}
