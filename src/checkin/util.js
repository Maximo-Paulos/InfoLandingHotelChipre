import { useEffect, useState } from 'react';

// Hora actual que se actualiza sola (para cuentas regresivas).
export function useAhora(cada = 1000) {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), cada);
    return () => clearInterval(t);
  }, [cada]);
  return ahora;
}

// 125 -> "2:05"
export const minSeg = (seg) => {
  const s = Math.max(0, Math.floor(seg));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// "570934" -> "570 934"
export const agruparCodigo = (c) => String(c ?? '').replace(/(\d{3})(\d{3})/, '$1 $2');

const ZONA = 'America/Argentina/Buenos_Aires';

export function fechaHora(iso, zona = ZONA) {
  try {
    return new Date(iso).toLocaleString('es-AR', { timeZone: zona, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return String(iso ?? '');
  }
}

export const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Lleva el foco al primer campo con error (después de que React dibuje los mensajes).
export const enfocarPrimerError = (formulario) => {
  setTimeout(() => formulario?.querySelector?.('[aria-invalid="true"]')?.focus?.(), 0);
};
