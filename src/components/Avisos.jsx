import { useCallback, useEffect, useState } from 'react';
import { MENSAJES_AVISOS, activarAvisos, desactivarAvisos, estadoAvisos, probarAviso } from '../push.js';

// Los avisos en el celular (notificaciones push) vistos desde la app del personal: un panel dentro de «Más» y un cartel que invita a activarlos.
// Cada celular los activa con un botón (iPhone y Android lo exigen); ver src/push.js.

export function useAvisos() {
  const [estado, setEstado] = useState(null);
  const [trabajando, setTrabajando] = useState(false);
  const [mensaje, setMensaje] = useState('');
  const recargar = useCallback(async () => { setEstado(await estadoAvisos()); }, []);
  useEffect(() => { recargar(); }, [recargar]);
  // `fn` se llama de inmediato (sin esperar nada antes): el permiso del celular solo se puede pedir ante el toque de la persona.
  const correr = async (fn, listo) => {
    setTrabajando(true);
    setMensaje('');
    try {
      await fn();
      if (listo) setMensaje(listo);
    } catch (e) {
      setMensaje(MENSAJES_AVISOS[e.codigo] ?? 'No se pudo. Probá de nuevo.');
    } finally {
      setTrabajando(false);
      await recargar();
    }
  };
  return {
    estado, trabajando, mensaje,
    activar: () => correr(activarAvisos, 'Listo: los avisos están activos en este celular.'),
    desactivar: () => correr(desactivarAvisos, 'Avisos apagados en este celular.'),
    probar: () => correr(probarAviso, 'Te mandamos un aviso de prueba. Si no te llega en un minuto, revisá los permisos del celular.')
  };
}

// Dentro de «Más»: el estado de los avisos en ESTE celular y qué hacer.
export function AvisosPanel() {
  const { estado: e, trabajando, mensaje, activar, desactivar, probar } = useAvisos();
  return (
    <section className="avisos" aria-label="Avisos en este celular">
      <h3>Avisos en este celular</h3>
      {!e && <p className="ayuda" role="status">Cargando…</p>}
      {e && e.activo && (
        <>
          <p className="av-ok">Activos: te llega un aviso cuando se anota una reserva o se hace un check-in.</p>
          <div className="btns ab-btns">
            <button type="button" className="btn mini claro" onClick={probar} disabled={trabajando}>Enviar aviso de prueba</button>
            <button type="button" className="btn mini claro" onClick={desactivar} disabled={trabajando}>Apagar</button>
          </div>
          {!e.configurado && <p className="ll-ayuda">Por ahora el envío no está conectado en el servidor, así que todavía no sale ningún aviso. Avisale al dueño (README, «Avisos en el celular»).</p>}
        </>
      )}
      {e && !e.activo && e.permiso === 'denied' && <p className="ayuda">{MENSAJES_AVISOS.permiso_denegado}</p>}
      {e && !e.activo && e.permiso !== 'denied' && !e.soportado && <p className="ayuda">{e.ios && !e.instalada ? MENSAJES_AVISOS.instalar : MENSAJES_AVISOS.no_soportado}</p>}
      {e && !e.activo && e.permiso !== 'denied' && e.soportado && (
        <>
          <p className="ayuda">Recibí un aviso en el celular cuando se anota una reserva o se hace un check-in.</p>
          <div className="btns ab-btns"><button type="button" className="btn mini" onClick={activar} disabled={trabajando}>{trabajando ? 'Un momento…' : 'Activar avisos'}</button></div>
        </>
      )}
      {mensaje && <p className="ayuda" role="status">{mensaje}</p>}
    </section>
  );
}

const OCULTO = 'chipre-avisos-no';
const SIETE_DIAS = 7 * 864e5;
const leerOculto = () => { try { return Date.now() - Number(localStorage.getItem(OCULTO) ?? 0) < SIETE_DIAS; } catch { return false; } };

// Un cartel arriba de la pantalla principal mientras los avisos no estén activos (se puede dejar para después: vuelve a aparecer a los 7 días).
export function AvisosBanner() {
  const { estado: e, trabajando, mensaje, activar } = useAvisos();
  const [oculto, setOculto] = useState(leerOculto);
  if (!e || oculto || !e.soportado || e.activo || e.permiso === 'denied') return null;
  const despues = () => { try { localStorage.setItem(OCULTO, String(Date.now())); } catch { /* sin almacenamiento */ } setOculto(true); };
  return (
    <aside className="av-banner" aria-label="Activar avisos">
      <p><b>Activá los avisos.</b> Así te enterás al instante cuando se anota una reserva o se hace un check-in.</p>
      <div className="btns ab-btns">
        <button type="button" className="btn mini" onClick={activar} disabled={trabajando}>{trabajando ? 'Un momento…' : 'Activar avisos'}</button>
        <button type="button" className="btn mini claro" onClick={despues}>Ahora no</button>
      </div>
      {mensaje && <p className="ayuda" role="status">{mensaje}</p>}
    </aside>
  );
}
