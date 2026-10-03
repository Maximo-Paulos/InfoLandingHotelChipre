import { useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';
import Icon from '../components/Icon.jsx';
import { BtnWa, Box, Cabecera, Datos, LinkMaps, Pasos, useToast } from '../components/ui.jsx';
import { D, H, hora, maps, tel } from '../lib.js';

export function Checkin() {
  const c = D.checkin;
  return (
    <>
      <Cabecera num="01" eyebrow="Tu llegada" titulo="Check-in" />
      <section className="big" aria-label="Horario de check-in">
        <div><p>Tu habitación está lista desde las</p><p className="hora">{H.horarios.checkin}</p></div>
        <p className="al">Recepción abierta las 24 h</p>
      </section>
      <h2 className="sub">Cómo es</h2>
      <Pasos lista={c.pasos} />
      <Box titulo={c.tempranoTitulo} texto={c.tempranoTexto} />
      <Datos lista={c.datos} />
      <div className="btns">
        <a className="btn" href={maps(`${H.nombre} ${H.direccion}`)} target="_blank" rel="noopener noreferrer">
          <Icon name="mapa" size={20} />Cómo llegar
        </a>
        <BtnWa texto="Avisar mi horario de llegada" msg="Hola, llego al hotel a las __:__. Mi nombre es " cls="claro" />
      </div>
    </>
  );
}

// Copia al portapapeles, con alternativa para navegadores que no lo permiten.
function copiar(texto) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(texto);
  return new Promise((ok, no) => {
    const t = document.createElement('textarea');
    t.value = texto;
    t.setAttribute('readonly', '');
    t.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(t);
    t.select();
    try { document.execCommand('copy') ? ok() : no(); } catch (e) { no(e); }
    document.body.removeChild(t);
  });
}

// Formato estándar WIFI:T:WPA;S:red;P:clave;; que la cámara del celular entiende.
function qrWifi() {
  const esc = (s) => s.replace(/([\;,":])/g, '\\$1');
  const q = qrcode(0, 'M');
  q.addData(`WIFI:T:WPA;S:${esc(H.wifi.red)};P:${esc(H.wifi.clave)};;`);
  q.make();
  return q.createSvgTag({ scalable: true, margin: 0 });
}

export function Wifi() {
  const toast = useToast();
  const svg = useMemo(qrWifi, []);
  const alCopiar = () => copiar(H.wifi.clave).then(
    () => toast('¡Clave copiada!'),
    () => toast(`No se pudo copiar. La clave es ${H.wifi.clave}`)
  );
  return (
    <>
      <Cabecera num="02" eyebrow="Conectate en un toque" titulo="Wi-Fi" />
      <section className="wifi" aria-label="Datos de la red">
        <p className="etq">Red</p>
        <p className="red">{H.wifi.red}</p>
        <hr />
        <p className="etq">Clave</p>
        <p className="clave">{H.wifi.clave}</p>
        <button type="button" className="btn" style={{ marginTop: 16 }} onClick={alCopiar}>
          <Icon name="copiar" size={20} /><span>Copiar clave</span>
        </button>
      </section>
      <h2 className="sub">En 3 pasos</h2>
      <ol className="pasos pasos-wifi">
        <li><span className="n" aria-hidden="true">01</span><p>Tocá <b>Copiar clave</b>.</p></li>
        <li><span className="n" aria-hidden="true">02</span><p>Abrí <b>Ajustes › Wi-Fi</b> y elegí <b>{H.wifi.red}</b>.</p></li>
        <li><span className="n" aria-hidden="true">03</span><p>Pegá la clave y listo: ya tenés internet en todo el hotel.</p></li>
      </ol>
      <section className="qr" aria-label="Código QR del Wi-Fi">
        <div className="img" role="img" aria-label="Código QR para conectarse al Wi-Fi" dangerouslySetInnerHTML={{ __html: svg }} />
        <div>
          <h2>¿Viene alguien con vos?</h2>
          <p>Que escanee este código con la cámara: se conecta solo, sin escribir la clave.</p>
        </div>
      </section>
      <Box azul titulo="¿No conecta?" texto="Apagá y prendé el Wi-Fi del celular, o tocá «Olvidar esta red» y volvé a intentar. Si sigue sin andar, escribinos y lo resolvemos.">
        <BtnWa mini texto="Pedir ayuda" msg="Hola, no logro conectarme al Wi-Fi." cls="negro" />
      </Box>
    </>
  );
}

export function Emergencias() {
  const E = D.emergencias;
  return (
    <>
      <Cabecera num="09" eyebrow="Tocá para llamar" titulo="Emergencias" />
      <div style={{ marginTop: 14 }}>
        {E.publicos.map((n) => (
          <a key={n.numero} className="tel" href={tel(n.numero)} aria-label={`Llamar al ${n.numero}, ${n.nombre}`}>
            <span className="num">{n.numero}</span><span className="nom">{n.nombre}</span><Icon name="tel" size={20} />
          </a>
        ))}
      </div>
      <p className="tit-sec">Del hotel · las 24 h</p>
      {E.internos.map((n) => (
        <a key={n.interno} className="tel interno" href={tel(n.tel)} aria-label={`Llamar a ${n.nombre}, interno ${n.interno}`}>
          <span className="int"><small>Interno</small><b>{n.interno}</b></span>
          <span className="nom"><b>{n.nombre}</b><span>{n.detalle}</span></span>
          <Icon name="tel" size={20} />
        </a>
      ))}
      <div className="btns">
        <a className="btn terra" href={tel(H.telefonoRecepcion)}><Icon name="tel" size={20} sw={1.7} />Llamar a recepción</a>
        <BtnWa texto="Escribir por WhatsApp" msg="Hola, necesito ayuda urgente." cls="claro" />
      </div>
      <div className="datos">
        <div className="dato">
          <Icon name="hospital" size={22} />
          <div>
            <b>Hospital más cercano</b>
            <p>{E.hospital.nombre} · a {E.hospital.distancia}. Guardia las 24 h.</p>
            <LinkMaps q={E.hospital.consulta} texto="Cómo llegar" />
          </div>
        </div>
        <div className="dato">
          <Icon name="salida" size={22} />
          <div><b>Si hay que evacuar</b><p>{E.evacuacion}</p></div>
        </div>
      </div>
    </>
  );
}

const CLAVE_CHECKOUT = 'chipre-checkout';
function leerChecks() {
  try { return JSON.parse(localStorage.getItem(CLAVE_CHECKOUT)) || []; } catch { return []; }
}

export function Checkout() {
  const C = D.checkout;
  const [hechos, setHechos] = useState(leerChecks);

  const alternar = (i) => {
    const sig = C.lista.map((_, k) => (k === i ? !hechos[k] : !!hechos[k]));
    setHechos(sig);
    try { localStorage.setItem(CLAVE_CHECKOUT, JSON.stringify(sig)); } catch { /* sin almacenamiento: sigue andando */ }
  };
  const listos = C.lista.filter((_, i) => hechos[i]).length;

  return (
    <>
      <Cabecera num="11" eyebrow="Antes de irte" titulo="Check-out" />
      <section className="big" aria-label="Horario de check-out">
        <div><p>Dejá la habitación hasta las</p><p className="hora">{H.horarios.checkout}</p></div>
        <p className="al">Late check-out hasta las {hora(H.horarios.lateCheckout)}, según disponibilidad</p>
      </section>
      <div className="head-row">
        <h2>Antes de salir</h2>
        <p className="progreso" aria-live="polite">{listos === C.lista.length ? '¡Todo listo!' : `${listos} de ${C.lista.length} listos`}</p>
      </div>
      <ul className="lista check">
        {C.lista.map((t, i) => (
          <li key={t}>
            <label>
              <input type="checkbox" checked={!!hechos[i]} onChange={() => alternar(i)} />
              <span>{t}</span>
            </label>
          </li>
        ))}
      </ul>
      <Datos lista={C.datos} />
      <div className="btns">
        <BtnWa texto="Pedir late check-out" msg={`Hola, quisiera pedir late check-out hasta las ${H.horarios.lateCheckout}. Habitación: `} />
        <BtnWa texto="Pedir un taxi" msg="Hola, necesito un taxi para las __:__." cls="claro" />
      </div>
      <div className="gracias">
        <p>¡Gracias por elegirnos!</p>
        <a className="maps" href="#/resena">Dejanos tu reseña <Icon name="ext" size={16} sw={2} /></a>
      </div>
    </>
  );
}
