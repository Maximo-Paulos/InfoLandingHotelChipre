import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { Cajas, V } from '../components/Editable.jsx';
import { Cabecera } from '../components/ui.jsx';
import { useDatos } from '../data/DataContext.jsx';
import { idiomaActual } from '../idioma.js';
import { VACIO } from './campos.js';
import { canjearCodigo, enviarCheckin, estadoCheckin, sesionCheckin } from './checkinApi.js';
import { comprimirImagen } from './comprimir.js';
import FormHuesped from './FormHuesped.jsx';
import { subirFoto } from './foto.js';
import { cargarTelefono } from './telefono.js';
import { enfocarPrimerError, esperar, minSeg, useAhora } from './util.js';
import { mensajeDe, validarHuesped } from './validar.js';

const BORRADOR = 'chipre-registro';
const REGRESO_MS = 6000;

const leerBorrador = () => {
  try { return JSON.parse(sessionStorage.getItem(BORRADOR) ?? 'null'); } catch { return null; }
};
const guardarBorrador = (b) => { try { sessionStorage.setItem(BORRADOR, JSON.stringify(b)); } catch { /* sin almacenamiento */ } };
const borrarBorrador = () => { try { sessionStorage.removeItem(BORRADOR); } catch { /* sin almacenamiento */ } };

// Los textos del check-in se editan desde el panel; el huésped ve el recorrido real.
export default function Registro() {
  const { editing } = useDatos();
  return editing ? <RegistroTextos /> : <RegistroHuesped />;
}

const TEXTOS = [
  ['registro.eyebrow', 'Texto chico de arriba'], ['registro.titulo', 'Título de la pantalla'], ['registro.lead', 'Bajada'],
  ['registro.codigoTitulo', 'Paso 1: título del código'], ['registro.codigoAyuda', 'Paso 1: ayuda del código'], ['registro.btnCodigo', 'Paso 1: botón'],
  ['registro.errCodigo', 'Mensaje: código incorrecto o vencido'], ['registro.errIntentos', 'Mensaje: demasiados intentos'],
  ['registro.errNoDisponible', 'Mensaje: check-in apagado'], ['registro.errRed', 'Mensaje: sin conexión'],
  ['registro.formTitulo', 'Paso 2: título del formulario'], ['registro.tiempo', 'Paso 2: texto de la cuenta regresiva ("Te quedan 29:10")'],
  ['registro.campos.nombre', 'Campo: nombre'], ['registro.campos.apellido', 'Campo: apellido'], ['registro.campos.email', 'Campo: email'],
  ['registro.campos.telefono', 'Campo: teléfono'], ['registro.campos.nacionalidad', 'Campo: nacionalidad'], ['registro.campos.localidad', 'Campo: localidad'],
  ['registro.campos.domicilio', 'Campo: domicilio'], ['registro.campos.docTipo', 'Campo: tipo de documento'], ['registro.campos.docNumero', 'Campo: número de documento'],
  ['registro.campos.foto', 'Campo: foto del documento'], ['registro.fotoAyuda', 'Foto: ayuda'], ['registro.btnSacarFoto', 'Foto: botón sacar'],
  ['registro.btnGaleria', 'Foto: botón galería'], ['registro.btnCambiarFoto', 'Foto: botón cambiar'], ['registro.btnQuitarFoto', 'Foto: botón quitar'],
  ['registro.consentimiento', 'Aceptación: texto antes del link'], ['registro.consentimientoLink', 'Aceptación: texto del link a los Términos'],
  ['registro.btnEnviar', 'Botón de enviar'], ['registro.errCampos', 'Mensaje: campos con error'], ['registro.errSesion', 'Mensaje: se terminó el tiempo'],
  ['registro.okTitulo', 'Pantalla final: título'], ['registro.okTexto', 'Pantalla final: texto'], ['registro.btnInicio', 'Pantalla final: botón']
];

function RegistroTextos() {
  return (
    <>
      <Cabecera num="14" id="registro" />
      <p className="note">Acá cambiás los textos del check-in que ve el huésped. Los datos del formulario, las reglas y los códigos se manejan desde <b>Ver huéspedes</b>, en el inicio del panel.</p>
      <Cajas ps={TEXTOS.slice(3)} />
    </>
  );
}

function RegistroHuesped() {
  const { D } = useDatos();
  const R = D.registro;
  const [paso, setPaso] = useState('inicio'); // inicio | apagado | codigo | form | ok | vencido
  const [codigo, setCodigo] = useState('');
  const [errorCodigo, setErrorCodigo] = useState('');
  const [sesion, setSesion] = useState(null); // { token, venceEn, foto }
  const [valores, setValores] = useState(VACIO);
  const [errores, setErrores] = useState({});
  const [acepta, setAcepta] = useState(false);
  const [errAcepta, setErrAcepta] = useState(false);
  const [foto, setFoto] = useState(null); // { base64, vista, bytes }
  const [fotoSubida, setFotoSubida] = useState(false);
  const [errFoto, setErrFoto] = useState('');
  const [estadoFoto, setEstadoFoto] = useState(''); // '' | subiendo | error
  const [aviso, setAviso] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [cargaFalla, setCargaFalla] = useState(false);
  const [reintento, setReintento] = useState(0);
  const formulario = useRef(null);
  const camara = useRef(null);
  const galeria = useRef(null);
  const ahora = useAhora(1000);

  // Al entrar: ¿está encendido el check-in? ¿hay una sesión a medio completar en esta pestaña?
  useEffect(() => {
    let vivo = true;
    setCargaFalla(false);
    (async () => {
      try {
        const b = leerBorrador();
        if (b?.token && b.venceEn > Date.now()) {
          const s = await sesionCheckin(b.token);
          if (!vivo) return;
          if (s.ok) {
            setSesion({ token: b.token, venceEn: Date.now() + s.vence_seg * 1000, foto: s.foto });
            setValores({ ...VACIO, ...b.valores });
            setAcepta(!!b.acepta);
            setFotoSubida(!!s.foto?.listo);
            setPaso('form');
            return;
          }
          borrarBorrador();
        }
        const e = await estadoCheckin();
        if (vivo) setPaso(e.activo ? 'codigo' : 'apagado');
      } catch {
        if (vivo) setCargaFalla(true);
      }
    })();
    return () => { vivo = false; };
  }, [reintento]);

  // Guarda lo escrito por si se recarga o se cambia de idioma (la foto no se guarda).
  useEffect(() => {
    if (paso === 'form' && sesion) guardarBorrador({ token: sesion.token, venceEn: sesion.venceEn, valores, acepta });
  }, [paso, sesion, valores, acepta]);

  const restante = sesion ? Math.max(0, Math.ceil((sesion.venceEn - ahora) / 1000)) : 0;
  useEffect(() => {
    if (paso === 'form' && sesion && restante === 0) { borrarBorrador(); setPaso('vencido'); }
  }, [paso, sesion, restante]);

  // Al terminar, vuelve solo al menú de la guía.
  useEffect(() => {
    if (paso !== 'ok') return undefined;
    const t = setTimeout(() => { location.hash = '#/'; }, REGRESO_MS);
    return () => clearTimeout(t);
  }, [paso]);

  const mensajeCodigo = (error) => ({
    demasiados_intentos: R.errIntentos, no_disponible: R.errNoDisponible
  }[error] ?? R.errCodigo);

  const probarCodigo = useCallback(async (valor) => {
    setEnviando(true);
    setErrorCodigo('');
    try {
      const r = await canjearCodigo(valor);
      if (r.ok) {
        setSesion({ token: r.token, venceEn: Date.now() + r.vence_seg * 1000, foto: r.foto });
        setFotoSubida(false);
        setPaso('form');
        window.scrollTo(0, 0);
      } else {
        if (r.error === 'no_disponible') setPaso('apagado');
        setErrorCodigo(mensajeCodigo(r.error));
      }
    } catch {
      setErrorCodigo(R.errRed);
    } finally {
      setEnviando(false);
      setCodigo('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [R]);

  const alCodigo = (e) => {
    const v = e.target.value.replace(/\D/g, '').slice(0, 6);
    setCodigo(v);
    if (v.length === 6 && !enviando) probarCodigo(v);
  };

  const cambia = (clave, valor) => {
    setValores((v) => ({ ...v, [clave]: valor }));
    if (errores[clave]) setErrores((e) => ({ ...e, [clave]: undefined }));
  };

  const elegirFoto = async (e) => {
    const archivo = e.target.files?.[0];
    e.target.value = '';
    if (!archivo) return;
    setErrFoto('');
    try {
      const r = await comprimirImagen(archivo);
      if (foto?.vista) URL.revokeObjectURL(foto.vista);
      setFoto(r);
      setFotoSubida(false);
      setEstadoFoto('');
    } catch (err) {
      setErrFoto(err.codigo === 'pesada' ? 'La foto es demasiado pesada. Probá con otra.' : 'No pudimos usar ese archivo. Elegí una foto (JPG o PNG).');
    }
  };

  const quitarFoto = () => {
    if (foto?.vista) URL.revokeObjectURL(foto.vista);
    setFoto(null);
    setFotoSubida(false);
    setEstadoFoto('');
    setErrFoto('');
  };

  // Sube la foto al Drive del hotel y espera a que la base la reconozca. Devuelve true si quedó guardada.
  const guardarFoto = async () => {
    setEstadoFoto('subiendo');
    const r = await subirFoto({ url: sesion.foto.url, ticket: sesion.foto.ticket, nombre: valores.nombre, apellido: valores.apellido, imagen: foto.base64 });
    let listo = r.ok === true;
    for (let i = 0; i < 4 && !listo; i += 1) {
      if (r.ok === false && i === 0) break;
      await esperar(1500);
      const s = await sesionCheckin(sesion.token).catch(() => null);
      listo = !!s?.foto?.listo;
    }
    if (listo) { setFotoSubida(true); setEstadoFoto(''); return true; }
    setEstadoFoto('error');
    return false;
  };

  const enviar = async (e, sinFoto = false) => {
    e?.preventDefault();
    if (enviando) return;
    setAviso('');
    setErrFoto('');
    let lib = null;
    try { lib = await cargarTelefono(); } catch { /* sin librería no se puede validar el teléfono */ }
    const v = validarHuesped(valores, lib);
    const modoFoto = sesion.foto?.modo;
    const faltaFoto = !sinFoto && modoFoto === 'obligatoria' && !foto && !fotoSubida;
    if (Object.keys(v.errores).length || !acepta || faltaFoto) {
      setErrores(v.errores);
      setErrAcepta(!acepta);
      if (faltaFoto) setErrFoto('Falta la foto del documento.');
      setAviso(R.errCampos);
      enfocarPrimerError(formulario.current);
      return;
    }
    setEnviando(true);
    try {
      if (!sinFoto && foto && !fotoSubida) {
        const listo = await guardarFoto();
        if (!listo) { setErrFoto('No pudimos subir la foto. Probá de nuevo.' + (modoFoto === 'obligatoria' ? '' : ' Si querés, podés enviar sin foto.')); return; }
      }
      const r = await enviarCheckin(sesion.token, v.datos, idiomaActual(), true);
      if (r.ok) {
        borrarBorrador();
        if (foto?.vista) URL.revokeObjectURL(foto.vista);
        setFoto(null);
        setValores(VACIO);
        setPaso('ok');
        window.scrollTo(0, 0);
      } else if (r.error === 'sesion_invalida' || r.error === 'no_disponible') {
        borrarBorrador();
        setPaso('vencido');
      } else if (r.error === 'datos_invalidos') {
        const mapa = {};
        (r.campos ?? []).forEach((c) => { mapa[c === 'telefono' ? 'telefono' : c] = mensajeDe(c, valores.doc_tipo); });
        setErrores(mapa);
        setAviso(R.errCampos);
        enfocarPrimerError(formulario.current);
      } else if (r.error === 'foto_requerida') {
        setErrFoto('Falta la foto del documento.');
      } else {
        setAviso(R.errRed);
      }
    } catch {
      setAviso(R.errRed);
    } finally {
      setEnviando(false);
    }
  };

  const nuevoCodigo = () => {
    borrarBorrador();
    setSesion(null);
    setCodigo('');
    setErrorCodigo('');
    setPaso('codigo');
  };

  let cuerpo;
  if (cargaFalla) {
    cuerpo = (
      <>
        <p className="ed-error" role="alert">{R.errRed}</p>
        <div className="btns"><button type="button" className="btn" onClick={() => setReintento((n) => n + 1)}>Reintentar</button></div>
      </>
    );
  } else if (paso === 'inicio') {
    cuerpo = <p className="intro" role="status">Cargando…</p>;
  } else if (paso === 'apagado') {
    cuerpo = (
      <>
        <p className="note" role="status">{R.errNoDisponible}</p>
        <div className="btns"><a className="btn claro" href="#/">Volver al inicio</a></div>
      </>
    );
  } else if (paso === 'codigo') {
    cuerpo = (
      <>
        <h2 className="sub"><V p="registro.codigoTitulo" /></h2>
        <p className="intro"><V p="registro.codigoAyuda" /></p>
        <form onSubmit={(e) => { e.preventDefault(); if (codigo.length === 6 && !enviando) probarCodigo(codigo); }}>
          <label className="solo-lector" htmlFor="registro-codigo">Código de 6 números</label>
          <input id="registro-codigo" className="codigo-input" value={codigo} onChange={alCodigo} inputMode="numeric" autoComplete="one-time-code"
            pattern="[0-9]*" maxLength={7} placeholder="······" disabled={enviando} autoFocus aria-describedby={errorCodigo ? 'registro-codigo-error' : undefined} aria-invalid={errorCodigo ? 'true' : undefined} />
          {errorCodigo && <p className="ed-error" id="registro-codigo-error" role="alert">{errorCodigo}</p>}
          <div className="btns">
            <button type="submit" className="btn" disabled={enviando || codigo.length !== 6}>{enviando ? 'Verificando…' : <V p="registro.btnCodigo" />}</button>
          </div>
        </form>
      </>
    );
  } else if (paso === 'vencido') {
    cuerpo = (
      <>
        <p className="ed-error" role="alert">{R.errSesion}</p>
        <div className="btns"><button type="button" className="btn" onClick={nuevoCodigo}>Ingresar otro código</button></div>
      </>
    );
  } else if (paso === 'ok') {
    cuerpo = (
      <div className="exito" role="status">
        <span className="exito-icono" aria-hidden="true"><Icon name="ok" size={40} sw={2.2} /></span>
        <h2><V p="registro.okTitulo" /></h2>
        <p><V p="registro.okTexto" /></p>
        <div className="btns"><a className="btn" href="#/"><V p="registro.btnInicio" /></a></div>
      </div>
    );
  } else {
    const fotoInfo = sesion?.foto;
    cuerpo = (
      <form onSubmit={enviar} noValidate ref={formulario}>
        <div className="form-cab">
          <h2 className="sub"><V p="registro.formTitulo" /></h2>
          <span className={`chip tiempo${restante < 120 ? ' poco' : ''}`} role="timer" aria-label={`${R.tiempo} ${minSeg(restante)}`}><V p="registro.tiempo" /> {minSeg(restante)}</span>
        </div>
        <FormHuesped valores={valores} errores={errores} onCambio={cambia} etiquetas={{ ...R.campos, telefono: R.campos.telefono }} deshabilitado={enviando} />

        {fotoInfo && (
          <div className={`campo foto-campo${errFoto ? ' error' : ''}`}>
            <span className="etq">{R.campos.foto}{fotoInfo.modo === 'opcional' ? ' (opcional)' : ''}</span>
            {foto ? (
              <img className="foto-prev" src={foto.vista} alt="Vista previa de la foto del documento" />
            ) : (
              <div className="foto-vacia"><Icon name="camara" size={30} sw={1.5} /><p><V p="registro.fotoAyuda" /></p></div>
            )}
            <div className="foto-botones">
              <button type="button" className="btn claro mini" onClick={() => camara.current?.click()} disabled={enviando}>
                <Icon name="camara" size={18} sw={1.7} /> {foto ? <V p="registro.btnCambiarFoto" /> : <V p="registro.btnSacarFoto" />}
              </button>
              <button type="button" className="btn claro mini" onClick={() => galeria.current?.click()} disabled={enviando}>
                <Icon name="imagen" size={18} sw={1.7} /> <V p="registro.btnGaleria" />
              </button>
              {foto && <button type="button" className="btn claro mini" onClick={quitarFoto} disabled={enviando}><V p="registro.btnQuitarFoto" /></button>}
            </div>
            <input ref={camara} type="file" accept="image/*" capture="environment" hidden onChange={elegirFoto} />
            <input ref={galeria} type="file" accept="image/*" hidden onChange={elegirFoto} />
            {estadoFoto === 'subiendo' && <p className="ayuda" role="status">Subiendo la foto…</p>}
            {fotoSubida && foto && <p className="ayuda ok" role="status">Foto guardada.</p>}
            {errFoto && <p className="msg" role="alert">{errFoto}</p>}
            {estadoFoto === 'error' && fotoInfo.modo !== 'obligatoria' && (
              <button type="button" className="btn claro mini" onClick={(e) => enviar(e, true)} disabled={enviando}>Enviar sin foto</button>
            )}
          </div>
        )}

        <div className={`campo acepto${errAcepta ? ' error' : ''}`}>
          <label>
            <input type="checkbox" checked={acepta} onChange={(e) => { setAcepta(e.target.checked); setErrAcepta(false); }} disabled={enviando} aria-invalid={errAcepta ? 'true' : undefined} />
            <span><V p="registro.consentimiento" /> <a href="#/terminos" target="_blank" rel="noopener noreferrer"><V p="registro.consentimientoLink" /></a>.</span>
          </label>
          {errAcepta && <p className="msg" role="alert">Tenés que aceptar para poder enviar.</p>}
        </div>

        {aviso && <p className="ed-error" role="alert">{aviso}</p>}
        <div className="btns">
          <button type="submit" className="btn" disabled={enviando}>{enviando ? (estadoFoto === 'subiendo' ? 'Subiendo foto…' : 'Enviando…') : <V p="registro.btnEnviar" />}</button>
        </div>
      </form>
    );
  }

  return (
    <>
      <Cabecera num="14" id="registro" />
      {cuerpo}
    </>
  );
}
