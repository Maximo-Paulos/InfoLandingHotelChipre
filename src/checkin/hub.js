// La pantalla «Reservas» de recepción: cuentas puras (sin pantalla ni red) que reparten lo que manda la base en las pestañas de arriba y arman el cartel de «qué falta llegar».
//   datos: la respuesta de recepcion_proximas → { hoy, dias, reservas (las reservas anotadas), estadias (todas las reservas con actividad en esos días) }
import { filtrarProximas } from './proximas.js';

// Las pestañas, en este orden: lo urgente primero.
export const PESTANAS = [
  { id: 'faltan', texto: 'Faltan llegar' },
  { id: 'cerrar', texto: 'Falta cerrar' },
  { id: 'cerradas', texto: 'Cerradas' },
  { id: 'proximas', texto: 'Próximas' },
  { id: 'historial', texto: 'Historial' }
];

const masReciente = (x, y) => String(y.ultima ?? '').localeCompare(String(x.ultima ?? ''));

// Reparte las reservas en las pestañas (aplicando el buscador, si hay algo escrito):
//   faltan    → todavía no llegó nadie: las anotadas de hoy o atrasadas que no empezaron el check-in, y las que tienen el código dado y no entró nadie (sin ingresos)
//   cerrar    → ingresó al menos un huésped y faltan otros: falta cerrarla (con el que falta, o a mano si no va a venir)
//   cerradas  → ya están: entraron todos (completa) o se cerró a mano con menos de los esperados (cerrada)
//   proximas  → las anotadas que llegan de mañana en adelante
//   historial → las que ya llegaron (con al menos un huésped), por día de llegada, de la más reciente a la más vieja
export function clasificarHub(datos, consulta = '') {
  const anotadas = filtrarProximas((datos?.reservas ?? []).filter((a) => a.estado === 'anotada'), consulta);
  const estadias = filtrarProximas(datos?.estadias ?? [], consulta);
  const atrasadas = anotadas.filter((a) => a.dias_para < 0);
  const hoy = anotadas.filter((a) => a.dias_para === 0);
  const sinIngresos = estadias.filter((e) => e.estado === 'sin_ingresos').sort(masReciente);
  const cerrar = estadias.filter((e) => e.estado === 'faltan').sort(masReciente);
  const cerradas = estadias.filter((e) => e.estado === 'completa' || e.estado === 'cerrada').sort(masReciente);
  const proximas = anotadas.filter((a) => a.dias_para > 0);
  const dias = [];
  for (const e of estadias.filter((x) => Number(x.con_checkin) > 0).sort(masReciente)) {
    let d = dias.find((x) => x.fecha === e.llegada);
    if (!d) { d = { fecha: e.llegada, dias: e.dias_para, items: [], huespedes: 0 }; dias.push(d); }
    d.items.push(e);
    d.huespedes += Number(e.con_checkin);
  }
  dias.sort((x, y) => y.fecha.localeCompare(x.fecha));
  return {
    faltan: { atrasadas, hoy, sinIngresos }, cerrar, cerradas, proximas, historial: dias,
    conteo: { faltan: atrasadas.length + hoy.length + sinIngresos.length, cerrar: cerrar.length, cerradas: cerradas.length, proximas: proximas.length, historial: dias.reduce((s, d) => s + d.items.length, 0) }
  };
}

// El cartel de arriba, para que recepción sepa si tiene que estar atento a alguna llegada o si ya se puede quedar tranquilo. Siempre sobre TODO (no cambia con el buscador).
//   estado: 'esperando' (falta llegar alguien, hoy o de días anteriores) | 'tranquilo' (ya llegaron todas las de hoy)
//   faltan: cuántas reservas faltan llegar · hoy / atrasadas / sinIngresos: de dónde salen · cerrar: cuántas tienen huéspedes sin llegar o sin cerrar · manana: cuántas llegan mañana
//   quienes: los primeros nombres de las que faltan llegar (hasta 4), para saber a quién esperar
export function controlLlegadas(datos) {
  const c = clasificarHub(datos, '');
  const { atrasadas, hoy, sinIngresos } = c.faltan;
  const faltan = atrasadas.length + hoy.length + sinIngresos.length;
  const nombre = (x) => x.titular || `Reserva rápida · Hab. ${x.habitacion}`;
  return {
    estado: faltan > 0 ? 'esperando' : 'tranquilo',
    faltan, hoy: hoy.length, atrasadas: atrasadas.length, sinIngresos: sinIngresos.length,
    cerrar: c.cerrar.length, manana: c.proximas.filter((a) => a.dias_para === 1).length,
    quienes: [...hoy, ...atrasadas, ...sinIngresos].slice(0, 4).map(nombre)
  };
}

// Cuántos días hay de una fecha a otra (YYYY-MM-DD): positivo si `hasta` es después de `desde`.
export const diasEntre = (desde, hasta) => Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 864e5);

// Lo que dice una reserva cerrada o completa: «Ingresaron los 3» / «Cerrada con 1 de 2 · por Recepción».
export const cierreTexto = (e) => {
  const con = Number(e.con_checkin) || 0;
  const esp = Number(e.esperados) || 0;
  if (e.estado === 'cerrada') return `Cerrada con ${con} de ${esp}${e.cerrada_por ? ` · por ${e.cerrada_por}` : ''}`;
  return con === 1 ? 'Ingresó 1 huésped' : `Ingresaron los ${con}`;
};

// Reservas duplicadas: una anotada que sigue esperando puede ser la misma que otra reserva ya abierta aparte (por ejemplo una reserva rápida en la misma habitación, donde el huésped
// ya hizo el check-in). Son candidatas las reservas sin anotada, de la misma habitación y con fechas cercanas (hasta 5 días); las que ya tienen huéspedes adentro, primero.
const hab = (x) => String(x ?? '').trim().toLowerCase();
export function candidatasPara(a, estadias = []) {
  return (estadias ?? [])
    .filter((e) => !e.anotada_id && hab(e.habitacion) === hab(a.habitacion) && a.fecha_ingreso && e.llegada && Math.abs(diasEntre(a.fecha_ingreso, e.llegada)) <= 5)
    .sort((x, y) => (Number(y.con_checkin) || 0) - (Number(x.con_checkin) || 0) || String(y.ultima ?? '').localeCompare(String(x.ultima ?? '')));
}

// Lo que se le dice a quien mira una anotada que puede ya haber llegado: «En la Hab. 202 ya hay una reserva con 2 huéspedes ingresados».
export const dudaTexto = (candidatas, habitacion) => {
  const c = candidatas[0];
  const n = Number(c.con_checkin) || 0;
  return n > 0
    ? `Puede que ya haya llegado: en la Hab. ${habitacion} hay una reserva con ${n} ${n === 1 ? 'huésped ingresado' : 'huéspedes ingresados'}.`
    : `Puede que sea la misma: en la Hab. ${habitacion} hay otra reserva abierta con el código dado.`;
};
