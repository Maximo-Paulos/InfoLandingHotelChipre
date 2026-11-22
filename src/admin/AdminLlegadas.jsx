import { useCallback, useEffect, useState } from 'react';
import BarraPersonal from '../BarraPersonal.jsx';
import { adminAnotadaCancelar, adminAnotadaGuardar, adminAnotadas, adminCatalogos, textoCodigo } from '../checkin/checkinApi.js';
import AnotadaForm from '../checkin/AnotadaForm.jsx';
import { TarjetaLlegada, fechaCorta, ventaDeHoy } from '../checkin/Llegadas.jsx';
import Modal from '../checkin/Modal.jsx';
import { useNoIndexar } from '../personal.js';
import { cargarCotizaciones } from './cotizaciones.js';
import { LoginAdmin, useSesionAdmin } from './sesionAdmin.jsx';

// Reservas anotadas (solo el dueño): carga por adelantado las reservas de los próximos días con a nombre de quién, fecha de ingreso, habitación, cuántos son,
// los precios (efectivo, transferencia, dólares), la seña ya pagada y una nota. Recepción ve las llegadas de los próximos 3 días y hace el check-in cobrando
// lo que corresponde. Una reserva anotada todavía no es una estadía: no suma en ninguna estadística hasta que se hace el check-in. Cancelar no borra.
export default function AdminLlegadas() {
  useNoIndexar('Reservas anotadas');
  const sesion = useSesionAdmin();
  if (sesion.fase !== 'ok') return <LoginAdmin sesion={sesion} />;
  return <Contenido clave={sesion.clave} salir={sesion.salir} />;
}

function Contenido({ clave, salir }) {
  const [lista, setLista] = useState(null);
  const [catalogos, setCatalogos] = useState({ categorias: [], canales: [] });
  const [cotizaciones, setCotizaciones] = useState(undefined);
  const [editando, setEditando] = useState(null); // 'nueva' | una reserva anotada
  const [aviso, setAviso] = useState('');
  const [error, setError] = useState('');
  const [trabajando, setTrabajando] = useState(null);

  const cargar = useCallback(async () => {
    try {
      const r = await adminAnotadas(clave);
      if (!r.ok) {
        if (r.error === 'clave_incorrecta') { salir(); return; }
        setError(textoCodigo(r.error));
        return;
      }
      setLista(r.anotadas);
      setError('');
    } catch {
      setError('No se pudo conectar. Revisá tu conexión.');
    }
  }, [clave, salir]);

  useEffect(() => {
    let vivo = true;
    cargar();
    adminCatalogos(clave).then((r) => { if (vivo && r?.ok) setCatalogos({ categorias: r.categorias.filter((x) => x.activo), canales: r.canales.filter((x) => x.activo) }); }).catch(() => {});
    cargarCotizaciones().then((c) => { if (vivo) setCotizaciones(c); }).catch(() => { if (vivo) setCotizaciones(null); });
    return () => { vivo = false; };
  }, [clave, cargar]);

  const venta = ventaDeHoy(cotizaciones);

  const guardar = async (r) => {
    const res = await adminAnotadaGuardar(clave, editando === 'nueva' ? null : editando.id, r);
    if (!res.ok) return { ok: false, mensaje: textoCodigo(res.error), campos: res.campos };
    const pisan = res.superpuestas ?? [];
    setAviso(`${editando === 'nueva' ? 'Reserva anotada.' : 'Reserva guardada.'}${pisan.length ? ` Atención: la ${r.habitacion} ya tiene ${pisan.length === 1 ? 'otra reserva' : 'otras reservas'} que se pisa con estas fechas: ${pisan.map((x) => `${x.titular} (${fechaCorta(x.fecha_ingreso)} al ${fechaCorta(x.salida)})`).join(', ')}.` : ''}`);
    setEditando(null);
    cargar();
    return { ok: true };
  };
  const cancelar = async (a, cancelarla) => {
    if (cancelarla && !window.confirm(`¿Cancelar la reserva de ${a.titular} (hab. ${a.habitacion})? Deja de verse en recepción. No se borra: la podés restaurar.`)) return;
    setTrabajando(a.id);
    setAviso('');
    try {
      const r = await adminAnotadaCancelar(clave, a.id, cancelarla);
      if (r.ok) { setAviso(cancelarla ? 'Reserva cancelada. La podés restaurar desde «Canceladas».' : 'Reserva restaurada.'); cargar(); } else setError(textoCodigo(r.error));
    } catch {
      setError('No se pudo conectar. Revisá tu conexión.');
    } finally {
      setTrabajando(null);
    }
  };

  const por = (f) => (lista ?? []).filter(f);
  const proximas = por((a) => a.estado === 'anotada' && a.dias_para >= 0);
  const pasadas = por((a) => a.estado === 'anotada' && a.dias_para < 0);
  const enCurso = por((a) => a.estado === 'en_curso');
  const canceladas = por((a) => a.estado === 'cancelada');
  const botones = (a) => (
    <div className="btns ab-btns">
      <button type="button" className="btn mini claro" onClick={() => { setAviso(''); setEditando(a); }}>Editar</button>
      <button type="button" className="btn mini claro" onClick={() => cancelar(a, true)} disabled={trabajando === a.id}>Cancelar reserva</button>
    </div>
  );

  return (
    <div className="page personal">
      <BarraPersonal titulo="Reservas anotadas" actual="llegadas" salir={salir} />
      <main className="card inicio">
        <header>
          <h1>Reservas anotadas</h1>
          <p className="lead">Cargalas por adelantado: recepción las ve los 3 días antes y sabe cuánto cobrar.</p>
        </header>
        <button type="button" className="btn in-accion" onClick={() => { setAviso(''); setEditando('nueva'); }}>Anotar una reserva</button>
        {aviso && <p className={`${aviso.includes('Atención') ? 'in-aviso' : 'ed-ok'}`} role="status">{aviso}</p>}
        {error && <p className="ed-error" role="alert">{error}</p>}
        {!lista && !error && <p className="intro" role="status">Cargando…</p>}

        {lista && (
          <>
            <h2 className="in-sub">Por llegar ({proximas.length})</h2>
            {!proximas.length && <p className="ayuda">No hay reservas anotadas por llegar. Tocá «Anotar una reserva» para cargar la primera.</p>}
            <ul className="ll-lista">{proximas.map((a) => <TarjetaLlegada key={a.id} a={a} venta={venta}>{botones(a)}</TarjetaLlegada>)}</ul>

            {pasadas.length > 0 && (
              <>
                <h2 className="in-sub">Pasó la fecha y no hicieron el check-in ({pasadas.length})</h2>
                <p className="ayuda">Recepción las ve unos días más. Si no vinieron, cancelalas.</p>
                <ul className="ll-lista">{pasadas.map((a) => <TarjetaLlegada key={a.id} a={a} venta={venta}>{botones(a)}</TarjetaLlegada>)}</ul>
              </>
            )}

            {enCurso.length > 0 && (
              <details className="caja-anuladas">
                <summary>Con el check-in en curso o hecho ({enCurso.length})</summary>
                <ul className="ll-lista">{enCurso.map((a) => <TarjetaLlegada key={a.id} a={a} venta={venta} />)}</ul>
              </details>
            )}
            {canceladas.length > 0 && (
              <details className="caja-anuladas">
                <summary>Canceladas ({canceladas.length})</summary>
                <p className="ayuda">No se ven en recepción. Si cancelaste una por error, restaurala.</p>
                <ul className="ll-lista">
                  {canceladas.map((a) => (
                    <TarjetaLlegada key={a.id} a={a} venta={venta}>
                      <div className="btns ab-btns"><button type="button" className="btn mini claro" onClick={() => cancelar(a, false)} disabled={trabajando === a.id}>Restaurar</button></div>
                    </TarjetaLlegada>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </main>

      {editando && (
        <Modal titulo={editando === 'nueva' ? 'Anotar una reserva' : `Reserva de ${editando.titular}`} onCerrar={() => setEditando(null)}>
          <AnotadaForm inicial={editando === 'nueva' ? null : editando} canales={catalogos.canales} categorias={catalogos.categorias} cotizaciones={cotizaciones} onGuardar={guardar} alCancelar={() => setEditando(null)} />
        </Modal>
      )}
    </div>
  );
}
