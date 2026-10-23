import { useEffect, useRef, useState } from 'react';

// Cámara dentro de la página. Al tocar "Sacar foto" NO se abre la aplicación de cámara del celular: en un celular con poca memoria
// el sistema cierra el navegador mientras está en segundo plano y, al volver, la página arranca de nuevo y la foto se pierde. Acá la
// imagen de la cámara se ve en la misma página y la foto se saca de un cuadro de ese video (1280x720 alcanza de sobra para leer un documento
// que ocupa el recuadro; pesa unos pocos MB en vez de decenas, y la cámara trabaja menos en un celular de poco rendimiento). Si el navegador no tiene cámara web o no da permiso, se ofrece la cámara del celular o la galería.

const ESPERA_PERMISO_MS = 25000; // abrir la cámara incluye que el huésped lea el pedido de permiso del navegador y lo acepte
const ESPERA_IMAGEN_MS = 10000; // y una vez abierta, la primera imagen tiene que llegar en este tiempo
const LADO_MAX = 1600;

export const hayCamara = () => typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function' && window.isSecureContext !== false;

const MENSAJES = {
  NotAllowedError: 'No tenemos permiso para usar la cámara desde esta página.',
  SecurityError: 'No tenemos permiso para usar la cámara desde esta página.',
  NotFoundError: 'No encontramos una cámara en este dispositivo.',
  OverconstrainedError: 'No encontramos una cámara en este dispositivo.',
  NotReadableError: 'La cámara está ocupada con otra aplicación.',
  AbortError: 'La cámara no se pudo abrir.'
};

// onFoto(lienzo): se llama con un lienzo con la foto (el que la recibe se encarga de liberarlo). onCerrar(): cancelar.
// onUsarCelular(): abrir la cámara del celular (fuera de la página). onFalla(): la cámara de la página no anduvo (para no insistir).
export default function CamaraFoto({ onFoto, onCerrar, onUsarCelular, onFalla }) {
  const caja = useRef(null);
  const video = useRef(null);
  const flujo = useRef(null);
  const cerrar = useRef(onCerrar);
  const falla = useRef(onFalla);
  const [estado, setEstado] = useState('iniciando'); // iniciando | lista | error
  const [error, setError] = useState('');
  const [luz, setLuz] = useState(null); // null: no hay linterna · false / true: apagada / prendida
  const abridor = useRef(document.activeElement);

  useEffect(() => { cerrar.current = onCerrar; falla.current = onFalla; });

  const detener = () => {
    flujo.current?.getTracks().forEach((t) => t.stop());
    flujo.current = null;
    if (video.current) video.current.srcObject = null;
  };

  useEffect(() => {
    let vivo = true;
    let espera = 0;
    const fallar = (e, texto) => {
      if (!vivo) return;
      clearTimeout(espera);
      detener();
      setError(`${texto ?? MENSAJES[e?.name] ?? 'No pudimos abrir la cámara.'} Podés usar la cámara del celular o elegir una foto de la galería.`);
      setEstado('error');
      falla.current?.();
    };

    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    caja.current?.focus();
    const alTecla = (e) => { if (e.key === 'Escape') cerrar.current(); };
    window.addEventListener('keydown', alTecla);

    (async () => {
      try {
        espera = setTimeout(() => fallar(null, 'La cámara no responde.'), ESPERA_PERMISO_MS);
        let s;
        try {
          s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 15 } }, audio: false });
        } catch (e) {
          if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError' || e?.name === 'NotReadableError') throw e;
          s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); // algunos navegadores no entienden las medidas pedidas
        }
        if (!vivo) { s.getTracks().forEach((t) => t.stop()); return; }
        clearTimeout(espera);
        espera = setTimeout(() => fallar(null, 'La cámara no responde.'), ESPERA_IMAGEN_MS);
        flujo.current = s;
        const pista = s.getVideoTracks()[0];
        pista?.addEventListener('ended', () => fallar(null, 'La cámara se detuvo.'));
        try { if (pista?.getCapabilities?.().torch) setLuz(false); } catch { /* sin linterna */ }
        const v = video.current;
        v.srcObject = s;
        const listo = () => {
          if (!vivo || !v.videoWidth) return;
          clearTimeout(espera);
          setEstado('lista');
        };
        v.addEventListener('playing', listo);
        v.addEventListener('loadeddata', listo);
        await v.play().catch(() => {}); // si el navegador no la deja arrancar sola, queda esperando el tiempo máximo
        listo();
      } catch (e) {
        fallar(e);
      }
    })();

    return () => {
      vivo = false;
      clearTimeout(espera);
      detener();
      window.removeEventListener('keydown', alTecla);
      document.body.style.overflow = overflow;
      setTimeout(() => abridor.current?.focus?.(), 0);
    };
  }, []);

  const sacar = () => {
    const v = video.current;
    if (estado !== 'lista' || !v?.videoWidth) return;
    const esc = Math.min(1, LADO_MAX / Math.max(v.videoWidth, v.videoHeight));
    const lienzo = document.createElement('canvas');
    lienzo.width = Math.max(1, Math.round(v.videoWidth * esc));
    lienzo.height = Math.max(1, Math.round(v.videoHeight * esc));
    lienzo.getContext('2d').drawImage(v, 0, 0, lienzo.width, lienzo.height);
    detener();
    onFoto(lienzo);
  };

  const alternarLuz = async () => {
    try {
      await flujo.current?.getVideoTracks()[0]?.applyConstraints({ advanced: [{ torch: !luz }] });
      setLuz(!luz);
    } catch { /* la linterna no respondió: se deja como estaba */ }
  };

  return (
    <div className="camara" role="dialog" aria-modal="true" aria-label="Cámara para sacar la foto del documento" tabIndex={-1} ref={caja}>
      <div className="camara-visor">
        <video ref={video} className="camara-video" autoPlay playsInline muted />
        {estado === 'lista' && <div className="camara-marco" aria-hidden="true" />}
        {estado === 'iniciando' && <p className="camara-msg" role="status">Abriendo la cámara… Si el navegador te pide permiso, tocá «Permitir».</p>}
        {estado === 'error' && <p className="camara-msg" role="alert">{error}</p>}
      </div>
      {estado === 'lista' && <p className="camara-ayuda">Poné el documento dentro del recuadro, con buena luz y sin reflejos, y tocá el botón blanco.</p>}
      <div className="camara-barra">
        <button type="button" className="camara-sec" onClick={() => cerrar.current()}>Cancelar</button>
        <button type="button" className="camara-disparo" onClick={sacar} disabled={estado !== 'lista'} aria-label="Sacar la foto" />
        {luz === null ? <span className="camara-sec camara-sec-vacio" aria-hidden="true" /> : (
          <button type="button" className="camara-sec" onClick={alternarLuz} aria-pressed={luz}>{luz ? 'Apagar luz' : 'Prender luz'}</button>
        )}
      </div>
      <button type="button" className="camara-celular" onClick={onUsarCelular}>Usar la cámara del celular</button>
    </div>
  );
}
