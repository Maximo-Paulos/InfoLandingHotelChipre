import { useCallback, useEffect, useState } from 'react';
import { adminSesionCerrar, adminSesiones } from '../sesion.js';
import { textoError } from '../data/api.js';
import { fechaHora } from '../checkin/util.js';

const ROL = { admin: 'Dueño', recepcion: 'Recepción' };

// Los dispositivos con sesión abierta (dueño, codueño y recepción). Cerrar uno lo deja afuera: tiene que escribir la clave de nuevo.
// Nada se borra: en la base la sesión queda marcada como cerrada.
export default function Dispositivos({ clave }) {
  const [lista, setLista] = useState(null);
  const [error, setError] = useState('');
  const [trabajando, setTrabajando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const r = await adminSesiones(clave);
      if (r.ok) { setLista(r.sesiones); setError(''); } else setError(textoError({ codigo: r.error }));
    } catch (e) {
      setError(textoError(e));
    }
  }, [clave]);
  useEffect(() => { cargar(); }, [cargar]);
  // Al volver a la pestaña o a la app se actualiza la lista (puede haber entrado alguien mientras tanto).
  useEffect(() => {
    const alVolver = () => { if (document.visibilityState === 'visible') cargar(); };
    document.addEventListener('visibilitychange', alVolver);
    return () => document.removeEventListener('visibilitychange', alVolver);
  }, [cargar]);

  const cerrar = async (id) => {
    const msg = id ? '¿Cerrar la sesión de ese dispositivo? Va a tener que escribir la clave de nuevo.' : '¿Cerrar la sesión en todos los demás dispositivos? Tendrán que escribir la clave de nuevo.';
    if (!window.confirm(msg)) return;
    setTrabajando(true);
    try {
      const r = await adminSesionCerrar(clave, id);
      if (!r.ok) setError(textoError({ codigo: r.error }));
      await cargar();
    } catch (e) {
      setError(textoError(e));
    } finally {
      setTrabajando(false);
    }
  };

  const otros = (lista ?? []).filter((s) => !s.actual).length;
  return (
    <section className="dispositivos" aria-label="Dispositivos con sesión abierta">
      <h2 className="sub">Dispositivos con sesión abierta</h2>
      <p className="ayuda">Los celulares y compus donde el personal ya puso la clave. Si se pierde o cambia un teléfono, cerrá su sesión desde acá.</p>
      {error && <p className="ed-error" role="alert">{error}</p>}
      {!lista && !error && <p className="intro" role="status">Cargando…</p>}
      {lista && (
        <ul className="foto-lista">
          {lista.map((s) => (
            <li key={s.id} className="foto-item">
              <div className="foto-fila">
                <div className="foto-datos">
                  <b>{s.etiqueta || 'Dispositivo'}{s.actual ? ' · este dispositivo' : ''}</b>
                  <small className="muted">{ROL[s.rol] ?? s.rol} · último uso {fechaHora(s.ultimo_uso)}</small>
                </div>
                {!s.actual && (
                  <div className="foto-acciones">
                    <button type="button" className="btn mini claro" onClick={() => cerrar(s.id)} disabled={trabajando} aria-label={`Cerrar la sesión de ${s.etiqueta || 'este dispositivo'}`}>Cerrar</button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {otros > 0 && (
        <div className="btns"><button type="button" className="btn claro" onClick={() => cerrar(null)} disabled={trabajando}>Cerrar en los demás dispositivos</button></div>
      )}
    </section>
  );
}
