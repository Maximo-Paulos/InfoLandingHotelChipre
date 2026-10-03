// Ayudas puras: no leen datos globales, reciben lo que necesitan.

export const wa = (numero, msg) => `https://wa.me/${String(numero).replace(/\D/g, '')}?text=${encodeURIComponent(msg)}`;
export const maps = (q) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
export const tel = (n) => `tel:${String(n).replace(/[^\d+]/g, '')}`;
export const hora = (t) => String(t).replace(/^0/, '');

// Solo se aceptan links http(s): un dato mal cargado no puede ejecutar código.
export const urlSegura = (u) => (/^https?:\/\//i.test(String(u).trim()) ? String(u).trim() : '#');

// Hora y día actuales en la zona horaria del hotel.
function ahora(zona) {
  try {
    const partes = new Intl.DateTimeFormat('en-GB', {
      timeZone: zona, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date());
    const o = {};
    partes.forEach((x) => { o[x.type] = x.value; });
    const dias = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return { min: +o.hour * 60 + +o.minute, dia: dias[o.weekday] };
  } catch {
    const d = new Date();
    return { min: d.getHours() * 60 + d.getMinutes(), dia: d.getDay() };
  }
}
const aMin = (t) => { const [h, m] = String(t).split(':'); return (+h || 0) * 60 + (+m || 0); };

export function estado(f, zona) {
  if (f.siempre) return { txt: 'Abierta 24 h', cls: 'ok' };
  if (f.conTurno) return { txt: 'Con turno', cls: 'turno' };
  const n = ahora(zona);
  if (f.diasSemana && !f.diasSemana.includes(n.dia)) return { txt: 'Hoy cerrado', cls: '' };
  if (n.min >= aMin(f.abre) && n.min < aMin(f.cierra)) return { txt: 'Abierto ahora', cls: 'ok' };
  if (n.min < aMin(f.abre)) return { txt: `Abre a las ${hora(f.abre)}`, cls: '' };
  return { txt: 'Cerrado por hoy', cls: '' };
}
