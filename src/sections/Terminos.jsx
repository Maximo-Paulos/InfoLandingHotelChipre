import { Fragment } from 'react';
import { Caja } from '../components/Editable.jsx';
import { Cabecera } from '../components/ui.jsx';
import { useDatos } from '../data/DataContext.jsx';

// Convierte el texto pegado por el dueño en párrafos, títulos y listas:
//   línea en blanco = nuevo párrafo · "# Título" = subtítulo · "- ítem" = viñeta
export function bloques(texto) {
  const salida = [];
  let actual = null; // párrafo o lista que se está armando
  const cerrar = () => { actual = null; };
  for (const cruda of String(texto ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const l = cruda.trim();
    if (!l) { cerrar(); continue; }
    if (/^#{1,3}\s/.test(l)) { salida.push({ tipo: 'h', texto: l.replace(/^#{1,3}\s+/, '') }); cerrar(); continue; }
    if (/^[-•*]\s+/.test(l)) {
      if (actual?.tipo !== 'ul') { actual = { tipo: 'ul', items: [] }; salida.push(actual); }
      actual.items.push(l.replace(/^[-•*]\s+/, ''));
      continue;
    }
    if (actual?.tipo !== 'p') { actual = { tipo: 'p', texto: l }; salida.push(actual); } else actual.texto += `\n${l}`;
  }
  return salida;
}

export function Terminos() {
  const { D, editing } = useDatos();
  const T = D.terminos;
  const lista = bloques(T.texto);
  return (
    <>
      <Cabecera num="13" id="terminos" />
      <article className="terminos">
        {lista.length === 0 && <p className="lead">Todavía no hay términos y condiciones cargados.</p>}
        {lista.map((b, i) => (
          <Fragment key={i}>
            {b.tipo === 'h' && <h2>{b.texto}</h2>}
            {b.tipo === 'ul' && <ul>{b.items.map((x, k) => <li key={k}>{x}</li>)}</ul>}
            {b.tipo === 'p' && <p>{b.texto}</p>}
          </Fragment>
        ))}
      </article>
      {editing && (
        <>
          <p className="note">Pegá acá el texto completo. Dejá una línea en blanco entre párrafos. Si una línea empieza con <b># </b> es un subtítulo, y si empieza con <b>- </b> es una viñeta.</p>
          <Caja p="terminos.texto" etiqueta="Texto de los términos y condiciones" filas={18} />
        </>
      )}
    </>
  );
}
