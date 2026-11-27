// La pantalla «Reservas» de recepción: cuentas puras (sin pantalla ni red) que reparten lo que manda la base en las pestañas de arriba y arman el cartel de «qué falta llegar».
//   datos: la respuesta de recepcion_proximas → { hoy, dias, reservas (las reservas anotadas), estadias (todas las reservas con actividad en esos días) }
import { filtrarProximas, normalizar, numeroTexto } from './proximas.js';

// Las pestañas, en este orden: lo urgente primero.
export const PESTANAS = [
  { id: 'faltan', texto: 'Faltan llegar' },
  { id: 'cerrar', texto: 'Falta cerrar' },
  { id: 'cerradas', texto: 'Cerradas' },
  { id: 'proximas', texto: 'Próximas' },
  { id: 'historial', texto: 'Historial' },
  { id: 'repetidas', texto: 'Repetidas' }, // las que parecen la misma reserva cargada dos veces; el dueño las unifica
  { id: 'eliminadas', texto: 'Eliminadas', soloDueno: true } // solo el dueño: lo que se eliminó, para restaurarlo
];

const masReciente = (x, y) => String(y.ultima ?? '').localeCompare(String(x.ultima ?? ''));

// Reparte las reservas en las pestañas (aplicando el buscador, si hay algo escrito):
//   faltan    → todavía no llegó nadie: las anotadas de hoy o atrasadas que no empezaron el check-in, y las que tienen el código dado y no entró nadie (sin ingresos)
//   cerrar    → ingresó al menos un huésped y faltan otros: falta cerrarla (con el que falta, o a mano si no va a venir)
//   cerradas  → ya están: entraron todos (completa) o se cerró a mano con menos de los esperados (cerrada)
//   proximas  → las anotadas que llegan de mañana en adelante
//   historial → las que ya llegaron (con al menos un huésped), por día de llegada, de la más reciente a la más vieja
//   repetidas → parejas de reservas que parecen la misma (ver `repetidas`)
//   eliminadas → (solo le llega al dueño) lo eliminado en los últimos 60 días: reservas anuladas y anotadas canceladas, para restaurarlas
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
  const eliminadas = filtrarProximas(datos?.eliminadas ?? [], consulta);
  const todasRepetidas = repetidas(datos);
  const repes = consulta.trim() === '' ? todasRepetidas : todasRepetidas.filter((p) => filtrarProximas([p.a, p.b], consulta).length > 0);
  return {
    faltan: { atrasadas, hoy, sinIngresos }, cerrar, cerradas, proximas, historial: dias, eliminadas, repetidas: repes,
    conteo: { faltan: atrasadas.length + hoy.length + sinIngresos.length, cerrar: cerrar.length, cerradas: cerradas.length, proximas: proximas.length, historial: dias.reduce((s, d) => s + d.items.length, 0), repetidas: repes.length, eliminadas: eliminadas.length }
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

// ---------------------------------------------------------------- reservas repetidas
// Una reserva puede quedar cargada dos veces (por ejemplo una anotada que sigue «sin llegar» y, aparte, una reserva rápida donde el huésped ya hizo el check-in). Se sospecha por tres cosas:
//   · la HABITACIÓN: la misma;
//   · el DÍA: las fechas de las dos se pisan (la habitación está usada el mismo día). Una anotada y una reserva armada sin anotada también cuentan si llegan con hasta 2 días de diferencia;
//   · el NOMBRE: el del titular o el de quienes ya ingresaron. «Maldonado Gianfranco» y «Gianfranco Maldonado» son el mismo; «Juan Pérez» y «Juan Gómez», no.
// Nivel «alta» = habitación + día + mismo nombre; «media» = habitación + día y no hay nombre para comparar (o, entre una anotada y una armada, el nombre no coincide: el titular puede no ser quien ingresó).
// Dos reservas armadas con nombres distintos, o dos anotadas con nombres distintos, NO se sospechan: son personas distintas.
const hab = (x) => String(x ?? '').trim().toLowerCase();
const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'da', 'do', 'di', 'van', 'von']);
const fichas = (nombre) => normalizar(nombre).split(' ').filter((t) => t.length >= 2 && !PARTICULAS.has(t));

// Compara dos listas de nombres (el titular y los que ingresaron): 'igual' | 'distinto' | 'sin' (alguna de las dos no tiene ningún nombre).
// Son el mismo si comparten dos palabras (en cualquier orden, sin importar tildes ni mayúsculas) o si uno solo tiene una palabra y está en el otro («Pérez» y «Juan Pérez»).
// «Sin nombre» es lo que se muestra de un huésped cargado a mano sin ningún nombre: no es un nombre, no sirve para comparar.
const hayNombre = (n) => normalizar(n) !== 'sin nombre';
export function compararNombres(nombresA = [], nombresB = []) {
  const A = nombresA.filter(hayNombre).map(fichas).filter((f) => f.length > 0);
  const B = nombresB.filter(hayNombre).map(fichas).filter((f) => f.length > 0);
  if (!A.length || !B.length) return 'sin';
  for (const fa of A) {
    for (const fb of B) {
      const comunes = fa.filter((t) => fb.includes(t)).length;
      if (comunes >= 2 || (comunes >= 1 && Math.min(fa.length, fb.length) === 1)) return 'igual';
    }
  }
  return 'distinto';
}

const desdeDia = (fecha) => diasEntre('2000-01-01', fecha);
const seTapan = (f1, n1, f2, n2) => !!f1 && !!f2 && desdeDia(f1) < desdeDia(f2) + n2 && desdeDia(f2) < desdeDia(f1) + n1;

// Todas las parejas que parecen la misma reserva, de la más segura a la menos. Cada una: { id: 'a41|e55', tipo: 'anotada-estadia' | 'estadia-estadia' | 'anotada-anotada', nivel, a, b, motivos, conservar }.
//   a y b son las reservas (con clave 'a41' = anotada 41, 'e55' = armada 55, tipo, numero, titular, nombres…) · motivos: { habitacion, dia: 'mismo' | 'cercano', nombre: 'igual' | 'distinto' | 'sin' }
//   conservar: la clave de la que se propone conservar (la que viene de una anotada, o la que tiene más huéspedes, o la más vieja); en anotada + armada se queda siempre la armada con el nombre de la anotada.
//   Las que el dueño descartó («no son la misma», datos.descartadas) no vuelven a aparecer.
export function repetidas(datos) {
  const descartadas = new Set(datos?.descartadas ?? []);
  const anotadas = (datos?.reservas ?? []).filter((a) => a.estado === 'anotada')
    .map((a) => ({ ...a, clave: `a${a.id}`, tipo: 'anotada', desde: a.fecha_ingreso, nombres: [a.titular], con: 0 }));
  const estadias = (datos?.estadias ?? [])
    .map((e) => ({ ...e, clave: `e${e.id}`, tipo: 'estadia', desde: e.llegada, nombres: [e.titular, ...(e.ingresaron ?? [])], con: Number(e.con_checkin) || 0 }));
  const todos = [...anotadas, ...estadias];
  const noches = (x) => Math.max(1, Number(x.noches) || 1);
  const pares = [];
  for (let i = 0; i < todos.length; i += 1) {
    for (let j = i + 1; j < todos.length; j += 1) {
      let x = todos[i];
      let y = todos[j];
      if (hab(x.habitacion) !== hab(y.habitacion) || !x.desde || !y.desde) continue;
      const cruzada = x.tipo !== y.tipo;
      const solapan = seTapan(x.desde, noches(x), y.desde, noches(y));
      let cerca = false;
      if (cruzada) {
        const armada = x.tipo === 'estadia' ? x : y;
        if (armada.anotada_id) continue; // esa armada ya sale de una anotada: no es la de esta
        cerca = Math.abs(diasEntre(x.desde, y.desde)) <= 2;
        if (!solapan && !cerca) continue;
      } else if (!solapan) continue;
      const nombre = compararNombres(x.nombres, y.nombres);
      if (!cruzada && nombre !== 'igual' && !(x.tipo === 'estadia' && nombre === 'sin')) continue;
      const id = [x.clave, y.clave].sort().join('|');
      const alReves = [y.clave, x.clave].join('|');
      if (descartadas.has(id) || descartadas.has(alReves)) continue;
      if (cruzada) { if (x.tipo === 'estadia') [x, y] = [y, x]; } // la anotada primero
      else if (x.id > y.id) [x, y] = [y, x]; // la más vieja primero
      let conservar = null;
      if (x.tipo === 'estadia' && y.tipo === 'estadia') conservar = x.anotada_id ? x.clave : y.anotada_id ? y.clave : y.con > x.con ? y.clave : x.clave;
      else if (x.tipo === 'anotada' && y.tipo === 'anotada') conservar = x.clave;
      pares.push({
        id, tipo: `${x.tipo}-${y.tipo}`, nivel: nombre === 'igual' ? 'alta' : 'media', a: x, b: y, conservar,
        motivos: { habitacion: true, dia: solapan ? 'mismo' : 'cercano', nombre }
      });
    }
  }
  return pares.sort((p, q) => (p.nivel === q.nivel ? 0 : p.nivel === 'alta' ? -1 : 1) || String(p.a.desde).localeCompare(String(q.a.desde)));
}

// Para cada reserva, las otras con las que parece repetida: { 'e12': [reserva, …], 'a7': […] }. Es lo que se avisa en la fila de cada una.
export function parecidas(datos) {
  const mapa = {};
  for (const p of repetidas(datos)) {
    (mapa[p.a.clave] ??= []).push(p.b);
    (mapa[p.b.clave] ??= []).push(p.a);
  }
  return mapa;
}

// Las reservas ya armadas con las que parece repetida esta anotada que espera (para preguntar «¿esta reserva ya llegó?» al abrirla), con huéspedes ingresados primero.
export function candidatasDe(a, pares = []) {
  const clave = `a${a.id}`;
  return pares
    .filter((p) => p.tipo === 'anotada-estadia' && p.a.clave === clave)
    .map((p) => p.b)
    .sort((x, y) => (Number(y.con_checkin) || 0) - (Number(x.con_checkin) || 0) || String(y.ultima ?? '').localeCompare(String(x.ultima ?? '')));
}

// Lo que se le dice a quien mira una anotada que puede ya haber llegado: «En la Hab. 202 ya hay una reserva (N.º 55) con 2 huéspedes ingresados».
export const dudaTexto = (candidatas, habitacion) => {
  const c = candidatas[0];
  const n = Number(c.con_checkin) || 0;
  const num = c.numero != null ? ` (${numeroTexto(c)})` : '';
  return n > 0
    ? `Puede que ya haya llegado: en la Hab. ${habitacion} hay una reserva${num} con ${n} ${n === 1 ? 'huésped ingresado' : 'huéspedes ingresados'}.`
    : `Puede que sea la misma: en la Hab. ${habitacion} hay otra reserva abierta${num} con el código dado.`;
};

// «Parece repetida: la N.º 55 (Maldonado) es de la misma habitación y de los mismos días.»
export const parecidaTexto = (otras) => {
  const nombres = otras.slice(0, 2).map((o) => `${o.numero != null ? `la ${numeroTexto(o)}` : 'otra'}${o.titular ? ` (${o.titular})` : ''}`).join(' y ');
  return `Parece repetida: ${nombres}${otras.length > 2 ? ' y más' : ''} es de la misma habitación y de días parecidos. Mirala en «Repetidas».`;
};

// Los tres motivos de una pareja, como etiquetas para mostrar: [{ texto, bien }]
export function motivosTexto(par) {
  const m = par.motivos;
  return [
    { texto: 'Misma habitación', bien: true },
    { texto: m.dia === 'mismo' ? 'Mismo día' : 'Días cercanos', bien: true },
    m.nombre === 'igual' ? { texto: 'Mismo nombre', bien: true } : m.nombre === 'sin' ? { texto: 'Sin nombre para comparar', bien: false } : { texto: 'Nombre distinto', bien: false }
  ];
}

// La pareja «anotada + reserva armada» para unificar desde el detalle de la anotada (sin pasar por la lista de repetidas): si la detección no las marca, igual se arma con lo que se sabe.
export function paraUnir(anotada, estadia) {
  const hallada = repetidas({ reservas: [{ ...anotada, estado: 'anotada' }], estadias: [{ ...estadia, anotada_id: null }] })[0];
  if (hallada) return hallada;
  return {
    id: `a${anotada.id}|e${estadia.id}`, tipo: 'anotada-estadia', nivel: 'media', conservar: null, motivos: { habitacion: true, dia: 'cercano', nombre: 'sin' },
    a: { ...anotada, clave: `a${anotada.id}`, tipo: 'anotada', desde: anotada.fecha_ingreso, nombres: [anotada.titular], con: 0 },
    b: { ...estadia, clave: `e${estadia.id}`, tipo: 'estadia', desde: estadia.llegada, nombres: [estadia.titular, ...(estadia.ingresaron ?? [])], con: Number(estadia.con_checkin) || 0 }
  };
}
