import Icon from '../components/Icon.jsx';
import { LoginAdmin, useSesionAdmin } from './sesionAdmin.jsx';

// Inicio del panel del admin general: elegir entre editar la guía o ver a los huéspedes.
export default function AdminInicio() {
  const sesion = useSesionAdmin();
  if (sesion.fase !== 'ok') return <LoginAdmin sesion={sesion} />;
  return (
    <div className="page">
      <main className="card">
        <header>
          <p className="eyebrow" style={{ paddingTop: 6 }}>Solo para el dueño</p>
          <h1>Panel del administrador</h1>
          <p className="lead">¿Qué querés hacer?</p>
        </header>
        <nav className="grid una" aria-label="Opciones del panel">
          <a className="tile hot grande" href="#/admin/editar">
            <Icon name="lapiz" size={28} sw={1.6} />
            <span>Editar landing page</span>
            <small>Textos, links, teléfonos y horarios de la guía.</small>
          </a>
          <a className="tile hot grande" href="#/admin/huespedes">
            <Icon name="personas" size={28} sw={1.6} />
            <span>Ver huéspedes</span>
            <small>Check-ins cargados, configuración y conexión con Drive.</small>
          </a>
        </nav>
        <div className="btns">
          <a className="btn claro" href="#/">Ver la guía</a>
          <button type="button" className="btn claro" onClick={sesion.salir}>Salir</button>
        </div>
      </main>
    </div>
  );
}
