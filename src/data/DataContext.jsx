import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import respaldo from './hotel.js';
import { leerContenido } from './api.js';
import { mezclar } from './mezclar.js';

// Lo que comparten la guía pública y el panel del dueño:
//   D        contenido actual
//   editing  true solo en el panel
//   base     prefijo de los links internos ('#/' o '#/admin/')
//   set / add / remove   solo hacen algo en el panel
export const DataContext = createContext(null);
export const useDatos = () => useContext(DataContext);

const CLAVE_LOCAL = 'chipre-contenido';

function copiaLocal() {
  try {
    const t = localStorage.getItem(CLAVE_LOCAL);
    return t ? mezclar(respaldo, JSON.parse(t)) : null;
  } catch {
    return null;
  }
}

const noHace = () => {};

const ESPERA_MS = 20000;

// Proveedor de la guía pública: pide el contenido a la base de datos (Supabase).
// Con una copia guardada en el celular la muestra enseguida y la actualiza cuando llega la nueva.
// Sin copia y sin conexión no muestra datos de ejemplo (podrían ser falsos): ofrece reintentar.
export function PublicoProvider({ children }) {
  const [D, setD] = useState(copiaLocal);
  const [falla, setFalla] = useState(false);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    const ctl = new AbortController();
    const espera = setTimeout(() => ctl.abort(), ESPERA_MS);
    setFalla(false);
    leerContenido(ctl.signal)
      .then(({ contenido }) => {
        const c = mezclar(respaldo, contenido);
        setD(c);
        try { localStorage.setItem(CLAVE_LOCAL, JSON.stringify(c)); } catch { /* sin almacenamiento */ }
      })
      .catch(() => setFalla(true))
      .finally(() => clearTimeout(espera));
    return () => { clearTimeout(espera); ctl.abort(); };
  }, [intento]);

  const valor = useMemo(() => D && ({ D, editing: false, base: '#/', set: noHace, add: noHace, remove: noHace }), [D]);
  if (!valor) {
    return (
      <div className="page">
        <main className="card" role="status">
          {falla ? (
            <>
              <h1 style={{ marginTop: 0 }}>No pudimos cargar la guía</h1>
              <p className="lead">Revisá tu conexión e intentá de nuevo.</p>
              <div className="btns"><button type="button" className="btn" onClick={() => setIntento((n) => n + 1)}>Reintentar</button></div>
              <p className="note"><strong>Emergencias:</strong> <a href="tel:911">911</a> · Policía <a href="tel:101">101</a> · Bomberos <a href="tel:100">100</a> · Emergencias médicas <a href="tel:107">107</a></p>
            </>
          ) : <p style={{ margin: 0 }}>Cargando…</p>}
        </main>
      </div>
    );
  }
  return <DataContext.Provider value={valor}>{children}</DataContext.Provider>;
}
