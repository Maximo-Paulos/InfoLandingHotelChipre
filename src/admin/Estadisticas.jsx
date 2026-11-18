import { useEffect, useMemo, useState } from 'react';
import BarraPersonal from '../BarraPersonal.jsx';
import { adminEstadisticas, textoCodigo } from '../checkin/checkinApi.js';
import { useNoIndexar } from '../personal.js';
import { cargarCotizaciones } from './cotizaciones.js';
import { ars, calcular, num, PERIODOS, porc, rangoAnterior, rangoDe, usd, variacion } from './estadisticas.js';
import { BarrasH, Cifra, Columnas, Linea, Tarjeta, Torta } from './graficos.jsx';
import { LoginAdmin, useSesionAdmin } from './sesionAdmin.jsx';

// Estadísticas del hotel para el dueño: cuánto se vendió, a qué tarifa (en dólares oficiales del día del cobro), quiénes se hospedan y cómo se vende.
// Todo sale de las reservas y los check-ins ya cargados; la base entrega solo cifras sueltas, sin nombres ni documentos.
export default function Estadisticas() {
  useNoIndexar('Estadísticas');
  const sesion = useSesionAdmin();
  if (sesion.fase !== 'ok') return <LoginAdmin sesion={sesion} />;
  return <Pantalla clave={sesion.clave} salir={sesion.salir} />;
}

const tablaDe = (cols, filas) => ({ cols, filas });
const hab = (n) => `${n} hab.`;

function Pantalla({ clave, salir }) {
  const [datos, setDatos] = useState(null);
  const [cotizaciones, setCotizaciones] = useState(undefined); // undefined = cargando · null = no se pudo bajar
  const [error, setError] = useState('');
  const [periodo, setPeriodo] = useState('365');

  useEffect(() => {
    let vivo = true;
    adminEstadisticas(clave).then((r) => {
      if (!vivo) return;
      if (r.ok) setDatos(r); else if (r.error === 'clave_incorrecta') salir(); else setError(textoCodigo(r.error));
    }).catch(() => { if (vivo) setError('No se pudo conectar. Revisá tu conexión.'); });
    cargarCotizaciones().then((c) => { if (vivo) setCotizaciones(c); }).catch(() => { if (vivo) setCotizaciones(null); });
    return () => { vivo = false; };
  }, [clave, salir]);

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

  return (
    <div className="page personal">
      <BarraPersonal titulo="Estadísticas" actual="estadisticas" salir={salir} ancha />
      <main className="card ancha estad">
        <header>
          <h1>Estadísticas</h1>
          <p className="lead">Cómo viene el hotel: cuánto se vendió, a qué tarifa y quiénes se hospedan.</p>
        </header>

        <div className="periodos" role="group" aria-label="Período">
          {PERIODOS.map((p) => (
            <button key={p.id} type="button" className={periodo === p.id ? 'activa' : ''} aria-pressed={periodo === p.id} onClick={() => setPeriodo(p.id)}>{p.texto}</button>
          ))}
        </div>

        {error && <p className="ed-error" role="alert">{error}</p>}
        {!error && !listo && <p className="intro" role="status">Cargando…</p>}
        {listo && cotizaciones === null && <p className="ed-error" role="alert">No se pudo traer el dólar oficial. Lo cobrado en pesos no entra en los totales en dólares hasta que vuelva a andar.</p>}

        {res && (
          <>
            <p className="ayuda">
              {r.rango.desde.split('-').reverse().join('/')} al {r.rango.hasta.split('-').reverse().join('/')}.
              {' '}Los pesos se pasan a dólares con el dólar oficial (venta) del día de cada cobro{hoyVenta ? `; hoy está a ${ars(hoyVenta)}` : ''}.
              {res.sinCotizacion > 0 && cotizaciones ? ` ${res.sinCotizacion} cobro${res.sinCotizacion === 1 ? '' : 's'} en pesos quedó sin convertir (no hay cotización de esa fecha).` : ''}
            </p>

            {res.vacio ? (
              <p className="planilla-vacia">No hay reservas ni huéspedes en este período. Probá con uno más largo.</p>
            ) : (
              <>
                <div className="gr-cifras">
                  <Cifra etiqueta="Ingresos" valor={usd(res.actual.ingresosUsd)} cambio={cambio('ingresosUsd')} sub={`${ars(res.pesosCobrados)} en pesos · US$ ${num(res.dolaresCobrados)} en dólares`} />
                  <Cifra etiqueta="Habitaciones vendidas" valor={num(res.actual.reservas)} cambio={cambio('reservas')} sub={res.huespedesPorHab ? `${num(res.huespedesPorHab, 1)} huéspedes por habitación` : null} />
                  <Cifra etiqueta="Tarifa promedio" valor={usd(res.actual.tarifaUsd)} cambio={cambio('tarifaUsd')} sub="por habitación, en dólares" />
                  <Cifra etiqueta="Huéspedes" valor={num(res.actual.huespedes)} cambio={cambio('huespedes')} sub={res.sinReserva ? `${res.sinReserva} de antes de las reservas` : null} />
                  <Cifra etiqueta="Edad promedio" valor={res.edadProm == null ? '—' : `${num(res.edadProm)} años`} sub={`según el año de nacimiento de ${res.edadesN} huéspedes`} />
                  <Cifra etiqueta="Ingreso por huésped" valor={usd(res.actual.porHuesped)} cambio={cambio('porHuesped')} sub="lo cobrado dividido los huéspedes" />
                </div>

                <h2 className="sub">Ventas</h2>
                <div className="gr-grilla-tarjetas">
                  <Tarjeta titulo="Ingresos" ayuda="Dólares cobrados por habitaciones en cada tramo del período." tabla={tablaDe([unidad, 'Habitaciones', 'Ingresos'], res.serie.map((s) => [s.etiqueta, String(s.reservas), usd(s.ingresosUsd)]))}>
                    <Columnas nombre="Ingresos en dólares" datos={res.serie.map((s) => ({ texto: s.etiqueta, valor: Math.round(s.ingresosUsd) }))} formato={usd} />
                  </Tarjeta>
                  <Tarjeta titulo="Habitaciones vendidas" ayuda="Cuántas habitaciones se cobraron. Muestra la estacionalidad: qué épocas se llena y cuáles no." tabla={tablaDe([unidad, 'Habitaciones'], res.serie.map((s) => [s.etiqueta, String(s.reservas)]))}>
                    <Columnas nombre="Habitaciones vendidas" enteros datos={res.serie.map((s) => ({ texto: s.etiqueta, valor: s.reservas }))} formato={hab} />
                  </Tarjeta>
                  <Tarjeta titulo="Tarifa promedio" ayuda="Lo que se cobró en promedio por habitación, en dólares del día. Si sube, estás vendiendo más caro (o bajó el dólar)." tabla={tablaDe([unidad, 'Tarifa promedio'], res.serie.map((s) => [s.etiqueta, usd(s.tarifaUsd)]))}>
                    <Linea nombre="Tarifa promedio en dólares" datos={res.serie.map((s) => ({ texto: s.etiqueta, valor: s.tarifaUsd == null ? null : Math.round(s.tarifaUsd) }))} formato={usd} />
                  </Tarjeta>
                  <Tarjeta titulo="Cómo pagan" ayuda={`En pesos: ${res.reservasEnPesos} cobros · en dólares: ${res.reservasEnDolares} cobros. Barras: dólares cobrados por cada medio.`} tabla={tablaDe(['Medio', 'Cobros', 'Ingresos'], res.medios.map((m) => [m.texto, String(m.n), usd(m.usd)]))}>
                    <BarrasH datos={res.medios.map((m) => ({ texto: m.texto, valor: Math.round(m.usd), nota: `${m.n} ${m.n === 1 ? 'cobro' : 'cobros'}` }))} formato={usd} />
                  </Tarjeta>
                </div>

                <h2 className="sub">Quiénes se hospedan</h2>
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

                <h2 className="sub">Cómo se vende</h2>
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
                  <Tarjeta titulo="Quién cargó las reservas" ayuda="Para controlar el cobro: cuántas reservas cargó cada persona y cuánto sumaron." tabla={tablaDe(['Persona', 'Reservas', 'Ingresos'], res.equipo.map((e) => [e.texto, String(e.n), usd(e.usd)]))}>
                    <BarrasH datos={res.equipo.map((e) => ({ texto: e.texto, valor: Math.round(e.usd), nota: `${e.n} ${e.n === 1 ? 'reserva' : 'reservas'}` }))} formato={usd} />
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
          </>
        )}
      </main>
    </div>
  );
}
