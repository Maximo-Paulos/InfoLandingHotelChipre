// Cuánto hay que cobrar de una reserva anotada según cómo pague lo que resta. Son cuentas puras (sin pantalla ni red): se prueban con node.
//   a: la reserva anotada { precio_efectivo, precio_transferencia, precio_usd, sena, canal_cobra, ... }  (precios en pesos, salvo precio_usd; seña en pesos)
//   venta: el dólar oficial (venta) de hoy, o null si no se pudo traer
//
// Reglas:
//   · Efectivo: lo que resta es el precio en efectivo menos la seña.
//   · Transferencia: el precio en transferencia menos la seña (si no se cargó precio en transferencia, es el del efectivo).
//   · Dólares: si hay precio en dólares, ese precio menos la seña pasada a dólares con el dólar oficial de hoy; si NO hay precio en dólares, lo que resta en
//     pesos en efectivo pasado a dólares con el dólar oficial de hoy (por eso se marca como «estimado»). La seña pagó el mismo dinero sin importar cómo se pagó.
//   · Con un canal que no cobra (obra social) no hay nada que cobrar: se factura aparte.

export const redondear = (n) => Math.round(n * 100) / 100;

// -> { efectivo: { total, sena, resta }, transferencia: { total, sena, resta, igualEfectivo }, usd: { total, sena, resta, estimado } | null }
export function aCobrar(a, venta) {
  const efectivo = Number(a.precio_efectivo);
  const transferencia = a.precio_transferencia != null ? Number(a.precio_transferencia) : efectivo;
  const sena = Number(a.sena) || 0;
  const pesos = (total) => ({ total, sena, resta: Math.max(0, redondear(total - sena)) });
  const salida = { efectivo: pesos(efectivo), transferencia: { ...pesos(transferencia), igualEfectivo: a.precio_transferencia == null }, usd: null };
  if (venta > 0) {
    if (a.precio_usd != null) {
      const total = Number(a.precio_usd);
      const senaUsd = redondear(sena / venta);
      salida.usd = { total, sena: senaUsd, resta: Math.max(0, redondear(total - senaUsd)), estimado: false };
    } else {
      salida.usd = { total: redondear(efectivo / venta), sena: redondear(sena / venta), resta: Math.max(0, redondear((efectivo - sena) / venta)), estimado: true };
    }
  } else if (a.precio_usd != null && sena === 0) {
    salida.usd = { total: Number(a.precio_usd), sena: 0, resta: Number(a.precio_usd), estimado: false }; // sin dólar oficial solo se puede si no hay seña que convertir
  }
  return salida;
}

// El medio de pago que mejor le queda a cada forma de cobrar, por su nombre (la lista la edita el dueño). null si ninguno se parece.
const PARECE = {
  efectivo: (n) => /efectivo/i.test(n) && !/usd|d[oó]lar/i.test(n),
  transferencia: (n) => /transfer/i.test(n),
  usd: (n) => /usd|d[oó]lar/i.test(n)
};
export const medioSugerido = (medios, forma) => (medios ?? []).find((m) => PARECE[forma]?.(m.nombre))?.id ?? null;

// La reserva que se arma al hacer el check-in cuando recepción confirma el cobro: la habitación, las noches, los huéspedes, el canal y la categoría salen TAL CUAL de la
// reserva anotada (no se tocan acá); del cobro se elige solo la forma de pago, el medio de pago y, si hace falta, cuánto se cobró de verdad.
//   forma: 'efectivo' | 'transferencia' | 'usd' · medioPago: el medio con el que paga (id) · hoy: la fecha del cobro (YYYY-MM-DD)
//   cobrado: lo que se cobró en el hotel (en la moneda de esa forma de pago), si NO es lo anotado (por ejemplo, si en el mostrador se negoció otro monto): el total de la
//     reserva pasa a ser lo cobrado más la seña que ya estaba pagada. Sin `cobrado` se cobra lo que resta: el precio anotado menos la seña.
// Con un canal que no cobra no hay monto ni medio de pago. null si esa forma de pagar no se puede calcular (dólares sin cotización) o si lo cobrado no es un monto válido.
export function reservaDeLlegada(a, forma, venta, medioPago, hoy, cobrado = null) {
  const base = { habitacion: a.habitacion, noches: a.noches, canal: a.canal_id, categoria: a.categoria_id ?? null, huespedes: a.esperados, fecha: hoy };
  if (a.canal_cobra === false) return { ...base, monto: 0, moneda: 'ARS', medioPago: null, pagoHotel: 0, fechaSena: null };
  const x = aCobrar(a, venta)[forma] ?? null;
  if (!x) return null;
  const otro = cobrado != null;
  if (otro && !(Number(cobrado) > 0 && Number(cobrado) < 1e9)) return null;
  const pagoHotel = otro ? redondear(Number(cobrado)) : x.resta;
  const monto = otro ? redondear(pagoHotel + x.sena) : x.total;
  return { ...base, monto, moneda: forma === 'usd' ? 'USD' : 'ARS', medioPago, pagoHotel, fechaSena: x.sena > 0 && pagoHotel < monto ? (a.fecha_sena ?? null) : null };
}
