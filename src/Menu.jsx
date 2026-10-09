import { useEffect, useState } from 'react';
import Icon from './components/Icon.jsx';
import { estadoCheckin } from './checkin/checkinApi.js';
import { Btn, Cajas, T, V } from './components/Editable.jsx';
import { useDatos } from './data/DataContext.jsx';
import { SECCIONES } from './secciones.jsx';

// El botón de check-in solo se muestra si el administrador prendió el check-in digital.
function useCheckinActivo(consultar) {
  const [activo, setActivo] = useState(false);
  useEffect(() => {
    if (!consultar) return undefined;
    let vivo = true;
    estadoCheckin().then((e) => { if (vivo) setActivo(!!e?.activo); }).catch(() => {});
    return () => { vivo = false; };
  }, [consultar]);
  return activo;
}

export default function Menu() {
  const { D, editing, base } = useDatos();
  const H = D.hotel;
  const checkinActivo = useCheckinActivo(!editing);
  return (
    <div className="menu">
      <header style={{ position: 'relative' }}>
        <div className="tag" aria-hidden="true"><i>{H.sigla}</i></div>
        <p className="eyebrow" translate="no" style={{ padding: '6px 0 0 60px', minHeight: 22 }}>{H.nombre}</p>
        <T as="h1" p="menu.titulo" etiqueta="Título del menú" />
        <T as="p" className="lead" p="menu.lead" etiqueta="Bajada" />
      </header>
      <nav className="grid" aria-label="Secciones de la guía">
        {SECCIONES.filter((s) => !s.fuera).map((s) => {
          const tile = (
            <a key={s.id} className={`tile${s.hot ? ' hot' : ''}`} href={`${base}${s.id}`}>
              <Icon name={s.icono} size={24} sw={s.hot ? 1.7 : 1.6} />
              <span><V p={`menu.tiles.${s.id}`} /></span>
            </a>
          );
          return editing
            ? <div className="tile-wrap" key={s.id}>{tile}<Cajas ps={[[`menu.tiles.${s.id}`, 'Texto del botón']]} /></div>
            : tile;
        })}
        {editing && (
          <a className="tile tile-datos" href={`${base}datos`}>
            <Icon name="candado" size={24} />
            <span>Datos generales</span>
          </a>
        )}
      </nav>
      <p className="note"><strong><V p="menu.apuroTitulo" /></strong> <V p="menu.apuroTexto" /></p>
      <Cajas ps={[['menu.apuroTitulo', 'Título del aviso'], ['menu.apuroTexto', 'Texto del aviso']]} />
      <div className="btns"><Btn label="menu.btnWa" wa="menu.msgWa" icon="wa" cls="negro" /></div>
      <a className="link-terminos" href={`${base}terminos`}>
        <Icon name="normas" size={20} sw={1.6} />
        <span><V p="menu.btnTerminos" /></span>
        <Icon name="adelante" size={16} sw={2} />
      </a>
      <Cajas ps={[['menu.btnTerminos', 'Texto del link a Términos y condiciones']]} />
      {(editing || checkinActivo) && (
        <>
          <div className="btns">
            <a className="btn terra" href={`${base}registro`}><Icon name="llave" size={20} sw={1.7} /><span><V p="menu.btnRegistro" /></span></a>
          </div>
          <Cajas ps={[['menu.btnRegistro', 'Texto del botón Realizar check-in']]} />
          {editing && <p className="ayuda">Este botón les aparece a los huéspedes solo cuando el check-in digital está encendido (Inicio → Ver huéspedes → Configuración). Tocándolo acá editás los textos del check-in.</p>}
        </>
      )}
    </div>
  );
}
