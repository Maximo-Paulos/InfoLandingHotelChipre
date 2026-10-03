import { useState } from 'react';
import Icon from '../components/Icon.jsx';
import { Btn, Cajas, Lista, T, V } from '../components/Editable.jsx';
import { Box, Cabecera } from '../components/ui.jsx';
import { useDatos } from '../data/DataContext.jsx';
import { maps, urlSegura } from '../lib.js';

// `link`: link de Google Maps propio del lugar; si está vacío se busca por nombre.
const LINK_ETQ = 'Link de Google Maps de este lugar (vacío = se busca por nombre)';

function LinkMaps({ q, p, link }) {
  const propio = String(link ?? '').trim();
  return (
    <a className="maps" href={propio ? urlSegura(propio) : maps(q)} target="_blank" rel="noopener noreferrer">
      <Icon name="pin" size={16} sw={1.8} /><V p={p} />
    </a>
  );
}

export function Comer() {
  const { D, editing, set } = useDatos();
  const C = D.comer;
  const [cat, setCat] = useState(C.categorias[0]?.id);
  return (
    <>
      <Cabecera num="06" id="comer" />
      <p className="note"><strong><V p="comer.desayunoEtq" /></strong> <V p="comer.desayunoTexto" /></p>
      <Cajas ps={[['comer.desayunoEtq', 'Título del aviso'], ['comer.desayunoTexto', 'Texto del aviso']]} />
      <div className="chips" role="group" aria-label="Filtrar lugares">
        {C.categorias.map((c) => (
          <button key={c.id} type="button" aria-pressed={c.id === cat} onClick={() => setCat(c.id)}>{c.nombre}</button>
        ))}
      </div>
      <Cajas ps={C.categorias.map((c, i) => [`comer.categorias.${i}.nombre`, `Nombre de la categoría ${i + 1}`])} />
      <Lista p="comer.lugares" filtro={(l) => l.cat === cat} plantilla={() => ({ cat, nombre: 'Nuevo lugar', meta: 'Tipo · $$ · a 300 m', tip: 'Un consejo', favorito: false })} agregar="Agregar lugar" render={(l, _i, ruta, quitar) => (
        <article className="cardi">
          <div className="cab" style={{ alignItems: 'flex-start' }}>
            <h2><V p={`${ruta}.nombre`} /></h2>
            {l.favorito && <span className="chip fav"><V p="comer.favorito" /></span>}
          </div>
          <p className="meta"><V p={`${ruta}.meta`} /></p>
          <p className="tip"><V p={`${ruta}.tip`} /></p>
          <LinkMaps q={`${l.nombre} ${D.hotel.ciudad}`} p="comer.btnMaps" link={l.link} />
          <Cajas ps={[[`${ruta}.nombre`, 'Nombre del lugar'], [`${ruta}.meta`, 'Tipo · precio · distancia'], [`${ruta}.tip`, 'Consejo'], [`${ruta}.link`, LINK_ETQ]]} />
          {editing && (
            <label className="ed-check">
              <input type="checkbox" checked={!!l.favorito} onChange={(e) => set(`${ruta}.favorito`, e.target.checked)} /> Marcar como favorito
            </label>
          )}
          {quitar}
        </article>
      )} />
      <Cajas ps={[['comer.favorito', 'Etiqueta de favorito'], ['comer.btnMaps', 'Texto del link a Google Maps']]} />
      <div className="btns"><Btn label="comer.btnMapa" url="hotel.mapaRecomendados" icon="mapa" cls="claro" /></div>
    </>
  );
}

export function Hacer() {
  return (
    <>
      <Cabecera num="07" id="hacer" />
      <div className="btns"><Btn label="hacer.btnMapa" url="hotel.mapaRecomendados" icon="mapa" /></div>
      <div style={{ marginTop: 6 }}>
        <HacerLista />
      </div>
      <Box azul titulo="hacer.excursionTitulo" texto="hacer.excursionTexto">
        <Btn mini label="hacer.btn" wa="hacer.msg" icon="wa" cls="negro" />
      </Box>
    </>
  );
}

function HacerLista() {
  const { D } = useDatos();
  const nuevo = { tipo: 'Paseo', icono: 'brujula', nombre: 'Nuevo lugar', dist: 'A 500 m · 7 min caminando', texto: 'Un consejo', ideal: 'Ideal para…' };
  return (
    <>
      <Lista p="hacer.items" plantilla={nuevo} agregar="Agregar lugar" render={(x, _i, ruta, quitar) => (
        <article className="cardi hacer">
          <span className="ico"><Icon name={x.icono} size={22} /></span>
          <div className="hacer-cuerpo">
            <p className="tipo"><V p={`${ruta}.tipo`} /></p>
            <h2><V p={`${ruta}.nombre`} /></h2>
            <p className="dist"><V p={`${ruta}.dist`} /></p>
            <p className="texto"><V p={`${ruta}.texto`} /></p>
            <div className="pie-card">
              <span className="chip"><V p={`${ruta}.ideal`} /></span>
              <LinkMaps q={`${x.nombre} ${D.hotel.ciudad}`} p="hacer.btnMaps" link={x.link} />
            </div>
            <Cajas ps={[[`${ruta}.tipo`, 'Tipo (Paseo, Cultura…)'], [`${ruta}.nombre`, 'Nombre del lugar'], [`${ruta}.dist`, 'Distancia'], [`${ruta}.texto`, 'Consejo'], [`${ruta}.ideal`, 'Ideal para…'], [`${ruta}.link`, LINK_ETQ]]} />
            {quitar}
          </div>
        </article>
      )} />
      <Cajas ps={[['hacer.btnMaps', 'Texto del link a Google Maps']]} />
    </>
  );
}

export function Compras() {
  const { D } = useDatos();
  return (
    <>
      <Cabecera num="08" id="compras" />
      <Lista p="compras.items" tag="ul" className="lista" style={{ marginTop: 10 }} plantilla={['tienda', 'Nuevo servicio', 'Detalle · a 300 m', '']} agregar="Agregar servicio" render={(it, _i, ruta, quitar) => (
        <li className="lugares">
          <span className="ico"><Icon name={it[0]} size={20} /></span>
          <div>
            <h2><V p={`${ruta}.1`} /></h2>
            <p><V p={`${ruta}.2`} /></p>
            <Cajas ps={[[`${ruta}.1`, 'Nombre'], [`${ruta}.2`, 'Horario y distancia'], [`${ruta}.3`, LINK_ETQ]]} />
            {quitar}
          </div>
          <a className="pin" href={it[3]?.trim() ? urlSegura(it[3]) : maps(`${it[1]} ${D.hotel.ciudad}`)} target="_blank" rel="noopener noreferrer" aria-label={`Ver ${it[1]} en Google Maps`}>
            <Icon name="pin" size={18} sw={1.8} />
          </a>
        </li>
      )} />
      <Box titulo="compras.taxiTitulo" texto="compras.taxiTexto">
        <Btn mini label="compras.btn" wa="compras.msg" icon="wa" cls="terra" />
      </Box>
    </>
  );
}

const Estrella = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="#EFC374" stroke="#B98A35" strokeWidth="1.2" strokeLinejoin="round" aria-hidden="true">
    <path d="M11.53 2.3a.53.53 0 0 1 .95 0l2.31 4.68a2.12 2.12 0 0 0 1.6 1.16l5.16.76a.53.53 0 0 1 .3.9l-3.74 3.64a2.12 2.12 0 0 0-.61 1.88l.88 5.14a.53.53 0 0 1-.77.56l-4.62-2.43a2.12 2.12 0 0 0-1.97 0L6.4 21.01a.53.53 0 0 1-.77-.56l.88-5.14a2.12 2.12 0 0 0-.61-1.88L2.16 9.8a.53.53 0 0 1 .3-.9l5.16-.76a2.12 2.12 0 0 0 1.6-1.16z" />
  </svg>
);

export function Resena() {
  return (
    <>
      <Cabecera num="12" id="resena" />
      <T as="p" className="intro" p="resena.intro" />
      <div className="estrellas" aria-hidden="true">{[0, 1, 2, 3, 4].map((i) => <Estrella key={i} />)}</div>
      <div className="btns">
        <Btn fila label="resena.btnGoogle" url="resena.google" />
        <Btn fila label="resena.btnBooking" url="resena.booking" cls="claro" />
        <Btn fila label="resena.btnTripadvisor" url="resena.tripadvisor" cls="claro" />
      </div>
      <div style={{ marginTop: 22 }}>
        <Box azul titulo="resena.mejorarTitulo" texto="resena.mejorarTexto">
          <Btn mini label="resena.btn" wa="resena.msg" icon="wa" cls="negro" />
        </Box>
      </div>
      <T as="p" className="cierre" p="resena.cierre" />
    </>
  );
}
