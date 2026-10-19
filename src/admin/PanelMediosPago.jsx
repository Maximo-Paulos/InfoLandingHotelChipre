import { useEffect, useMemo, useRef, useState } from 'react';
import { adminMediosPagoGuardar, textoCodigo } from '../checkin/checkinApi.js';

// Mismas reglas que la base (supabase/checkin.sql): hasta 40 letras, números y signos comunes.
const NOMBRE_OK = /^[\p{L}\p{N}][\p{L}\p{N} ._/&()+,'-]{0,39}$/u;
const limpiar = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();
const clave = (t) => limpiar(t).toLowerCase();

const ERRORES = {
  base_obligatoria: '«Otros» no se puede quitar.',
  nombre_repetido: 'Hay dos medios de pago con el mismo nombre.',
  nombre_invalido: 'Algún nombre no es válido: hasta 40 letras o números, sin símbolos raros.',
  lista_invalida: 'La lista no es válida. Actualizá la pantalla y probá de nuevo.',
  no_existe: 'Algún medio de pago ya no existe. Actualizá la pantalla y probá de nuevo.'
};

const desdeServidor = (medios) => medios.map((m) => ({ k: `s${m.id}`, id: m.id, nombre: m.nombre, activo: m.activo, base: m.base, usos: m.usos ?? 0 }));
const resumen = (lista) => JSON.stringify(lista.map((m) => [m.id, limpiar(m.nombre), m.activo]));

// Los medios de pago que elige recepción. El dueño cambia nombres, agrega y quita. NADA se borra: un medio quitado deja de
// ofrecerse, pero los huéspedes que ya lo tenían lo siguen mostrando, y se puede volver a poner.
//   medios: la lista que guardó la base (todos, también los quitados) o null mientras carga
//   alGuardar(listaNueva): se llama cuando la base confirma el cambio
export default function PanelMediosPago({ clave: claveAdmin, medios, alGuardar }) {
  const [lista, setLista] = useState([]);
  const [nuevo, setNuevo] = useState('');
  const [errorNuevo, setErrorNuevo] = useState('');
  const [msg, setMsg] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const contador = useRef(0);

  useEffect(() => { if (medios) setLista(desdeServidor(medios)); }, [medios]);

  const activos = lista.filter((m) => m.activo);
  const quitados = lista.filter((m) => !m.activo);

  // Errores por medio, antes de guardar (la base los vuelve a revisar).
  const errores = useMemo(() => {
    const e = {};
    const vistos = new Set();
    lista.forEach((m) => {
      const n = limpiar(m.nombre);
      if (!NOMBRE_OK.test(n)) e[m.k] = 'Escribí un nombre de hasta 40 letras o números.';
      else if (vistos.has(clave(n))) e[m.k] = 'Ya hay otro medio de pago con ese nombre.';
      vistos.add(clave(n));
    });
    return e;
  }, [lista]);
  const hayErrores = Object.keys(errores).length > 0;
  const sucio = !!medios && resumen(lista) !== resumen(desdeServidor(medios));

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
    if (igual && igual.activo) { setErrorNuevo('Ya hay un medio de pago con ese nombre.'); return; }
    setErrorNuevo('');
    setMsg(null);
    if (igual) {
      // Estaba quitado: se lo vuelve a poner en vez de crear uno repetido.
      setLista((l) => l.map((m) => (m.k === igual.k ? { ...m, activo: true } : m)));
    } else {
      contador.current += 1;
      const item = { k: `n${contador.current}`, id: null, nombre: n, activo: true, base: false, usos: 0 };
      // Va antes de "Otros", que siempre queda último.
      setLista((l) => { const i = l.findIndex((m) => m.base); return i < 0 ? [...l, item] : [...l.slice(0, i), item, ...l.slice(i)]; });
    }
    setNuevo('');
  };

  const guardar = async () => {
    setGuardando(true);
    setMsg(null);
    try {
      const r = await adminMediosPagoGuardar(claveAdmin, lista.map((m) => ({ id: m.id, nombre: limpiar(m.nombre), activo: m.activo })));
      if (r.ok) {
        alGuardar(r.medios);
        setMsg({ ok: true, texto: 'Medios de pago guardados. Recepción ya los ve.' });
      } else {
        setMsg({ ok: false, texto: ERRORES[r.error] ?? textoCodigo(r.error) });
      }
    } catch {
      setMsg({ ok: false, texto: 'No se pudo conectar. Revisá tu conexión.' });
    } finally {
      setGuardando(false);
    }
  };

  if (!medios) return null;
  return (
    <details className="panel">
      <summary>Medios de pago <span className="chip">{activos.length} en la lista</span></summary>
      <p className="ayuda">Son las opciones que ve recepción para elegir cómo pagó cada huésped. Podés cambiar un nombre, agregar medios nuevos y quitar los que no uses. Si quitás uno, deja de ofrecerse, pero los huéspedes que ya lo tenían lo siguen mostrando: nunca se borra nada.</p>

      <ul className="medios">
        {activos.map((m, i) => (
          <li key={m.k} className={`medio${errores[m.k] ? ' error' : ''}`}>
            <div className="medio-fila">
              <input className="entrada" value={m.nombre} maxLength={40} autoComplete="off" aria-label={`Nombre del medio de pago ${i + 1}`}
                aria-invalid={errores[m.k] ? 'true' : undefined} onChange={(e) => cambia(m.k, { nombre: e.target.value })} />
              {m.base
                ? <span className="medio-fijo">Fijo</span>
                : <button type="button" className="btn mini claro" onClick={() => quitar(m.k)} aria-label={`Quitar ${limpiar(m.nombre) || 'este medio de pago'}`}>Quitar</button>}
            </div>
            {errores[m.k] && <p className="ed-error" role="alert">{errores[m.k]}</p>}
            {m.base && <p className="ayuda">Lo reciben los huéspedes nuevos hasta que recepción elige uno. No se puede quitar, pero sí cambiarle el nombre.</p>}
            {m.id != null && m.usos > 0 && <p className="ayuda">{m.usos === 1 ? 'Lo tiene 1 huésped.' : `Lo tienen ${m.usos} huéspedes.`}</p>}
          </li>
        ))}
      </ul>

      <form className="medio-nuevo" onSubmit={agregar} noValidate>
        <label htmlFor="medio-nuevo">Agregar un medio de pago</label>
        <div className="medio-fila">
          <input id="medio-nuevo" className="entrada" value={nuevo} maxLength={40} autoComplete="off" placeholder="Ej. Tarjeta de crédito"
            aria-invalid={errorNuevo ? 'true' : undefined} onChange={(e) => { setNuevo(e.target.value); setErrorNuevo(''); }} />
          <button type="submit" className="btn mini claro">Agregar</button>
        </div>
        {errorNuevo && <p className="ed-error" role="alert">{errorNuevo}</p>}
      </form>

      {quitados.length > 0 && (
        <div className="medios-quitados">
          <h4>Quitados</h4>
          <p className="ayuda">Ya no se ofrecen, pero los huéspedes que los tenían los siguen mostrando.</p>
          <ul>
            {quitados.map((m) => (
              <li key={m.k}>
                <span>{limpiar(m.nombre)}{m.usos > 0 ? <small className="muted"> · {m.usos === 1 ? '1 huésped' : `${m.usos} huéspedes`}</small> : null}</span>
                <button type="button" className="btn mini claro" onClick={() => cambia(m.k, { activo: true })}>Volver a poner</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {msg && <p className={msg.ok ? 'ed-ok' : 'ed-error'} role="status">{msg.texto}</p>}
      <div className="btns">
        <button type="button" className="btn" onClick={guardar} disabled={!sucio || hayErrores || guardando}>{guardando ? 'Guardando…' : 'Guardar medios de pago'}</button>
      </div>
    </details>
  );
}
