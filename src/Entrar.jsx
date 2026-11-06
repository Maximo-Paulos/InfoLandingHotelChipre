import { useEffect, useRef, useState } from 'react';
import Icon from './components/Icon.jsx';
import { textoError } from './data/api.js';
import { useNoIndexar } from './personal.js';
import { borrarSesion, entrarConClave, estadoSesion, leerSesion } from './sesion.js';

const destino = (rol) => (rol === 'admin' ? '#/admin' : '#/recepcion');
const esIphone = () => /iPhone|iPad/.test(navigator.userAgent);
const instalada = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone;

// Ingreso único del personal: la clave del dueño abre su panel y la de recepción abre recepción. Si el dispositivo ya tiene la
// sesión abierta, entra directo. Desde acá se instala como app (la pantalla de inicio del teléfono).
export default function Entrar() {
  useNoIndexar('Ingresar');
  const [fase, setFase] = useState('verificando'); // verificando | form
  const [error, setError] = useState('');
  const [entrando, setEntrando] = useState(false);
  const [instalar, setInstalar] = useState(null); // el aviso de instalación de Chrome (Android y compu)
  const vivo = useRef(true);

  useEffect(() => {
    vivo.current = true;
    (async () => {
      const s = leerSesion();
      if (s) {
        try {
          const r = await estadoSesion(s.token);
          if (r.ok) { location.replace(destino(r.rol)); return; }
          borrarSesion();
        } catch { /* sin conexión: se pide la clave */ }
      }
      if (vivo.current) setFase('form');
    })();
    return () => { vivo.current = false; };
  }, []);

  useEffect(() => {
    const antes = (e) => { e.preventDefault(); setInstalar(e); };
    window.addEventListener('beforeinstallprompt', antes);
    return () => window.removeEventListener('beforeinstallprompt', antes);
  }, []);

  const entrar = async (e) => {
    e.preventDefault();
    const clave = e.currentTarget.elements.clave.value;
    setEntrando(true);
    setError('');
    try {
      const s = await entrarConClave(clave);
      location.replace(destino(s.rol));
    } catch (err) {
      setError(textoError(err));
      setEntrando(false);
    }
  };

  const pedirInstalacion = async () => {
    instalar.prompt();
    await instalar.userChoice.catch(() => {});
    setInstalar(null);
  };

  return (
    <div className="page">
      <main className="card login">
        <p className="eyebrow">Hotel Chipre</p>
        <h1>Ingreso del personal</h1>
        {fase === 'verificando' ? <p role="status">Entrando…</p> : (
          <form onSubmit={entrar}>
            <p className="lead">Ingresá tu clave. Este dispositivo queda con la sesión abierta para que no tengas que escribirla de nuevo.</p>
            <label className="caja">
              <span>Clave</span>
              <input name="clave" type="password" autoComplete="current-password" autoFocus required />
            </label>
            {error && <p className="ed-error" role="alert">{error}</p>}
            <div className="btns"><button type="submit" className="btn" disabled={entrando}>{entrando ? 'Entrando…' : 'Entrar'}</button></div>
          </form>
        )}

        {fase === 'form' && !instalada() && (instalar || esIphone()) && (
          <section className="instalar" aria-label="Instalar como app">
            <h2 className="sub"><Icon name="llave" size={18} sw={1.7} /> Tenerla como app en tu celular</h2>
            {instalar
              ? <button type="button" className="btn claro mini" onClick={pedirInstalacion}>Instalar la app</button>
              : <p className="ayuda">En Safari tocá <b>Compartir</b> y después <b>Añadir a pantalla de inicio</b>. Se abre sin barras, como una app.</p>}
          </section>
        )}
        <div className="btns"><a className="btn claro" href="#/">Ir a la guía del huésped</a></div>
      </main>
    </div>
  );
}
