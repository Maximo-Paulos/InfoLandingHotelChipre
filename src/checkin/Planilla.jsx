import { Fragment, useEffect, useMemo, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { cargarTelefono } from './telefono.js';
import { porReserva } from './agrupar.js';
import ListaHuespedes from './ListaHuespedes.jsx';
import { cobroLinea, detalleTexto, huespedesTexto, plata } from './ReservaForm.jsx';
import { fechaHora, minSeg, urlDrive, useMedia } from './util.js';

// Las fotos de una fila: la lista nueva, o la única foto de antes si la base todavía no tiene la lista.
const fotosDe = (f) => (Array.isArray(f.fotos) ? f.fotos : f.foto_id ? [{ foto_id: f.foto_id, nombre: f.foto_nombre }] : []);

// La planilla de huéspedes: una fila por persona, con la habitación fija a la izquierda y scroll hacia los costados.
//   filas: [{ id, creado, habitacion, datos, foto_id, foto_nombre, fotos?, editable_seg? }]
//   puedeEditar(fila) -> segundos que quedan para editar (null = sin límite, 0 = no se puede)
//   Los huéspedes de una misma reserva (fila.estadia_id) se muestran juntos, bajo una cabecera con la habitación y lo cobrado.
//   En pantallas chicas (celular) se muestra como lista (ListaHuespedes.jsx) en lugar de tabla.
//   onEditarReserva(estadia): si viene, la cabecera tiene «Corregir reserva» · reservaEditable(estadia) -> false la deja cerrada (sin esta función, siempre se puede)
//   reservas: [{ id, habitacion, ... }] y onAsignar(fila, estadiaId | null): si vienen, cada huésped se puede mover a otra reserva, o dejar sin reserva con null (solo el dueño)
//   onFotos(fila): si viene, cada fila tiene un botón para ver y agregar sus fotos (el dueño también puede quitarlas; recepción no)
export default function Planilla({ filas, onEditar, onFotos, onEditarReserva, reservaEditable, reservas, onAsignar, restante, vacio = 'Todavía no hay huéspedes cargados.' }) {
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

  // Una cabecera por reserva, en el orden en que aparece su primer huésped; los de antes de las reservas van al final.
  const grupos = useMemo(() => porReserva(filas), [filas]);
  const celular = useMedia('(max-width:760px)');

  if (!filas.length) return <p className="planilla-vacia">{vacio}</p>;
  // En el celular no hay tabla: una lista corta por reserva, y la ficha de cada persona al tocarla.
  if (celular) return <ListaHuespedes grupos={grupos} onEditar={onEditar} onFotos={onFotos} onEditarReserva={onEditarReserva} reservaEditable={reservaEditable} reservas={reservas} onAsignar={onAsignar} restante={restante} vacio={vacio} />;
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
            <th scope="col" role="columnheader">Año nac.</th>
            <th scope="col" role="columnheader">Localidad</th>
            <th scope="col" role="columnheader">Domicilio</th>
            <th scope="col" role="columnheader">Email</th>
            <th scope="col" role="columnheader">Teléfono</th>
            <th scope="col" role="columnheader">Foto</th>
            <th scope="col" role="columnheader"><span className="solo-lector">Acciones</span></th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {grupos.map((g) => (
            <Fragment key={g.estadia?.id ?? 'sin'}>
              <tr role="row" className="grupo">
                <td role="cell" colSpan={15}>
                  {g.estadia ? (
                    <>
                      <b>Hab. {g.estadia.habitacion}</b> · {detalleTexto(g.estadia)} · {cobroLinea(g.estadia)} · {g.estadia.canal_cobra === false ? 'estadía' : 'cobro'} {g.estadia.fecha_cobro.split('-').reverse().slice(0, 2).join('/')}
                      <span className="muted"> · cargó {g.estadia.cargado_por} · {huespedesTexto(g.estadia, g.estadia.con_checkin ?? g.filas.length)}</span>
                      {onEditarReserva && (!reservaEditable || reservaEditable(g.estadia)) && (
                        <button type="button" className="btn mini claro" onClick={() => onEditarReserva(g.estadia)}><Icon name="lapiz" size={16} sw={1.8} /> Corregir reserva</button>
                      )}
                    </>
                  ) : <span className="pendiente">Sin reserva (check-ins de antes)</span>}
                </td>
              </tr>
              {g.filas.map((f) => {
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
                <td role="cell" className="c-anio" data-label="Año nac.">{d.anio_nac ?? ''}</td>
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
                  {onAsignar && (reservas?.length > 0 || f.estadia_id) && (
                    <select className="asignar" aria-label={`${f.estadia_id ? 'Mover' : 'Asignar'} a ${d.apellido ?? ''} ${d.nombre ?? ''} ${f.estadia_id ? 'a otra reserva' : 'a una reserva'}`.trim()} value="" onChange={(e) => e.target.value && onAsignar(f, e.target.value === 'ninguna' ? null : Number(e.target.value))}>
                      <option value="">{f.estadia_id ? 'Mover a otra reserva…' : 'Asignar a reserva…'}</option>
                      {f.estadia_id && <option value="ninguna">Dejar sin reserva</option>}
                      {(reservas ?? []).filter((r) => r.id !== f.estadia_id).map((r) => <option key={r.id} value={r.id}>Hab. {r.habitacion} · {r.canal_cobra === false ? 'sin cobro' : plata(r.monto, r.moneda)} · {huespedesTexto(r)}</option>)}
                    </select>
                  )}
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
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
