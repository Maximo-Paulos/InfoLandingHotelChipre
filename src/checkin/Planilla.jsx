import { useEffect, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { cargarTelefono } from './telefono.js';
import { fechaHora, minSeg, urlDrive } from './util.js';

// Las fotos de una fila: la lista nueva, o la única foto de antes si la base todavía no tiene la lista.
const fotosDe = (f) => (Array.isArray(f.fotos) ? f.fotos : f.foto_id ? [{ foto_id: f.foto_id, nombre: f.foto_nombre }] : []);

// La planilla de huéspedes: una fila por persona, con la habitación fija a la izquierda y scroll hacia los costados.
//   filas: [{ id, creado, habitacion, datos, foto_id, foto_nombre, fotos?, editable_seg? }]
//   puedeEditar(fila) -> segundos que quedan para editar (null = sin límite, 0 = no se puede)
//   onFotos(fila): si viene, cada fila tiene un botón para ver y agregar sus fotos (el dueño también puede quitarlas; recepción no)
export default function Planilla({ filas, onEditar, onFotos, restante, vacio = 'Todavía no hay huéspedes cargados.' }) {
  const [lib, setLib] = useState(null);
  useEffect(() => {
    let vivo = true;
    cargarTelefono().then((l) => { if (vivo) setLib(l); }).catch(() => {});
    return () => { vivo = false; };
  }, []);
  const tel = (n) => {
    if (!n) return '';
    try { return lib?.parsePhoneNumberFromString(n)?.formatInternational() ?? n; } catch { return n; }
  };

  if (!filas.length) return <p className="planilla-vacia">{vacio}</p>;
  return (
    <div className="planilla-scroll" role="region" aria-label="Planilla de huéspedes" tabIndex={0}>
      {/* En el celular cada fila se ve como una tarjeta (ver styles.css), por eso los roles explícitos: así se sigue leyendo como tabla. */}
      <table className="planilla" role="table">
        <thead role="rowgroup">
          <tr role="row">
            <th className="fija" scope="col" role="columnheader">Habitación</th>
            <th scope="col" role="columnheader">Medio de pago</th>
            <th scope="col" role="columnheader">Cargado</th>
            <th scope="col" role="columnheader">Habilitó</th>
            <th scope="col" role="columnheader">Apellido</th>
            <th scope="col" role="columnheader">Nombre</th>
            <th scope="col" role="columnheader">Documento</th>
            <th scope="col" role="columnheader">Nacionalidad</th>
            <th scope="col" role="columnheader">Localidad</th>
            <th scope="col" role="columnheader">Domicilio</th>
            <th scope="col" role="columnheader">Email</th>
            <th scope="col" role="columnheader">Teléfono</th>
            <th scope="col" role="columnheader">Foto</th>
            <th scope="col" role="columnheader"><span className="solo-lector">Acciones</span></th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {filas.map((f) => {
            const d = f.datos ?? {};
            const fotos = fotosDe(f);
            const seg = restante ? restante(f) : null;
            const puede = seg === null || seg > 0;
            return (
              <tr key={f.id} role="row" className={f.habitacion ? '' : 'sin-hab'}>
                <th className="fija" scope="row" role="rowheader">
                  {/* La habitación es lo primero que carga recepción: tocarla abre la edición sin tener que deslizar hasta el final. */}
                  {onEditar && puede ? (
                    <button type="button" className="hab-boton" onClick={() => onEditar(f)} aria-label={`Editar a ${d.apellido ?? ''} ${d.nombre ?? ''}`.trim()}>
                      {f.habitacion ? <b>{f.habitacion}</b> : <span className="pendiente">Sin asignar</span>}
                      <Icon name="lapiz" size={14} sw={1.8} />
                    </button>
                  ) : (f.habitacion ? <b>{f.habitacion}</b> : <span className="pendiente">Sin asignar</span>)}
                </th>
                <td role="cell" className="c-pago" data-label="Pago">{f.medio_pago ? <span className="pago">{f.medio_pago}</span> : <span className="muted">—</span>}</td>
                <td role="cell" className="c-cargado" data-label="Cargado">{fechaHora(f.creado)}</td>
                <td role="cell" className="c-hab-por" data-label="Habilitó">{f.habilitado_por ?? ''}</td>
                <td role="cell" className="c-ape" data-label="Apellido">{d.apellido}</td>
                <td role="cell" className="c-nom" data-label="Nombre">{d.nombre}</td>
                <td role="cell" className="c-doc" data-label="Documento"><span className="doc-tipo">{d.doc_tipo}</span> {d.doc_numero}</td>
                <td role="cell" className="c-nac" data-label="Nacionalidad">{d.nacionalidad}</td>
                <td role="cell" className="c-loc" data-label="Localidad">{d.localidad}</td>
                <td role="cell" className="dom c-dom" data-label="Domicilio">{d.domicilio}</td>
                <td role="cell" className="c-email" data-label="Email">{d.email}</td>
                <td role="cell" className="nowrap c-tel" data-label="Teléfono">{tel(d.telefono)}</td>
                <td role="cell" className="fotos-celda c-foto" data-label="Foto">
                  {fotos.length === 0 && <span className="muted">—</span>}
                  {fotos.map((p, i) => (
                    <a key={p.foto_id} className="ver-foto" href={urlDrive(p.foto_id)} target="_blank" rel="noopener noreferrer" title={p.nombre ?? ''}>
                      <Icon name="imagen" size={16} sw={1.8} /> {fotos.length > 1 ? `Ver ${i + 1}` : 'Ver'}
                    </a>
                  ))}
                  {onFotos && (
                    <button type="button" className="btn mini claro foto-gestion" onClick={() => onFotos(f)} aria-label={`${fotos.length ? 'Fotos' : 'Agregar foto'} de ${d.apellido ?? ''} ${d.nombre ?? ''}`.trim()}>
                      {fotos.length ? 'Fotos' : 'Agregar foto'}
                    </button>
                  )}
                </td>
                <td role="cell" className="acciones c-acciones">
                  {onEditar && (
                    puede
                      ? <button type="button" className="btn mini claro" onClick={() => onEditar(f)}>
                          <Icon name="lapiz" size={16} sw={1.8} /> Editar{seg !== null && <small>{minSeg(seg)}</small>}
                        </button>
                      : <span className="candado" title="Se pasó el tiempo para editar"><Icon name="candado" size={16} sw={1.8} /> Cerrado</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
