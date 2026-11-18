import { useState } from 'react';
import Icon from '../components/Icon.jsx';
import Modal from './Modal.jsx';
import { cobroTexto, plata } from './ReservaForm.jsx';
import { fechaHora, urlDrive } from './util.js';

const fotosDe = (f) => (Array.isArray(f.fotos) ? f.fotos : f.foto_id ? [{ foto_id: f.foto_id, nombre: f.foto_nombre }] : []);
const nombreDe = (f) => `${f.datos?.apellido ?? ''}, ${f.datos?.nombre ?? ''}`.replace(/^, |, $/g, '');
const ddmm = (iso) => iso.split('-').reverse().slice(0, 2).join('/');

// La lista de huéspedes para el celular: una reserva por bloque y una fila corta por persona. Al tocar una persona se abre su ficha con todo
// (y desde ahí se llama, se escribe, se edita o se ven sus fotos). Es la misma información que la planilla, pero sin tener que deslizar.
// Recibe lo mismo que Planilla; `grupos` ya viene armado (ver agrupar.js).
export default function ListaHuespedes({ grupos, onEditar, onFotos, onEditarReserva, reservaEditable, reservas, onAsignar, restante, vacio }) {
  const [ficha, setFicha] = useState(null);
  if (!grupos.length) return <p className="planilla-vacia">{vacio}</p>;
  return (
    <>
      <div className="lista-hue">
        {grupos.map((g) => (
          <section key={g.estadia?.id ?? 'sin'} className="rg" aria-label={g.estadia ? `Habitación ${g.estadia.habitacion}` : 'Sin reserva'}>
            <header className="rg-cab">
              {g.estadia ? (
                <>
                  <div className="rg-tit">
                    <b className="rg-hab">Hab. {g.estadia.habitacion}</b>
                    <span className="rg-cuenta">{g.filas.length} {g.filas.length === 1 ? 'huésped' : 'huéspedes'}</span>
                  </div>
                  <p className="rg-plata">{cobroTexto(g.estadia)} · {g.estadia.medio_pago} · cobro {ddmm(g.estadia.fecha_cobro)} · cargó {g.estadia.cargado_por}</p>
                  {onEditarReserva && (!reservaEditable || reservaEditable(g.estadia)) && (
                    <button type="button" className="rg-editar" onClick={() => onEditarReserva(g.estadia)} aria-label={`Corregir la reserva de la ${g.estadia.habitacion}`}>
                      <Icon name="lapiz" size={16} sw={1.8} /> Corregir
                    </button>
                  )}
                </>
              ) : (
                <div className="rg-tit"><b className="rg-hab pendiente">Sin reserva</b><span className="rg-cuenta">check-ins de antes</span></div>
              )}
            </header>
            <ul className="rg-gente">
              {g.filas.map((f) => {
                const d = f.datos ?? {};
                return (
                  <li key={f.id}>
                    <button type="button" className="hf" onClick={() => setFicha(f)} aria-label={`Ver a ${nombreDe(f)}`}>
                      <span className="hf-datos">
                        <b>{nombreDe(f)}</b>
                        <small>{[!g.estadia && f.habitacion ? `Hab. ${f.habitacion}` : null, d.nacionalidad, d.anio_nac, fechaHora(f.creado)].filter(Boolean).join(' · ')}</small>
                      </span>
                      <Icon name="adelante" size={20} sw={1.8} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {ficha && (
        <Ficha
          fila={ficha}
          puedeEditar={onEditar && (restante ? (restante(ficha) ?? 1) > 0 : true)}
          onCerrar={() => setFicha(null)}
          onEditar={onEditar && ((f) => { setFicha(null); onEditar(f); })}
          onFotos={onFotos && ((f) => { setFicha(null); onFotos(f); })}
          reservas={onAsignar && reservas?.length && !ficha.estadia_id ? reservas : null}
          onAsignar={onAsignar && ((f, id) => { setFicha(null); onAsignar(f, id); })}
        />
      )}
    </>
  );
}

function Dato({ etiqueta, children }) {
  if (children == null || children === '') return null;
  return <div className="fi-dato"><dt>{etiqueta}</dt><dd>{children}</dd></div>;
}

// La ficha de una persona (una hoja que sube desde abajo).
function Ficha({ fila, puedeEditar, onCerrar, onEditar, onFotos, reservas, onAsignar }) {
  const d = fila.datos ?? {};
  const fotos = fotosDe(fila);
  const tel = d.telefono ? String(d.telefono) : '';
  const wa = tel.replace(/\D/g, '');
  return (
    <Modal titulo={nombreDe(fila) || 'Huésped'} onCerrar={onCerrar}>
      <dl className="ficha">
        <Dato etiqueta="Habitación">{fila.habitacion ? `Hab. ${fila.habitacion}` : 'Sin asignar'}</Dato>
        {fila.estadia && <Dato etiqueta="Cobro de la habitación">{cobroTexto(fila.estadia)} · {fila.estadia.medio_pago}</Dato>}
        {!fila.estadia && fila.medio_pago && <Dato etiqueta="Medio de pago">{fila.medio_pago}</Dato>}
        <Dato etiqueta="Documento">{d.doc_tipo} {d.doc_numero}</Dato>
        <Dato etiqueta="Nacionalidad">{d.nacionalidad}</Dato>
        <Dato etiqueta="Año de nacimiento">{d.anio_nac}</Dato>
        <Dato etiqueta="Localidad">{d.localidad}</Dato>
        <Dato etiqueta="Domicilio">{d.domicilio}</Dato>
        <Dato etiqueta="Email">{d.email && <a href={`mailto:${d.email}`}>{d.email}</a>}</Dato>
        <Dato etiqueta="Teléfono">{tel && (<><a href={`tel:${tel}`}>{tel}</a>{wa && <> · <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer">WhatsApp</a></>}</>)}</Dato>
        <Dato etiqueta="Check-in">{fechaHora(fila.creado)}{fila.habilitado_por ? ` · habilitó ${fila.habilitado_por}` : ''}</Dato>
        <Dato etiqueta="Fotos del documento">
          {fotos.length ? fotos.map((p, i) => <a key={p.foto_id} className="ver-foto" href={urlDrive(p.foto_id)} target="_blank" rel="noopener noreferrer">Ver {fotos.length > 1 ? i + 1 : 'foto'}</a>) : 'Sin foto'}
        </Dato>
      </dl>
      {reservas && (
        <div className="campo">
          <label htmlFor="ficha-asignar">Asignar a una reserva</label>
          <select id="ficha-asignar" value="" onChange={(e) => e.target.value && onAsignar(fila, Number(e.target.value))}>
            <option value="">Elegí una reserva…</option>
            {reservas.map((r) => <option key={r.id} value={r.id}>Hab. {r.habitacion} · {plata(r.monto, r.moneda)}</option>)}
          </select>
        </div>
      )}
      {(onEditar || onFotos) && (
        <div className="btns modal-pie">
          {onEditar && puedeEditar && <button type="button" className="btn" onClick={() => onEditar(fila)}><Icon name="lapiz" size={18} sw={1.8} /> Editar datos</button>}
          {onFotos && <button type="button" className="btn claro" onClick={() => onFotos(fila)}>{fotos.length ? 'Fotos' : 'Agregar foto'}</button>}
        </div>
      )}
    </Modal>
  );
}
