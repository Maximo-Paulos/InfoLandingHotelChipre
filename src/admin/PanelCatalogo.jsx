import { useEffect, useMemo, useRef, useState } from 'react';
import { adminCatalogoGuardar, textoCodigo } from '../checkin/checkinApi.js';

// Mismas reglas que la base (supabase/estadias.sql): hasta 40 letras, números y signos comunes.
const NOMBRE_OK = /^[\p{L}\p{N}][\p{L}\p{N} ._/&()+,'-]{0,39}$/u;
const limpiar = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();
const clave = (t) => limpiar(t).toLowerCase();

const desdeServidor = (items) => items.map((m) => ({ k: `s${m.id}`, id: m.id, nombre: m.nombre, activo: m.activo, base: m.base, cobra: m.cobra, usos: m.usos ?? 0 }));
const resumen = (lista) => JSON.stringify(lista.map((m) => [m.id, limpiar(m.nombre), m.activo, m.cobra]));

// Una lista que edita el dueño y elige recepción: las categorías de habitación o los canales de venta. NADA se borra: lo que se quita
// deja de ofrecerse, pero las reservas que ya lo tenían lo siguen mostrando, y se puede volver a poner.
//   tipo: 'categoria' | 'canal' · items: la lista que guardó la base (también lo quitado) o null mientras carga
//   conCobro: los canales pueden marcarse «sin cobro» (obra social: se factura aparte y no entra en cobros ni tarifas)
//   alGuardar(listaNueva): se llama cuando la base confirma el cambio
export default function PanelCatalogo({ clave: claveAdmin, tipo, titulo, singular, plural, ejemplo, ayuda, conCobro = false, items, alGuardar }) {
  const [lista, setLista] = useState([]);
  const [nuevo, setNuevo] = useState('');
  const [errorNuevo, setErrorNuevo] = useState('');
  const [msg, setMsg] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const contador = useRef(0);

  useEffect(() => { if (items) setLista(desdeServidor(items)); }, [items]);

  const activos = lista.filter((m) => m.activo);
  const quitados = lista.filter((m) => !m.activo);

  const errores = useMemo(() => {
    const e = {};
    const vistos = new Set();
    lista.forEach((m) => {
      const n = limpiar(m.nombre);
      if (!NOMBRE_OK.test(n)) e[m.k] = 'Escribí un nombre de hasta 40 letras o números.';
      else if (vistos.has(clave(n))) e[m.k] = `Ya hay ${singular} con ese nombre.`;
      vistos.add(clave(n));
    });
    return e;
  }, [lista, singular]);
  const hayErrores = Object.keys(errores).length > 0;
  const sucio = !!items && resumen(lista) !== resumen(desdeServidor(items));

  const cambia = (k, cambios) => { setLista((l) => l.map((m) => (m.k === k ? { ...m, ...cambios } : m))); setMsg(null); };
  const quitar = (k) => {
    setMsg(null);
    // Uno recién agregado y sin guardar simplemente se saca; uno que ya existe se "quita" (queda guardado como quitado).
    setLista((l) => l.flatMap((m) => (m.k !== k ? [m] : m.id == null ? [] : [{ ...m, activo: false }])));
  };

  const agregar = (e) => {
    e.preventDefault();
    const n = limpiar(nuevo);
    if (!NOMBRE_OK.test(n)) { setErrorNuevo('Escribí un nombre de hasta 40 letras o números.'); return; }
    const igual = lista.find((m) => clave(m.nombre) === clave(n));
    if (igual && igual.activo) { setErrorNuevo(`Ya hay ${singular} con ese nombre.`); return; }
    setErrorNuevo('');
    setMsg(null);
    if (igual) {
      setLista((l) => l.map((m) => (m.k === igual.k ? { ...m, activo: true } : m))); // estaba quitado: se lo vuelve a poner
    } else {
      contador.current += 1;
      setLista((l) => [...l, { k: `n${contador.current}`, id: null, nombre: n, activo: true, base: false, cobra: true, usos: 0 }]);
    }
    setNuevo('');
  };

  const guardar = async () => {
    setGuardando(true);
    setMsg(null);
    try {
      const r = await adminCatalogoGuardar(claveAdmin, tipo, lista.map((m) => ({ id: m.id, nombre: limpiar(m.nombre), activo: m.activo, ...(conCobro ? { cobra: m.cobra } : {}) })));
      if (r.ok) {
        alGuardar(r.lista);
        setMsg({ ok: true, texto: 'Guardado. Recepción ya lo ve.' });
      } else {
        setMsg({ ok: false, texto: textoCodigo(r.error) });
      }
    } catch {
      setMsg({ ok: false, texto: 'No se pudo conectar. Revisá tu conexión.' });
    } finally {
      setGuardando(false);
    }
  };

  if (!items) return null;
  return (
    <details className="panel">
      <summary>{titulo} <span className="chip">{activos.length} en la lista</span></summary>
      <p className="ayuda">{ayuda}</p>

      <ul className="medios">
        {activos.map((m, i) => (
          <li key={m.k} className={`medio${errores[m.k] ? ' error' : ''}`}>
            <div className="medio-fila">
              <input className="entrada" value={m.nombre} maxLength={40} autoComplete="off" aria-label={`Nombre de ${singular} ${i + 1}`}
                aria-invalid={errores[m.k] ? 'true' : undefined} onChange={(e) => cambia(m.k, { nombre: e.target.value })} />
              {m.base
                ? <span className="medio-fijo">Fijo</span>
                : <button type="button" className="btn mini claro" onClick={() => quitar(m.k)} aria-label={`Quitar ${limpiar(m.nombre) || singular}`}>Quitar</button>}
            </div>
            {errores[m.k] && <p className="ed-error" role="alert">{errores[m.k]}</p>}
            {conCobro && (
              <label className="medio-cobra">
                <input type="checkbox" checked={!m.cobra} disabled={m.base || m.usos > 0} onChange={(e) => cambia(m.k, { cobra: !e.target.checked })} />
                <span>Sin cobro: se factura aparte (no entra en cobros ni tarifas)</span>
              </label>
            )}
            {conCobro && m.id != null && m.usos > 0 && !m.base && <p className="ayuda">Como ya tiene reservas, no se puede cambiar si cobra o no.</p>}
            {m.base && <p className="ayuda">Lo reciben las reservas de antes. No se puede quitar, pero sí cambiarle el nombre.</p>}
            {m.id != null && m.usos > 0 && <p className="ayuda">{m.usos === 1 ? 'La tiene 1 reserva.' : `La tienen ${m.usos} reservas.`}</p>}
          </li>
        ))}
        {!activos.length && <li className="ayuda">No hay ninguna: recepción carga las reservas sin {plural}.</li>}
      </ul>

      <form className="medio-nuevo" onSubmit={agregar} noValidate>
        <label htmlFor={`nuevo-${tipo}`}>Agregar {singular}</label>
        <div className="medio-fila">
          <input id={`nuevo-${tipo}`} className="entrada" value={nuevo} maxLength={40} autoComplete="off" placeholder={ejemplo}
            aria-invalid={errorNuevo ? 'true' : undefined} onChange={(e) => { setNuevo(e.target.value); setErrorNuevo(''); }} />
          <button type="submit" className="btn mini claro">Agregar</button>
        </div>
        {errorNuevo && <p className="ed-error" role="alert">{errorNuevo}</p>}
      </form>

      {quitados.length > 0 && (
        <div className="medios-quitados">
          <h4>Quitados</h4>
          <p className="ayuda">Ya no se ofrecen, pero las reservas que los tenían los siguen mostrando.</p>
          <ul>
            {quitados.map((m) => (
              <li key={m.k}>
                <span>{limpiar(m.nombre)}{m.usos > 0 ? <small className="muted"> · {m.usos === 1 ? '1 reserva' : `${m.usos} reservas`}</small> : null}</span>
                <button type="button" className="btn mini claro" onClick={() => cambia(m.k, { activo: true })}>Volver a poner</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {msg && <p className={msg.ok ? 'ed-ok' : 'ed-error'} role="status">{msg.texto}</p>}
      <div className="btns">
        <button type="button" className="btn" onClick={guardar} disabled={!sucio || hayErrores || guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>
      </div>
    </details>
  );
}
