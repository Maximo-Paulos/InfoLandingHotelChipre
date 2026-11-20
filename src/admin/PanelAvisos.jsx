import { useEffect, useState } from 'react';
import { adminPushConfig, textoCodigo } from '../checkin/checkinApi.js';

// Ajustes de los avisos en los celulares (solo el dueño): si el aviso lleva el nombre del titular y si el check-in también le avisa a recepción.
// Cada celular activa los suyos desde «Más → Avisos en este celular».
export default function PanelAvisos({ clave }) {
  const [cfg, setCfg] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let vivo = true;
    adminPushConfig(clave).then((r) => { if (!vivo) return; if (r.ok) setCfg(r); else setError(textoCodigo(r.error)); }).catch(() => { if (vivo) setError('No se pudo conectar. Revisá tu conexión.'); });
    return () => { vivo = false; };
  }, [clave]);
  const cambiar = async (nombre, checkinRecepcion) => {
    setError('');
    try {
      const r = await adminPushConfig(clave, nombre, checkinRecepcion);
      if (r.ok) setCfg(r); else setError(textoCodigo(r.error));
    } catch {
      setError('No se pudo conectar. Revisá tu conexión.');
    }
  };
  return (
    <details className="panel">
      <summary>Avisos en los celulares</summary>
      <p className="ayuda">Cuando se anota una reserva o se hace un check-in, les llega un aviso a los celulares que lo activaron (cada uno toca «Activar avisos» en <b>Más</b>). A quien hizo la acción no se le avisa.</p>
      <ul className="ayuda av-reglas">
        <li>Reserva anotada por el <b>dueño</b> → les avisa a recepción.</li>
        <li>Reserva anotada por <b>recepción</b> → te avisa a vos y a los otros de recepción.</li>
        <li><b>Check-in</b> de un huésped → te avisa a vos (y a recepción si lo prendés abajo).</li>
      </ul>
      {error && <p className="ed-error" role="alert">{error}</p>}
      {cfg && !cfg.configurado && (
        <p className="in-aviso" role="note"><b>Falta conectar el envío.</b> Se hace una sola vez, siguiendo los pasos de «Avisos en el celular» del README (cargar las claves en Vercel y una línea en la base). Hasta entonces los celulares se pueden activar, pero no sale ningún aviso.</p>
      )}
      {cfg && (
        <>
          <p className="ayuda">Celulares con avisos activos y sesión abierta: <b>{cfg.dispositivos.admin}</b> del dueño · <b>{cfg.dispositivos.recepcion}</b> de recepción.</p>
          <label className="medio-cobra"><input type="checkbox" checked={cfg.con_nombre} onChange={(e) => cambiar(e.target.checked, null)} /><span>Poner el <b>nombre del titular</b> en el aviso. Se ve en la pantalla bloqueada del celular: si lo apagás, el aviso lleva solo la habitación.</span></label>
          <label className="medio-cobra"><input type="checkbox" checked={cfg.checkin_a_recepcion} onChange={(e) => cambiar(null, e.target.checked)} /><span>Avisar los <b>check-ins también a recepción</b> (si no, solo te llegan a vos).</span></label>
        </>
      )}
    </details>
  );
}
