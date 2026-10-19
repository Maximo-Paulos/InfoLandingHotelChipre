import { useEffect, useRef, useState } from 'react';
import FormHuesped from './FormHuesped.jsx';
import Modal from './Modal.jsx';
import { cargarTelefono } from './telefono.js';
import { mensajeDe, validarHuesped, valoresDesdeDatos } from './validar.js';
import { enfocarPrimerError, minSeg, useAhora } from './util.js';

// Cuenta regresiva de la ventana de edición. Es un componente aparte: se redibuja ella sola cada segundo
// y no toca el formulario mientras la persona escribe.
function NotaTiempo({ venceEn }) {
  const ahora = useAhora(1000);
  const restante = Math.max(0, Math.ceil((venceEn - ahora) / 1000));
  const vencido = restante === 0;
  return (
    <p className={`nota-tiempo${vencido ? ' vencido' : ''}`} role="status">
      {vencido ? 'Se terminó el tiempo para editar. Si hay que corregir algo, pedíselo al administrador.' : `Podés editar durante ${minSeg(restante)} más.`}
    </p>
  );
}

// Edición de un huésped (recepción: dentro de la ventana de tiempo; admin: siempre).
//   venceEn: hora (ms) hasta la que se puede editar, o null si no hay límite
//   medios: los medios de pago que se ofrecen hoy [{ id, nombre }] (null = todavía no se cargaron: no se pide)
//   onGuardar(datos, habitacion, medioPago) -> { ok, mensaje?, campos? }
export default function EditarHuesped({ fila, venceEn = null, medios = null, onGuardar, onCerrar }) {
  const [valores, setValores] = useState(() => valoresDesdeDatos(fila.datos, fila.habitacion, fila.medio_pago_id));
  // Opciones del selector: lo que se ofrece hoy + el medio que el huésped ya tiene, si después lo quitaron de la lista.
  const opciones = medios && fila.medio_pago_id != null && !medios.some((m) => m.id === fila.medio_pago_id)
    ? [...medios, { id: fila.medio_pago_id, nombre: `${fila.medio_pago ?? 'Otro'} (ya no se ofrece)` }]
    : medios;
  const [errores, setErrores] = useState({});
  const [aviso, setAviso] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [vencido, setVencido] = useState(() => venceEn != null && venceEn <= Date.now());
  const cerrado = useRef(false);
  const formulario = useRef(null);

  // En desarrollo React monta, desmonta y vuelve a montar (StrictMode): hay que "reabrir" al montar o nunca se cierra.
  useEffect(() => {
    cerrado.current = false;
    return () => { cerrado.current = true; };
  }, []);

  // Pasado el tiempo se bloquea el guardado (la base también lo rechaza).
  useEffect(() => {
    if (venceEn == null) return undefined;
    const falta = venceEn - Date.now();
    if (falta <= 0) { setVencido(true); return undefined; }
    const t = setTimeout(() => setVencido(true), falta);
    return () => clearTimeout(t);
  }, [venceEn]);

  // El teléfono se guarda como +5491155551234: al editar se muestra con su país y el número en formato local.
  useEffect(() => {
    const guardado = fila.datos.telefono ?? '';
    if (!guardado) return undefined;
    let vivo = true;
    cargarTelefono().then((lib) => {
      const p = lib.parsePhoneNumberFromString(guardado);
      if (!vivo || !p?.country) return;
      setValores((v) => (v.telefonoNumero === guardado ? { ...v, telefonoPais: p.country, telefonoNumero: p.formatNational() } : v));
    }).catch(() => { /* sin librería queda el número tal cual está guardado */ });
    return () => { vivo = false; };
  }, [fila.datos.telefono]);

  const cambia = (clave, valor) => {
    setValores((v) => ({ ...v, [clave]: valor }));
    if (errores[clave]) setErrores((e) => ({ ...e, [clave]: undefined }));
  };

  const guardar = async (e) => {
    e.preventDefault();
    if (guardando || vencido) return;
    setAviso('');
    let lib = null;
    try { lib = await cargarTelefono(); } catch { /* sin librería: no se puede validar el teléfono */ }
    const r = validarHuesped(valores, lib, { conHabitacion: true });
    if (opciones && !opciones.some((m) => String(m.id) === String(valores.medio_pago))) r.errores.medio_pago = mensajeDe('medio_pago');
    if (Object.keys(r.errores).length) {
      setErrores(r.errores);
      setAviso('Revisá los campos marcados en rojo.');
      enfocarPrimerError(formulario.current);
      return;
    }
    setGuardando(true);
    try {
      const res = await onGuardar(r.datos, r.habitacion, opciones ? Number(valores.medio_pago) : null);
      if (cerrado.current) return;
      if (res.ok) { onCerrar(true); return; }
      if (res.campos?.length) {
        const mapa = {};
        res.campos.forEach((c) => { mapa[c] = mensajeDe(c, valores.doc_tipo); });
        setErrores(mapa);
      }
      setAviso(res.mensaje || 'No se pudo guardar.');
    } catch {
      if (!cerrado.current) setAviso('No se pudo conectar. Revisá tu conexión e intentá de nuevo.');
    } finally {
      if (!cerrado.current) setGuardando(false);
    }
  };

  const nombre = `${fila.datos.nombre ?? ''} ${fila.datos.apellido ?? ''}`.trim();
  return (
    <Modal titulo={`Editar a ${nombre}`} onCerrar={() => onCerrar(false)}>
      {venceEn != null && <NotaTiempo venceEn={venceEn} />}
      <form onSubmit={guardar} noValidate ref={formulario}>
        <FormHuesped valores={valores} errores={errores} onCambio={cambia} conHabitacion sugerencias={false} medios={opciones} deshabilitado={guardando || vencido} />
        {aviso && <p className="ed-error" role="alert">{aviso}</p>}
        <div className="btns modal-pie">
          <button type="submit" className="btn" disabled={guardando || vencido}>{guardando ? 'Guardando…' : 'Guardar cambios'}</button>
          <button type="button" className="btn claro" onClick={() => onCerrar(false)}>Cancelar</button>
        </div>
      </form>
    </Modal>
  );
}
