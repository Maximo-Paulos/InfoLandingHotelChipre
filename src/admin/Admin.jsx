import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pantalla } from '../App.jsx';
import { get, setIn } from '../components/Editable.jsx';
import { cambiarClave, guardarContenido, leerContenido, textoError, verificarClave } from '../data/api.js';
import { DataContext } from '../data/DataContext.jsx';
import respaldo from '../data/hotel.js';
import { mezclar } from '../data/mezclar.js';

const CLAVE_SESION = 'chipre-clave';

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

  const entrar = useCallback(async (k) => {
    setError('');
    try {
      const r = await verificarClave(k);
      if (!r.ok) throw Object.assign(new Error(r.error), { codigo: r.error });
      let contenido = respaldo;
      try { contenido = (await leerContenido()).contenido; } catch { /* base vacía: se parte del contenido de ejemplo */ }
      const c = mezclar(respaldo, contenido);
      setDraft(c);
      setGuardado(c);
      setClave(k);
      sessionStorage.setItem(CLAVE_SESION, k);
      setFase('ok');
    } catch (e) {
      sessionStorage.removeItem(CLAVE_SESION);
      setError(textoError(e));
      setFase('login');
    }
  }, []);

  useEffect(() => {
    const k = sessionStorage.getItem(CLAVE_SESION);
    if (k) entrar(k); else setFase('login');
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
    base: '#/admin/',
    set: (p, v) => setDraft((d) => setIn(d, p, v)),
    add: (p, item) => setDraft((d) => setIn(d, p, [...get(d, p), item])),
    remove: (p, i) => setDraft((d) => setIn(d, p, get(d, p).filter((_, k) => k !== i))),
    // Solo existe en el panel: cambia la clave del dueño y la recuerda para esta sesión.
    cambiarClave: async (nueva) => {
      try {
        const r = await cambiarClave(clave, nueva);
        if (!r.ok) return { ok: false, mensaje: textoError({ codigo: r.error }) };
        setClave(nueva);
        sessionStorage.setItem(CLAVE_SESION, nueva);
        return { ok: true, mensaje: 'Clave cambiada. Usá la nueva la próxima vez que entres.' };
      } catch (e) {
        return { ok: false, mensaje: textoError(e) };
      }
    }
  }), [draft, clave]);

  const salir = () => { sessionStorage.removeItem(CLAVE_SESION); setDraft(null); setClave(''); setFase('login'); };

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
            <form onSubmit={async (e) => { e.preventDefault(); const k = e.currentTarget.elements.clave.value; setEntrando(true); await entrar(k); setEntrando(false); }}>
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
          <a className="btn mini claro" href="#/" target="_blank" rel="noopener noreferrer">Ver guía</a>
          <button type="button" className="btn mini claro" onClick={salir}>Salir</button>
        </div>
      </div>
      <Pantalla ruta={ruta} />
    </DataContext.Provider>
  );
}
