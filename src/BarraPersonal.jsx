import { useEffect, useState } from 'react';
import Icon from './components/Icon.jsx';
import Modal from './checkin/Modal.jsx';
import { AvisosPanel } from './components/Avisos.jsx';
import { iniciarAvisos } from './push.js';
import { perfilGuardado, refrescarSesion } from './sesion.js';

// Lo que ve el personal en todas sus pantallas, como una app: una barra de arriba con el nombre de la pantalla y de quién entró, y
// las pestañas de abajo para cambiar de sección (la última, «Más», abre el resto: editar la guía, la guía del huésped y salir).
// Cada uno ve solo lo suyo: recepción tiene Código, Reservas (las próximas reservas) y Huéspedes; el dueño, además, Inicio y Datos (estadísticas). Son 5 como máximo (como en
// cualquier app del celular); el resto (Equipo, Ajustes, editar la guía) está en «Más».
const TABS = {
  inicio: { texto: 'Inicio', href: '#/admin', icono: 'casa' },
  codigo: { texto: 'Código', href: '#/recepcion', icono: 'llave' },
  huespedes: { texto: 'Huéspedes', href: '#/admin/huespedes', icono: 'personas' },
  reservasRec: { texto: 'Reservas', href: '#/recepcion/reservas', icono: 'calendario' },
  huespedesRec: { texto: 'Huéspedes', href: '#/recepcion/huespedes', icono: 'personas' },
  estadisticas: { texto: 'Datos', href: '#/admin/estadisticas', icono: 'grafico' }
};
const tabsPara = (rol, dueno) => (rol === 'recepcion'
  ? ['codigo', 'reservasRec', 'huespedesRec']
  : ['inicio', 'codigo', 'huespedes', 'estadisticas']);
const ROL = { admin: 'dueño', recepcion: 'recepción' };

//   titulo: nombre de la pantalla · actual: qué pestaña es (inicio, codigo, huespedes, estadisticas, reservasRec, huespedesRec; otra cosa, como equipo o ajustes = «Más»)
//   atras: { href, texto } para las pantallas que no son una pestaña (el editor) · salir(): cierra la sesión de este dispositivo
//   confirmar(): si devuelve false no se sale de la pantalla (para avisar de cambios sin guardar) · ancha: para las pantallas con planilla
//   children: una segunda fila dentro de la barra de arriba (el editor pone ahí Guardar y Descartar)
export default function BarraPersonal({ titulo, actual, atras, salir, confirmar, ancha, children }) {
  const [abierto, setAbierto] = useState(false);
  const [perfil, setPerfil] = useState(perfilGuardado);
  // Si los avisos ya estaban activos en este celular, se vuelven a atar a la sesión de ahora (una sola vez por carga).
  useEffect(() => { iniciarAvisos(); }, []);
  // Las sesiones abiertas antes del equipo no saben cómo se llama su dueño: se le pregunta una vez a la base.
  useEffect(() => {
    let vivo = true;
    refrescarSesion().then((s) => { if (vivo && s) setPerfil({ rol: s.rol, alias: s.alias, dueno: s.dueno }); }).catch(() => {});
    return () => { vivo = false; };
  }, []);
  const rol = perfil?.rol ?? 'recepcion';
  const dueno = perfil?.dueno ?? false;

  const ir = (e) => {
    if (confirmar && !confirmar()) { e.preventDefault(); return; }
    setAbierto(false);
  };
  const salirYa = () => {
    if (confirmar && !confirmar()) return;
    setAbierto(false);
    salir();
  };
  const abrirMas = () => {
    if (confirmar && !confirmar()) return;
    setAbierto(true);
  };
  const tabs = tabsPara(rol, dueno);
  const enMas = !tabs.includes(actual);

  return (
    <>
      <header className={`barra-personal${ancha ? ' ancha' : ''}`}>
        <div className="bp-fila">
          {atras
            ? <a className="bp-btn" href={atras.href} onClick={ir}><Icon name="atras" size={20} sw={2} /><span>{atras.texto}</span></a>
            : <span className="bp-lado" />}
          <p className="bp-titulo">{titulo}</p>
          <p className="bp-lado bp-quien" title={perfil?.alias ? `Sesión de ${perfil.alias}` : undefined}>{perfil?.alias ?? ''}</p>
        </div>
        {children}
      </header>

      <nav className="tabs-personal" aria-label="Secciones">
        <ul>
          {tabs.map((id) => {
            const t = TABS[id];
            const activa = id === actual;
            return (
              <li key={id}>
                <a href={t.href} onClick={ir} aria-current={activa ? 'page' : undefined} className={activa ? 'activa' : ''}>
                  <Icon name={t.icono} size={24} sw={activa ? 2.2 : 1.7} />
                  <span>{t.texto}</span>
                </a>
              </li>
            );
          })}
          <li>
            <button type="button" onClick={abrirMas} aria-haspopup="dialog" aria-expanded={abierto} className={enMas ? 'activa' : ''}>
              <Icon name="menu" size={24} sw={enMas ? 2.2 : 1.7} />
              <span>Más</span>
            </button>
          </li>
        </ul>
      </nav>

      {abierto && (
        <Modal titulo="Más" onCerrar={() => setAbierto(false)}>
          <AvisosPanel />
          <ul className="bp-lista">
            {rol === 'admin' && dueno && (
              <li>
                <a className="bp-item" href="#/admin/equipo" onClick={ir} aria-current={actual === 'equipo' ? 'page' : undefined}>
                  <Icon name="equipo" size={26} sw={1.6} />
                  <span><b>Equipo</b><small>Quién tiene clave y su código</small></span>
                </a>
              </li>
            )}
            {rol === 'admin' && (
              <li>
                <a className="bp-item" href="#/admin/llegadas" onClick={ir} aria-current={actual === 'llegadas' ? 'page' : undefined}>
                  <Icon name="calendario" size={26} sw={1.6} />
                  <span><b>Reservas anotadas</b><small>Cargar llegadas por adelantado, con precios y seña</small></span>
                </a>
              </li>
            )}
            {rol === 'admin' && (
              <li>
                <a className="bp-item" href="#/admin/ajustes" onClick={ir} aria-current={actual === 'ajustes' ? 'page' : undefined}>
                  <Icon name="ajustes" size={26} sw={1.6} />
                  <span><b>Ajustes</b><small>Check-in, medios de pago, Drive e historial</small></span>
                </a>
              </li>
            )}
            {rol === 'admin' && (
              <li>
                <a className="bp-item" href="#/admin/editar" onClick={ir} aria-current={actual === 'editar' ? 'page' : undefined}>
                  <Icon name="lapiz" size={26} sw={1.6} />
                  <span><b>Editar la guía</b><small>Textos, teléfonos y horarios</small></span>
                </a>
              </li>
            )}
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
          <p className="bp-sesion">Sesión abierta como {perfil?.alias ? `${perfil.alias} (${ROL[rol]})` : ROL[rol]}</p>
        </Modal>
      )}
    </>
  );
}
