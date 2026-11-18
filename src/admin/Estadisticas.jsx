import { useEffect, useMemo, useRef, useState } from 'react';
import BarraPersonal from '../BarraPersonal.jsx';
import Modal from '../checkin/Modal.jsx';
import { adminEstadisticas, textoCodigo } from '../checkin/checkinApi.js';
import Icon from '../components/Icon.jsx';
import { useNoIndexar } from '../personal.js';
import { cargarCotizaciones } from './cotizaciones.js';
import { ars, calcular, num, PERIODOS, porc, rangoAnterior, rangoDe, usd, variacion } from './estadisticas.js';
import Caja from './Caja.jsx';
import { BarrasH, Cifra, Columnas, Linea, Tarjeta, Torta } from './graficos.jsx';
import { LoginAdmin, useSesionAdmin } from './sesionAdmin.jsx';

// Estadísticas del hotel para el dueño: cuánto se vendió, a qué tarifa (en dólares oficiales del día del cobro), quiénes se hospedan y cómo se vende.
// Todo sale de las reservas y los check-ins ya cargados; la base entrega solo cifras sueltas, sin nombres ni documentos.
// Se mira por secciones (Resumen, Ventas, Huéspedes, Operación) y el período se elige en una hoja desde abajo: nada de una página interminable.
export default function Estadisticas({ inicial = 'resumen', periodoInicial = '365' }) {
  useNoIndexar('Estadísticas');
  const sesion = useSesionAdmin();
  if (sesion.fase !== 'ok') return <LoginAdmin sesion={sesion} />;
  return <Pantalla clave={sesion.clave} salir={sesion.salir} inicial={inicial} periodoInicial={periodoInicial} />;
}

const SECCIONES = [
  { id: 'resumen', texto: 'Resumen' },
  { id: 'ventas', texto: 'Ventas' },
  { id: 'caja', texto: 'Caja' },
  { id: 'huespedes', texto: 'Huéspedes' },
  { id: 'operacion', texto: 'Operación' }
];
const tablaDe = (cols, filas) => ({ cols, filas });
const hab = (n) => `${n} hab.`;
const dmy = (iso) => { const [a, m, d] = iso.split('-'); return `${d}/${m}/${a.slice(2)}`; };

function Pantalla({ clave, salir, inicial, periodoInicial }) {
  const [datos, setDatos] = useState(null);
  const [cotizaciones, setCotizaciones] = useState(undefined); // undefined = cargando · null = no se pudo bajar
  const [error, setError] = useState('');
  const [periodo, setPeriodo] = useState(periodoInicial);
  const [version, setVersion] = useState(0); // sube al corregir una reserva: vuelve a pedir los datos
  const [hoja, setHoja] = useState(false);
  const [seccion, setSeccion] = useState(inicial);
  const botones = useRef({});

  useEffect(() => {
    let vivo = true;
    adminEstadisticas(clave).then((r) => {
      if (!vivo) return;
      if (r.ok) setDatos(r); else if (r.error === 'clave_incorrecta') salir(); else setError(textoCodigo(r.error));
    }).catch(() => { if (vivo) setError('No se pudo conectar. Revisá tu conexión.'); });
    cargarCotizaciones().then((c) => { if (vivo) setCotizaciones(c); }).catch(() => { if (vivo) setCotizaciones(null); });
    return () => { vivo = false; };
  }, [clave, salir, version]);

  const listo = datos && cotizaciones !== undefined;
  const r = useMemo(() => {
    if (!listo) return null;
    const primera = datos.reservas.reduce((m, x) => (x.fecha_cobro < m ? x.fecha_cobro : m), datos.hoy);
    const rango = rangoDe(periodo, datos.hoy, primera);
    return { rango, res: calcular(datos, cotizaciones ?? [], rango, rangoAnterior(rango, periodo)) };
  }, [listo, datos, cotizaciones, periodo]);

  const res = r?.res;
  const hoyVenta = cotizaciones?.length ? cotizaciones[cotizaciones.length - 1].venta : null;
  const cambio = (k) => (res?.previo ? variacion(res.actual[k], res.previo[k]) : null);
  const unidad = res ? { dia: 'Día', semana: 'Semana desde', mes: 'Mes' }[res.corte] : '';
  const textoPeriodo = PERIODOS.find((p) => p.id === periodo).texto;

  // Las secciones se recorren con las flechas del teclado, como cualquier barra de pestañas.
  const alTecla = (e) => {
    const i = SECCIONES.findIndex((s) => s.id === seccion);
    const j = e.key === 'ArrowRight' ? (i + 1) % SECCIONES.length : e.key === 'ArrowLeft' ? (i + SECCIONES.length - 1) % SECCIONES.length : e.key === 'Home' ? 0 : e.key === 'End' ? SECCIONES.length - 1 : -1;
    if (j < 0) return;
    e.preventDefault();
    setSeccion(SECCIONES[j].id);
    botones.current[SECCIONES[j].id]?.focus();
  };
  const elegirSeccion = (id) => { setSeccion(id); window.scrollTo(0, 0); };

  return (
    <div className="page personal">
      <BarraPersonal titulo="Estadísticas" actual="estadisticas" salir={salir} ancha />
      <main className="card ancha estad">
        <header>
          <h1>Estadísticas</h1>
          <p className="lead">Cómo viene el hotel: cuánto se vendió, a qué tarifa y quiénes se hospedan.</p>
        </header>

        <div className="est-periodo">
          <button type="button" className="est-pildora" onClick={() => setHoja(true)} aria-haspopup="dialog">
            <Icon name="calendario" size={18} sw={1.8} /> <b>{textoPeriodo}</b> <Icon name="abajo" size={18} sw={2} />
          </button>
          {r && <span className="est-fechas">{dmy(r.rango.desde)} al {dmy(r.rango.hasta)}</span>}
        </div>

        <div className="est-tabs" role="tablist" aria-label="Secciones de las estadísticas" onKeyDown={alTecla}>
          {SECCIONES.map((s) => (
            <button key={s.id} type="button" role="tab" id={`est-tab-${s.id}`} aria-selected={seccion === s.id} aria-controls="est-panel" tabIndex={seccion === s.id ? 0 : -1}
              ref={(el) => { botones.current[s.id] = el; }} className={seccion === s.id ? 'activa' : ''} onClick={() => elegirSeccion(s.id)}>{s.texto}</button>
          ))}
        </div>

        <div id="est-panel" role="tabpanel" aria-labelledby={`est-tab-${seccion}`} className="est-panel">
          {error && <p className="ed-error" role="alert">{error}</p>}
          {!error && !listo && <p className="intro" role="status">Cargando…</p>}
          {listo && cotizaciones === null && <p className="ed-error" role="alert">No se pudo traer el dólar oficial. Lo cobrado en pesos no entra en los totales en dólares hasta que vuelva a andar.</p>}

          {res && res.vacio && (
            <div className="est-vacio">
              <p>No hay reservas ni huéspedes en este período.</p>
              {periodo !== 'todo' && <button type="button" className="btn mini" onClick={() => setPeriodo('todo')}>Ver todo el historial</button>}
            </div>
          )}

          {res && !res.vacio && seccion === 'resumen' && (
            <>
              <div className="gr-cifras">
                <Cifra etiqueta="Ingresos" valor={usd(res.actual.ingresosUsd)} cambio={cambio('ingresosUsd')} sub={`valor total de las reservas: ${usd(res.actual.hotelUsd)} en el hotel + ${usd(res.actual.senasUsd)} en señas`} />
                <Cifra etiqueta="Habitaciones vendidas" valor={num(res.actual.reservas)} cambio={cambio('reservas')} sub={[res.actual.noches ? `${num(res.actual.noches)} noches` : null, res.actual.sinCobro ? `${res.actual.sinCobro} de obra social o sin cobro` : null].filter(Boolean).join(' · ') || null} />
                <Cifra etiqueta="Ticket promedio" valor={usd(res.actual.tarifaUsd)} cambio={cambio('tarifaUsd')} sub="lo que deja una reserva que cobra, con la seña incluida" />
                <Cifra etiqueta="Tarifa por noche" valor={usd(res.actual.tarifaNocheUsd)} cambio={cambio('tarifaNocheUsd')} sub={res.actual.nochesProm ? `se quedan ${num(res.actual.nochesProm, 1)} noches en promedio` : 'cargá las noches en cada reserva'} />
                <Cifra etiqueta="Huéspedes" valor={num(res.actual.huespedes)} cambio={cambio('huespedes')} sub={res.sinReserva ? `${res.sinReserva} de antes de las reservas` : null} />
                <Cifra etiqueta="Ingreso por huésped" valor={usd(res.actual.porHuesped)} cambio={cambio('porHuesped')} sub="lo cobrado dividido los huéspedes" />
              </div>
              <Tarjeta titulo="Ingresos" ayuda="Valor total de las habitaciones (lo cobrado en el hotel más las señas), en dólares, en cada tramo del período." tabla={tablaDe([unidad, 'Habitaciones', 'Ingresos'], res.serie.map((s) => [s.etiqueta, String(s.reservas), usd(s.ingresosUsd)]))}>
                <Columnas nombre="Ingresos en dólares" datos={res.serie.map((s) => ({ texto: s.etiqueta, valor: Math.round(s.ingresosUsd) }))} formato={usd} />
              </Tarjeta>
              <p className="ayuda">
                Los pesos se pasan a dólares con el dólar oficial (venta) del día de cada pago: lo pagado en el hotel con la fecha del cobro y la seña con la fecha de la seña (si no se cargó, la del cobro){hoyVenta ? `; hoy está a ${ars(hoyVenta)}` : ''}.
                {res.sinCotizacion > 0 && cotizaciones ? ` ${res.sinCotizacion} cobro${res.sinCotizacion === 1 ? '' : 's'} en pesos quedó sin convertir (no hay cotización de esa fecha).` : ''}
              </p>
            </>
          )}

          {res && !res.vacio && seccion === 'ventas' && (
            <>
            <div className="gr-cifras cinco">
              <Cifra etiqueta="Cobrado en el hotel" valor={usd(res.actual.hotelUsd)} sub="lo que se pagó al llegar" />
              <Cifra etiqueta="Señas cobradas antes" valor={usd(res.actual.senasUsd)} sub="cada una con el dólar de su fecha" />
              <Cifra etiqueta="Reservas con seña" valor={porc(res.pctConSena)} sub={`${res.reservasConSena} de ${res.actual.reservas}${res.senaPromedioPct != null ? ` · dejan ${porc(res.senaPromedioPct)} del total` : ''}`} />
            </div>
            <div className="gr-grilla-tarjetas">
              <Tarjeta titulo="Habitaciones vendidas" ayuda="Cuántas habitaciones se cobraron. Muestra la estacionalidad: qué épocas se llena y cuáles no." tabla={tablaDe([unidad, 'Habitaciones'], res.serie.map((s) => [s.etiqueta, String(s.reservas)]))}>
                <Columnas nombre="Habitaciones vendidas" enteros datos={res.serie.map((s) => ({ texto: s.etiqueta, valor: s.reservas }))} formato={hab} />
              </Tarjeta>
              <Tarjeta titulo="Ticket promedio" ayuda="Lo que deja en promedio una reserva que cobra, en dólares del día. Si sube, estás vendiendo más caro (o bajó el dólar)." tabla={tablaDe([unidad, 'Tarifa promedio'], res.serie.map((s) => [s.etiqueta, usd(s.tarifaUsd)]))}>
                <Linea nombre="Tarifa promedio en dólares" datos={res.serie.map((s) => ({ texto: s.etiqueta, valor: s.tarifaUsd == null ? null : Math.round(s.tarifaUsd) }))} formato={usd} />
              </Tarjeta>
              <Tarjeta titulo="Cuántas noches se quedan" ayuda={`${res.actual.nochesProm ? `Se quedan ${num(res.actual.nochesProm, 1)} noches en promedio. ` : ''}Ticket promedio ${usd(res.actual.tarifaUsd)} · tarifa por noche ${usd(res.actual.tarifaNocheUsd)}.${res.sinNoches ? ` ${res.sinNoches} reservas (las de antes) no tienen las noches cargadas y no entran acá.` : ''}`} tabla={tablaDe(['Noches', 'Reservas'], res.porNoches.map((x) => [x.texto, String(x.n)]))}>
                <Columnas nombre="Reservas según las noches que se quedan" enteros datos={res.porNoches.map((x) => ({ texto: x.texto, valor: x.n }))} formato={hab} />
              </Tarjeta>
              <Tarjeta titulo="Tarifa por noche" ayuda="Lo que se cobra por noche en promedio, en dólares del día. Sirve para comparar épocas aunque la gente se quede distinta cantidad de noches." tabla={tablaDe([unidad, 'Tarifa por noche'], res.serie.map((x) => [x.etiqueta, usd(x.tarifaNocheUsd)]))}>
                <Linea nombre="Tarifa por noche en dólares" datos={res.serie.map((x) => ({ texto: x.etiqueta, valor: x.tarifaNocheUsd == null ? null : Math.round(x.tarifaNocheUsd) }))} formato={usd} />
              </Tarjeta>
              <Tarjeta titulo="Categorías más buscadas" ayuda="Qué categorías de habitación se venden más y a qué tarifa por noche." tabla={tablaDe(['Categoría', 'Reservas', 'Noches', 'Tarifa por noche', 'Ticket promedio'], res.porCategoria.map((x) => [x.texto, String(x.n), String(x.noches), usd(x.tarifaNoche), usd(x.tarifa)]))}>
                <BarrasH datos={res.porCategoria.map((x) => ({ texto: x.texto, valor: x.n, nota: x.tarifaNoche ? `${usd(x.tarifaNoche)} por noche` : undefined }))} formato={hab} />
              </Tarjeta>
              <Tarjeta titulo="Canales de venta" ayuda={res.sinCobro.reservas ? `Las ${res.sinCobro.reservas} reservas sin cobro (obra social) cuentan acá y en habitaciones y noches, pero no suman ingresos ni tarifas.` : 'Por dónde llegan las reservas.'} tabla={tablaDe(['Canal', 'Reservas', 'Noches', 'Ingresos'], res.porCanal.map((x) => [x.texto, String(x.n), String(x.noches), x.sinCobro === x.n ? 'sin cobro' : usd(x.usd)]))}>
                <BarrasH datos={res.porCanal.map((x) => ({ texto: x.texto, valor: x.n, nota: x.sinCobro === x.n ? 'sin cobro' : usd(x.usd) }))} formato={hab} />
              </Tarjeta>
              <Tarjeta titulo="Cómo pagan en el hotel" ayuda={`Reservas en pesos: ${res.reservasEnPesos} · en dólares: ${res.reservasEnDolares}. Barras: dólares pagados en el hotel con cada medio (sin las señas).`} tabla={tablaDe(['Medio', 'Cobros', 'Pagado en el hotel'], res.medios.map((m) => [m.texto, String(m.n), usd(m.usd)]))}>
                <BarrasH datos={res.medios.map((m) => ({ texto: m.texto, valor: Math.round(m.usd), nota: `${m.n} ${m.n === 1 ? 'cobro' : 'cobros'}` }))} formato={usd} />
              </Tarjeta>
            </div>
            </>
          )}

          {listo && seccion === 'caja' && <Caja datos={datos} rango={r.rango} clave={clave} alGuardar={() => setVersion((v) => v + 1)} />}

          {res && !res.vacio && seccion === 'huespedes' && (
            <>
              <div className="gr-grilla-tarjetas">
                <Tarjeta titulo="De qué país vienen" ayuda={res.pctExtranjeros == null ? null : `${porc(res.pctExtranjeros)} de los huéspedes son extranjeros. Sirve para elegir en qué idiomas y países anunciarte.`} tabla={tablaDe(['País', 'Huéspedes'], res.paises.map((p) => [p.texto, String(p.n)]))}>
                  <Torta nombre="Huéspedes por país" datos={res.paises} />
                </Tarjeta>
                <Tarjeta titulo="Edades" ayuda={res.edadProm == null ? null : `Edad promedio: ${num(res.edadProm)} años. Define a quién le hablás en la publicidad y qué servicios ofrecer.`} tabla={tablaDe(['Edad', 'Huéspedes'], res.porEdad.map((e) => [e.texto, String(e.n)]))}>
                  <Columnas nombre="Huéspedes por edad" enteros datos={res.porEdad.map((e) => ({ texto: e.texto, valor: e.n }))} formato={(v) => `${v} huéspedes`} />
                </Tarjeta>
                <Tarjeta titulo="De qué ciudad vienen" ayuda="Las localidades que más se repiten: ahí conviene anunciar." tabla={tablaDe(['Localidad', 'Huéspedes'], res.localidades.map((p) => [p.texto, String(p.n)]))}>
                  <BarrasH datos={res.localidades.map((p) => ({ texto: p.texto, valor: p.n }))} />
                </Tarjeta>
                <Tarjeta titulo="Cuántos son por habitación" ayuda="Cuántos huéspedes se registran en cada habitación vendida." tabla={tablaDe(['Huéspedes', 'Habitaciones'], res.tamanos.map((t) => [t.texto, String(t.n)]))}>
                  <Columnas nombre="Habitaciones según cantidad de huéspedes" enteros datos={res.tamanos.map((t) => ({ texto: t.texto, valor: t.n }))} formato={hab} />
                </Tarjeta>
              </div>
              <h2 className="sub">Para volver a venderles</h2>
              <div className="gr-cifras cinco">
                <Cifra etiqueta="Dejaron su email" valor={porc(res.pctEmail)} sub="se les puede escribir con ofertas" />
                <Cifra etiqueta="Dejaron su teléfono" valor={porc(res.pctTelefono)} sub="para avisarles por WhatsApp" />
                <Cifra etiqueta="Ya se habían alojado" valor={porc(res.pctRecurrentes)} sub={`${res.recurrentes} huéspedes que vuelven`} />
                <Cifra etiqueta="Extranjeros" valor={porc(res.pctExtranjeros)} sub="del total de huéspedes" />
                <Cifra etiqueta="Menores de edad" valor={porc(res.pctMenores)} sub="con año de nacimiento cargado" />
              </div>
              <p className="ayuda">La edad es aproximada (se cuenta por el año de nacimiento, sin el día). Los check-ins de antes de las reservas no tienen monto: no suman ingresos, pero sí cuentan en países, edades y localidades.</p>
            </>
          )}

          {res && !res.vacio && seccion === 'operacion' && (
            <div className="gr-grilla-tarjetas">
              <Tarjeta titulo="Qué días se vende más" ayuda="Habitaciones cobradas según el día de la semana." tabla={tablaDe(['Día', 'Habitaciones'], res.porDia.map((d) => [d.texto, String(d.n)]))}>
                <Columnas nombre="Habitaciones por día de la semana" enteros datos={res.porDia.map((d) => ({ texto: d.texto, valor: d.n }))} formato={hab} />
              </Tarjeta>
              <Tarjeta titulo="A qué hora llegan" ayuda="Huéspedes que hicieron el check-in en cada hora del día. Sirve para saber cuándo reforzar la recepción." tabla={tablaDe(['Hora', 'Huéspedes'], res.porHora.filter((h) => h.n).map((h) => [`${h.texto}:00`, String(h.n)]))}>
                <Columnas nombre="Check-ins por hora" enteros datos={res.porHora.map((h) => ({ texto: h.texto, valor: h.n }))} formato={(v) => `${v} huéspedes`} />
              </Tarjeta>
              <Tarjeta titulo="Qué habitaciones se venden" ayuda="Las que más se venden y a qué tarifa. Las que no aparecen o van abajo son las que cuesta vender." tabla={tablaDe(['Habitación', 'Ventas', 'Ingresos', 'Tarifa promedio'], res.porHabitacion.map((h) => [h.texto, String(h.n), usd(h.usd), usd(h.tarifa)]))}>
                <BarrasH datos={res.porHabitacion.slice(0, 8).map((h) => ({ texto: `Hab. ${h.texto}`, valor: h.n, nota: `${usd(h.tarifa)} c/u` }))} formato={hab} />
              </Tarjeta>
              <Tarjeta titulo="Cuánto cobró cada persona" ayuda="Para controlar la caja: cuántas reservas cargó cada persona y cuánto cobró en el hotel (sin las señas, que entraron antes)." tabla={tablaDe(['Persona', 'Reservas', 'Cobrado en el hotel'], res.equipo.map((e) => [e.texto, String(e.n), usd(e.usd)]))}>
                <BarrasH datos={res.equipo.map((e) => ({ texto: e.texto, valor: Math.round(e.usd), nota: `${e.n} ${e.n === 1 ? 'reserva' : 'reservas'}` }))} formato={usd} />
              </Tarjeta>
            </div>
          )}
        </div>
      </main>

      {hoja && (
        <Modal titulo="Período" onCerrar={() => setHoja(false)}>
          <ul className="hoja-lista" role="radiogroup" aria-label="Período">
            {PERIODOS.map((p) => (
              <li key={p.id}>
                <button type="button" role="radio" aria-checked={periodo === p.id} className={`hoja-fila${periodo === p.id ? ' elegida' : ''}`} onClick={() => { setPeriodo(p.id); setHoja(false); }}>
                  <span>{p.texto}</span>
                  {periodo === p.id && <Icon name="tilde" size={22} sw={2.4} />}
                </button>
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </div>
  );
}
