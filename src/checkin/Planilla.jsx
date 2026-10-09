import { useEffect, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { cargarTelefono } from './telefono.js';
import { fechaHora, minSeg } from './util.js';

const urlDrive = (id) => `https://drive.google.com/file/d/${encodeURIComponent(id)}/view`;

// La planilla de huéspedes: una fila por persona, con la habitación fija a la izquierda y scroll hacia los costados.
//   filas: [{ id, creado, habitacion, datos, foto_id, foto_nombre, editable_seg? }]
//   puedeEditar(fila) -> segundos que quedan para editar (null = sin límite, 0 = no se puede)
export default function Planilla({ filas, onEditar, restante, vacio = 'Todavía no hay huéspedes cargados.' }) {
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
      <table className="planilla">
        <thead>
          <tr>
            <th className="fija" scope="col">Habitación</th>
            <th scope="col">Cargado</th>
            <th scope="col">Apellido</th>
            <th scope="col">Nombre</th>
            <th scope="col">Documento</th>
            <th scope="col">Nacionalidad</th>
            <th scope="col">Localidad</th>
            <th scope="col">Domicilio</th>
            <th scope="col">Email</th>
            <th scope="col">Teléfono</th>
            <th scope="col">Foto</th>
            <th scope="col"><span className="solo-lector">Acciones</span></th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => {
            const d = f.datos ?? {};
            const seg = restante ? restante(f) : null;
            const puede = seg === null || seg > 0;
            return (
              <tr key={f.id} className={f.habitacion ? '' : 'sin-hab'}>
                <th className="fija" scope="row">
                  {/* La habitación es lo primero que carga recepción: tocarla abre la edición sin tener que deslizar hasta el final. */}
                  {onEditar && puede ? (
                    <button type="button" className="hab-boton" onClick={() => onEditar(f)} aria-label={`Editar a ${d.apellido ?? ''} ${d.nombre ?? ''}`.trim()}>
                      {f.habitacion ? <b>{f.habitacion}</b> : <span className="pendiente">Sin asignar</span>}
                      <Icon name="lapiz" size={14} sw={1.8} />
                    </button>
                  ) : (f.habitacion ? <b>{f.habitacion}</b> : <span className="pendiente">Sin asignar</span>)}
                </th>
                <td>{fechaHora(f.creado)}</td>
                <td>{d.apellido}</td>
                <td>{d.nombre}</td>
                <td><span className="doc-tipo">{d.doc_tipo}</span> {d.doc_numero}</td>
                <td>{d.nacionalidad}</td>
                <td>{d.localidad}</td>
                <td>{d.domicilio}</td>
                <td>{d.email}</td>
                <td className="nowrap">{tel(d.telefono)}</td>
                <td>
                  {f.foto_id
                    ? <a className="ver-foto" href={urlDrive(f.foto_id)} target="_blank" rel="noopener noreferrer" title={f.foto_nombre ?? ''}><Icon name="imagen" size={16} sw={1.8} /> Ver</a>
                    : <span className="muted">—</span>}
                </td>
                <td className="acciones">
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
