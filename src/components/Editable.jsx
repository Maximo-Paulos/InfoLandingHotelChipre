import { Fragment } from 'react';
import Icon from './Icon.jsx';
import { useDatos } from '../data/DataContext.jsx';
import { tel as telUrl, urlSegura, wa as waUrl } from '../lib.js';

// Lee y escribe valores por ruta: "checkin.pasos.0.1" → D.checkin.pasos[0][1]
export const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);

export function setIn(o, p, v) {
  const [k, ...resto] = p.split('.');
  const copia = Array.isArray(o) ? [...o] : { ...o };
  copia[k] = resto.length ? setIn(o[k], resto.join('.'), v) : v;
  return copia;
}

/* ---------- cajas para editar (solo aparecen en el panel) ---------- */

export function Caja({ p, etiqueta = 'Editar texto' }) {
  const { D, set } = useDatos();
  const v = String(get(D, p) ?? '');
  const filas = Math.min(6, Math.max(1, Math.ceil(v.length / 42)));
  return (
    <label className="caja">
      <span>{etiqueta}</span>
      <textarea rows={filas} value={v} onChange={(e) => set(p, e.target.value)} />
    </label>
  );
}

// ps: lista de rutas, o de [ruta, etiqueta]
export function Cajas({ ps }) {
  const { editing } = useDatos();
  if (!editing) return null;
  return ps.filter(Boolean).map((x) => {
    const [p, etiqueta] = Array.isArray(x) ? x : [x];
    return <Caja key={p} p={p} etiqueta={etiqueta} />;
  });
}

/* ---------- textos ---------- */

// Solo el valor, sin caja: para armar frases con varias partes.
export function V({ p }) {
  const { D } = useDatos();
  return String(get(D, p) ?? '');
}

// Un texto de la guía. En el panel agrega debajo la caja para editarlo.
export function T({ p, as: Tag = 'span', className, style, etiqueta }) {
  const { D, editing } = useDatos();
  return (
    <>
      <Tag className={className} style={style}>{String(get(D, p) ?? '')}</Tag>
      {editing && <Caja p={p} etiqueta={etiqueta} />}
    </>
  );
}

/* ---------- botones y links ---------- */

// Botón de la guía. `wa`, `tel` y `url` son rutas a los datos (mensaje, teléfono, link).
// En el panel se dibuja sin acción y debajo aparecen las cajas para cambiar texto y destino.
export function Btn({ label, cls = '', icon, wa, tel, url, to, href, mini, fila, onClick, extra = [] }) {
  const { D, editing } = useDatos();
  // Cada botón puede tener su propio número (`<label>Num`) o su propio link (`<label>Link`);
  // si están vacíos se usa el WhatsApp general o el link automático.
  const num = String(get(D, `${label}Num`) ?? '').trim();
  const link = String(get(D, `${label}Link`) ?? '').trim();
  let destino = href;
  if (href && link) destino = urlSegura(link);
  if (wa) destino = waUrl(num.replace(/\D/g, '').length >= 8 ? num : D.hotel.whatsapp, get(D, wa) ?? '');
  else if (tel) destino = telUrl(get(D, tel) ?? '');
  else if (url) destino = urlSegura(get(D, url) ?? '');
  else if (to) destino = to;

  const clase = `btn ${mini ? 'mini ' : ''}${fila ? 'fila ' : ''}${cls}`.trim();
  const contenido = (
    <>
      {icon && <Icon name={icon} size={mini ? 18 : 20} sw={1.7} />}
      <span>{String(get(D, label) ?? '')}</span>
      {fila && <Icon name="ext" size={18} sw={2} />}
    </>
  );

  if (editing) {
    return (
      <>
        <div className={clase}>{contenido}</div>
        <Cajas ps={[
          [label, 'Texto del botón'],
          wa && [`${label}Num`, 'Número de WhatsApp de este botón, con código de país (vacío = el número general del hotel)'],
          wa && [wa, 'Mensaje de WhatsApp que se envía'],
          href && !onClick && [`${label}Link`, 'Link de Google Maps de este botón (vacío = se arma solo con la dirección)'],
          tel && [tel, 'Teléfono al que llama'],
          url && [url, 'Link al que lleva (https://…)'],
          ...extra
        ]} />
      </>
    );
  }
  if (onClick) return <button type="button" className={clase} onClick={onClick}>{contenido}</button>;
  const externo = !to && !tel;
  return (
    <a className={clase} href={destino} {...(externo ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
      {contenido}
    </a>
  );
}

/* ---------- listas con Agregar / Quitar ---------- */

function Quitar({ p, i }) {
  const { remove } = useDatos();
  return <button type="button" className="ed-quitar" onClick={() => remove(p, i)}>Quitar este ítem</button>;
}

// Dibuja cada ítem con `render(item, i, ruta, quitar)`; `quitar` es el botón de borrar (solo en el panel).
// `filtro` permite mostrar solo algunos ítems sin perder la posición real.
export function Lista({ p, plantilla, render, tag: Tag = 'div', className, style, filtro, agregar = 'Agregar ítem' }) {
  const { D, editing, add } = useDatos();
  const items = get(D, p) ?? [];
  return (
    <>
      <Tag className={className} style={style}>
        {items.map((it, i) => (filtro && !filtro(it) ? null : (
          <Fragment key={i}>{render(it, i, `${p}.${i}`, editing ? <Quitar p={p} i={i} /> : null)}</Fragment>
        )))}
      </Tag>
      {editing && (
        <button type="button" className="ed-add" onClick={() => add(p, typeof plantilla === 'function' ? plantilla() : structuredClone(plantilla))}>
          ＋ {agregar}
        </button>
      )}
    </>
  );
}
