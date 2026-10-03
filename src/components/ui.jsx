import { createContext, useContext } from 'react';
import Icon from './Icon.jsx';
import { wa, maps } from '../lib.js';

export const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);

export function Cabecera({ num, eyebrow, titulo, lead }) {
  return (
    <header style={{ position: 'relative' }}>
      <div className="tag" aria-hidden="true"><small>Nº</small><b>{num}</b></div>
      <div className="top">
        <p className="eyebrow">{eyebrow}</p>
        <a className="back" href="#/"><Icon name="atras" size={16} sw={2} />Menú</a>
      </div>
      <h1>{titulo}</h1>
      {lead && <p className="lead">{lead}</p>}
    </header>
  );
}

export function BtnWa({ texto, msg, cls = '', mini = false }) {
  return (
    <a className={`btn ${mini ? 'mini ' : ''}${cls}`} href={wa(msg)} target="_blank" rel="noopener noreferrer">
      <Icon name="wa" size={mini ? 18 : 20} />{texto}
    </a>
  );
}

export function LinkMaps({ q, texto = 'Ver en Google Maps' }) {
  return (
    <a className="maps" href={maps(q)} target="_blank" rel="noopener noreferrer">
      <Icon name="pin" size={16} sw={1.8} />{texto}
    </a>
  );
}

export function ItemsIcono({ lista }) {
  return (
    <ul className="lista">
      {lista.map(([icono, titulo, texto]) => (
        <li className="item" key={titulo}>
          <span className="ico"><Icon name={icono} size={20} /></span>
          <div><h2>{titulo}</h2><p>{texto}</p></div>
        </li>
      ))}
    </ul>
  );
}

export function Datos({ lista }) {
  return (
    <dl>
      {lista.map(([icono, titulo, texto]) => (
        <div className="dato" key={titulo}>
          <Icon name={icono} size={22} />
          <div><dt>{titulo}</dt><dd>{texto}</dd></div>
        </div>
      ))}
    </dl>
  );
}

export function Pasos({ lista }) {
  return (
    <ol className="pasos">
      {lista.map(([titulo, texto], i) => (
        <li key={titulo}>
          <span className="n" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
          <div><b>{titulo}</b><span className="t">{texto}</span></div>
        </li>
      ))}
    </ol>
  );
}

export function Box({ titulo, texto, azul = false, children }) {
  return (
    <div className={`box${azul ? ' azul' : ''}`}>
      <p>{titulo}</p>
      <p>{texto}</p>
      {children}
    </div>
  );
}
