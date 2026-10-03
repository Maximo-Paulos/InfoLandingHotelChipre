import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pantalla } from '../App.jsx';
import { get, setIn } from '../components/Editable.jsx';
import { DataContext } from '../data/DataContext.jsx';
import respaldo from '../data/hotel.js';
import { mezclar } from '../data/mezclar.js';

const CLAVE_SESION = 'chipre-clave';

async function api(ruta, { clave, metodo = 'GET', cuerpo } = {}) {
  const r = await fetch(ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(clave ? { 'x-clave': clave } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    cache: 'no-store'
  });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(datos.error || 'No se pudo completar la operación.'), { status: r.status });
  return datos;
}

const horaLocal = (d) => d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

// Panel del dueño: la misma guía, con una caja debajo de cada texto para editarlo.
export default function Admin({ ruta }) {
  const [fase, setFase] = useState('verificando'); // verificando | login | ok
  const [clave, setClave] = useState('');
  const [error, setError] = useState('');
  const [draft, setDraft] = useState(null);
  const [guardado, setGuardado] = useState(null);
  const [estado, setEstado] = useState('');
  const [trabajando, setTrabajando] = useState(false);

  const entrar = useCallback(async (k) => {
    setError('');
    try {
      await api('/api/login', { clave: k, metodo: 'POST' });
      const { contenido } = await api('/api/contenido');
      const c = mezclar(respaldo, contenido);
      setDraft(c);
      setGuardado(c);
      setClave(k);
      sessionStorage.setItem(CLAVE_SESION, k);
      setFase('ok');
    } catch (e) {
      sessionStorage.removeItem(CLAVE_SESION);
      setError(e.status === 401 ? 'Clave incorrecta.' : e.status ? e.message : 'No se pudo conectar con el servidor.');
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
    remove: (p, i) => setDraft((d) => setIn(d, p, get(d, p).filter((_, k) => k !== i)))
  }), [draft]);

  const salir = () => { sessionStorage.removeItem(CLAVE_SESION); setDraft(null); setClave(''); setFase('login'); };

  const guardar = async () => {
    setTrabajando(true);
    setEstado('Guardando…');
    try {
      await api('/api/contenido', { clave, metodo: 'PUT', cuerpo: draft });
      setGuardado(draft);
      setEstado(`Guardado a las ${horaLocal(new Date())}`);
    } catch (e) {
      if (e.status === 401) { salir(); setError('La sesión venció. Ingresá de nuevo.'); return; }
      setEstado(`No se guardó: ${e.message}`);
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
            <form onSubmit={(e) => { e.preventDefault(); entrar(e.currentTarget.elements.clave.value); }}>
              <p className="lead">Ingresá tu clave para editar la guía.</p>
              <label className="caja">
                <span>Clave</span>
                <input name="clave" type="password" autoComplete="current-password" autoFocus />
              </label>
              {error && <p className="ed-error" role="alert">{error}</p>}
              <div className="btns"><button type="submit" className="btn">Entrar</button></div>
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
