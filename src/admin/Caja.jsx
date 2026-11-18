import { useEffect, useMemo, useState } from 'react';
import Modal from '../checkin/Modal.jsx';
import { adminCatalogos, adminEstadiaEditar, adminMediosPago, textoCodigo } from '../checkin/checkinApi.js';
import ReservaForm, { detalleTexto, plata } from '../checkin/ReservaForm.jsx';
import Icon from '../components/Icon.jsx';
import { caja } from './estadisticas.js';

const POR_VEZ = 40;
const NOMBRE_MONEDA = { ARS: 'Pesos', USD: 'Dólares' };
const diaTexto = (iso) => new Intl.DateTimeFormat('es-AR', { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));
const ddmm = (iso) => iso.split('-').reverse().slice(0, 2).join('/');

// La caja del período: TODAS las reservas (también las que todavía no tienen ningún check-in), cada una con su fecha, habitación, lo que se
// cobró (total, seña y lo pagado en el hotel) y quién la cargó. Arriba, los totales por moneda y por medio de pago para hacer la caja.
// Tocar una reserva la abre para corregirla.
//   datos: lo que devuelve admin_estadisticas · rango: { desde, hasta } · alGuardar(): se llama después de corregir una reserva (para volver a pedir los datos)
export default function Caja({ datos, rango, clave, alGuardar }) {
  const c = useMemo(() => caja(datos, rango), [datos, rango]);
  const [visibles, setVisibles] = useState(POR_VEZ);
  const [editando, setEditando] = useState(null);
  const [medios, setMedios] = useState([]);
  const [catalogos, setCatalogos] = useState({ canales: [], categorias: [] });
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

  if (!c.reservas) return <div className="est-vacio"><p>No hay reservas en este período.</p></div>;

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
      <p className="ayuda">Todas las reservas del período, con lo que se cobró en cada una, incluidas las que todavía no tienen ningún check-in. Tocá una para verla o corregirla.</p>

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
                      <small>{[detalleTexto(f), f.sinCobro ? null : f.medio_pago, `cargó ${f.cargado_por}`].filter(Boolean).join(' · ')}</small>
                      <small className={f.huespedes ? '' : 'alerta'}>{f.huespedes ? `${f.huespedes} ${f.huespedes === 1 ? 'huésped' : 'huéspedes'} con check-in` : 'Todavía sin check-in'}</small>
                    </span>
                    <Icon name="lapiz" size={16} sw={1.8} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {hayMas && <div className="btns"><button type="button" className="btn claro" onClick={() => setVisibles((v) => v + POR_VEZ)}>Ver más reservas</button></div>}

      {editando && (
        <Modal titulo={`Reserva de la ${editando.habitacion}`} onCerrar={() => setEditando(null)}>
          <ReservaForm inicial={editando} medios={medios} canales={catalogos.canales} categorias={catalogos.categorias} onGuardar={guardar} texto="Guardar cambios" alCancelar={() => setEditando(null)} />
        </Modal>
      )}
    </>
  );
}
