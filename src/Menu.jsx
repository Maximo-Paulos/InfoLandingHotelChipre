import Icon from './components/Icon.jsx';
import { Btn, Cajas, T, V } from './components/Editable.jsx';
import { useDatos } from './data/DataContext.jsx';
import { SECCIONES } from './secciones.jsx';

export default function Menu() {
  const { D, editing, base } = useDatos();
  const H = D.hotel;
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
    </div>
  );
}
