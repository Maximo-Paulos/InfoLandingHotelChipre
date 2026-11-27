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
// Una reserva en dólares: { total, hotel, sena }. `monto` es el valor TOTAL de la habitación; `pago_hotel`, lo que se pagó en el hotel (con la
// fecha_cobro); la seña es la diferencia y, si se sabe, tiene su propia fecha (fecha_sena). Cada parte en pesos se pasa a dólar con SU día.
// Devuelve null si estaba en pesos y no hay cotización de alguno de esos días.
export function partesUsd(reserva, cotizaciones) {
  const total = Number(reserva.monto);
  const hotel = Number(reserva.pago_hotel ?? reserva.monto);
  const sena = Math.max(0, total - hotel);
  if (reserva.moneda === 'USD') return { total, hotel, sena };
  const vHotel = hotel > 0 || sena === 0 ? ventaEn(cotizaciones, reserva.fecha_cobro) : 1;
  const vSena = sena > 0 ? ventaEn(cotizaciones, reserva.fecha_sena ?? reserva.fecha_cobro) : 1;
  if (!vHotel || !vSena) return null;
  const h = hotel / vHotel;
  const sn = sena / vSena;
  return { total: h + sn, hotel: h, sena: sn };
}
// El valor total de una reserva en dólares (null si no se puede pasar).
export const aDolares = (reserva, cotizaciones) => partesUsd(reserva, cotizaciones)?.total ?? null;

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

// Una reserva con sus montos en dólares. Un canal que no cobra (obra social) no lleva monto: no suma ingresos ni tarifas (sinCobro), pero sí cuenta como habitación y noches.
const conMontos = (r, cotizaciones) => {
  if (r.canal_cobra === false) return { ...r, sinCobro: true, usd: null, usdHotel: null, usdSena: null };
  const p = partesUsd(r, cotizaciones);
  return { ...r, sinCobro: false, usd: p?.total ?? null, usdHotel: p?.hotel ?? null, usdSena: p?.sena ?? null };
};

// Agrupa reservas (ya con sus montos) por habitación, categoría o canal. n = todas las reservas; la tarifa y el ingreso salen solo de las que cobran.
function resumenGrupos(items, clave, vacio = null) {
  const mapa = new Map();
  for (const r of items) {
    const k = clave(r) ?? vacio;
    if (k == null || k === '') continue;
    const id = sinTildes(k);
    if (!mapa.has(id)) mapa.set(id, { texto: String(k).trim(), n: 0, noches: 0, nochesPagas: 0, ncob: 0, sinCobro: 0, usd: 0, usdConNoches: 0 });
    const g = mapa.get(id);
    g.n += 1;
    g.noches += r.noches ?? 0;
    if (r.sinCobro) g.sinCobro += 1;
    else if (r.usd != null) {
      g.ncob += 1;
      g.usd += r.usd;
      if (r.noches) { g.nochesPagas += r.noches; g.usdConNoches += r.usd; }
    }
  }
  return [...mapa.values()]
    .map((g) => ({ ...g, tarifa: g.ncob ? g.usd / g.ncob : null, tarifaNoche: g.nochesPagas ? g.usdConNoches / g.nochesPagas : null }))
    .sort((x, y) => y.n - x.n || y.usd - x.usd || x.texto.localeCompare(y.texto, 'es'));
}

// Qué datos dejan los huéspedes: de cada dato (campo de la base que dice si lo dejó), el porcentaje de los que lo dejaron. Se compara entre los que hicieron el check-in ellos
// mismos y los que cargó el dueño a mano (a_mano), que suelen traer menos datos: sin esa separación, los check-ins a mano bajarían los porcentajes y parecería que los huéspedes dejan menos.
export const DATOS_QUE_DEJAN = [['con_nombre', 'Nombre y apellido'], ['con_documento', 'Número de documento'], ['con_email', 'Mail'], ['con_telefono', 'Teléfono'], ['con_domicilio', 'Domicilio'], ['nacionalidad', 'Nacionalidad']];
export function datosQueDejan(huespedes) {
  const pct = (a, b) => (b ? (a / b) * 100 : null);
  const mano = huespedes.filter((h) => h.a_mano);
  const propios = huespedes.filter((h) => !h.a_mano);
  const tasa = (hs, campo) => pct(hs.filter((h) => (campo === 'nacionalidad' ? !!h.nacionalidad : !!h[campo])).length, hs.length);
  return {
    total: huespedes.length,
    aMano: mano.length,
    propios: propios.length,
    pctAMano: pct(mano.length, huespedes.length),
    filas: DATOS_QUE_DEJAN.map(([campo, texto]) => ({ campo, texto, todos: tasa(huespedes, campo), propios: tasa(propios, campo), mano: tasa(mano, campo) }))
  };
}

// Todo lo que se dibuja, para un período.
//   datos: { reservas, huespedes } de la base · cotizaciones: lista de dólares (o null si no se pudo bajar) · rango: { desde, hasta } · anterior: rango o null
export function calcular(datos, cotizaciones, rango, anterior = null) {
  const { reservas, huespedes } = recortar(datos, rango);
  const conUsd = reservas.map((r) => conMontos(r, cotizaciones));
  const cobrables = conUsd.filter((r) => !r.sinCobro);
  const cobradas = cobrables.filter((r) => r.usd != null);
  const resumen = (rs, hs) => {
    const ok = rs.filter((r) => !r.sinCobro && r.usd != null);
    const ing = suma(ok.map((r) => r.usd));
    const conNoches = ok.filter((r) => r.noches);
    const nochesPagas = suma(conNoches.map((r) => r.noches));
    const todasConNoches = rs.filter((r) => r.noches);
    return {
      reservas: rs.length,
      huespedes: hs.length,
      ingresosUsd: ing,
      hotelUsd: suma(ok.map((r) => r.usdHotel ?? 0)),
      senasUsd: suma(ok.map((r) => r.usdSena ?? 0)),
      tarifaUsd: ok.length ? ing / ok.length : null, // el ticket promedio: lo que deja una reserva que cobra
      porHuesped: suma(ok.map((r) => r.huespedes)) ? ing / suma(ok.map((r) => r.huespedes)) : null,
      noches: suma(todasConNoches.map((r) => r.noches)),
      nochesProm: todasConNoches.length ? suma(todasConNoches.map((r) => r.noches)) / todasConNoches.length : null,
      tarifaNocheUsd: nochesPagas ? suma(conNoches.map((r) => r.usd)) / nochesPagas : null,
      sinCobro: rs.filter((r) => r.sinCobro).length
    };
  };
  const actual = resumen(conUsd, huespedes);
  let previo = null;
  if (anterior) {
    const p = recortar(datos, anterior);
    previo = resumen(p.reservas.map((r) => conMontos(r, cotizaciones)), p.huespedes);
  }

  // Edad en el año del check-in (no se pregunta el día: es aproximada, ±1 año).
  const edades = huespedes.map((h) => (h.anio_nac ? Number(h.fecha.slice(0, 4)) - h.anio_nac : null)).filter((e) => e != null && e >= 0 && e <= 110);
  const edadProm = edades.length ? suma(edades) / edades.length : null;

  const corte = cortes(rango.desde, rango.hasta);
  const claves = serieVacia(rango.desde, rango.hasta, corte);
  const serie = claves.map((k) => {
    const rs = conUsd.filter((r) => claveDe(r.fecha_cobro, corte) === k);
    const s = resumen(rs, []);
    return { clave: k, etiqueta: etiquetaDe(k, corte), reservas: rs.length, noches: s.noches, ingresosUsd: s.ingresosUsd, tarifaUsd: s.tarifaUsd, tarifaNocheUsd: s.tarifaNocheUsd };
  });

  const paises = topConOtros(agrupar(huespedes, (h) => h.nacionalidad ?? 'Sin dato'), 5);
  const localidades = agrupar(huespedes, (h) => h.localidad).slice(0, 8);
  const extranjeros = huespedes.filter((h) => h.nacionalidad && sinTildes(h.nacionalidad) !== 'argentina').length;
  const conNacionalidad = huespedes.filter((h) => h.nacionalidad).length;

  const porEdad = EDADES.map((e) => ({ texto: e.texto, n: edades.filter((x) => x >= e.desde && x <= e.hasta).length }));

  const porHabitacion = resumenGrupos(conUsd, (r) => r.habitacion);
  const porCategoria = resumenGrupos(conUsd, (r) => r.categoria, 'Sin categoría');
  const porCanal = resumenGrupos(conUsd, (r) => r.canal, 'Sin canal');
  // Medios de pago y equipo: lo que se pagó / cobró EN EL HOTEL (las señas se cobraron antes, por otro lado). Lo sin cobro (obra social) no entra.
  const medios = agrupar(cobrables, (r) => r.medio_pago, (r) => r.usdHotel).sort((a, b) => b.usd - a.usd || b.n - a.n);
  const equipo = agrupar(cobrables, (r) => r.cargado_por, (r) => r.usdHotel).sort((a, b) => b.usd - a.usd || b.n - a.n);
  const conSena = cobrables.filter((r) => Number(r.pago_hotel ?? r.monto) < Number(r.monto));
  const conSenaOk = conSena.filter((r) => r.usd != null);

  // Cuántas noches se quedan (solo las reservas que tienen las noches cargadas: las de antes no).
  const CORTES_NOCHES = [['1', (n) => n === 1], ['2', (n) => n === 2], ['3', (n) => n === 3], ['4', (n) => n === 4], ['5', (n) => n === 5], ['6-7', (n) => n === 6 || n === 7], ['8 o más', (n) => n >= 8]];
  const conNoches = conUsd.filter((r) => r.noches);
  const porNoches = CORTES_NOCHES.map(([texto, f]) => ({ texto, n: conNoches.filter((r) => f(r.noches)).length }));

  const porDia = DIAS.map((texto, i) => ({ texto, n: conUsd.filter((r) => diaSemana(r.fecha_cobro) === i).length }));
  const porHora = Array.from({ length: 24 }, (_, h) => ({ texto: String(h), n: huespedes.filter((x) => x.hora === h).length }));
  const tamanos = [1, 2, 3, 4, 5].map((t) => ({ texto: t === 5 ? '5 o más' : String(t), n: conUsd.filter((r) => (t === 5 ? r.huespedes >= 5 : r.huespedes === t)).length }));

  const pesos = cobrables.filter((r) => r.moneda === 'ARS');
  const dolares = cobrables.filter((r) => r.moneda === 'USD');
  const totalConSena = suma(conSenaOk.map((r) => r.usd));
  const pct = (a, b) => (b ? (a / b) * 100 : null);
  const obra = conUsd.filter((r) => r.sinCobro);
  return {
    vacio: reservas.length === 0 && huespedes.length === 0,
    corte, serie, actual, previo,
    sinCotizacion: cobrables.length - cobradas.length,
    reservasConSena: conSena.length,
    pctConSena: pct(conSena.length, cobrables.length),
    senaPromedioPct: pct(suma(conSenaOk.map((r) => r.usdSena)), totalConSena), // de lo que sale una habitación con seña, qué parte se deja de seña
    reservasEnPesos: pesos.length, reservasEnDolares: dolares.length,
    sinCobro: { reservas: obra.length, noches: suma(obra.map((r) => r.noches ?? 0)), pct: pct(obra.length, reservas.length) },
    sinNoches: reservas.filter((r) => !r.noches).length,
    porNoches, porCategoria, porCanal,
    edadProm, edadesN: edades.length, porEdad, paises, localidades,
    pctExtranjeros: pct(extranjeros, conNacionalidad),
    pctMenores: pct(porEdad[0].n, edades.length),
    datos: datosQueDejan(huespedes),
    pctEmail: pct(huespedes.filter((h) => h.con_email).length, huespedes.length),
    pctTelefono: pct(huespedes.filter((h) => h.con_telefono).length, huespedes.length),
    recurrentes: huespedes.filter((h) => h.visitas > 1).length,
    pctRecurrentes: pct(huespedes.filter((h) => h.visitas > 1).length, huespedes.length),
    porHabitacion, medios, equipo, porDia, porHora, tamanos,
    huespedesPorHab: reservas.length ? suma(reservas.map((r) => r.huespedes)) / reservas.length : null,
    sinReserva: huespedes.filter((h) => h.estadia_id == null).length
  };
}

// La caja de un período, con plata de verdad (sin pasar a dólares): qué se facturó, cuánto entró en el hotel, cuánto fue seña, y cada reserva con su fecha.
// Una moneda por renglón (pesos y dólares no se mezclan). Las reservas sin cobro (obra social) van aparte, con sus noches, para facturarlas.
//   datos: { reservas, pendientes? } de la base · rango: { desde, hasta } (por la fecha del cobro en el hotel)
//   `reservas` son solo las que ya tienen algún huésped: son las únicas que suman. `pendientes` son las que todavía no tienen ninguno (en espera) o se
//   anularon: se devuelven aparte (sinHuespedes / anuladas) para que el dueño las vea, y nunca entran en los totales.
export function caja(datos, rango) {
  const { reservas } = recortar({ reservas: datos.reservas, huespedes: [] }, rango);
  const pendientes = (datos.pendientes ?? []).filter((r) => r.fecha_cobro >= rango.desde && r.fecha_cobro <= rango.hasta)
    .sort((a, b) => (a.creado < b.creado ? 1 : a.creado > b.creado ? -1 : b.id - a.id));
  const orden = [...reservas].sort((a, b) => (a.fecha_cobro < b.fecha_cobro ? 1 : a.fecha_cobro > b.fecha_cobro ? -1 : b.id - a.id));
  const monedas = new Map();
  const medios = new Map();
  const dias = [];
  const aFacturar = [];
  for (const r of orden) {
    const sinCobro = r.canal_cobra === false;
    const total = Number(r.monto);
    const hotel = Number(r.pago_hotel ?? r.monto);
    const fila = { ...r, sinCobro, total, hotel, sena: Math.max(0, total - hotel) };
    if (sinCobro) aFacturar.push(fila);
    else {
      const m = monedas.get(r.moneda) ?? { moneda: r.moneda, facturado: 0, hotel: 0, sena: 0, reservas: 0 };
      m.facturado += total; m.hotel += hotel; m.sena += fila.sena; m.reservas += 1;
      monedas.set(r.moneda, m);
      const claveMedio = `${r.moneda}|${r.medio_pago}`;
      const md = medios.get(claveMedio) ?? { moneda: r.moneda, medio: r.medio_pago, monto: 0, n: 0 };
      md.monto += hotel; md.n += 1;
      medios.set(claveMedio, md);
    }
    let dia = dias[dias.length - 1];
    if (!dia || dia.fecha !== r.fecha_cobro) { dia = { fecha: r.fecha_cobro, filas: [], hotel: {} }; dias.push(dia); }
    dia.filas.push(fila);
    if (!sinCobro) dia.hotel[r.moneda] = (dia.hotel[r.moneda] ?? 0) + hotel;
  }
  const porMoneda = (x, y) => (x.moneda === y.moneda ? 0 : x.moneda === 'ARS' ? -1 : 1);
  return {
    monedas: [...monedas.values()].sort(porMoneda),
    medios: [...medios.values()].sort((x, y) => porMoneda(x, y) || y.monto - x.monto),
    dias,
    reservas: reservas.length,
    sinCobro: { reservas: aFacturar.length, noches: suma(aFacturar.map((f) => f.noches ?? 0)), filas: aFacturar },
    sinHuespedes: pendientes.filter((r) => !r.anulada_en),
    anuladas: pendientes.filter((r) => r.anulada_en)
  };
}

// Cuánto subió o bajó respecto del período anterior, en %. null si antes era cero (no hay con qué comparar).
export const variacion = (ahora, antes) => (antes == null || antes === 0 || ahora == null ? null : ((ahora - antes) / antes) * 100);

export const usd = (n) => (n == null ? '—' : `US$ ${Math.round(n).toLocaleString('es-AR')}`);
export const ars = (n) => `$ ${Math.round(n).toLocaleString('es-AR')}`;
export const num = (n, dec = 0) => (n == null ? '—' : n.toLocaleString('es-AR', { maximumFractionDigits: dec, minimumFractionDigits: dec }));
export const porc = (n) => (n == null ? '—' : `${num(n, n < 10 && n > 0 ? 1 : 0)}%`);
