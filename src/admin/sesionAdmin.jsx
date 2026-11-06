import { useCallback, useEffect, useState } from 'react';
import { textoError, verificarClave } from '../data/api.js';
import { borrarSesion, cerrarSesion, entrarConClave, leerSesion } from '../sesion.js';

// Ingreso del admin general para las pantallas nuevas (inicio y huéspedes). Comparte la sesión del dispositivo con el editor.
// `clave` es el código de dispositivo (sd_…), que las funciones de la base aceptan en lugar de la clave.
export function useSesionAdmin() {
  const [fase, setFase] = useState('verificando'); // verificando | login | ok
  const [clave, setClave] = useState('');
  const [error, setError] = useState('');
  const [entrando, setEntrando] = useState(false);

  // esClave: lo que se escribió es la clave (se cambia por un código de dispositivo); si no, es el código guardado en este dispositivo.
  const entrar = useCallback(async (k, esClave = false) => {
    setError('');
    setEntrando(true);
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
      setClave(cred);
      setFase('ok');
    } catch (e) {
      // Solo se cierra la sesión guardada si la base dijo que ya no vale; si fue un corte de red se conserva.
      if (!esClave && e.codigo) { borrarSesion(); setError('La sesión de este dispositivo venció. Ingresá de nuevo.'); } else setError(textoError(e));
      setFase('login');
    } finally {
      setEntrando(false);
    }
  }, []);

  useEffect(() => {
    const s = leerSesion();
    if (s?.rol === 'admin') entrar(s.token); else setFase('login');
  }, [entrar]);

  const salir = useCallback(() => { cerrarSesion(); setClave(''); setFase('login'); }, []);
  return { fase, clave, error, entrando, entrar, salir };
}

export function LoginAdmin({ sesion }) {
  return (
    <div className="page">
      <main className="card login">
        <h1>Panel del dueño</h1>
        {sesion.fase === 'verificando' ? <p>Entrando…</p> : (
          <form onSubmit={(e) => { e.preventDefault(); sesion.entrar(e.currentTarget.elements.clave.value, true); }}>
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
