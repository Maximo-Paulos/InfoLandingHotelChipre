import { useEffect, useState } from 'react';
import BarraPersonal from '../BarraPersonal.jsx';
import { adminEstadisticas, adminHuespedes } from '../checkin/checkinApi.js';
import { fechaHora } from '../checkin/util.js';
import Icon from '../components/Icon.jsx';
import { useNoIndexar } from '../personal.js';
import { perfilGuardado } from '../sesion.js';
import { cargarCotizaciones } from './cotizaciones.js';
import { calcular, num, rangoAnterior, rangoDe, usd, variacion } from './estadisticas.js';
import { Cifra } from './graficos.jsx';
import { LoginAdmin, useSesionAdmin } from './sesionAdmin.jsx';

// Inicio del dueño: cómo va el día y el mes de un vistazo, el botón para abrir una reserva y los últimos check-ins.
// Lo demás (editar la guía, equipo, ajustes) está en «Más».
export default function AdminInicio() {
  useNoIndexar('Inicio');
  const sesion = useSesionAdmin();
  if (sesion.fase !== 'ok') return <LoginAdmin sesion={sesion} />;
  return <Contenido clave={sesion.clave} salir={sesion.salir} />;
}

const fechaLarga = () => new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
const primeroDelMesAnterior = (hoy) => {
  const [a, m] = hoy.split('-').map(Number);
  return m === 1 ? `${a - 1}-12-01` : `${a}-${String(m - 1).padStart(2, '0')}-01`;
};

function Contenido({ clave, salir }) {
  const [datos, setDatos] = useState(null);
  const [cotizaciones, setCotizaciones] = useState(undefined);
  const [ultimos, setUltimos] = useState(null);
  const alias = perfilGuardado()?.alias;

  useEffect(() => {
    let vivo = true;
    // Solo desde el mes pasado: alcanza para «hoy», «este mes» y compararlo con el mes anterior.
    adminEstadisticas(clave, primeroDelMesAnterior(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date()))).then((r) => { if (vivo && r.ok) setDatos(r); }).catch(() => {});
    cargarCotizaciones().then((c) => { if (vivo) setCotizaciones(c); }).catch(() => { if (vivo) setCotizaciones(null); });
    adminHuespedes(clave, '', 5).then((r) => { if (vivo && r.ok) setUltimos(r.huespedes); }).catch(() => {});
    return () => { vivo = false; };
  }, [clave]);

  let hoy = null;
  let mes = null;
  const sinHuespedes = (datos?.pendientes ?? []).filter((r) => !r.anulada_en).length; // reservas cargadas en las que todavía no entró nadie: no suman
  if (datos && cotizaciones !== undefined) {
    hoy = calcular(datos, cotizaciones ?? [], { desde: datos.hoy, hasta: datos.hoy }, null);
    const r = rangoDe('mes', datos.hoy);
    mes = calcular(datos, cotizaciones ?? [], r, rangoAnterior(r, 'mes'));
  }

  return (
    <div className="page personal">
      <BarraPersonal titulo="Inicio" actual="inicio" salir={salir} />
      <main className="card inicio">
        <header>
          <h1>Inicio</h1>
        </header>
        <p className="in-saludo">Hola{alias ? `, ${alias}` : ''}</p>
        <p className="in-fecha">{fechaLarga()}</p>

        <a className="btn in-accion" href="#/recepcion"><Icon name="llave" size={22} sw={1.8} /> Nueva reserva y código</a>

        <div className="in-fila"><h2 className="in-sub">Hoy</h2><a className="in-ver" href="#/admin/caja">Ver cobros y reservas <Icon name="adelante" size={16} sw={2} /></a></div>
        <div className="gr-cifras cinco in-cifras">
          <Cifra etiqueta="Habitaciones vendidas" valor={hoy ? num(hoy.actual.reservas) : '…'} />
          <Cifra etiqueta="Huéspedes" valor={hoy ? num(hoy.actual.huespedes) : '…'} />
        </div>

        {sinHuespedes > 0 && (
          <p className="in-aviso" role="note">
            <b>{sinHuespedes} {sinHuespedes === 1 ? 'reserva sin huéspedes' : 'reservas sin huéspedes'}.</b> No suman en las cifras hasta que entre alguien. Si eran pruebas, anulalas. <a href="#/admin/caja">Verlas</a>
          </p>
        )}

        <div className="in-fila"><h2 className="in-sub">Este mes</h2><a className="in-ver" href="#/admin/estadisticas">Ver estadísticas <Icon name="adelante" size={16} sw={2} /></a></div>
        <div className="gr-cifras cinco in-cifras">
          <Cifra etiqueta="Ingresos" valor={mes ? usd(mes.actual.ingresosUsd) : '…'} cambio={mes?.previo ? variacion(mes.actual.ingresosUsd, mes.previo.ingresosUsd) : null} />
          <Cifra etiqueta="Ticket promedio" valor={mes ? usd(mes.actual.tarifaUsd) : '…'} cambio={mes?.previo ? variacion(mes.actual.tarifaUsd, mes.previo.tarifaUsd) : null} />
          <Cifra etiqueta="Habitaciones" valor={mes ? num(mes.actual.reservas) : '…'} sub={mes?.actual.noches ? `${num(mes.actual.noches)} noches` : null} cambio={mes?.previo ? variacion(mes.actual.reservas, mes.previo.reservas) : null} />
          <Cifra etiqueta="Huéspedes" valor={mes ? num(mes.actual.huespedes) : '…'} cambio={mes?.previo ? variacion(mes.actual.huespedes, mes.previo.huespedes) : null} sub={mes?.sinReserva ? `${mes.sinReserva} de antes de las reservas` : null} />
        </div>

        <div className="in-fila"><h2 className="in-sub">Últimos check-ins</h2><a className="in-ver" href="#/admin/huespedes">Ver todos <Icon name="adelante" size={16} sw={2} /></a></div>
        {ultimos && !ultimos.length && <p className="ayuda">Todavía no hay check-ins.</p>}
        {ultimos?.length > 0 && (
          <ul className="in-ultimos">
            {ultimos.map((h) => (
              <li key={h.id}>
                <a href="#/admin/huespedes">
                  <span className="in-hab">{h.habitacion ? `Hab. ${h.habitacion}` : 'Sin asignar'}</span>
                  <span className="in-nom"><b>{h.datos?.apellido}, {h.datos?.nombre}</b><small>{fechaHora(h.creado)}{h.habilitado_por ? ` · ${h.habilitado_por}` : ''}</small></span>
                  <Icon name="adelante" size={18} sw={1.8} />
                </a>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
