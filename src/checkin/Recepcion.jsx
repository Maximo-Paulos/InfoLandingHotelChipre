import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../components/Icon.jsx';
import FotosHuesped from '../admin/FotosHuesped.jsx';
import BarraPersonal from '../BarraPersonal.jsx';
import { useNoIndexar } from '../personal.js';
import { cerrarSesion, entrarConClave, leerSesion } from '../sesion.js';
import { cargarCotizaciones } from '../admin/cotizaciones.js';
import { AvisosBanner } from '../components/Avisos.jsx';
import { adminAnotadaCancelar, adminCheckinManual, adminCheckinManualAnotada, adminCheckinManualEditar, adminEstadiaReabrir, adminRepetidaDescartar, adminReservaAnular, adminReservasUnificar, recepcionAnotadaGuardar, recepcionCodigoNuevo, recepcionEditar, recepcionEstadiaCerrar, recepcionEstadiaEditar, recepcionEstado, recepcionLlegadaIniciar, recepcionReservaAbrir, recepcionReservaCerrar, recepcionReservaNueva, textoCodigo } from './checkinApi.js';
import AnotadaForm from './AnotadaForm.jsx';
import CheckinManual from './CheckinManual.jsx';
import CobroLlegada from './CobroLlegada.jsx';
import EditarHuesped from './EditarHuesped.jsx';
import { ventaDeHoy } from './Llegadas.jsx';
import Modal from './Modal.jsx';
import Planilla from './Planilla.jsx';
import ReservaForm, { cobroLinea, detalleTexto, hoyAR, huespedesTexto } from './ReservaForm.jsx';
import { paraUnir } from './hub.js';
import Unificar from './Unificar.jsx';
import Reservas from './Reservas.jsx';
import { agruparCodigo, minSeg, useAhora } from './util.js';

const CADA_MS = 3000;

// Pantalla de recepción: ingreso con la clave propia de cada persona (o la del dueño, desde su panel). Tiene dos pestañas de abajo: «Reservas» y «Huéspedes» (la planilla de los últimos días).
// «Reservas» es todo lo de las reservas en un solo lugar (ver Reservas.jsx): un cartel de qué falta llegar, crear una reserva (anotada a nombre de alguien o rápida, sin nombre) y las
// pestañas de arriba (Faltan llegar · Falta cerrar · Cerradas · Próximas · Historial). El código para el huésped no es una pestaña: aparece arriba, apenas se crea o se le da código a una
// reserva (es de quien está en sesión). Al tocar una reserva que falta llegar se ve la habitación y cuánto hay que cobrar, se confirma el cobro y recién ahí se hace el check-in (ver CobroLlegada).
// Recepción también anota reservas (por ejemplo, al que llega de la calle sin reserva) y corrige las llegadas que ve; cancelar es solo del dueño, por eso acá no hay ningún botón de cancelar una llegada.
// Cerrar una reserva a la que vino menos gente de la esperada puede recepción; reabrirla, solo el dueño.
// La sesión queda abierta en el dispositivo (ver sesion.js).
export default function Recepcion({ vista = 'reservas' }) {
  useNoIndexar('Recepción');
  const [sesion, setSesion] = useState(leerSesion); // { token, rol } o null
  const salir = useCallback(() => { cerrarSesion(); setSesion(null); }, []);
  if (!sesion) return <Ingreso alEntrar={setSesion} />;
  return <Panel clave={sesion.token} rol={sesion.rol} vista={vista} salir={salir} />;
}

function Ingreso({ alEntrar }) {
  const [error, setError] = useState('');
  const [entrando, setEntrando] = useState(false);
  const entrar = async (e) => {
    e.preventDefault();
    const k = e.currentTarget.elements.clave.value;
    setEntrando(true);
    setError('');
    try {
      alEntrar(await entrarConClave(k));
    } catch (err) {
      setError(err.codigo ? textoCodigo(err.codigo) : 'No se pudo conectar. Revisá tu conexión.');
    } finally {
      setEntrando(false);
    }
  };
  return (
    <div className="page">
      <main className="card login">
        <h1>Recepción</h1>
        <form onSubmit={entrar}>
          <p className="lead">Ingresá la clave de recepción para ver el código y los huéspedes.</p>
          <label className="caja">
            <span>Clave</span>
            <input name="clave" type="password" autoComplete="current-password" autoFocus required />
          </label>
          {error && <p className="ed-error" role="alert">{error}</p>}
          <div className="btns"><button type="submit" className="btn" disabled={entrando}>{entrando ? 'Entrando…' : 'Entrar'}</button></div>
        </form>
      </main>
    </div>
  );
}

function Panel({ clave, rol, vista, salir }) {
  const [estado, setEstado] = useState(null); // la última respuesta + { recibido }
  const [error, setError] = useState('');
  const [editando, setEditando] = useState(null);
  const [nuevo, setNuevo] = useState(false);
  const [rapida, setRapida] = useState(false); // la ventana de «Reserva rápida (sin nombre)»
  const [trabajando, setTrabajando] = useState(null); // la reserva de la lista a la que se le está dando código o que se está anulando
  const [editandoReserva, setEditandoReserva] = useState(null);
  const [anotando, setAnotando] = useState(null); // 'nueva' o la llegada que se está corrigiendo: el formulario de reserva anotada
  const [aviso, setAviso] = useState(''); // lo que pasó al anotar (por ejemplo, que se pisa con otra reserva de la misma habitación)
  const [unificando, setUnificando] = useState(null); // la pareja de reservas repetidas que el dueño está por unificar
  const [haciendoCheckin, setHaciendoCheckin] = useState(null); // la llegada anotada a la que se le está haciendo el check-in (se elige cómo paga)
  const [cotizaciones, setCotizaciones] = useState(null); // el dólar oficial, para decir cuánto cobrar en dólares (solo se pide si hay llegadas)
  const [cargandoMano, setCargandoMano] = useState(null); // la reserva a la que el dueño le carga el check-in a mano (con los datos que tenga)
  const [editandoMano, setEditandoMano] = useState(null); // un huésped cargado a mano al que el dueño le completa los datos
  const [fotos, setFotos] = useState(null);
  const [version, setVersion] = useState(0); // sube cuando algo cambia (se anotó, se hizo un check-in): la lista de próximas reservas se vuelve a pedir
  const ahora = useAhora(250);
  const reloj = useRef(null);
  const ultimoVencido = useRef(0);
  const duplicadaAvisada = useRef(''); // la habitación por la que ya se avisó «ya hay una reserva anotada»: a la segunda vez se crea igual

  const refrescar = useCallback(async () => {
    try {
      const r = await recepcionEstado(clave);
      if (!r.ok) {
        if (r.error === 'clave_incorrecta') { salir(); return; }
        setError(textoCodigo(r.error));
        return;
      }
      setEstado({ ...r, recibido: Date.now() });
      setError('');
      return r;
    } catch {
      setError('Sin conexión. Reintentando…');
    }
    return null;
  }, [clave, salir]);

  // Consulta cada pocos segundos mientras la pantalla se ve; al volver a la pestaña consulta enseguida.
  useEffect(() => {
    let vivo = true;
    const vuelta = async () => {
      if (document.visibilityState !== 'hidden') await refrescar();
      if (vivo) reloj.current = setTimeout(vuelta, CADA_MS);
    };
    vuelta();
    const alVolver = () => { if (document.visibilityState === 'visible') { clearTimeout(reloj.current); vuelta(); } };
    document.addEventListener('visibilitychange', alVolver);
    return () => { vivo = false; clearTimeout(reloj.current); document.removeEventListener('visibilitychange', alVolver); };
  }, [refrescar]);

  const restanteCodigo = estado?.codigo ? Math.max(0, estado.codigo.vence_seg - (ahora - estado.recibido) / 1000) : 0;
  const duracion = estado?.config?.codigo_seg ?? 15;

  // Cuando el código se termina de contar, pide otro enseguida (sin esperar al próximo ciclo).
  useEffect(() => {
    if (estado?.activo && estado.codigo && restanteCodigo <= 0 && ultimoVencido.current !== estado.recibido) {
      ultimoVencido.current = estado.recibido;
      refrescar();
    }
  }, [estado, restanteCodigo, refrescar]);

  const codigoNuevo = async () => {
    setNuevo(true);
    try {
      const r = await recepcionCodigoNuevo(clave);
      if (r.ok) await refrescar(); else setError(textoCodigo(r.error));
    } catch {
      setError('No se pudo conectar. Revisá tu conexión.');
    } finally {
      setNuevo(false);
    }
  };

  // Cuando la reserva se termina de contar, se vuelve a consultar: el código desaparece y vuelve el formulario.
  const restanteReserva = estado?.reserva ? Math.max(0, estado.reserva.vence_seg - (ahora - estado.recibido) / 1000) : 0;
  const reservaVencida = useRef(0);
  useEffect(() => {
    if (estado?.reserva && restanteReserva <= 0 && reservaVencida.current !== estado.recibido) {
      reservaVencida.current = estado.recibido;
      refrescar();
    }
  }, [estado, restanteReserva, refrescar]);

  // Antes de abrir una reserva nueva (rápida, o anotada a nombre de alguien) se mira si esa habitación ya tiene una reserva anotada esperando: puede ser la misma persona y quedaría duplicada.
  // Se avisa una vez; si es otra persona, a la segunda vez se crea igual.
  const avisoDuplicada = (habitacion) => {
    const h = String(habitacion ?? '').trim().toLowerCase();
    if (!h || duplicadaAvisada.current === h) return null;
    const a = (estado?.llegadas ?? []).find((x) => String(x.habitacion).trim().toLowerCase() === h && x.estado === 'anotada');
    if (a) {
      duplicadaAvisada.current = h;
      return `La Hab. ${habitacion} ya tiene una reserva anotada${a.numero != null ? ` (N.º ${a.numero})` : ''} a nombre de ${a.titular}${a.dias_para === 0 ? ' (llega hoy)' : a.dias_para < 0 ? ' (todavía no llegó)' : ''}. Si es esa persona, cerrá esta ventana y hacé el check-in desde «Faltan llegar»: así no queda duplicada. Si es otra persona, tocá de nuevo el botón.`;
    }
    // Lo mismo si esa habitación ya tiene una reserva abierta (a la que todavía le faltan huéspedes): para sumar a otro huésped se le da el código a esa reserva, no se abre otra.
    const e = (estado?.reservas_abiertas ?? []).map((x) => x.estadia).find((x) => x && !x.anulada && String(x.habitacion).trim().toLowerCase() === h);
    if (!e) return null;
    duplicadaAvisada.current = h;
    return `La Hab. ${habitacion} ya tiene una reserva abierta${e.numero != null ? ` (N.º ${e.numero})` : ''}${e.titular ? ` a nombre de ${e.titular}` : ''} con ${e.con_checkin} de ${e.esperados} ${e.esperados === 1 ? 'huésped ingresado' : 'huéspedes ingresados'}. Si es la misma, no abras otra: dale el código a esa reserva desde «Falta cerrar» o «Faltan llegar». Si es otra persona, tocá de nuevo el botón.`;
  };

  // Anota una reserva (o corrige una llegada). Si es nueva y llega hoy (el que vino de la calle), se sigue directo con el check-in: elegir cómo paga y generar el código.
  const guardarAnotada = async (r) => {
    const nueva = anotando === 'nueva';
    if (nueva) { const dup = avisoDuplicada(r.habitacion); if (dup) return { ok: false, mensaje: dup }; }
    const res = await recepcionAnotadaGuardar(clave, nueva ? null : anotando.id, r);
    if (!res.ok) {
      if (['anotada_ya_empezo', 'anotada_cancelada', 'llegada_fuera_de_fecha', 'no_existe'].includes(res.error)) { setAnotando(null); setError(textoCodigo(res.error)); setVersion((v) => v + 1); await refrescar(); }
      return { ok: false, mensaje: textoCodigo(res.error), campos: res.campos };
    }
    setVersion((v) => v + 1);
    const pisan = res.superpuestas ?? [];
    setAnotando(null);
    setError('');
    setAviso(`${nueva ? 'Reserva anotada.' : 'Reserva guardada.'}${pisan.length ? ` Atención: la ${r.habitacion} ya tiene ${pisan.length === 1 ? 'otra reserva' : 'otras reservas'} que se pisa con estas fechas: ${pisan.map((x) => `${x.titular} (${x.fecha_ingreso.split('-').reverse().slice(0, 2).join('/')} al ${x.salida.split('-').reverse().slice(0, 2).join('/')})`).join(', ')}.` : ''}`);
    const nuevo = await refrescar();
    if (nueva && r.ingreso === hoyAR()) {
      const llegada = nuevo?.llegadas?.find((x) => x.id === res.id);
      if (llegada) setHaciendoCheckin(llegada);
    }
    return { ok: true };
  };

  // Hace el check-in de una llegada anotada con el cobro elegido: arma la reserva y deja el código a la vista.
  const iniciarLlegada = async (r) => {
    const res = await recepcionLlegadaIniciar(clave, haciendoCheckin.id, r);
    if (!res.ok) {
      if (['anotada_ya_empezo', 'anotada_cancelada', 'llegada_fuera_de_fecha', 'no_existe'].includes(res.error)) { setHaciendoCheckin(null); setError(textoCodigo(res.error)); setVersion((v) => v + 1); await refrescar(); }
      return { ok: false, mensaje: textoCodigo(res.error), campos: res.campos };
    }
    setHaciendoCheckin(null);
    setError('');
    setAviso('');
    setVersion((v) => v + 1);
    await refrescar();
    window.scrollTo({ top: 0 }); // con el check-in hecho, el código para el huésped aparece arriba
    return { ok: true };
  };
  const abrirReserva = async (r) => {
    const dup = avisoDuplicada(r.habitacion);
    if (dup) return { ok: false, mensaje: dup };
    const res = await recepcionReservaNueva(clave, r);
    if (!res.ok) return { ok: false, mensaje: textoCodigo(res.error), campos: res.campos };
    setRapida(false);
    setVersion((v) => v + 1);
    await refrescar();
    window.scrollTo({ top: 0 }); // el código para el huésped aparece arriba
    return { ok: true };
  };
  const cerrarReserva = async (extender) => {
    try {
      const r = await recepcionReservaCerrar(clave, extender);
      if (r.ok) await refrescar(); else setError(textoCodigo(r.error));
    } catch {
      setError('No se pudo conectar. Revisá tu conexión.');
    }
  };
  // Le vuelve a dar código a una reserva abierta de la lista (por ejemplo, para el huésped que llegó más tarde).
  const darCodigo = async (id) => {
    setTrabajando(id);
    try {
      const r = await recepcionReservaAbrir(clave, id);
      setError(r.ok ? '' : textoCodigo(r.error));
      setVersion((v) => v + 1);
      await refrescar();
      if (r.ok) window.scrollTo({ top: 0 }); // con el código dado, el código para el huésped aparece arriba
    } catch {
      setError('No se pudo conectar. Revisá tu conexión.');
    } finally {
      setTrabajando(null);
    }
  };
  // Solo el dueño: unifica dos reservas que son la misma cargada dos veces (la ventana «Unificar» le muestra las dos y le dice qué va a pasar). Nada se borra.
  const unificarPar = async (par, conservar) => {
    const res = await adminReservasUnificar(clave, par.a.clave, par.b.clave, conservar);
    if (!res.ok) {
      if (['no_existe', 'anotada_ya_empezo', 'anotada_cancelada', 'reserva_anulada', 'estadia_ya_unida'].includes(res.error)) { setUnificando(null); setError(textoCodigo(res.error)); setVersion((v) => v + 1); await refrescar(); }
      return { ok: false, mensaje: textoCodigo(res.error) };
    }
    setUnificando(null);
    setHaciendoCheckin(null);
    setError('');
    setAviso(`Listo: las dos reservas quedaron unificadas en la ${res.numero != null ? `N.º ${res.numero}` : 'reserva elegida'}. La otra está en «Eliminadas», por si hay que restaurarla.`);
    setVersion((v) => v + 1);
    await refrescar();
    return { ok: true };
  };
  // El dueño dice «no son la misma»: esa sugerencia no se vuelve a mostrar.
  const descartarPar = async (par) => {
    if (!window.confirm(`¿Marcar que la ${par.a.numero != null ? `N.º ${par.a.numero}` : 'primera'} y la ${par.b.numero != null ? `N.º ${par.b.numero}` : 'segunda'} NO son la misma reserva? Dejan de sugerirse como repetidas.`)) return;
    setTrabajando(par.id);
    try {
      const res = await adminRepetidaDescartar(clave, par.a.clave, par.b.clave);
      setError(res.ok ? '' : textoCodigo(res.error));
      if (res.ok) { setUnificando(null); setAviso('Listo: no se vuelven a sugerir esas dos como repetidas.'); }
      setVersion((v) => v + 1);
      await refrescar();
    } catch {
      setError('No se pudo conectar. Revisá tu conexión.');
    } finally {
      setTrabajando(null);
    }
  };
  // Cierra a mano una reserva a la que vino menos gente de la esperada («al final no viene el otro»): deja de esperar a los que faltan y el código deja de servir.
  const cerrarEstadia = async (est) => {
    if (!window.confirm(`¿Cerrar la reserva de la habitación ${est.habitacion}? Ya no se espera a los huéspedes que faltan y el código deja de servir. Después solo el dueño la puede reabrir.`)) return;
    setTrabajando(est.id);
    try {
      const r = await recepcionEstadiaCerrar(clave, est.id);
      setError(r.ok ? '' : textoCodigo(r.error));
      setVersion((v) => v + 1);
      await refrescar();
    } catch {
      setError('No se pudo conectar. Revisá tu conexión.');
    } finally {
      setTrabajando(null);
    }
  };
  // Solo el dueño: una reserva cerrada a mano vuelve a esperar a los que faltan.
  const reabrirEstadia = async (est) => {
    if (!window.confirm(`¿Reabrir la reserva de la habitación ${est.habitacion}? Vuelve a esperar a los huéspedes que faltan.`)) return;
    setTrabajando(est.id);
    try {
      const r = await adminEstadiaReabrir(clave, est.id);
      setError(r.ok ? '' : textoCodigo(r.error));
      setVersion((v) => v + 1);
      await refrescar();
    } catch {
      setError('No se pudo conectar. Revisá tu conexión.');
    } finally {
      setTrabajando(null);
    }
  };
  // Solo el dueño: elimina una reserva (por ejemplo la que quedó repetida). No se borra nada: va a «Eliminadas» y se puede restaurar. Con huéspedes ingresados, ellos se sacan con la reserva.
  const eliminarReserva = async (x) => {
    const num = x.numero != null ? ` N.º ${x.numero}` : '';
    const de = x.titular ? ` de ${x.titular}` : '';
    const con = Number(x.con_checkin) || 0;
    const texto = x.tipo === 'anotada'
      ? `¿Eliminar la reserva${num}${de} (Hab. ${x.habitacion})? Todavía no llegó. No se borra: queda en «Eliminadas» y la podés restaurar.`
      : `¿Eliminar la reserva${num}${de} (Hab. ${x.habitacion})?${con > 0 ? ` Tiene ${con} ${con === 1 ? 'huésped ingresado' : 'huéspedes ingresados'}: también se sacan de la lista de Huéspedes y de las estadísticas.` : ''} No se borra: queda en «Eliminadas» y la podés restaurar.`;
    if (!window.confirm(texto)) return;
    setTrabajando(x.tipo === 'anotada' ? `a${x.id}` : x.id);
    try {
      const r = x.tipo === 'anotada' ? await adminAnotadaCancelar(clave, x.id, true) : await adminReservaAnular(clave, x.id, true);
      setError(r.ok ? '' : textoCodigo(r.error));
      if (r.ok) setAviso(`Listo: se eliminó la reserva${num}. La podés restaurar desde la pestaña «Eliminadas».`);
      setVersion((v) => v + 1);
      await refrescar();
    } catch {
      setError('No se pudo conectar. Revisá tu conexión.');
    } finally {
      setTrabajando(null);
    }
  };
  const restaurarReserva = async (x) => {
    const num = x.numero != null ? ` N.º ${x.numero}` : '';
    if (!window.confirm(`¿Restaurar la reserva${num}${x.titular ? ` de ${x.titular}` : ''} (Hab. ${x.habitacion})? Vuelve a las listas${x.huespedes > 0 ? ` con sus ${x.huespedes} ${x.huespedes === 1 ? 'huésped' : 'huéspedes'}` : ''}.`)) return;
    setTrabajando(x.tipo === 'anotada' ? `a${x.id}` : x.id);
    try {
      const r = x.tipo === 'anotada' ? await adminAnotadaCancelar(clave, x.id, false) : await adminReservaAnular(clave, x.id, false);
      setError(r.ok ? '' : textoCodigo(r.error));
      if (r.ok) setAviso(`Listo: la reserva${num} volvió a las listas.`);
      setVersion((v) => v + 1);
      await refrescar();
    } catch {
      setError('No se pudo conectar. Revisá tu conexión.');
    } finally {
      setTrabajando(null);
    }
  };
  // Solo el dueño: carga a mano el check-in de una reserva (anotada que todavía no tiene check-in, o armada a la que le faltan huéspedes) con los datos que haya: ninguno es obligatorio.
  // Los huéspedes quedan marcados «a mano», cuentan como el check-in de la reserva y entran en las estadísticas. Si algún dato está mal no se guarda ninguno.
  const guardarManual = async (huespedes, cobro) => {
    const x = cargandoMano;
    const res = x.tipo === 'anotada' ? await adminCheckinManualAnotada(clave, x.id, huespedes, cobro) : await adminCheckinManual(clave, x.id, huespedes);
    if (!res.ok) {
      if (['no_existe', 'anotada_ya_empezo', 'anotada_cancelada', 'reserva_anulada'].includes(res.error)) { setCargandoMano(null); setError(textoCodigo(res.error)); setVersion((v) => v + 1); await refrescar(); }
      return { ok: false, mensaje: textoCodigo(res.error), indice: res.indice, campos: res.campos };
    }
    setCargandoMano(null);
    setError('');
    setAviso(`Listo: se cargó el check-in a mano${res.numero != null ? ` de la reserva N.º ${res.numero}` : ''} (${huespedes.length} ${huespedes.length === 1 ? 'huésped' : 'huéspedes'}). Queda marcado «a mano» con tu nombre. Para completar datos después, andá a «Huéspedes» del panel.`);
    setVersion((v) => v + 1);
    await refrescar();
    return { ok: true };
  };
  const guardarManualEditar = async (datos) => {
    const res = await adminCheckinManualEditar(clave, editandoMano.id, datos);
    if (!res.ok) return { ok: false, mensaje: textoCodigo(res.error), campos: res.campos };
    setEditandoMano(null);
    await refrescar();
    return { ok: true };
  };
  const guardarReserva = async (r) => {
    const res = await recepcionEstadiaEditar(clave, editandoReserva.id, r);
    if (!res.ok) return { ok: false, mensaje: textoCodigo(res.error), campos: res.campos };
    setEditandoReserva(null);
    await refrescar();
    return { ok: true };
  };

  const segundosEdicion = (f) => (estado?.config?.edicion_activa ? Math.max(0, f.editable_seg - (ahora - estado.recibido) / 1000) : 0);
  // Un check-in cargado a mano por el dueño lo corrige solo el dueño (sin límite de tiempo); para recepción queda cerrado.
  const restanteDe = (f) => (f.origen === 'manual' ? (rol === 'admin' ? null : 0) : segundosEdicion(f));

  const guardar = async (datos, habitacion, medioPago) => {
    const r = await recepcionEditar(clave, editando.id, datos, habitacion, medioPago);
    if (r.ok) return { ok: true };
    return { ok: false, mensaje: textoCodigo(r.error), campos: r.campos };
  };

  const activo = estado?.activo;
  const huespedes = estado?.huespedes ?? [];
  const venta = ventaDeHoy(cotizaciones);
  const pideDolar = !!anotando || vista === 'reservas' || !!haciendoCheckin;
  useEffect(() => {
    if (!pideDolar) return undefined;
    let vivo = true;
    cargarCotizaciones().then((c) => { if (vivo) setCotizaciones(c); }).catch(() => { /* sin dólar oficial: se avisa en cada llegada */ });
    return () => { vivo = false; };
  }, [pideDolar]);
  const segundosReserva = (e) => (e.editable_seg == null ? Infinity : Math.max(0, e.editable_seg - (ahora - estado.recibido) / 1000));
  const pct = Math.max(0, Math.min(100, (restanteCodigo / duracion) * 100));

  return (
    <div className="page personal">
      <BarraPersonal titulo={vista === 'reservas' ? 'Reservas' : 'Huéspedes'} actual={vista === 'reservas' ? 'reservas' : rol === 'admin' ? 'huespedes' : 'huespedesRec'} salir={salir} ancha={vista === 'huespedes'} />
      <main className={`card${vista === 'huespedes' ? ' ancha' : ''}`}>
        <header>
          <p className="eyebrow">Recepción</p>
          <h1>{vista === 'reservas' ? 'Reservas' : 'Huéspedes cargados'}</h1>
        </header>

        {!estado && !error && <p className="intro" role="status">Cargando…</p>}
        {error && <p className="ed-error" role="alert">{error}</p>}
        {aviso && vista !== 'huespedes' && <p className={aviso.includes('Atención') ? 'in-aviso' : 'ed-ok'} role="status">{aviso}</p>}
        {vista === 'reservas' && <AvisosBanner />}

        {estado && vista === 'reservas' && (
          <>
            {activo && estado.reserva && (
              <section className="codigo-panel" aria-label="Código para el huésped">
              <p className="reserva-cab"><b>Hab. {estado.reserva.estadia.habitacion}</b>{estado.reserva.estadia.numero != null && <> · <b>N.º {estado.reserva.estadia.numero}</b></>} · {detalleTexto(estado.reserva.estadia)}<br />{cobroLinea(estado.reserva.estadia)}</p>
              {estado.reserva.estadia.nota && <p className="reserva-nota"><b>Nota:</b> {estado.reserva.estadia.nota}</p>}
              <p className="reserva-prog">
                <b>{huespedesTexto(estado.reserva.estadia, estado.reserva.huespedes.length)}</b> {estado.reserva.huespedes.length < estado.reserva.estadia.esperados ? `· faltan ${estado.reserva.estadia.esperados - estado.reserva.huespedes.length}` : ''}
              </p>
              <p className="etq">Dáselo al próximo huésped de esta habitación</p>
              {restanteCodigo > 0
                ? <p className="codigo-grande" aria-label={`Código ${estado.codigo.valor.split('').join(' ')}`}>{agruparCodigo(estado.codigo.valor)}</p>
                : <p className="codigo-grande generando" role="status">Generando…</p>}
              <div className="barra" role="progressbar" aria-valuemin={0} aria-valuemax={duracion} aria-valuenow={Math.ceil(restanteCodigo)} aria-label="Tiempo que le queda al código">
                <span style={{ width: `${pct}%` }} />
              </div>
              <p className="codigo-meta">
                Cambia en {Math.ceil(restanteCodigo)} s · Usado {estado.codigo.usos} de {estado.codigo.usos_max}
              </p>
              <p className="codigo-meta">El código se apaga en {minSeg(restanteReserva)}. La reserva sigue abierta hasta que entren todos: si falta alguien, la encontrás en «Falta cerrar».</p>
              {estado.reserva.huespedes.length > 0 && (
                <>
                  <p className="etq">Ya hicieron el check-in ({estado.reserva.huespedes.length})</p>
                  <ul className="reserva-lista">{estado.reserva.huespedes.map((h) => <li key={h.id}>{h.nombre} {h.apellido}</li>)}</ul>
                </>
              )}
              <div className="btns reserva-btns">
                <button type="button" className="btn mini claro" onClick={codigoNuevo} disabled={nuevo}><Icon name="refrescar" size={18} sw={1.8} /> {nuevo ? 'Generando…' : 'Código nuevo ahora'}</button>
                <button type="button" className="btn mini claro" onClick={() => cerrarReserva(true)}>Dar {estado.config.reserva_min} min más</button>
                {segundosReserva(estado.reserva.estadia) > 0 && <button type="button" className="btn mini claro" onClick={() => setEditandoReserva(estado.reserva.estadia)}>Corregir reserva</button>}
                <button type="button" className="btn mini claro" onClick={() => cerrarReserva(false)}>Ocultar el código</button>
                {estado.reserva.huespedes.length > 0 && estado.reserva.huespedes.length < estado.reserva.estadia.esperados && <button type="button" className="btn mini claro" onClick={() => cerrarEstadia(estado.reserva.estadia)} disabled={trabajando === estado.reserva.estadia.id}>Cerrar reserva</button>}
                {rol === 'admin' && <button type="button" className="btn mini claro" onClick={() => eliminarReserva({ tipo: 'estadia', ...estado.reserva.estadia, con_checkin: estado.reserva.huespedes.length })} disabled={trabajando === estado.reserva.estadia.id}>Eliminar reserva</button>}
                <button type="button" className="btn mini" onClick={() => setRapida(true)}>Otra reserva rápida</button>
              </div>
              {segundosReserva(estado.reserva.estadia) <= 0 && <p className="codigo-quien">Para corregir esta reserva, avisale al dueño.</p>}
              {estado.quien && <p className="codigo-quien">Es tu código: los check-ins que se hagan con él quedan a nombre de <b>{estado.quien}</b>.</p>}
              </section>
            )}
            <Reservas clave={clave} version={version} salir={salir} dueno={rol === 'admin'} apagado={!activo} trabajando={trabajando}
              onAbrir={(a) => { setAviso(''); setHaciendoCheckin(a); }} onAnotar={() => { setAviso(''); duplicadaAvisada.current = ''; setAnotando('nueva'); }} onRapida={() => { setAviso(''); duplicadaAvisada.current = ''; setRapida(true); }}
              onDarCodigo={darCodigo} onCerrar={cerrarEstadia} onReabrir={reabrirEstadia} onEliminar={eliminarReserva} onRestaurar={restaurarReserva} onUnificar={setUnificando} onDescartar={descartarPar}
              onCheckinMano={(x) => { setAviso(''); setCargandoMano(x); }} />
          </>
        )}

        {estado && vista === 'huespedes' && (
          <>
            <div className="head-row">
              <span className="muted">Últimos {estado.config.dias} {estado.config.dias === 1 ? 'día' : 'días'}</span>
            </div>
            <p className="aclara">
              {estado.config.edicion_activa
                ? `Podés corregir los datos y la reserva durante ${estado.config.edicion_min} minutos desde que el huésped envía el formulario.`
                : 'Por ahora recepción no puede editar los datos. Si hay que corregir algo, avisale al administrador.'}
            </p>
            <Planilla filas={huespedes} restante={estado.config.edicion_activa ? restanteDe : (f) => (f.origen === 'manual' && rol === 'admin' ? null : 0)} onEditar={(f) => (f.origen === 'manual' ? setEditandoMano(f) : setEditando({ ...f, venceEn: estado.recibido + f.editable_seg * 1000 }))} onEditarReserva={(e) => setEditandoReserva(e)} reservaEditable={(e) => (estado.config.edicion_activa ? Math.max(0, e.editable_seg - (ahora - estado.recibido) / 1000) : 0) > 0} onFotos={setFotos} vacio="Todavía no hay huéspedes cargados en estos días." />
          </>
        )}
      </main>

      {rapida && (
        <Modal titulo="Reserva rápida (sin nombre)" onCerrar={() => setRapida(false)}>
          <p className="aclara">Cargá la habitación, las noches, los huéspedes y lo que se cobró. Recién ahí aparece el código. Los huéspedes entran de a uno y la reserva queda abierta hasta que estén todos.</p>
          <ReservaForm medios={estado?.medios_pago ?? []} canales={estado?.canales ?? []} categorias={estado?.categorias ?? []} onGuardar={abrirReserva} texto="Generar códigos" alCancelar={() => setRapida(false)} />
        </Modal>
      )}

      {anotando && (
        <Modal titulo={anotando === 'nueva' ? 'Anotar una reserva' : `Reserva de ${anotando.titular}`} onCerrar={() => setAnotando(null)}>
          <AnotadaForm inicial={anotando === 'nueva' ? null : anotando} ingresoInicial={hoyAR()} canales={estado?.canales ?? []} categorias={estado?.categorias ?? []} cotizaciones={cotizaciones} onGuardar={guardarAnotada} alCancelar={() => setAnotando(null)} />
        </Modal>
      )}

      {haciendoCheckin && (
        <CobroLlegada a={haciendoCheckin} venta={venta} medios={estado?.medios_pago ?? []} apagado={estado?.activo === false} dueno={rol === 'admin'}
          onIniciar={iniciarLlegada} onEditar={(a) => { setHaciendoCheckin(null); setAviso(''); setAnotando(a); }} onUnir={(a, e) => { setHaciendoCheckin(null); setUnificando(paraUnir(a, e)); return { ok: true }; }} onCerrar={() => setHaciendoCheckin(null)} />
      )}

      {cargandoMano && rol === 'admin' && (
        <CheckinManual reserva={cargandoMano} medios={estado?.medios_pago ?? []} onGuardar={guardarManual} onCerrar={() => setCargandoMano(null)} />
      )}

      {unificando && rol === 'admin' && (
        <Unificar par={unificando} onUnificar={unificarPar} onDescartar={descartarPar} onCerrar={() => setUnificando(null)} />
      )}

      {editandoMano && rol === 'admin' && <CheckinManual huesped={editandoMano} onGuardar={guardarManualEditar} onCerrar={() => setEditandoMano(null)} />}

      {fotos && <FotosHuesped modo="recepcion" clave={clave} fila={fotos} onCerrar={() => setFotos(null)} alCambiar={refrescar} />}

      {editandoReserva && (
        <Modal titulo={`Corregir la reserva de la ${editandoReserva.habitacion}`} onCerrar={() => setEditandoReserva(null)}>
          <ReservaForm inicial={editandoReserva} medios={estado?.medios_pago ?? []} canales={estado?.canales ?? []} categorias={estado?.categorias ?? []} onGuardar={guardarReserva} texto="Guardar cambios" alCancelar={() => setEditandoReserva(null)} />
        </Modal>
      )}

      {editando && (
        <EditarHuesped
          fila={editando}
          venceEn={editando.venceEn}
          medios={estado?.medios_pago ?? null}
          onGuardar={guardar}
          onCerrar={(guardado) => { setEditando(null); if (guardado) refrescar(); }}
        />
      )}
    </div>
  );
}
