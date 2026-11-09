import { useCallback, useEffect, useState } from 'react';
import BarraPersonal from '../BarraPersonal.jsx';
import Modal from '../checkin/Modal.jsx';
import { adminEquipo, adminEquipoGuardar, textoCodigo } from '../checkin/checkinApi.js';
import { fechaHora } from '../checkin/util.js';
import { useNoIndexar } from '../personal.js';
import { LoginAdmin, useSesionAdmin } from './sesionAdmin.jsx';

const ROLES = { recepcion: 'Recepción', admin: 'Dueño' };
const AYUDA_ROL = {
  recepcion: 'Da el código a los huéspedes y ve la lista de los últimos días.',
  admin: 'Entra a todo el panel, menos a esta pantalla: el equipo lo maneja solamente el dueño.'
};
// Sin letras que se confunden entre sí (0/O, 1/l/I) para poder dictarla por teléfono.
const generarClave = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), (n) => 'abcdefghjkmnpqrstuvwxyz23456789'[n % 31]).join('');

// El equipo: quién tiene clave. Solo el dueño lo ve. Cada persona tiene un nombre (alias) y su propia clave; el código que da cada una
// queda anotado en el check-in del huésped como «Habilitado por …», con el nombre que tenía ese día aunque después se lo cambien.
export default function Equipo() {
  useNoIndexar('Equipo');
  const sesion = useSesionAdmin();
  if (sesion.fase !== 'ok') return <LoginAdmin sesion={sesion} />;
  return <Pantalla clave={sesion.clave} salir={sesion.salir} />;
}

function Pantalla({ clave, salir }) {
  const [lista, setLista] = useState(null);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [editando, setEditando] = useState(null); // {} = persona nueva · una persona de la lista = editarla

  const cargar = useCallback(async () => {
    try {
      const r = await adminEquipo(clave);
      if (r.ok) { setLista(r.usuarios); setError(''); } else setError(textoCodigo(r.error));
    } catch {
      setError('No se pudo conectar. Revisá tu conexión.');
    }
  }, [clave]);
  useEffect(() => { cargar(); }, [cargar]);

  const guardado = (usuarios, mensaje) => { setLista(usuarios); setEditando(null); setAviso(mensaje); };

  return (
    <div className="page personal">
      <BarraPersonal titulo="Equipo" actual="equipo" salir={salir} />
      <main className="card">
        <header>
          <p className="eyebrow">Solo para el dueño</p>
          <h1>Equipo</h1>
          <p className="lead">Cada persona entra con su nombre y su propia clave. Los check-ins quedan anotados con el nombre de quien dio el código.</p>
        </header>
        {error && <p className="ed-error" role="alert">{error}</p>}
        {aviso && <p className="ed-ok" role="status">{aviso}</p>}
        {!lista && !error && <p className="intro" role="status">Cargando…</p>}
        {lista && (
          <>
            {lista.length === 0 && <p className="ayuda">Todavía no cargaste a nadie. Agregá a la primera persona para que pueda entrar.</p>}
            <ul className="foto-lista equipo-lista">
              {lista.map((u) => (
                <li key={u.id} className={`foto-item${u.activo ? '' : ' de-baja'}`}>
                  <div className="foto-fila">
                    <div className="foto-datos">
                      <b>{u.alias}</b>
                      <small className="muted">
                        {ROLES[u.rol]}{u.activo ? '' : ' · de baja'}
                        {u.activo && ` · ${u.sesiones === 1 ? '1 celular con sesión' : `${u.sesiones} celulares con sesión`}`}
                      </small>
                      {u.ultimo_uso && <small className="muted">Último uso: {fechaHora(u.ultimo_uso)}</small>}
                    </div>
                    <div className="foto-acciones">
                      <button type="button" className="btn mini claro" onClick={() => { setAviso(''); setEditando(u); }} aria-label={`Editar a ${u.alias}`}>Editar</button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <div className="btns"><button type="button" className="btn" onClick={() => { setAviso(''); setEditando({}); }}>Agregar persona</button></div>
            <p className="ayuda">Si alguien deja de trabajar, cambiale el nombre y la clave a la persona que lo reemplaza: los check-ins que ya hizo siguen a nombre de él.</p>
          </>
        )}
      </main>
      {editando && <FormPersona clave={clave} persona={editando} onCerrar={() => setEditando(null)} alGuardar={guardado} />}
    </div>
  );
}

function FormPersona({ clave, persona, onCerrar, alGuardar }) {
  const nueva = !persona.id;
  const [alias, setAlias] = useState(persona.alias ?? '');
  const [rol, setRol] = useState(persona.rol ?? 'recepcion');
  const [claveNueva, setClaveNueva] = useState('');
  const [error, setError] = useState('');
  const [trabajando, setTrabajando] = useState(false);

  const enviar = async (cambios, mensaje) => {
    setTrabajando(true);
    setError('');
    try {
      const r = await adminEquipoGuardar(clave, { id: persona.id ?? null, ...cambios });
      if (r.ok) alGuardar(r.usuarios, mensaje); else setError(textoCodigo(r.error));
    } catch {
      setError('No se pudo conectar. Revisá tu conexión.');
    } finally {
      setTrabajando(false);
    }
  };

  const guardar = (e) => {
    e.preventDefault();
    if (!nueva && alias.trim() !== persona.alias && claveNueva === '' && rol === persona.rol) {
      return enviar({ alias }, `Listo: ahora se llama ${alias.trim()}. Lo que ya hizo sigue a nombre de ${persona.alias}.`);
    }
    return enviar({ alias, rol, claveNueva: claveNueva || null },
      nueva ? `${alias.trim()} ya puede entrar con su clave.` : `Cambios guardados en ${alias.trim()}.`);
  };
  const cambiarEstado = () => {
    const baja = persona.activo;
    const msg = baja
      ? `¿Dar de baja a ${persona.alias}? Se le cierra la sesión en sus celulares y su clave y su código dejan de servir. Lo que ya hizo queda guardado.`
      : `¿Volver a dar de alta a ${persona.alias}?`;
    if (window.confirm(msg)) enviar({ activo: !baja }, baja ? `${persona.alias} quedó de baja.` : `${persona.alias} volvió a estar activo.`);
  };

  const cierraSesion = !nueva && (claveNueva !== '' || rol !== persona.rol);
  return (
    <Modal titulo={nueva ? 'Agregar persona' : persona.alias} onCerrar={onCerrar}>
      <form onSubmit={guardar}>
        <div className="campo">
          <label htmlFor="eq-alias">Nombre (como lo ves en la lista)</label>
          <input id="eq-alias" value={alias} onChange={(e) => setAlias(e.target.value)} maxLength={30} required autoComplete="off" autoFocus={nueva} />
          {!nueva && alias.trim() !== persona.alias && alias.trim() !== '' && (
            <p className="ayuda">Los check-ins que ya hizo siguen diciendo «{persona.alias}». Los nuevos van a decir «{alias.trim()}».</p>
          )}
        </div>
        <fieldset className="campo roles">
          <legend className="etq">¿Qué puede hacer?</legend>
          {Object.keys(ROLES).map((r) => (
            <label key={r} className="opcion">
              <input type="radio" name="eq-rol" value={r} checked={rol === r} onChange={() => setRol(r)} />
              <span><b>{ROLES[r]}</b><small>{AYUDA_ROL[r]}</small></span>
            </label>
          ))}
        </fieldset>
        <div className="campo">
          <label htmlFor="eq-clave">{nueva ? 'Clave' : 'Clave nueva (dejala vacía para no cambiarla)'}</label>
          <div className="campo-fila">
            <input id="eq-clave" value={claveNueva} onChange={(e) => setClaveNueva(e.target.value)} minLength={claveNueva ? 8 : undefined} maxLength={100}
              required={nueva} autoComplete="off" autoCapitalize="none" spellCheck={false} aria-describedby="eq-clave-ayuda" />
            <button type="button" className="btn mini claro" onClick={() => setClaveNueva(generarClave())}>Generar</button>
          </div>
          <p className="ayuda" id="eq-clave-ayuda">Mínimo 8 caracteres. Se la pasás vos a la persona; no se puede volver a ver, solo cambiar.{cierraSesion && ' Al guardar se le cierra la sesión en sus celulares.'}</p>
        </div>
        {error && <p className="ed-error" role="alert">{error}</p>}
        <div className="modal-pie">
          <div className="btns">
            <button type="submit" className="btn" disabled={trabajando}>{trabajando ? 'Guardando…' : nueva ? 'Agregar' : 'Guardar'}</button>
            <button type="button" className="btn claro" onClick={onCerrar}>Cancelar</button>
          </div>
          {!nueva && (
            <div className="btns"><button type="button" className="btn claro" onClick={cambiarEstado} disabled={trabajando}>{persona.activo ? 'Dar de baja' : 'Volver a dar de alta'}</button></div>
          )}
        </div>
      </form>
    </Modal>
  );
}
