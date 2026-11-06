import { useState } from 'react';
import Icon from './components/Icon.jsx';
import Modal from './checkin/Modal.jsx';

// Barra de arriba de todas las pantallas del personal: una flecha para volver, el nombre de la pantalla y el botón "Menú" (las tres
// barritas), que abre la lista de pantallas. Se queda fija arriba al deslizar.
const PANTALLAS = [
  { id: 'inicio', texto: 'Inicio', ayuda: 'Lo que podés hacer', href: '#/admin', icono: 'entrada', roles: ['admin'] },
  { id: 'huespedes', texto: 'Huéspedes', ayuda: 'Quiénes hicieron el check-in y los ajustes', href: '#/admin/huespedes', icono: 'personas', roles: ['admin'] },
  { id: 'recepcion', texto: 'Recepción', ayuda: 'El código para el huésped y la lista', href: '#/recepcion', icono: 'llave', roles: ['admin', 'recepcion'] },
  { id: 'editar', texto: 'Editar la guía', ayuda: 'Textos, teléfonos y horarios', href: '#/admin/editar', icono: 'lapiz', roles: ['admin'] }
];

//   titulo: nombre de la pantalla · actual: cuál es (para marcarla en el menú) · rol: 'admin' | 'recepcion'
//   atras: { href, texto } o nada si es la pantalla principal · salir(): cierra la sesión de este dispositivo
//   confirmar(): si devuelve false no se sale de la pantalla (para avisar de cambios sin guardar) · ancha: para las pantallas con planilla
//   children: una segunda fila dentro de la barra (el editor pone ahí Guardar y Descartar)
export default function BarraPersonal({ titulo, actual, rol = 'admin', atras, salir, confirmar, ancha, children }) {
  const [abierto, setAbierto] = useState(false);
  const ir = (e) => {
    if (confirmar && !confirmar()) { e.preventDefault(); return; }
    setAbierto(false);
  };
  const salirYa = () => {
    if (confirmar && !confirmar()) return;
    setAbierto(false);
    salir();
  };
  return (
    <>
      <header className={`barra-personal${ancha ? ' ancha' : ''}`}>
        <div className="bp-fila">
          {atras
            ? <a className="bp-btn" href={atras.href} onClick={ir}><Icon name="atras" size={20} sw={2} /><span>{atras.texto}</span></a>
            : <span className="bp-vacio" />}
          <p className="bp-titulo">{titulo}</p>
          <button type="button" className="bp-btn" onClick={() => setAbierto(true)} aria-haspopup="dialog" aria-expanded={abierto}>
            <Icon name="menu" size={20} sw={2} /><span>Menú</span>
          </button>
        </div>
        {children}
      </header>
      {abierto && (
        <Modal titulo="Menú" onCerrar={() => setAbierto(false)}>
          <nav aria-label="Pantallas del personal">
            <ul className="bp-lista">
              {PANTALLAS.filter((p) => p.roles.includes(rol)).map((p) => (
                <li key={p.id}>
                  <a className="bp-item" href={p.href} onClick={ir} aria-current={p.id === actual ? 'page' : undefined}>
                    <Icon name={p.icono} size={26} sw={1.6} />
                    <span><b>{p.texto}</b><small>{p.ayuda}</small></span>
                  </a>
                </li>
              ))}
              <li>
                <a className="bp-item" href="#/" target="_blank" rel="noopener noreferrer" onClick={() => setAbierto(false)}>
                  <Icon name="ext" size={26} sw={1.6} />
                  <span><b>Ver la guía del huésped</b><small>Como la ve tu cliente (se abre aparte)</small></span>
                </a>
              </li>
              <li>
                <button type="button" className="bp-item" onClick={salirYa}>
                  <Icon name="salida" size={26} sw={1.6} />
                  <span><b>Salir</b><small>Cierra la sesión en este celular</small></span>
                </button>
              </li>
            </ul>
          </nav>
          <p className="bp-sesion">Sesión abierta como {rol === 'admin' ? 'dueño' : 'recepción'}</p>
        </Modal>
      )}
    </>
  );
}
