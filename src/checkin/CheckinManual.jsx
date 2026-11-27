import { useState } from 'react';
import { aCobrar, medioSugerido } from './cobro.js';
import Modal from './Modal.jsx';
import { numeroTexto } from './proximas.js';
import { nochesTexto, plata } from './ReservaForm.jsx';

// CHECK-IN A MANO (solo el dueño). Cuando en el apuro no se llega a hacer el check-in, el dueño carga al huésped con los datos que tenga: NINGÚN dato es obligatorio. Queda
// marcado como «cargado a mano» (con quién lo cargó), cuenta como el check-in de la reserva y entra en las estadísticas.
//   Dos usos: «nuevo» (cargar uno o varios huéspedes en una reserva; si es una reserva ANOTADA que todavía no tiene check-in, también se arma la reserva con lo anotado) y
//   «editar» (completar después los datos de uno que ya se cargó a mano).
//   reserva: { tipo: 'anotada' | 'estadia', id, habitacion, numero, titular, noches, esperados, con_checkin, … (si es anotada: precios, seña y canal) } · medios: [{ id, nombre }]
//   huesped: la fila de uno cargado a mano (modo editar) · onGuardar(huespedes, cobro) | onGuardar(datos) -> { ok, mensaje?, indice?, campos? } · onCerrar()
const VACIO = { nombre: '', apellido: '', email: '', telefono: '', doc_tipo: '', doc_numero: '', nacionalidad: '', localidad: '', domicilio: '', anio_nac: '' };
const MAS = ['nacionalidad', 'localidad', 'domicilio', 'anio_nac'];
const TEXTO_ERROR = {
  nombre: 'el nombre', apellido: 'el apellido', email: 'el mail (tiene que parecer un mail, como nombre@correo.com, o quedar vacío)',
  telefono: 'el teléfono (solo números, con + si lleva el país; entre 6 y 15 números)', doc_tipo: 'el tipo de documento',
  doc_numero: 'el número de documento (un DNI tiene 7 u 8 números)', nacionalidad: 'la nacionalidad', localidad: 'la localidad', domicilio: 'el domicilio',
  anio_nac: 'el año de nacimiento (4 números, desde 1900)', datos: 'los datos', huespedes: 'la lista de huéspedes'
};

const conDatos = (h) => Object.values(h).some((v) => String(v ?? '').trim() !== '');
const limpio = (h) => Object.fromEntries(Object.entries(h).map(([k, v]) => [k, String(v ?? '').trim()]).filter(([, v]) => v !== ''));
const desdeDatos = (d = {}) => ({ ...VACIO, ...Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v == null ? '' : String(v)])) });

function Campo({ id, etiqueta, valor, onCambio, error, tipo = 'text', modo, placeholder, children }) {
  return (
    <div className={`campo${error ? ' error' : ''}`}>
      <label htmlFor={id}>{etiqueta}</label>
      {children ?? <input id={id} type={tipo} inputMode={modo} autoComplete="off" maxLength={120} value={valor} placeholder={placeholder} onChange={(e) => onCambio(e.target.value)} aria-invalid={error ? 'true' : undefined} />}
    </div>
  );
}

function Huesped({ i, h, onCambio, errores, onQuitar }) {
  const set = (campo) => (v) => onCambio({ ...h, [campo]: v });
  const id = (c) => `mano-${i}-${c}`;
  return (
    <fieldset className={`mano-huesped${errores.length ? ' con-error' : ''}`}>
      <legend>Huésped {i + 1}</legend>
      <div className="mano-grilla">
        <Campo id={id('nombre')} etiqueta="Nombre" valor={h.nombre} onCambio={set('nombre')} error={errores.includes('nombre')} />
        <Campo id={id('apellido')} etiqueta="Apellido" valor={h.apellido} onCambio={set('apellido')} error={errores.includes('apellido')} />
        <Campo id={id('email')} etiqueta="Mail" valor={h.email} onCambio={set('email')} error={errores.includes('email')} modo="email" placeholder="nombre@correo.com" />
        <Campo id={id('telefono')} etiqueta="Teléfono" valor={h.telefono} onCambio={set('telefono')} error={errores.includes('telefono')} modo="tel" placeholder="+54 9 11 5555 1234" />
        <Campo id={id('doc_tipo')} etiqueta="Tipo de documento" error={errores.includes('doc_tipo')}>
          <select id={id('doc_tipo')} value={h.doc_tipo} onChange={(e) => set('doc_tipo')(e.target.value)}>
            <option value="">Sin dato</option>
            <option value="DNI">DNI</option>
            <option value="Pasaporte">Pasaporte</option>
            <option value="Otro">Otro</option>
          </select>
        </Campo>
        <Campo id={id('doc_numero')} etiqueta="Número de documento" valor={h.doc_numero} onCambio={set('doc_numero')} error={errores.includes('doc_numero')} modo="text" />
      </div>
      <details className="mano-mas" open={MAS.some((c) => String(h[c]).trim() !== '') || errores.some((c) => MAS.includes(c))}>
        <summary>Más datos (nacionalidad, localidad, domicilio, año de nacimiento)</summary>
        <div className="mano-grilla">
          <Campo id={id('nacionalidad')} etiqueta="Nacionalidad" valor={h.nacionalidad} onCambio={set('nacionalidad')} error={errores.includes('nacionalidad')} />
          <Campo id={id('localidad')} etiqueta="Localidad" valor={h.localidad} onCambio={set('localidad')} error={errores.includes('localidad')} />
          <Campo id={id('domicilio')} etiqueta="Domicilio" valor={h.domicilio} onCambio={set('domicilio')} error={errores.includes('domicilio')} />
          <Campo id={id('anio_nac')} etiqueta="Año de nacimiento" valor={h.anio_nac} onCambio={set('anio_nac')} error={errores.includes('anio_nac')} modo="numeric" placeholder="1985" />
        </div>
      </details>
      {onQuitar && <button type="button" className="btn mini claro" onClick={onQuitar}>Quitar este huésped de la carga</button>}
    </fieldset>
  );
}

export default function CheckinManual({ reserva = null, huesped = null, medios = [], onGuardar, onCerrar }) {
  const editar = !!huesped;
  const anotada = !editar && reserva?.tipo === 'anotada';
  // Cuántos formularios arrancan: los que faltan ingresar (o los esperados, si es una anotada). Siempre al menos uno.
  const faltan = editar ? 1 : Math.max(1, Math.min(12, anotada ? Number(reserva.esperados) || 1 : (Number(reserva.esperados) || 1) - (Number(reserva.con_checkin) || 0)));
  const [lista, setLista] = useState(() => (editar ? [desdeDatos(huesped.datos)] : Array.from({ length: faltan }, () => ({ ...VACIO }))));
  const [forma, setForma] = useState('efectivo');
  const [medio, setMedio] = useState(() => String(medioSugerido(medios, 'efectivo') ?? ''));
  const [errores, setErrores] = useState({}); // { indice: [campos] }
  const [aviso, setAviso] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cobra = anotada && reserva.canal_cobra !== false;
  const x = cobra ? aCobrar(reserva, null)[forma] : null;
  const sinDatos = lista.filter((h) => !conDatos(h)).length;

  const cambiar = (i, nuevo) => { setLista((l) => l.map((h, k) => (k === i ? nuevo : h))); setErrores({}); setAviso(''); };
  const elegirForma = (f) => { setForma(f); setMedio(String(medioSugerido(medios, f) ?? '')); };

  const guardar = async () => {
    if (guardando) return;
    setGuardando(true);
    setAviso('');
    setErrores({});
    try {
      const res = editar ? await onGuardar(limpio(lista[0])) : await onGuardar(lista.map(limpio), anotada ? { forma, medio: medio ? Number(medio) : null } : null);
      if (!res.ok) {
        const campos = res.campos ?? [];
        if (res.indice != null) setErrores({ [res.indice]: campos }); else if (editar) setErrores({ 0: campos });
        const quien = res.indice != null && lista.length > 1 ? `Revisá al huésped ${res.indice + 1}: ` : 'Revisá ';
        setAviso(campos.length ? `${quien}${campos.map((c) => TEXTO_ERROR[c] ?? c).join(', ')}.` : res.mensaje || 'No se pudo guardar.');
      }
    } catch {
      setAviso('No se pudo conectar. Revisá tu conexión e intentá de nuevo.');
    } finally {
      setGuardando(false);
    }
  };

  const titulo = editar
    ? `Completar los datos · ${[huesped.datos?.nombre, huesped.datos?.apellido].filter(Boolean).join(' ') || 'Sin nombre'}`
    : `Check-in a mano · Hab. ${reserva.habitacion}`;
  return (
    <Modal titulo={titulo} onCerrar={onCerrar}>
      <p className="ayuda">
        Cargá lo que tengas. <b>Ningún dato es obligatorio</b>: lo que no sepas, dejalo vacío (después se puede completar). Queda marcado como <b>«cargado a mano»</b>, con tu nombre,
        y cuenta como check-in de la reserva.
      </p>
      {!editar && (
        <p className="mano-reserva">
          <b>{reserva.numero != null ? numeroTexto(reserva) : 'Reserva'}</b>{reserva.titular ? ` · ${reserva.titular}` : ''} · {nochesTexto(reserva.noches)} ·
          {` ${reserva.esperados} ${Number(reserva.esperados) === 1 ? 'huésped esperado' : 'huéspedes esperados'}`}
          {Number(reserva.con_checkin) > 0 ? ` · ya ingresaron ${reserva.con_checkin}` : ''}
        </p>
      )}

      {lista.map((h, i) => (
        <Huesped key={i} i={i} h={h} errores={errores[i] ?? []} onCambio={(n) => cambiar(i, n)} onQuitar={!editar && lista.length > 1 ? () => setLista((l) => l.filter((_, k) => k !== i)) : null} />
      ))}
      {!editar && lista.length < 12 - (Number(reserva.con_checkin) || 0) && (
        <button type="button" className="btn mini claro" onClick={() => setLista((l) => [...l, { ...VACIO }])}>Agregar otro huésped</button>
      )}
      {sinDatos > 0 && <p className="ayuda">{sinDatos === 1 ? 'Un huésped sin ningún dato' : `${sinDatos} huéspedes sin ningún dato`}: igual cuenta como persona que ingresó.</p>}

      {anotada && (
        <section className="mano-cobro" aria-labelledby="mano-cobro-tit">
          <h3 id="mano-cobro-tit">Cobro de la reserva</h3>
          {cobra ? (
            <>
              <p className="ayuda">
                Se registra <b>lo anotado</b>: {plata(x.total, 'ARS')} {forma === 'transferencia' ? 'por transferencia' : 'en efectivo'}
                {x.sena > 0 ? `, de los cuales ${plata(x.sena, 'ARS')} ya estaban pagados de seña (se cobró ${plata(x.resta, 'ARS')} en el hotel)` : ''}.
                Si fue otro monto, lo corregís después en la reserva.
              </p>
              <div className="mano-grilla">
                <div className="campo">
                  <label htmlFor="mano-forma">Cómo pagó</label>
                  <select id="mano-forma" value={forma} onChange={(e) => elegirForma(e.target.value)}>
                    <option value="efectivo">Efectivo</option>
                    <option value="transferencia">Transferencia</option>
                  </select>
                </div>
                <div className="campo">
                  <label htmlFor="mano-medio">Medio de pago</label>
                  <select id="mano-medio" value={medio} onChange={(e) => setMedio(e.target.value)}>
                    <option value="">El básico de la lista</option>
                    {medios.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
                  </select>
                </div>
              </div>
            </>
          ) : <p className="ayuda">Sin cobro: esta reserva se factura aparte.</p>}
        </section>
      )}

      {aviso && <p className="ed-error" role="alert">{aviso}</p>}
      <div className="btns modal-pie">
        <button type="button" className="btn" onClick={guardar} disabled={guardando}>{guardando ? 'Un momento…' : editar ? 'Guardar los datos' : 'Guardar el check-in'}</button>
        <button type="button" className="btn claro" onClick={onCerrar} disabled={guardando}>Cancelar</button>
      </div>
    </Modal>
  );
}
