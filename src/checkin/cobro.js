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

// La reserva que se arma al hacer el check-in cuando recepción confirma el cobro tal cual está anotado, sin tocar montos: es lo mismo que haría el formulario
// completado con prefillDe y apretado «Generar códigos». `medioPago`: el medio con el que paga (id). `hoy`: la fecha del cobro (YYYY-MM-DD).
// Con un canal que no cobra no hay monto ni medio de pago. null si esa forma de pagar no se puede calcular (dólares sin cotización).
export function reservaDeLlegada(a, forma, venta, medioPago, hoy) {
  const base = { habitacion: a.habitacion, noches: a.noches, canal: a.canal_id, categoria: a.categoria_id ?? null, huespedes: a.esperados, fecha: hoy };
  if (a.canal_cobra === false) return { ...base, monto: 0, moneda: 'ARS', medioPago: null, pagoHotel: 0, fechaSena: null };
  const x = aCobrar(a, venta)[forma] ?? null;
  if (!x) return null;
  const conSena = Number(a.sena) > 0;
  const pagoHotel = conSena ? x.resta : x.total;
  return { ...base, monto: x.total, moneda: forma === 'usd' ? 'USD' : 'ARS', medioPago, pagoHotel, fechaSena: conSena && pagoHotel < x.total ? (a.fecha_sena ?? null) : null };
}

// Lo que se le pone ya completado al formulario de la reserva al hacer el check-in, para cada forma de cobrar ('efectivo' | 'transferencia' | 'usd').
// Todo se puede corregir: por ejemplo, si en el mostrador se negoció otro monto. Con un canal que no cobra solo van los datos de la estadía.
export function prefillDe(a, forma, venta, medios) {
  const base = { habitacion: a.habitacion, categoria_id: a.categoria_id, noches: a.noches, huespedes: a.esperados, canal_id: a.canal_id };
  if (a.canal_cobra === false) return base;
  const x = aCobrar(a, venta)[forma] ?? null;
  return {
    ...base,
    moneda: forma === 'usd' ? 'USD' : 'ARS',
    monto: x ? x.total : null,
    sena: x ? Number(a.sena) > 0 : false, // con seña, «lo que pagó en el hotel» es lo que resta; la seña es la diferencia
    pago: x && Number(a.sena) > 0 ? x.resta : null,
    fecha_sena: a.fecha_sena ?? null,
    medio_pago: medioSugerido(medios, forma)
  };
}
