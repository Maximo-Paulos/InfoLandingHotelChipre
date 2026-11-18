// Las cuentas de la pantalla de estadísticas: puras (sin pantalla ni red), así se pueden probar con node.
// Entra lo que devuelve la base (reservas cobradas + huéspedes, sin datos personales) y la lista de dólares oficiales; sale todo lo que se dibuja.
// Las fechas son siempre texto «AAAA-MM-DD» (hora argentina), así se comparan como texto.

export const PERIODOS = [
  { id: 'mes', texto: 'Este mes' },
  { id: '30', texto: '30 días' },
  { id: '90', texto: '3 meses' },
  { id: '365', texto: '12 meses' },
  { id: 'anio', texto: 'Este año' },
  { id: 'todo', texto: 'Todo' }
];
export const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const DIAS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
export const EDADES = [
  { texto: 'Menores', desde: 0, hasta: 17 }, { texto: '18-24', desde: 18, hasta: 24 }, { texto: '25-34', desde: 25, hasta: 34 },
  { texto: '35-44', desde: 35, hasta: 44 }, { texto: '45-54', desde: 45, hasta: 54 }, { texto: '55-64', desde: 55, hasta: 64 }, { texto: '65 o más', desde: 65, hasta: 120 }
];

const mediodia = (iso) => Date.parse(`${iso}T12:00:00Z`);
export const sumarDias = (iso, n) => new Date(mediodia(iso) + n * 864e5).toISOString().slice(0, 10);
export const diasEntre = (a, b) => Math.round((mediodia(b) - mediodia(a)) / 864e5);
const diaSemana = (iso) => (new Date(mediodia(iso)).getUTCDay() + 6) % 7; // 0 = lunes
const sinTildes = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const suma = (xs) => xs.reduce((a, b) => a + b, 0);

// El período elegido -> { desde, hasta }. «Todo» arranca en la primera fecha que haya.
export function rangoDe(id, hoy, primera = hoy) {
  if (id === 'mes') return { desde: `${hoy.slice(0, 7)}-01`, hasta: hoy };
  if (id === 'anio') return { desde: `${hoy.slice(0, 4)}-01-01`, hasta: hoy };
  if (id === 'todo') return { desde: primera < hoy ? primera : hoy, hasta: hoy };
  const dias = Number(id);
  return { desde: sumarDias(hoy, -(dias - 1)), hasta: hoy };
}
// El período de igual largo que termina justo antes (para decir «subió / bajó»). «Todo» no tiene anterior.
export function rangoAnterior({ desde, hasta }, id) {
  if (id === 'todo') return null;
  const largo = diasEntre(desde, hasta) + 1;
  if (id === 'mes') { // el mes anterior entero hasta el mismo día
    const [a, m] = desde.split('-').map(Number);
    const ant = m === 1 ? `${a - 1}-12-01` : `${a}-${String(m - 1).padStart(2, '0')}-01`;
    const fin = sumarDias(ant, largo - 1);
    return { desde: ant, hasta: fin < desde ? fin : sumarDias(desde, -1) };
  }
  const h = sumarDias(desde, -1);
  return { desde: sumarDias(h, -(largo - 1)), hasta: h };
}

// Dólar oficial (venta) del día de un cobro: el último que haya hasta esa fecha (fines de semana y feriados no cotizan).
// cotizaciones: [{ fecha, venta }] ordenadas de menor a mayor fecha.
export function ventaEn(cotizaciones, fecha) {
  if (!cotizaciones?.length || fecha < cotizaciones[0].fecha) return null;
  let a = 0;
  let b = cotizaciones.length - 1;
  while (a < b) {
    const m = (a + b + 1) >> 1;
    if (cotizaciones[m].fecha <= fecha) a = m; else b = m - 1;
  }
  return cotizaciones[a].venta;
}
// Lo cobrado de una reserva, en dólares (null si estaba en pesos y no hay cotización de ese día).
export function aDolares(reserva, cotizaciones) {
  const monto = Number(reserva.monto);
  if (reserva.moneda === 'USD') return monto;
  const venta = ventaEn(cotizaciones, reserva.fecha_cobro);
  return venta ? monto / venta : null;
}

// Agrupa por una clave (sin importar mayúsculas ni tildes) y suma. Devuelve [{ texto, n, usd, ... }] de mayor a menor.
function agrupar(items, clave, sumar = () => 0) {
  const mapa = new Map();
  for (const it of items) {
    const k = clave(it);
    if (k == null || k === '') continue;
    const id = sinTildes(k);
    if (!mapa.has(id)) mapa.set(id, { texto: String(k).trim(), n: 0, usd: 0 });
    const g = mapa.get(id);
    g.n += 1;
    g.usd += sumar(it) ?? 0;
  }
  return [...mapa.values()].sort((x, y) => y.n - x.n || y.usd - x.usd || x.texto.localeCompare(y.texto, 'es'));
}
const topConOtros = (lista, max) => {
  if (lista.length <= max) return lista;
  const resto = lista.slice(max);
  return [...lista.slice(0, max), { texto: 'Otros', n: suma(resto.map((x) => x.n)), usd: suma(resto.map((x) => x.usd)), otros: true }];
};

// Lo que cae dentro de un período: las reservas por fecha de cobro, y los huéspedes de esas reservas (más los de antes de las reservas, por la fecha del check-in).
export function recortar({ reservas, huespedes }, { desde, hasta }) {
  const rs = reservas.filter((r) => r.fecha_cobro >= desde && r.fecha_cobro <= hasta);
  const ids = new Set(rs.map((r) => r.id));
  const hs = huespedes.filter((h) => (h.estadia_id != null ? ids.has(h.estadia_id) : h.fecha >= desde && h.fecha <= hasta));
  return { reservas: rs, huespedes: hs };
}

// Cada cuánto se corta la serie del tiempo según lo largo del período.
export function cortes(desde, hasta) {
  const dias = diasEntre(desde, hasta) + 1;
  return dias <= 45 ? 'dia' : dias <= 200 ? 'semana' : 'mes';
}
function claveDe(fecha, corte) {
  if (corte === 'dia') return fecha;
  if (corte === 'mes') return fecha.slice(0, 7);
  return sumarDias(fecha, -diaSemana(fecha)); // el lunes de esa semana
}
function etiquetaDe(clave, corte) {
  const [a, m, d] = clave.split('-');
  if (corte === 'mes') return `${MESES[Number(m) - 1]}${a === String(new Date().getFullYear()) ? '' : ` ${a.slice(2)}`}`;
  return `${Number(d)}/${Number(m)}`;
}
function serieVacia(desde, hasta, corte) {
  const claves = [];
  let f = desde;
  while (f <= hasta) {
    const k = claveDe(f, corte);
    if (claves[claves.length - 1] !== k) claves.push(k);
    f = sumarDias(f, 1);
  }
  return claves;
}

// Todo lo que se dibuja, para un período.
//   datos: { reservas, huespedes } de la base · cotizaciones: lista de dólares (o null si no se pudo bajar) · rango: { desde, hasta } · anterior: rango o null
export function calcular(datos, cotizaciones, rango, anterior = null) {
  const { reservas, huespedes } = recortar(datos, rango);
  const conUsd = reservas.map((r) => ({ ...r, usd: aDolares(r, cotizaciones) }));
  const cobradas = conUsd.filter((r) => r.usd != null);
  const ingresosUsd = suma(cobradas.map((r) => r.usd));
  const resumen = (rs, hs) => {
    const ok = rs.filter((r) => r.usd != null);
    const ing = suma(ok.map((r) => r.usd));
    return {
      reservas: rs.length,
      huespedes: hs.length,
      ingresosUsd: ing,
      tarifaUsd: ok.length ? ing / ok.length : null,
      porHuesped: suma(ok.map((r) => r.huespedes)) ? ing / suma(ok.map((r) => r.huespedes)) : null
    };
  };
  const actual = resumen(conUsd, huespedes);
  let previo = null;
  if (anterior) {
    const p = recortar(datos, anterior);
    previo = resumen(p.reservas.map((r) => ({ ...r, usd: aDolares(r, cotizaciones) })), p.huespedes);
  }

  // Edad en el año del check-in (no se pregunta el día: es aproximada, ±1 año).
  const edades = huespedes.map((h) => (h.anio_nac ? Number(h.fecha.slice(0, 4)) - h.anio_nac : null)).filter((e) => e != null && e >= 0 && e <= 110);
  const edadProm = edades.length ? suma(edades) / edades.length : null;

  const corte = cortes(rango.desde, rango.hasta);
  const claves = serieVacia(rango.desde, rango.hasta, corte);
  const serie = claves.map((k) => {
    const rs = conUsd.filter((r) => claveDe(r.fecha_cobro, corte) === k);
    const ok = rs.filter((r) => r.usd != null);
    const ing = suma(ok.map((r) => r.usd));
    return { clave: k, etiqueta: etiquetaDe(k, corte), reservas: rs.length, ingresosUsd: ing, tarifaUsd: ok.length ? ing / ok.length : null };
  });

  const paises = topConOtros(agrupar(huespedes, (h) => h.nacionalidad ?? 'Sin dato'), 5);
  const localidades = agrupar(huespedes, (h) => h.localidad).slice(0, 8);
  const extranjeros = huespedes.filter((h) => h.nacionalidad && sinTildes(h.nacionalidad) !== 'argentina').length;
  const conNacionalidad = huespedes.filter((h) => h.nacionalidad).length;

  const porEdad = EDADES.map((e) => ({ texto: e.texto, n: edades.filter((x) => x >= e.desde && x <= e.hasta).length }));

  const porHabitacion = agrupar(conUsd, (r) => r.habitacion, (r) => r.usd).map((g) => ({ ...g, tarifa: g.usd / g.n }));
  const medios = agrupar(conUsd, (r) => r.medio_pago, (r) => r.usd).sort((a, b) => b.usd - a.usd || b.n - a.n);
  const equipo = agrupar(conUsd, (r) => r.cargado_por, (r) => r.usd).sort((a, b) => b.usd - a.usd || b.n - a.n);

  const porDia = DIAS.map((texto, i) => ({ texto, n: conUsd.filter((r) => diaSemana(r.fecha_cobro) === i).length }));
  const porHora = Array.from({ length: 24 }, (_, h) => ({ texto: String(h), n: huespedes.filter((x) => x.hora === h).length }));
  const tamanos = [1, 2, 3, 4, 5].map((t) => ({ texto: t === 5 ? '5 o más' : String(t), n: conUsd.filter((r) => (t === 5 ? r.huespedes >= 5 : r.huespedes === t)).length }));

  const pesos = conUsd.filter((r) => r.moneda === 'ARS');
  const dolares = conUsd.filter((r) => r.moneda === 'USD');
  const pct = (a, b) => (b ? (a / b) * 100 : null);
  return {
    vacio: reservas.length === 0 && huespedes.length === 0,
    corte, serie, actual, previo,
    sinCotizacion: conUsd.length - cobradas.length,
    pesosCobrados: suma(pesos.map((r) => Number(r.monto))),
    dolaresCobrados: suma(dolares.map((r) => Number(r.monto))),
    reservasEnPesos: pesos.length, reservasEnDolares: dolares.length,
    edadProm, edadesN: edades.length, porEdad, paises, localidades,
    pctExtranjeros: pct(extranjeros, conNacionalidad),
    pctMenores: pct(porEdad[0].n, edades.length),
    pctEmail: pct(huespedes.filter((h) => h.con_email).length, huespedes.length),
    pctTelefono: pct(huespedes.filter((h) => h.con_telefono).length, huespedes.length),
    recurrentes: huespedes.filter((h) => h.visitas > 1).length,
    pctRecurrentes: pct(huespedes.filter((h) => h.visitas > 1).length, huespedes.length),
    porHabitacion, medios, equipo, porDia, porHora, tamanos,
    huespedesPorHab: reservas.length ? suma(reservas.map((r) => r.huespedes)) / reservas.length : null,
    sinReserva: huespedes.filter((h) => h.estadia_id == null).length
  };
}

// Cuánto subió o bajó respecto del período anterior, en %. null si antes era cero (no hay con qué comparar).
export const variacion = (ahora, antes) => (antes == null || antes === 0 || ahora == null ? null : ((ahora - antes) / antes) * 100);

export const usd = (n) => (n == null ? '—' : `US$ ${Math.round(n).toLocaleString('es-AR')}`);
export const ars = (n) => `$ ${Math.round(n).toLocaleString('es-AR')}`;
export const num = (n, dec = 0) => (n == null ? '—' : n.toLocaleString('es-AR', { maximumFractionDigits: dec, minimumFractionDigits: dec }));
export const porc = (n) => (n == null ? '—' : `${num(n, n < 10 && n > 0 ? 1 : 0)}%`);
