import { useEffect, useRef } from 'react';
import Icon from '../components/Icon.jsx';

// Ventana encima de la pantalla: se cierra con Esc o con la X, y bloquea el scroll de fondo.
export default function Modal({ titulo, onCerrar, children }) {
  const caja = useRef(null);
  useEffect(() => {
    const previo = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    caja.current?.focus();
    const alTecla = (e) => { if (e.key === 'Escape') onCerrar(); };
    window.addEventListener('keydown', alTecla);
    return () => {
      window.removeEventListener('keydown', alTecla);
      document.body.style.overflow = overflow;
      previo?.focus?.();
    };
  }, [onCerrar]);
  return (
    <div className="modal-fondo" onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={titulo} tabIndex={-1} ref={caja}>
        <div className="modal-cab">
          <h2>{titulo}</h2>
          <button type="button" className="modal-x" onClick={onCerrar} aria-label="Cerrar"><Icon name="cerrar" size={20} sw={2} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
