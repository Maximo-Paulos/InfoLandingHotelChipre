import { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { SUPABASE_KEY, SUPABASE_URL } from '../config.js';
import { leerContenido } from '../data/api.js';
import { adminClaveRecepcion, adminConfig, adminConfigGuardar, textoCodigo } from '../checkin/checkinApi.js';
import { probarConexion } from '../checkin/foto.js';
import codigoScript from '../../apps-script/Codigo.gs?raw';

const NUMEROS = [
  ['codigo_seg', 'Cada cuántos segundos cambia el código', 5, 300],
  ['usos_max', 'Cuántas personas pueden usar el mismo código', 1, 20],
  ['edicion_min', 'Minutos que recepción puede editar un huésped', 1, 1440],
  ['dias_recepcion', 'Días de huéspedes que ve recepción', 1, 365]
];

// Estado compartido de la configuración (se lee una vez y se vuelve a leer al guardar).
export function useConfigCheckin(clave) {
  const [config, setConfig] = useState(null);
  const [error, setError] = useState('');
  const recargar = useCallback(async () => {
    try {
      const r = await adminConfig(clave);
      if (r.ok) { setConfig(r.config); setError(''); } else setError(textoCodigo(r.error));
    } catch {
      setError('No se pudo conectar. Revisá tu conexión.');
    }
  }, [clave]);
  useEffect(() => { recargar(); }, [recargar]);
  return { config, error, recargar };
}

export function ConfigCheckin({ clave, config, recargar }) {
  const [f, setF] = useState(null);
  const [msg, setMsg] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [claveNueva, setClaveNueva] = useState('');
  const [msgClave, setMsgClave] = useState(null);

  useEffect(() => {
    if (config) setF({ ...config, foto_url: config.foto_url ?? '' });
  }, [config]);

  const sucio = useMemo(() => {
    if (!config || !f) return false;
    return ['activo', 'edicion_activa', 'foto_modo', ...NUMEROS.map((n) => n[0])].some((k) => String(f[k]) !== String(config[k]));
  }, [config, f]);

  if (!f) return <p className="intro" role="status">Cargando configuración…</p>;

  const cambia = (k, v) => { setF((x) => ({ ...x, [k]: v })); setMsg(null); };

  const guardar = async (e) => {
    e.preventDefault();
    for (const [k, etq, min, max] of NUMEROS) {
      const n = Number(f[k]);
      if (!Number.isInteger(n) || n < min || n > max) { setMsg({ ok: false, texto: `"${etq}": poné un número entre ${min} y ${max}.` }); return; }
    }
    setGuardando(true);
    setMsg(null);
    try {
      const r = await adminConfigGuardar(clave, {
        activo: !!f.activo, edicion_activa: !!f.edicion_activa, foto_modo: f.foto_modo,
        codigo_seg: Number(f.codigo_seg), usos_max: Number(f.usos_max), edicion_min: Number(f.edicion_min), dias_recepcion: Number(f.dias_recepcion)
      });
      if (r.ok) { setMsg({ ok: true, texto: 'Configuración guardada.' }); await recargar(); } else setMsg({ ok: false, texto: textoCodigo(r.error) });
    } catch {
      setMsg({ ok: false, texto: 'No se pudo conectar. Revisá tu conexión.' });
    } finally {
      setGuardando(false);
    }
  };

  const guardarClave = async (e) => {
    e.preventDefault();
    setMsgClave(null);
    try {
      const r = await adminClaveRecepcion(clave, claveNueva);
      if (r.ok) { setClaveNueva(''); setMsgClave({ ok: true, texto: 'Clave de recepción guardada. Pasale la nueva a recepción.' }); await recargar(); } else setMsgClave({ ok: false, texto: textoCodigo(r.error) });
    } catch {
      setMsgClave({ ok: false, texto: 'No se pudo conectar. Revisá tu conexión.' });
    }
  };

  return (
    <details className="panel" open>
      <summary>Configuración del check-in</summary>
      <form onSubmit={guardar} className="cfg" noValidate>
        {f.activo && !config.recepcion_con_clave && <p className="note" role="alert">Falta cargar la clave de recepción: sin clave nadie puede ver el código.</p>}
        <div className="campo">
          <label htmlFor="cfg-activo">Check-in digital</label>
          <select id="cfg-activo" value={f.activo ? 'si' : 'no'} onChange={(e) => cambia('activo', e.target.value === 'si')}>
            <option value="no">Apagado (el botón no aparece en la guía)</option>
            <option value="si">Encendido</option>
          </select>
        </div>
        {NUMEROS.slice(0, 2).map(([k, etq, min, max]) => (
          <div className="campo" key={k}>
            <label htmlFor={`cfg-${k}`}>{etq}</label>
            <input id={`cfg-${k}`} type="number" inputMode="numeric" min={min} max={max} step="1" value={f[k]} onChange={(e) => cambia(k, e.target.value)} />
          </div>
        ))}
        <div className="campo">
          <label htmlFor="cfg-edicion_activa">Recepción puede editar a los huéspedes</label>
          <select id="cfg-edicion_activa" value={f.edicion_activa ? 'si' : 'no'} onChange={(e) => cambia('edicion_activa', e.target.value === 'si')}>
            <option value="si">Sí, por un tiempo</option>
            <option value="no">No</option>
          </select>
        </div>
        {NUMEROS.slice(2).map(([k, etq, min, max]) => (
          <div className="campo" key={k}>
            <label htmlFor={`cfg-${k}`}>{etq}</label>
            <input id={`cfg-${k}`} type="number" inputMode="numeric" min={min} max={max} step="1" value={f[k]} onChange={(e) => cambia(k, e.target.value)} disabled={k === 'edicion_min' && !f.edicion_activa} />
          </div>
        ))}
        <div className="campo">
          <label htmlFor="cfg-foto_modo">Foto del documento</label>
          <select id="cfg-foto_modo" value={f.foto_modo} onChange={(e) => cambia('foto_modo', e.target.value)}>
            <option value="opcional">Opcional</option>
            <option value="obligatoria">Obligatoria</option>
            <option value="no">No pedir</option>
          </select>
          <p className="ayuda">{config.foto_url ? 'Drive conectado.' : 'Solo aparece cuando conectás Drive (abajo).'}</p>
        </div>
        {msg && <p className={msg.ok ? 'ed-ok' : 'ed-error'} role="status">{msg.texto}</p>}
        <div className="btns"><button type="submit" className="btn" disabled={guardando || !sucio}>{guardando ? 'Guardando…' : 'Guardar configuración'}</button></div>
      </form>

      <form onSubmit={guardarClave} className="cfg" noValidate>
        <h3>Clave de recepción</h3>
        <p className="ayuda">{config.recepcion_con_clave ? 'Hay una clave cargada. Si la cambiás, la anterior deja de servir.' : 'Todavía no hay clave: recepción no puede entrar.'} Solo vos podés cambiarla.</p>
        <div className="campo">
          <label htmlFor="cfg-clave-recepcion">Clave nueva (mínimo 8 caracteres)</label>
          <input id="cfg-clave-recepcion" type="password" autoComplete="new-password" minLength={8} value={claveNueva} onChange={(e) => { setClaveNueva(e.target.value); setMsgClave(null); }} />
        </div>
        {msgClave && <p className={msgClave.ok ? 'ed-ok' : 'ed-error'} role="status">{msgClave.texto}</p>}
        <div className="btns"><button type="submit" className="btn claro" disabled={claveNueva.length < 8}>Guardar clave de recepción</button></div>
        <p className="ayuda">La pantalla de recepción está en <a href="#/recepcion" target="_blank" rel="noopener noreferrer">/#/recepcion</a>.</p>
      </form>
    </details>
  );
}

const ZONA_INICIAL = 'America/Argentina/Buenos_Aires';
const ZONA_VALIDA = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/;

const idDeCarpeta = (texto) => {
  const t = String(texto ?? '').trim();
  const m = t.match(/\/folders\/([A-Za-z0-9_-]{10,})/) || t.match(/[?&]id=([A-Za-z0-9_-]{10,})/) || t.match(/^([A-Za-z0-9_-]{20,})$/);
  return m ? m[1] : '';
};

// Asistente para conectar la carpeta de Drive donde se guardan las fotos de los documentos.
export function ConectarDrive({ clave, config, recargar }) {
  const [carpeta, setCarpeta] = useState('');
  const [url, setUrl] = useState('');
  const [msg, setMsg] = useState(null);
  const [trabajando, setTrabajando] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [zona, setZona] = useState(ZONA_INICIAL);

  useEffect(() => { if (config) setUrl(config.foto_url ?? ''); }, [config]);
  // El nombre de la foto lleva la hora del hotel: se toma la zona horaria cargada en Datos generales.
  useEffect(() => {
    let vivo = true;
    leerContenido().then(({ contenido }) => {
      const z = contenido?.hotel?.zonaHoraria;
      if (vivo && typeof z === 'string' && ZONA_VALIDA.test(z)) setZona(z);
    }).catch(() => { /* queda la zona de Argentina */ });
    return () => { vivo = false; };
  }, []);
  const carpetaId = idDeCarpeta(carpeta);

  const codigo = useMemo(() => (config && carpetaId
    ? codigoScript
      .replace('%%SUPABASE_URL%%', () => SUPABASE_URL).replace('%%SUPABASE_KEY%%', () => SUPABASE_KEY)
      .replace('%%SECRETO%%', () => config.foto_secreto).replace('%%CARPETA_ID%%', () => carpetaId)
      .replace('%%ZONA%%', () => zona)
    : ''), [config, carpetaId, zona]);

  if (!config) return null;

  const copiar = async () => {
    try { await navigator.clipboard.writeText(codigo); setCopiado(true); setTimeout(() => setCopiado(false), 2500); } catch { setMsg({ ok: false, texto: 'No se pudo copiar. Seleccioná el código y copialo a mano.' }); }
  };

  const conectar = async (e) => {
    e.preventDefault();
    setTrabajando(true);
    setMsg(null);
    try {
      const r = await adminConfigGuardar(clave, { foto_url: url.trim() });
      if (!r.ok) { setMsg({ ok: false, texto: r.error === 'config_invalida' ? 'Esa dirección no parece la de una aplicación web de Google (tiene que terminar en /exec).' : textoCodigo(r.error) }); return; }
      await recargar();
      if (!url.trim()) { setMsg({ ok: true, texto: 'Drive desconectado: el formulario sale sin foto.' }); return; }
      const t = await probarConexion(url.trim(), config.foto_secreto);
      if (t.ok === true) setMsg({ ok: true, texto: `¡Conectado! Se guardó un archivo de prueba en la carpeta «${t.carpeta}».` });
      else if (t.ok === false) setMsg({ ok: false, texto: t.error === 'secreto' ? 'El script tiene una clave distinta. Volvé a copiar el código del paso 2 y publicalo de nuevo.' : 'El script contestó con un error. Revisá que el link de la carpeta sea el correcto.' });
      else setMsg({ ok: null, texto: 'Guardé la dirección, pero el navegador no me dejó leer la respuesta. Mirá si en tu carpeta de Drive apareció el archivo «prueba-conexion.txt»: si está, anda.' });
    } catch {
      setMsg({ ok: false, texto: 'No se pudo conectar. Revisá tu conexión.' });
    } finally {
      setTrabajando(false);
    }
  };

  return (
    <details className="panel">
      <summary>Conectar Drive para las fotos {config.foto_url ? <span className="chip ok">Conectado</span> : <span className="chip">Sin conectar</span>}</summary>
      <p className="ayuda">Las fotos de los documentos se guardan en una carpeta de tu Drive, no en la base de datos. Son 4 pasos y se hacen una sola vez.</p>
      <ol className="pasos-drive">
        <li>
          <b>Creá una carpeta en tu Drive</b> (por ejemplo «Check-in Hotel Chipre — documentos»), abrila y pegá acá su link:
          <input className="entrada" type="url" placeholder="https://drive.google.com/drive/folders/…" value={carpeta} onChange={(e) => setCarpeta(e.target.value)} aria-label="Link de la carpeta de Drive" />
          {carpeta && !carpetaId && <p className="ed-error">No encuentro el código de la carpeta en ese link.</p>}
        </li>
        <li>
          <b>Abrí <a href="https://script.google.com/home/start" target="_blank" rel="noopener noreferrer">script.google.com</a></b>, tocá «Proyecto nuevo», borrá lo que haya y pegá este código:
          {codigo ? (
            <>
              <textarea className="codigo-script" readOnly rows={8} value={codigo} aria-label="Código del script" onFocus={(e) => e.target.select()} />
              <button type="button" className="btn mini claro" onClick={copiar}><Icon name="copiar" size={18} sw={1.7} /> {copiado ? '¡Copiado!' : 'Copiar código'}</button>
            </>
          ) : <p className="ayuda">Primero pegá el link de la carpeta (paso 1) y acá aparece el código listo.</p>}
        </li>
        <li>
          <b>Publicalo:</b> «Implementar» → «Nueva implementación» → tipo «Aplicación web» → «Ejecutar como: yo» → «Quién tiene acceso: cualquier persona» → «Implementar». Google te va a pedir permiso (es tu propio script; si dice «app no verificada», tocá «Avanzado» y «Ir a…»). Al final copiá la <b>URL de la aplicación web</b>.
        </li>
        <li>
          <b>Pegá esa URL acá</b> y tocá «Guardar y probar»:
          <form onSubmit={conectar}>
            <input className="entrada" type="url" placeholder="https://script.google.com/macros/s/…/exec" value={url} onChange={(e) => { setUrl(e.target.value); setMsg(null); }} aria-label="URL de la aplicación web" />
            {msg && <p className={msg.ok === true ? 'ed-ok' : msg.ok === false ? 'ed-error' : 'ayuda'} role="status">{msg.texto}</p>}
            <div className="btns"><button type="submit" className="btn" disabled={trabajando}>{trabajando ? 'Probando…' : 'Guardar y probar'}</button></div>
          </form>
        </li>
      </ol>
    </details>
  );
}
