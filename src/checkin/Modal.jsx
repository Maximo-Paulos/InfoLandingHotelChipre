import { useEffect, useRef } from 'react';
import Icon from '../components/Icon.jsx';

// Ventana encima de la pantalla: se cierra con Esc o con la X, y bloquea el scroll de fondo.
// Todo lo de abrir (llevar el foco, bloquear el scroll) se hace UNA sola vez, al aparecer. No puede depender de
// `onCerrar`: esa función es nueva en cada dibujo y la pantalla se redibuja varias veces por segundo (cuentas
// regresivas, consulta a la base), así que el foco se le sacaba al campo que se estaba escribiendo.
export default function Modal({ titulo, onCerrar, children }) {
  const caja = useRef(null);
  const cerrar = useRef(onCerrar);
  useEffect(() => { cerrar.current = onCerrar; });
  // Quién tenía el foco antes de abrir (el botón que se tocó): se mira al dibujar, antes de que un campo de adentro pida el foco.
  const abridor = useRef(document.activeElement);
  const devolver = useRef(0);

  useEffect(() => {
    clearTimeout(devolver.current); // en desarrollo React desmonta y monta enseguida: ahí no hay que devolver nada
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Si un campo de adentro ya pidió el foco (autoFocus), se respeta; si no, va al cuadro de la ventana.
    if (!caja.current?.contains(document.activeElement)) caja.current?.focus();
    const alTecla = (e) => { if (e.key === 'Escape') cerrar.current(); };
    window.addEventListener('keydown', alTecla);
    return () => {
      window.removeEventListener('keydown', alTecla);
      document.body.style.overflow = overflow;
      devolver.current = setTimeout(() => abridor.current?.focus?.(), 0);
    };
  }, []);

  return (
    <div className="modal-fondo" onMouseDown={(e) => { if (e.target === e.currentTarget) cerrar.current(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={titulo} tabIndex={-1} ref={caja}>
        <div className="modal-cab">
          <h2>{titulo}</h2>
          <button type="button" className="modal-x" onClick={() => cerrar.current()} aria-label="Cerrar"><Icon name="cerrar" size={20} sw={2} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
