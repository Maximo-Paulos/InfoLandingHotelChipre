import { useEffect, useMemo, useState } from 'react';
import Modal from '../checkin/Modal.jsx';
import { adminCatalogos, adminEstadiaEditar, adminMediosPago, adminReservaAnular, recepcionReservaAbrir, textoCodigo } from '../checkin/checkinApi.js';
import ReservaForm, { cobroLinea, detalleTexto, huespedesTexto, plata } from '../checkin/ReservaForm.jsx';
import Icon from '../components/Icon.jsx';
import { numeroTexto } from '../checkin/proximas.js';
import { caja } from './estadisticas.js';

const POR_VEZ = 40;
const NOMBRE_MONEDA = { ARS: 'Pesos', USD: 'Dólares' };
const diaTexto = (iso) => new Intl.DateTimeFormat('es-AR', { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));
const ddmm = (iso) => iso.split('-').reverse().slice(0, 2).join('/');

// La caja del período: las reservas que ya tienen huéspedes, cada una con su fecha, habitación, lo que se cobró (total, seña y lo pagado en el
// hotel) y quién la cargó. Arriba, los totales por moneda y por medio de pago para hacer la caja. Tocar una reserva la abre para corregirla.
// Las reservas que todavía no tienen NINGÚN huésped (en espera, o pruebas) NO suman: se muestran aparte, en «Sin huéspedes todavía», donde el
// dueño las puede corregir o anular, y las anuladas se pueden restaurar. Nada se borra.
// Las que todavía esperan huéspedes tienen «Dar código»: es la forma de que el dueño le dé código a una reserva que recepción ya no ve (pasaron los 3 días).
//   datos: lo que devuelve admin_estadisticas · rango: { desde, hasta } · alGuardar(): se llama después de corregir una reserva (para volver a pedir los datos)
export default function Caja({ datos, rango, clave, alGuardar }) {
  const c = useMemo(() => caja(datos, rango), [datos, rango]);
  const [visibles, setVisibles] = useState(POR_VEZ);
  const [editando, setEditando] = useState(null);
  const [medios, setMedios] = useState([]);
  const [catalogos, setCatalogos] = useState({ canales: [], categorias: [] });
  const [error, setError] = useState('');
  const [trabajando, setTrabajando] = useState(null);
  useEffect(() => { setVisibles(POR_VEZ); }, [rango.desde, rango.hasta]);
  useEffect(() => {
    let vivo = true;
    adminMediosPago(clave).then((r) => { if (vivo && r?.ok) setMedios(r.medios.filter((m) => m.activo).map(({ id, nombre }) => ({ id, nombre }))); }).catch(() => {});
    adminCatalogos(clave).then((r) => { if (vivo && r?.ok) setCatalogos({ categorias: r.categorias.filter((x) => x.activo), canales: r.canales.filter((x) => x.activo) }); }).catch(() => {});
    return () => { vivo = false; };
  }, [clave]);

  const guardar = async (r) => {
    const res = await adminEstadiaEditar(clave, editando.id, r);
    if (!res.ok) return { ok: false, mensaje: textoCodigo(res.error), campos: res.campos };
    setEditando(null);
    alGuardar?.();
    return { ok: true };
  };

  // Eliminar (anular) una reserva, con o sin huéspedes, o restaurar una anulada. No borra nada: los huéspedes se van y vuelven con ella.
  const cambiar = async (f, anular) => {
    const n = f.huespedes ?? 0;
    if (anular && !window.confirm(n
      ? `¿Eliminar la reserva de la habitación ${f.habitacion}? Se eliminan también sus ${n} ${n === 1 ? 'huésped' : 'huéspedes'}: dejan de verse y de contar en las estadísticas. No se borra nada: la podés restaurar desde «Reservas anuladas», acá abajo.`
      : `¿Anular la reserva de la habitación ${f.habitacion}? No tiene huéspedes: deja de verse en recepción y no suma en nada. Podés restaurarla después.`)) return;
    setTrabajando(f.id);
    setError('');
    try {
      const res = await adminReservaAnular(clave, f.id, anular);
      if (res.ok) { setEditando(null); alGuardar?.(); } else setError(textoCodigo(res.error));
    } catch {
      setError('No se pudo conectar. Revisá tu conexión.');
    } finally {
      setTrabajando(null);
    }
  };

  // Le da código a una reserva que todavía espera huéspedes y lleva a la pantalla donde se ve el código (la de recepción, que el dueño también usa).
  const darCodigo = async (f) => {
    setTrabajando(f.id);
    setError('');
    try {
      const res = await recepcionReservaAbrir(clave, f.id);
      if (res.ok) location.hash = '#/recepcion'; else setError(textoCodigo(res.error));
    } catch {
      setError('No se pudo conectar. Revisá tu conexión.');
    } finally {
      setTrabajando(null);
    }
  };

  if (!c.reservas && !c.sinHuespedes.length && !c.anuladas.length) return <div className="est-vacio"><p>No hay reservas en este período.</p></div>;

  // Se muestran por día, de la más nueva a la más vieja; «Ver más» agrega de a tandas.
  let restan = visibles;
  const dias = [];
  for (const d of c.dias) {
    if (restan <= 0) break;
    dias.push({ ...d, filas: d.filas.slice(0, restan) });
    restan -= d.filas.length;
  }
  const hayMas = visibles < c.reservas;

  return (
    <>
      <p className="ayuda">Las reservas del período que ya tienen huéspedes, con lo que se cobró en cada una. Tocá una para verla o corregirla. Una reserva sin ningún huésped no suma acá ni en las estadísticas.</p>
      {error && <p className="ed-error" role="alert">{error}</p>}

      {c.sinHuespedes.length > 0 && (
        <section className="caja-card caja-espera" aria-label="Reservas sin huéspedes">
          <h3>Sin huéspedes todavía <small>{c.sinHuespedes.length} {c.sinHuespedes.length === 1 ? 'reserva' : 'reservas'}</small></h3>
          <p className="ayuda"><b>No suman</b> en ingresos, habitaciones ni estadísticas. Empiezan a sumar apenas entra el primer huésped. Si eran pruebas, o al final no vino nadie, anulalas: no se borran, quedan guardadas.</p>
          <ul>
            {c.sinHuespedes.map((f) => (
              <li key={f.id}>
                <button type="button" className="caja-fila" onClick={() => setEditando(f)} aria-label={`Ver la reserva de la ${f.habitacion}`}>
                  <span className="caja-hab">{f.habitacion}</span>
                  <span className="caja-cuerpo">
                    <b>{cobroLinea(f)}</b>
                    <small>{[numeroTexto(f), detalleTexto(f), `${f.esperados} ${f.esperados === 1 ? 'huésped esperado' : 'huéspedes esperados'}`, `cargó ${f.cargado_por}`, ddmm(f.fecha_cobro)].filter(Boolean).join(' · ')}</small>
                  </span>
                  <Icon name="lapiz" size={16} sw={1.8} />
                </button>
                <button type="button" className="btn mini" onClick={() => darCodigo(f)} disabled={trabajando === f.id}>Dar código</button>
                <button type="button" className="btn mini claro" onClick={() => cambiar(f, true)} disabled={trabajando === f.id}>{trabajando === f.id ? 'Un momento…' : 'Anular'}</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {c.monedas.length > 0 && (
        <div className="caja-totales">
          {c.monedas.map((m) => (
            <section key={m.moneda} className="caja-card" aria-label={NOMBRE_MONEDA[m.moneda] ?? m.moneda}>
              <h3>{NOMBRE_MONEDA[m.moneda] ?? m.moneda} <small>{m.reservas} {m.reservas === 1 ? 'reserva' : 'reservas'}</small></h3>
              <dl>
                <div><dt>Entró en el hotel</dt><dd className="grande">{plata(m.hotel, m.moneda)}</dd></div>
                <div><dt>Señas ya cobradas</dt><dd>{plata(m.sena, m.moneda)}</dd></div>
                <div><dt>Facturado (valor total)</dt><dd>{plata(m.facturado, m.moneda)}</dd></div>
              </dl>
            </section>
          ))}
        </div>
      )}

      {c.medios.length > 0 && (
        <section className="caja-card" aria-label="Por medio de pago">
          <h3>Lo que entró en el hotel, por medio de pago</h3>
          <ul className="caja-medios">
            {c.medios.map((m) => (
              <li key={`${m.moneda}|${m.medio}`}><span>{m.medio} <small>{m.n} {m.n === 1 ? 'cobro' : 'cobros'}</small></span><b>{plata(m.monto, m.moneda)}</b></li>
            ))}
          </ul>
        </section>
      )}

      {c.sinCobro.reservas > 0 && (
        <p className="sin-cobro" role="note"><b>Sin cobro (se factura aparte):</b> {c.sinCobro.reservas} {c.sinCobro.reservas === 1 ? 'reserva' : 'reservas'}{c.sinCobro.noches ? ` y ${c.sinCobro.noches} ${c.sinCobro.noches === 1 ? 'noche' : 'noches'}` : ''} en el período. Están en la lista de abajo.</p>
      )}

      <h2 className="sub">Reservas por día</h2>
      <div className="caja-dias">
        {dias.map((d) => (
          <section key={d.fecha} className="caja-dia" aria-label={diaTexto(d.fecha)}>
            <header>
              <b>{diaTexto(d.fecha)}</b>
              <span>{Object.keys(d.hotel).length ? `En el hotel: ${Object.entries(d.hotel).map(([mo, n]) => plata(n, mo)).join(' · ')}` : 'Sin cobros'}</span>
            </header>
            <ul>
              {d.filas.map((f) => (
                <li key={f.id}>
                  <button type="button" className="caja-fila" onClick={() => setEditando(f)} aria-label={`Ver la reserva de la ${f.habitacion}`}>
                    <span className="caja-hab">{f.habitacion}</span>
                    <span className="caja-cuerpo">
                      <b>{f.sinCobro ? 'Sin cobro: se factura aparte' : `${plata(f.hotel, f.moneda)} en el hotel`}</b>
                      {f.sena > 0 && <small>+ seña {plata(f.sena, f.moneda)}{f.fecha_sena ? ` (${ddmm(f.fecha_sena)})` : ''} · total {plata(f.total, f.moneda)}</small>}
                      <small>{[numeroTexto(f), detalleTexto(f), f.sinCobro ? null : f.medio_pago, `cargó ${f.cargado_por}`].filter(Boolean).join(' · ')}</small>
                      <small>{huespedesTexto(f, f.huespedes)} con check-in</small>
                    </span>
                    <Icon name="lapiz" size={16} sw={1.8} />
                  </button>
                  {f.esperados > f.huespedes && (
                    <div className="caja-acciones"><button type="button" className="btn mini claro" onClick={() => darCodigo(f)} disabled={trabajando === f.id}>Dar código a los que faltan</button></div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {hayMas && <div className="btns"><button type="button" className="btn claro" onClick={() => setVisibles((v) => v + POR_VEZ)}>Ver más reservas</button></div>}

      {c.anuladas.length > 0 && (
        <details className="caja-anuladas">
          <summary>Reservas anuladas ({c.anuladas.length})</summary>
          <p className="ayuda">No suman ni se ven en recepción. Si eliminaste una por error, restaurala: vuelven también sus huéspedes.</p>
          <ul>
            {c.anuladas.map((f) => (
              <li key={f.id}>
                <span className="caja-hab">{f.habitacion}</span>
                <span className="caja-cuerpo">
                  <b>{detalleTexto(f) || 'Reserva anulada'}</b>
                  <small>{`cargó ${f.cargado_por} · eliminada por ${f.anulada_por ?? '—'}${f.quitados ? ` · tenía ${f.quitados} ${f.quitados === 1 ? 'huésped' : 'huéspedes'}, vuelven al restaurarla` : ''}`}</small>
                </span>
                <button type="button" className="btn mini claro" onClick={() => cambiar(f, false)} disabled={trabajando === f.id}>Restaurar</button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {editando && (
        <Modal titulo={`Reserva de la ${editando.habitacion}${editando.numero != null ? ` · N.º ${editando.numero}` : ''}`} onCerrar={() => setEditando(null)}>
          <ReservaForm inicial={editando} medios={medios} canales={catalogos.canales} categorias={catalogos.categorias} onGuardar={guardar} texto="Guardar cambios" alCancelar={() => setEditando(null)} />
          <div className="zona-quitar">
            <p className="ayuda">Si la reserva no corresponde (una prueba, o se cargó por error), la podés eliminar{editando.huespedes ? `: se van con ella sus ${editando.huespedes} ${editando.huespedes === 1 ? 'huésped' : 'huéspedes'}` : ''}. No se borra nada: queda en «Reservas anuladas» y la podés restaurar.</p>
            <button type="button" className="btn mini claro" onClick={() => cambiar(editando, true)} disabled={trabajando === editando.id}>Eliminar reserva</button>
          </div>
        </Modal>
      )}
    </>
  );
}
