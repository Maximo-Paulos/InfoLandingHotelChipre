import { useEffect, useRef, useState } from 'react';
import Icon from '../components/Icon.jsx';
import Modal from '../checkin/Modal.jsx';
import { adminFotoPermiso, adminFotoQuitar, adminFotos, textoCodigo } from '../checkin/checkinApi.js';
import { comprimirImagen } from '../checkin/comprimir.js';
import { subirFoto } from '../checkin/foto.js';
import { esperar, fechaHora, urlDrive } from '../checkin/util.js';

// Lo que contesta el script de Drive cuando no pudo guardar la foto.
const ERRORES_SCRIPT = {
  permiso: 'El permiso para subir la foto venció. Probá de nuevo.',
  imagen: 'La foto no es válida. Probá con otra.',
  limite: 'Ya se subieron demasiadas fotos seguidas. Esperá un momento y probá de nuevo.',
  registro: 'La foto llegó a Drive pero no se pudo anotar en el huésped. Probá de nuevo.'
};
const ORIGEN = { admin: 'La cargó el dueño', huesped: 'La mandó el huésped' };

// Las fotos del documento de un huésped, para el dueño: ver, agregar (si el huésped no la mandó, o la primera no se ve) y quitar.
// "Quitar" NO borra nada: la foto sale de la lista pero sigue en Drive y en la base, y se puede volver a poner.
//   fila: el huésped de la planilla ({ id, datos })
//   alCambiar(): se llama cuando cambia algo, para que la planilla se actualice
export default function FotosHuesped({ clave, fila, onCerrar, alCambiar }) {
  const [datos, setDatos] = useState(null); // { fotos, drive } o null mientras carga
  const [error, setError] = useState('');
  const [nueva, setNueva] = useState(null); // la foto elegida, todavía sin subir: { base64, vista, bytes }
  const [errFoto, setErrFoto] = useState('');
  const [estado, setEstado] = useState(''); // '' | preparando | subiendo
  const [msg, setMsg] = useState('');
  const [confirmando, setConfirmando] = useState(null); // id de la foto que está por quitarse
  const [trabajando, setTrabajando] = useState(null); // id de la foto que se está quitando o volviendo a poner
  const camara = useRef(null);
  const galeria = useRef(null);
  const nuevaRef = useRef(null);
  const vivo = useRef(true);

  const cargar = async () => {
    try {
      const r = await adminFotos(clave, fila.id);
      if (!vivo.current) return null;
      if (r.ok) { setDatos(r); setError(''); return r; }
      setError(textoCodigo(r.error));
    } catch {
      if (vivo.current) setError('No se pudo conectar. Revisá tu conexión.');
    }
    return null;
  };

  // En desarrollo React monta, desmonta y vuelve a montar (StrictMode): hay que "reabrir" al montar.
  useEffect(() => {
    vivo.current = true;
    cargar();
    return () => {
      vivo.current = false;
      if (nuevaRef.current?.vista) URL.revokeObjectURL(nuevaRef.current.vista);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave, fila.id]);

  const descartar = () => {
    if (nuevaRef.current?.vista) URL.revokeObjectURL(nuevaRef.current.vista);
    nuevaRef.current = null;
    setNueva(null);
  };

  const elegir = async (e) => {
    const archivo = e.target.files?.[0];
    e.target.value = ''; // así se puede elegir de nuevo el mismo archivo
    if (!archivo) return;
    setErrFoto('');
    setMsg('');
    setEstado('preparando');
    try {
      const r = await comprimirImagen(archivo);
      if (!vivo.current) { URL.revokeObjectURL(r.vista); return; }
      descartar();
      nuevaRef.current = r;
      setNueva(r);
    } catch (err) {
      if (vivo.current) setErrFoto(err.codigo === 'pesada' ? 'La foto es demasiado pesada. Probá con otra.' : 'No pudimos usar ese archivo. Elegí una foto (JPG o PNG).');
    } finally {
      if (vivo.current) setEstado('');
    }
  };

  // La foto sale directo al script de Drive del hotel (el mismo de los huéspedes) con un permiso de 10 minutos que da la base.
  // El script avisa a la base antes de contestar; si el navegador no puede leer su respuesta, manda lo que diga la lista.
  const subir = async () => {
    if (!nueva || estado) return;
    setEstado('subiendo');
    setErrFoto('');
    setMsg('');
    const antes = datos?.fotos.length ?? 0;
    try {
      const p = await adminFotoPermiso(clave, fila.id);
      if (!p.ok) { setErrFoto(textoCodigo(p.error)); return; }
      const r = await subirFoto({ url: p.url, ticket: p.ticket, nombre: fila.datos?.nombre, apellido: fila.datos?.apellido, imagen: nueva.base64 });
      if (r.ok === false) { setErrFoto(ERRORES_SCRIPT[r.error] ?? 'No se pudo subir la foto. Probá de nuevo.'); return; }
      let guardada = false;
      for (let i = 0; i < 4 && !guardada; i += 1) {
        if (i > 0) await esperar(1500);
        const lista = await cargar();
        guardada = !!lista && lista.fotos.length > antes;
      }
      if (!vivo.current) return;
      if (guardada) {
        descartar();
        setMsg('Foto agregada.');
        alCambiar?.();
      } else {
        setErrFoto('No pudimos confirmar que la foto se guardó. Mirá la lista y, si no está, probá de nuevo.');
      }
    } catch {
      if (vivo.current) setErrFoto('No se pudo conectar. Revisá tu conexión e intentá de nuevo.');
    } finally {
      if (vivo.current) setEstado('');
    }
  };

  const cambiarEstado = async (id, quitar) => {
    setTrabajando(id);
    setMsg('');
    setError('');
    try {
      const r = await adminFotoQuitar(clave, id, quitar);
      if (!vivo.current) return;
      if (r.ok) {
        setDatos((d) => ({ ...d, fotos: r.fotos }));
        setConfirmando(null);
        setMsg(quitar ? 'Foto quitada de la lista. Sigue en tu Drive.' : 'Foto puesta de nuevo.');
        alCambiar?.();
      } else {
        setError(textoCodigo(r.error));
      }
    } catch {
      if (vivo.current) setError('No se pudo conectar. Revisá tu conexión.');
    } finally {
      if (vivo.current) setTrabajando(null);
    }
  };

  const nombre = `${fila.datos?.nombre ?? ''} ${fila.datos?.apellido ?? ''}`.trim();
  const activas = datos?.fotos.filter((f) => f.activa) ?? [];
  const quitadas = datos?.fotos.filter((f) => !f.activa) ?? [];
  const ocupado = estado !== '';
  return (
    <Modal titulo={`Fotos de ${nombre}`} onCerrar={onCerrar}>
      <p className="ayuda">Acá ves las fotos del documento de este huésped. Podés agregar otra (por ejemplo, la que sacó recepción) o quitar la que no se vea. Quitar solo la saca de la lista: el archivo sigue en tu Drive y la podés volver a poner.</p>
      {error && <p className="ed-error" role="alert">{error}</p>}
      {!datos && !error && <p className="intro" role="status">Cargando…</p>}
      {datos && (
        <>
          <h3 className="fotos-sub">Fotos del documento <span className="chip">{activas.length}</span></h3>
          {activas.length === 0 && <p className="ayuda">Este huésped no tiene ninguna foto cargada.</p>}
          <ul className="foto-lista">
            {activas.map((f, i) => (
              <li key={f.id} className="foto-item">
                <div className="foto-fila">
                  <div className="foto-datos">
                    <b>Foto {i + 1}</b>
                    <small className="muted">{ORIGEN[f.origen] ?? ''} · {fechaHora(f.creado)}</small>
                  </div>
                  <div className="foto-acciones">
                    <a className="btn mini claro" href={urlDrive(f.foto_id)} target="_blank" rel="noopener noreferrer" title={f.nombre ?? ''}>
                      <Icon name="imagen" size={16} sw={1.8} /> Abrir
                    </a>
                    <button type="button" className="btn mini claro" onClick={() => setConfirmando(f.id)} disabled={trabajando === f.id} aria-label={`Quitar la foto ${i + 1}`}>Quitar</button>
                  </div>
                </div>
                {confirmando === f.id && (
                  <div className="foto-confirma" role="group" aria-label={`Confirmar que se quita la foto ${i + 1}`}>
                    <p>¿Quitar esta foto de la lista? No se borra de tu Drive y la podés volver a poner.</p>
                    <div className="foto-botones">
                      <button type="button" className="btn mini" onClick={() => cambiarEstado(f.id, true)} disabled={trabajando === f.id}>{trabajando === f.id ? 'Quitando…' : 'Sí, quitar'}</button>
                      <button type="button" className="btn mini claro" onClick={() => setConfirmando(null)} disabled={trabajando === f.id}>No</button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>

          <div className="foto-campo foto-agregar">
            <h3 className="fotos-sub">{activas.length ? 'Agregar otra foto' : 'Agregar una foto'}</h3>
            {!datos.drive && <p className="ed-error" role="alert">{textoCodigo('sin_drive')}</p>}
            {nueva ? (
              <img className="foto-prev" src={nueva.vista} alt="Vista previa de la foto que vas a subir" />
            ) : (
              <div className="foto-vacia"><Icon name="camara" size={30} sw={1.5} /><p>Sacale una foto al documento o elegí una de la galería o de tus archivos.</p></div>
            )}
            <div className="foto-botones">
              <button type="button" className="btn claro mini" onClick={() => camara.current?.click()} disabled={ocupado || !datos.drive}>
                <Icon name="camara" size={18} sw={1.7} /> Sacar foto
              </button>
              <button type="button" className="btn claro mini" onClick={() => galeria.current?.click()} disabled={ocupado || !datos.drive}>
                <Icon name="imagen" size={18} sw={1.7} /> Elegir de la galería
              </button>
              {nueva && <button type="button" className="btn mini" onClick={subir} disabled={ocupado}>{estado === 'subiendo' ? 'Subiendo…' : 'Subir esta foto'}</button>}
              {nueva && <button type="button" className="btn claro mini" onClick={descartar} disabled={ocupado}>Descartar</button>}
            </div>
            <input ref={camara} type="file" accept="image/*" capture="environment" hidden onChange={elegir} />
            <input ref={galeria} type="file" accept="image/*" hidden onChange={elegir} />
            {estado === 'preparando' && <p className="ayuda" role="status">Preparando la foto…</p>}
            {estado === 'subiendo' && <p className="ayuda" role="status">Subiendo la foto a Drive…</p>}
            {errFoto && <p className="ed-error" role="alert">{errFoto}</p>}
          </div>

          {quitadas.length > 0 && (
            <div className="medios-quitados foto-quitadas">
              <h4>Quitadas</h4>
              <p className="ayuda">Ya no se muestran en la planilla, pero siguen en tu Drive.</p>
              <ul>
                {quitadas.map((f) => (
                  <li key={f.id}>
                    <span>{ORIGEN[f.origen] ?? 'Foto'}<small className="muted"> · {fechaHora(f.creado)}</small></span>
                    <span className="foto-acciones">
                      <a className="btn mini claro" href={urlDrive(f.foto_id)} target="_blank" rel="noopener noreferrer" title={f.nombre ?? ''}>Abrir</a>
                      <button type="button" className="btn mini claro" onClick={() => cambiarEstado(f.id, false)} disabled={trabajando === f.id}>{trabajando === f.id ? 'Poniendo…' : 'Volver a poner'}</button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      {msg && <p className="ed-ok" role="status">{msg}</p>}
      <div className="btns modal-pie">
        <button type="button" className="btn claro" onClick={onCerrar}>Cerrar</button>
      </div>
    </Modal>
  );
}
