import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import respaldo from './hotel.js';
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

// Proveedor de la guía pública: pide el contenido a la base de datos.
// Si no hay conexión usa la última copia guardada en el celular y, si no, el contenido de ejemplo.
export function PublicoProvider({ children }) {
  const [D, setD] = useState(copiaLocal);

  useEffect(() => {
    const ctl = new AbortController();
    const espera = setTimeout(() => ctl.abort(), 6000);
    fetch('/api/contenido', { signal: ctl.signal, cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
      .then(({ contenido }) => {
        const c = mezclar(respaldo, contenido);
        setD(c);
        try { localStorage.setItem(CLAVE_LOCAL, JSON.stringify(c)); } catch { /* sin almacenamiento */ }
      })
      .catch(() => setD((actual) => actual ?? respaldo))
      .finally(() => clearTimeout(espera));
    return () => { clearTimeout(espera); ctl.abort(); };
  }, []);

  const valor = useMemo(() => D && ({ D, editing: false, base: '#/', set: noHace, add: noHace, remove: noHace }), [D]);
  if (!valor) return <main className="card"><p style={{ padding: 24 }}>Cargando…</p></main>;
  return <DataContext.Provider value={valor}>{children}</DataContext.Provider>;
}
