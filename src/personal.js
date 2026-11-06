import { useEffect } from 'react';

// Las pantallas del personal no se enlazan desde la guía y no deben aparecer en buscadores.
export function useNoIndexar(titulo) {
  useEffect(() => {
    const previo = document.title;
    document.title = titulo;
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => { document.title = previo; meta.remove(); };
  }, [titulo]);
}

// Solo las pantallas del personal ofrecen "instalar como app": la guía de los huéspedes no lleva manifiesto.
export function useManifestoPersonal(activo) {
  useEffect(() => {
    if (!activo) return undefined;
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = 'personal.webmanifest';
    document.head.appendChild(link);
    return () => link.remove();
  }, [activo]);
}
