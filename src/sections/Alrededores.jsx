import { useState } from 'react';
import Icon from '../components/Icon.jsx';
import { BtnWa, Box, Cabecera, LinkMaps } from '../components/ui.jsx';
import { D, H, maps } from '../lib.js';

export function Comer() {
  const C = D.comer;
  const [cat, setCat] = useState(C.categorias[0].id);
  const [titulo, ...resto] = C.desayunoHotel.split(':');
  return (
    <>
      <Cabecera num="06" eyebrow="Cerca del hotel" titulo="Dónde comer" />
      <p className="note"><strong>{titulo}:</strong>{resto.join(':')}</p>
      <div className="chips" role="group" aria-label="Filtrar lugares">
        {C.categorias.map((c) => (
          <button key={c.id} type="button" aria-pressed={c.id === cat} onClick={() => setCat(c.id)}>{c.nombre}</button>
        ))}
      </div>
      {C.lugares.filter((l) => l.cat === cat).map((l) => (
        <article className="cardi" key={l.nombre}>
          <div className="cab" style={{ alignItems: 'flex-start' }}>
            <h2>{l.nombre}</h2>
            {l.favorito && <span className="chip fav">Nuestro favorito</span>}
          </div>
          <p className="meta">{l.meta}</p>
          <p className="tip">{l.tip}</p>
          <LinkMaps q={`${l.nombre} ${H.ciudad}`} />
        </article>
      ))}
      <div className="btns">
        <a className="btn claro" href={H.mapaRecomendados} target="_blank" rel="noopener noreferrer">
          <Icon name="mapa" size={20} />Ver todos en el mapa
        </a>
      </div>
    </>
  );
}

export function Hacer() {
  return (
    <>
      <Cabecera num="07" eyebrow="Para disfrutar" titulo="Qué hacer" lead="Nuestros favoritos, a pie o a pocos minutos." />
      <div className="btns">
        <a className="btn" href={H.mapaRecomendados} target="_blank" rel="noopener noreferrer">
          <Icon name="mapa" size={20} />Ver todo en el mapa
        </a>
      </div>
      <div style={{ marginTop: 6 }}>
        {D.hacer.map((x) => (
          <article className="cardi hacer" key={x.nombre}>
            <span className="ico"><Icon name={x.icono} size={22} /></span>
            <div className="hacer-cuerpo">
              <p className="tipo">{x.tipo}</p>
              <h2>{x.nombre}</h2>
              <p className="dist">{x.dist}</p>
              <p className="texto">{x.texto}</p>
              <div className="pie-card">
                <span className="chip">{x.ideal}</span>
                <LinkMaps q={`${x.nombre} ${H.ciudad}`} texto="Ver en Maps" />
              </div>
            </div>
          </article>
        ))}
      </div>
      <Box azul titulo="¿Querés una excursión?" texto="Te ayudamos a reservar paseos y traslados desde recepción.">
        <BtnWa mini texto="Consultar por WhatsApp" msg="Hola, quiero consultar por excursiones." cls="negro" />
      </Box>
    </>
  );
}

export function Compras() {
  return (
    <>
      <Cabecera num="08" eyebrow="Lo que necesites" titulo="Compras y servicios" />
      <ul className="lista" style={{ marginTop: 10 }}>
        {D.compras.map(([icono, nombre, detalle]) => (
          <li className="lugares" key={nombre}>
            <span className="ico"><Icon name={icono} size={20} /></span>
            <div><h2>{nombre}</h2><p>{detalle}</p></div>
            <a className="pin" href={maps(`${nombre} ${H.ciudad}`)} target="_blank" rel="noopener noreferrer" aria-label={`Ver ${nombre} en Google Maps`}>
              <Icon name="pin" size={18} sw={1.8} />
            </a>
          </li>
        ))}
      </ul>
      <Box titulo="¿Necesitás un taxi o remís?" texto="Te lo pedimos desde recepción en minutos.">
        <BtnWa mini texto="Pedir un taxi" msg="Hola, necesito un taxi para las __:__." cls="terra" />
      </Box>
    </>
  );
}

const Estrella = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="#EFC374" stroke="#B98A35" strokeWidth="1.2" strokeLinejoin="round" aria-hidden="true">
    <path d="M11.53 2.3a.53.53 0 0 1 .95 0l2.31 4.68a2.12 2.12 0 0 0 1.6 1.16l5.16.76a.53.53 0 0 1 .3.9l-3.74 3.64a2.12 2.12 0 0 0-.61 1.88l.88 5.14a.53.53 0 0 1-.77.56l-4.62-2.43a2.12 2.12 0 0 0-1.97 0L6.4 21.01a.53.53 0 0 1-.77-.56l.88-5.14a2.12 2.12 0 0 0-.61-1.88L2.16 9.8a.53.53 0 0 1 .3-.9l5.16-.76a2.12 2.12 0 0 0 1.6-1.16z" />
  </svg>
);

function FilaResena({ texto, url, cls = '' }) {
  return (
    <a className={`btn fila ${cls}`} href={url} target="_blank" rel="noopener noreferrer">
      <span>{texto}</span><Icon name="ext" size={18} sw={2} />
    </a>
  );
}

export function Resena() {
  const R = D.resena;
  return (
    <>
      <Cabecera num="12" eyebrow="Tu opinión" titulo="¿Cómo fue tu estadía?" />
      <p className="intro">Tu reseña ayuda a otros viajeros a elegirnos y a nosotros a mejorar. Te lleva un minuto.</p>
      <div className="estrellas" aria-hidden="true">{[0, 1, 2, 3, 4].map((i) => <Estrella key={i} />)}</div>
      <div className="btns">
        <FilaResena texto="Dejar reseña en Google" url={R.google} />
        <FilaResena texto="Opinar en Booking" url={R.booking} cls="claro" />
        <FilaResena texto="Opinar en TripAdvisor" url={R.tripadvisor} cls="claro" />
      </div>
      <div style={{ marginTop: 22 }}>
        <Box azul titulo="¿Algo para mejorar?" texto="Contanos en privado: lo leemos todos los días y lo resolvemos.">
          <BtnWa mini texto="Escribinos por WhatsApp" msg="Hola, quiero contarles cómo fue mi estadía: " cls="negro" />
        </Box>
      </div>
      <p className="cierre">Gracias por hospedarte con nosotros. ¡Volvé cuando quieras!</p>
    </>
  );
}
