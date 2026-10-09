import { useCallback, useEffect, useState } from 'react';
import { textoError, verificarClave } from '../data/api.js';

const CLAVE_SESION = 'chipre-clave'; // la misma que usa el editor de la landing

const leer = () => { try { return sessionStorage.getItem(CLAVE_SESION) ?? ''; } catch { return ''; } };
const guardar = (k) => { try { sessionStorage.setItem(CLAVE_SESION, k); } catch { /* sin almacenamiento */ } };
const borrar = () => { try { sessionStorage.removeItem(CLAVE_SESION); } catch { /* sin almacenamiento */ } };

// Ingreso del admin general para las pantallas nuevas (inicio y huéspedes). Comparte la clave con el editor.
export function useSesionAdmin() {
  const [fase, setFase] = useState('verificando'); // verificando | login | ok
  const [clave, setClave] = useState('');
  const [error, setError] = useState('');
  const [entrando, setEntrando] = useState(false);

  const entrar = useCallback(async (k) => {
    setError('');
    setEntrando(true);
    try {
      const r = await verificarClave(k);
      if (!r.ok) throw Object.assign(new Error(r.error), { codigo: r.error });
      guardar(k);
      setClave(k);
      setFase('ok');
    } catch (e) {
      borrar();
      setError(textoError(e));
      setFase('login');
    } finally {
      setEntrando(false);
    }
  }, []);

  useEffect(() => {
    const k = leer();
    if (k) entrar(k); else setFase('login');
  }, [entrar]);

  const salir = useCallback(() => { borrar(); setClave(''); setFase('login'); }, []);
  return { fase, clave, error, entrando, entrar, salir };
}

export function LoginAdmin({ sesion }) {
  return (
    <div className="page">
      <main className="card login">
        <h1>Panel del dueño</h1>
        {sesion.fase === 'verificando' ? <p>Entrando…</p> : (
          <form onSubmit={(e) => { e.preventDefault(); sesion.entrar(e.currentTarget.elements.clave.value); }}>
            <p className="lead">Ingresá tu clave para entrar.</p>
            <label className="caja">
              <span>Clave</span>
              <input name="clave" type="password" autoComplete="current-password" autoFocus />
            </label>
            {sesion.error && <p className="ed-error" role="alert">{sesion.error}</p>}
            <div className="btns"><button type="submit" className="btn" disabled={sesion.entrando}>{sesion.entrando ? 'Entrando…' : 'Entrar'}</button></div>
          </form>
        )}
      </main>
    </div>
  );
}
