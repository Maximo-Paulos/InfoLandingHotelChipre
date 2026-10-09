// La librería de teléfonos pesa bastante, así que se baja solo cuando se abre un formulario.
let carga = null;

export function cargarTelefono() {
  if (!carga) carga = import('libphonenumber-js/max').catch((e) => { carga = null; throw e; });
  return carga;
}

// Devuelve { ok, numero (+5491155551234), formato (+54 9 11 5555 1234) } o { ok: false }.
export function revisarTelefono(lib, pais, texto) {
  const t = String(texto ?? '').trim();
  if (!t) return { ok: false };
  try {
    const p = t.startsWith('+') ? lib.parsePhoneNumberFromString(t) : lib.parsePhoneNumberFromString(t, pais);
    if (p && p.isValid()) return { ok: true, numero: p.number, formato: p.formatInternational(), pais: p.country ?? null };
  } catch { /* texto raro */ }
  return { ok: false };
}

export const codigoDe = (lib, pais) => {
  try { return lib.getCountryCallingCode(pais); } catch { return null; }
};
