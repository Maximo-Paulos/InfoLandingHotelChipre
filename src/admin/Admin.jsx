import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pantalla } from '../App.jsx';
import { get, setIn } from '../components/Editable.jsx';
import { cambiarClave, guardarContenido, leerContenido, textoError, verificarClave } from '../data/api.js';
import { DataContext } from '../data/DataContext.jsx';
import respaldo from '../data/hotel.js';
import { mezclar } from '../data/mezclar.js';
import { borrarSesion, cerrarSesion, entrarConClave, leerSesion } from '../sesion.js';

const horaLocal = (d) => d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

// Panel del dueño: la misma guía, con una caja debajo de cada texto para editarlo.
export default function Admin({ ruta }) {
  const [fase, setFase] = useState('verificando'); // verificando | login | ok
  const [clave, setClave] = useState('');
  const [error, setError] = useState('');
  const [entrando, setEntrando] = useState(false);
  const [draft, setDraft] = useState(null);
  const [guardado, setGuardado] = useState(null);
  const [estado, setEstado] = useState('');
  const [trabajando, setTrabajando] = useState(false);

  // esClave: lo que se escribió es la clave (se cambia por un código de dispositivo); si no, es el código guardado en este dispositivo.
  const entrar = useCallback(async (k, esClave = false) => {
    setError('');
    try {
      let cred = k;
      if (esClave) {
        const s = await entrarConClave(k);
        if (s.rol !== 'admin') { location.hash = '#/recepcion'; return; } // era la clave de recepción
        cred = s.token;
      } else {
        const r = await verificarClave(cred);
        if (!r.ok) throw Object.assign(new Error(r.error), { codigo: r.error });
      }
      let contenido = respaldo;
      try { contenido = (await leerContenido()).contenido; } catch { /* base vacía: se parte del contenido de ejemplo */ }
      const c = mezclar(respaldo, contenido);
      setDraft(c);
      setGuardado(c);
      setClave(cred);
      setFase('ok');
    } catch (e) {
      // Solo se cierra la sesión guardada si la base dijo que ya no vale; si fue un corte de red se conserva.
      if (!esClave && e.codigo) { borrarSesion(); setError('La sesión de este dispositivo venció. Ingresá de nuevo.'); } else setError(textoError(e));
      setFase('login');
    }
  }, []);

  useEffect(() => {
    const s = leerSesion();
    if (s?.rol === 'admin') entrar(s.token); else setFase('login');
  }, [entrar]);

  const sucio = useMemo(() => fase === 'ok' && JSON.stringify(draft) !== JSON.stringify(guardado), [fase, draft, guardado]);

  useEffect(() => {
    if (!sucio) return undefined;
    const avisar = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', avisar);
    return () => window.removeEventListener('beforeunload', avisar);
  }, [sucio]);

  const valor = useMemo(() => draft && ({
    D: draft,
    editing: true,
    base: '#/admin/editar/',
    set: (p, v) => setDraft((d) => setIn(d, p, v)),
    add: (p, item) => setDraft((d) => setIn(d, p, [...get(d, p), item])),
    remove: (p, i) => setDraft((d) => setIn(d, p, get(d, p).filter((_, k) => k !== i))),
    // Solo existe en el panel: cambia la clave del dueño. Pide la clave de verdad (el código del dispositivo no alcanza) y, como el cambio
    // cierra la sesión de todos los dispositivos, abre otra en este con la clave nueva.
    cambiarClave: async (actual, nueva) => {
      try {
        const r = await cambiarClave(actual, nueva);
        if (!r.ok) return { ok: false, mensaje: textoError({ codigo: r.error }) };
        const s = await entrarConClave(nueva);
        setClave(s.token);
        return { ok: true, mensaje: 'Clave cambiada. Se cerró la sesión en los demás dispositivos: ahí hay que usar la clave nueva.' };
      } catch (e) {
        return { ok: false, mensaje: textoError(e) };
      }
    }
  }), [draft]);

  const salir = () => { cerrarSesion(); setDraft(null); setClave(''); setFase('login'); };

  const guardar = async () => {
    setTrabajando(true);
    setEstado('Guardando…');
    try {
      const r = await guardarContenido(clave, draft);
      if (!r.ok) {
        if (r.error === 'clave_incorrecta') { salir(); setError('La sesión venció. Ingresá de nuevo.'); return; }
        setEstado(`No se guardó: ${textoError({ codigo: r.error })}`);
        return;
      }
      setGuardado(draft);
      setEstado(`Guardado a las ${horaLocal(new Date())}`);
    } catch (e) {
      setEstado(`No se guardó: ${textoError(e)}`);
    } finally {
      setTrabajando(false);
    }
  };

  const descartar = () => {
    if (window.confirm('¿Descartar todos los cambios sin guardar?')) { setDraft(guardado); setEstado('Cambios descartados'); }
  };

  if (fase !== 'ok') {
    return (
      <div className="page">
        <main className="card login">
          <h1>Panel del dueño</h1>
          {fase === 'verificando' ? <p>Entrando…</p> : (
            <form onSubmit={async (e) => { e.preventDefault(); const k = e.currentTarget.elements.clave.value; setEntrando(true); await entrar(k, true); setEntrando(false); }}>
              <p className="lead">Ingresá tu clave para editar la guía.</p>
              <label className="caja">
                <span>Clave</span>
                <input name="clave" type="password" autoComplete="current-password" autoFocus />
              </label>
              {error && <p className="ed-error" role="alert">{error}</p>}
              <div className="btns"><button type="submit" className="btn" disabled={entrando}>{entrando ? 'Entrando…' : 'Entrar'}</button></div>
            </form>
          )}
        </main>
      </div>
    );
  }

  return (
    <DataContext.Provider value={valor}>
      <div className="barra-admin" role="region" aria-label="Barra del panel">
        <strong>Modo edición</strong>
        <span className="estado" aria-live="polite">{estado || (sucio ? 'Hay cambios sin guardar' : 'Sin cambios')}</span>
        <div className="acciones">
          <button type="button" className="btn mini" onClick={guardar} disabled={!sucio || trabajando}>Guardar cambios</button>
          <button type="button" className="btn mini claro" onClick={descartar} disabled={!sucio || trabajando}>Descartar</button>
          <a className="btn mini claro" href="#/admin" onClick={(e) => { if (sucio && !window.confirm('Hay cambios sin guardar. ¿Salir igual?')) e.preventDefault(); }}>Inicio</a>
          <a className="btn mini claro" href="#/" target="_blank" rel="noopener noreferrer">Ver guía</a>
          <button type="button" className="btn mini claro" onClick={salir}>Salir</button>
        </div>
      </div>
      <Pantalla ruta={ruta} />
    </DataContext.Provider>
  );
}
