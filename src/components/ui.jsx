import { createContext, useContext } from 'react';
import Icon from './Icon.jsx';
import { Cajas, Lista, T, V, get } from './Editable.jsx';
import { useDatos } from '../data/DataContext.jsx';

export const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);

// Encabezado de cada pantalla: etiqueta con el Nº, texto superior, título y volver al menú.
export function Cabecera({ num, id }) {
  const { D, base } = useDatos();
  return (
    <header style={{ position: 'relative' }}>
      <div className="tag" aria-hidden="true"><small>Nº</small><b>{num}</b></div>
      <div className="top">
        <p className="eyebrow"><V p={`${id}.eyebrow`} /></p>
        <a className="back" href={base}><Icon name="atras" size={16} sw={2} />Menú</a>
      </div>
      <Cajas ps={[[`${id}.eyebrow`, 'Texto chico de arriba']]} />
      <T as="h1" p={`${id}.titulo`} etiqueta="Título de la pantalla" />
      {get(D, `${id}.lead`) !== undefined && <T as="p" className="lead" p={`${id}.lead`} etiqueta="Bajada" />}
    </header>
  );
}

// Recuadro con título y texto; los botones van como `children`.
export function Box({ titulo, texto, azul = false, children }) {
  return (
    <div className={`box${azul ? ' azul' : ''}`}>
      <p><V p={titulo} /></p>
      <p><V p={texto} /></p>
      {children}
      <Cajas ps={[[titulo, 'Título del recuadro'], [texto, 'Texto del recuadro']]} />
    </div>
  );
}

// Lista de [título, texto] con número: pasos, normas.
export function Pasos({ p }) {
  return (
    <Lista p={p} tag="ol" className="pasos" plantilla={['Nuevo ítem', 'Descripción']} render={(_it, i, ruta, quitar) => (
      <li>
        <span className="n" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
        <div>
          <b><V p={`${ruta}.0`} /></b>
          <span className="t"><V p={`${ruta}.1`} /></span>
          <Cajas ps={[[`${ruta}.0`, 'Título'], [`${ruta}.1`, 'Texto']]} />
          {quitar}
        </div>
      </li>
    )} />
  );
}

// Lista de [ícono, título, texto] con el ícono en círculo.
export function ItemsIcono({ p }) {
  return (
    <Lista p={p} tag="ul" className="lista" plantilla={['brillo', 'Nuevo ítem', 'Descripción']} render={(it, _i, ruta, quitar) => (
      <li className="item">
        <span className="ico"><Icon name={it[0]} size={20} /></span>
        <div>
          <h2><V p={`${ruta}.1`} /></h2>
          <p><V p={`${ruta}.2`} /></p>
          <Cajas ps={[[`${ruta}.1`, 'Título'], [`${ruta}.2`, 'Texto']]} />
          {quitar}
        </div>
      </li>
    )} />
  );
}

// Lista de datos [ícono, título, texto] en filas.
export function Datos({ p }) {
  return (
    <Lista p={p} tag="dl" plantilla={['reloj', 'Nuevo dato', 'Descripción']} render={(it, _i, ruta, quitar) => (
      <div className="dato">
        <Icon name={it[0]} size={22} />
        <div>
          <dt><V p={`${ruta}.1`} /></dt>
          <dd><V p={`${ruta}.2`} /></dd>
          <Cajas ps={[[`${ruta}.1`, 'Título'], [`${ruta}.2`, 'Texto']]} />
          {quitar}
        </div>
      </div>
    )} />
  );
}
