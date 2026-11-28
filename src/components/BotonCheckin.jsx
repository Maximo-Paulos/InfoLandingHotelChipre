import Icon from './Icon.jsx';
import { V, Cajas } from './Editable.jsx';
import { useCheckinActivo } from '../checkin/useCheckinActivo.js';
import { useDatos } from '../data/DataContext.jsx';

// El botón grande «Realizar check-in»: va arriba de todo en el menú y también arriba de la pantalla «Check-in» (donde está la información), para que el huésped lo encuentre
// aunque toque primero la información. Solo se muestra si el administrador prendió el check-in digital (en el editor se ve siempre).
//   cajas: en el editor, muestra la caja para cambiar el texto del botón (se edita una sola vez, en el menú; el texto es el mismo en los dos lugares).
export default function BotonCheckin({ cajas = false }) {
  const { editing, base } = useDatos();
  const activo = useCheckinActivo(!editing);
  if (!editing && !activo) return null;
  return (
    <div className="checkin-rapido">
      <a className="btn terra grande" href={`${base}registro`}><Icon name="llave" size={26} sw={1.7} /><span><V p="menu.btnRegistro" /></span></a>
      {cajas && <Cajas ps={[['menu.btnRegistro', 'Texto del botón Realizar check-in']]} />}
      {cajas && editing && <p className="ayuda">Este botón les aparece a los huéspedes solo cuando el check-in digital está encendido (Inicio → Ver huéspedes → Configuración), arriba de todo en el menú y arriba de la pantalla Check-in. Tocándolo acá editás los textos del check-in.</p>}
    </div>
  );
}
