import { useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';
import Icon from '../components/Icon.jsx';
import { Btn, Cajas, Lista, T, V } from '../components/Editable.jsx';
import { Box, Cabecera, Datos, Pasos, useToast } from '../components/ui.jsx';
import { useDatos } from '../data/DataContext.jsx';
import { hora, maps, tel } from '../lib.js';

export function Checkin() {
  const { D } = useDatos();
  return (
    <>
      <Cabecera num="01" id="checkin" />
      <section className="big" aria-label="Horario de check-in">
        <div><p><V p="checkin.horaLead" /></p><p className="hora"><V p="hotel.horarios.checkin" /></p></div>
        <p className="al"><V p="checkin.recepcion" /></p>
      </section>
      <Cajas ps={[['checkin.horaLead', 'Texto sobre la hora'], ['hotel.horarios.checkin', 'Hora de check-in (ej. 15:00)'], ['checkin.recepcion', 'Texto al costado de la hora']]} />
      <T as="h2" className="sub" p="checkin.subtitulo" />
      <Pasos p="checkin.pasos" />
      <Box titulo="checkin.tempranoTitulo" texto="checkin.tempranoTexto" />
      <dl>
        <div className="dato">
          <Icon name="pin" size={22} />
          <div><dt><V p="checkin.direccionEtq" /></dt><dd><V p="hotel.direccion" /></dd></div>
        </div>
      </dl>
      <Cajas ps={[['checkin.direccionEtq', 'Título del dato'], ['hotel.direccion', 'Dirección del hotel']]} />
      <Datos p="checkin.datos" />
      <div className="btns">
        <Btn label="checkin.btnMapa" icon="mapa" href={maps(`${D.hotel.nombre} ${D.hotel.direccion}`)} />
        <Btn label="checkin.btnAvisar" wa="checkin.msgAvisar" icon="wa" cls="claro" />
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
function qrWifi(red, clave) {
  const esc = (s) => String(s).replace(/([\;,":])/g, '\\$1');
  const q = qrcode(0, 'M');
  q.addData(`WIFI:T:WPA;S:${esc(red)};P:${esc(clave)};;`);
  q.make();
  return q.createSvgTag({ scalable: true, margin: 0 });
}

export function Wifi() {
  const { D } = useDatos();
  const toast = useToast();
  const { red, clave } = D.hotel.wifi;
  const svg = useMemo(() => qrWifi(red, clave), [red, clave]);
  const alCopiar = () => copiar(clave).then(
    () => toast(D.wifi.copiado),
    () => toast(`No se pudo copiar. La clave es ${clave}`)
  );
  return (
    <>
      <Cabecera num="02" id="wifi" />
      <section className="wifi" aria-label="Datos de la red">
        <p className="etq"><V p="wifi.redEtq" /></p>
        <p className="red" translate="no"><V p="hotel.wifi.red" /></p>
        <hr />
        <p className="etq"><V p="wifi.claveEtq" /></p>
        <p className="clave" translate="no"><V p="hotel.wifi.clave" /></p>
        <Btn label="wifi.btnCopiar" icon="copiar" onClick={alCopiar} extra={[['wifi.copiado', 'Aviso al copiar la clave']]} />
      </section>
      <Cajas ps={[['wifi.redEtq', 'Título de la red'], ['hotel.wifi.red', 'Nombre de la red Wi-Fi'], ['wifi.claveEtq', 'Título de la clave'], ['hotel.wifi.clave', 'Clave del Wi-Fi']]} />
      <T as="h2" className="sub" p="wifi.pasosTitulo" />
      <Lista p="wifi.pasos" tag="ol" className="pasos pasos-wifi" plantilla="Nuevo paso" agregar="Agregar paso" render={(_it, i, ruta, quitar) => (
        <li>
          <span className="n" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
          <div><p><V p={ruta} /></p><Cajas ps={[[ruta, 'Texto del paso']]} />{quitar}</div>
        </li>
      )} />
      <section className="qr" aria-label="Código QR del Wi-Fi">
        <div className="img" role="img" aria-label="Código QR para conectarse al Wi-Fi" dangerouslySetInnerHTML={{ __html: svg }} />
        <div>
          <h2><V p="wifi.qrTitulo" /></h2>
          <p><V p="wifi.qrTexto" /></p>
          <Cajas ps={[['wifi.qrTitulo', 'Título del QR'], ['wifi.qrTexto', 'Texto del QR']]} />
        </div>
      </section>
      <Box azul titulo="wifi.ayudaTitulo" texto="wifi.ayudaTexto">
        <Btn mini label="wifi.btnAyuda" wa="wifi.msgAyuda" icon="wa" cls="negro" />
      </Box>
    </>
  );
}

function FilaTel({ href, clase, aria, children, ps }) {
  const { editing } = useDatos();
  if (!editing) return <a className={clase} href={href} aria-label={aria}>{children}</a>;
  return (
    <>
      <div className={clase}>{children}</div>
      <Cajas ps={ps} />
    </>
  );
}

export function Emergencias() {
  const { D } = useDatos();
  const E = D.emergencias;
  return (
    <>
      <Cabecera num="09" id="emergencias" />
      <div style={{ marginTop: 14 }}>
        <Lista p="emergencias.publicos" plantilla={{ numero: '000', nombre: 'Nuevo teléfono' }} agregar="Agregar teléfono" render={(n, _i, ruta, quitar) => (
          <>
            <FilaTel href={tel(n.numero)} clase="tel" aria={`Llamar al ${n.numero}, ${n.nombre}`} ps={[[`${ruta}.numero`, 'Número (ej. 911)'], [`${ruta}.nombre`, 'Nombre']]}>
              <span className="num"><V p={`${ruta}.numero`} /></span><span className="nom"><V p={`${ruta}.nombre`} /></span><Icon name="tel" size={20} />
            </FilaTel>
            {quitar}
          </>
        )} />
      </div>
      <T as="p" className="tit-sec" p="emergencias.internosTitulo" />
      <Lista p="emergencias.internos" plantilla={{ interno: '0', nombre: 'Nuevo interno', detalle: 'Detalle', tel: '+54' }} agregar="Agregar interno" render={(n, _i, ruta, quitar) => (
        <>
          <FilaTel href={tel(n.tel)} clase="tel interno" aria={`Llamar a ${n.nombre}, interno ${n.interno}`}
            ps={[[`${ruta}.interno`, 'Número de interno'], [`${ruta}.nombre`, 'Nombre'], [`${ruta}.detalle`, 'Detalle que se muestra'], [`${ruta}.tel`, 'Teléfono al que llama (con código de país)']]}>
            <span className="int"><small>Interno</small><b><V p={`${ruta}.interno`} /></b></span>
            <span className="nom"><b><V p={`${ruta}.nombre`} /></b><span><V p={`${ruta}.detalle`} /></span></span>
            <Icon name="tel" size={20} />
          </FilaTel>
          {quitar}
        </>
      )} />
      <div className="btns">
        <Btn label="emergencias.btnRecepcion" tel="hotel.telefonoRecepcion" icon="tel" cls="terra" />
        <Btn label="emergencias.btnWa" wa="emergencias.msgWa" icon="wa" cls="claro" />
      </div>
      <div className="datos">
        <div className="dato">
          <Icon name="hospital" size={22} />
          <div>
            <b><V p="emergencias.hospitalTitulo" /></b>
            <p><V p="emergencias.hospital.nombre" /> · <V p="emergencias.hospital.detalle" /></p>
            <Cajas ps={[['emergencias.hospitalTitulo', 'Título'], ['emergencias.hospital.nombre', 'Nombre del hospital'], ['emergencias.hospital.detalle', 'Distancia y detalle'], ['emergencias.hospital.consulta', 'Búsqueda para Google Maps']]} />
            <Btn label="emergencias.btnHospital" href={maps(E.hospital.consulta)} cls="mapa-link" />
          </div>
        </div>
        <div className="dato">
          <Icon name="salida" size={22} />
          <div>
            <b><V p="emergencias.evacTitulo" /></b>
            <p><V p="emergencias.evacuacion" /></p>
            <Cajas ps={[['emergencias.evacTitulo', 'Título'], ['emergencias.evacuacion', 'Texto']]} />
          </div>
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
  const { D, base } = useDatos();
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
      <Cabecera num="11" id="checkout" />
      <section className="big" aria-label="Horario de check-out">
        <div><p><V p="checkout.horaLead" /></p><p className="hora"><V p="hotel.horarios.checkout" /></p></div>
        <p className="al"><V p="checkout.lateTexto" /></p>
      </section>
      <Cajas ps={[['checkout.horaLead', 'Texto sobre la hora'], ['hotel.horarios.checkout', 'Hora de check-out (ej. 10:00)'], ['checkout.lateTexto', 'Texto del late check-out'], ['hotel.horarios.lateCheckout', 'Hora máxima de late check-out']]} />
      <div className="head-row">
        <h2><V p="checkout.listaTitulo" /></h2>
        <p className="progreso" aria-live="polite">{listos === C.lista.length ? '¡Todo listo!' : `${listos} de ${C.lista.length} listos`}</p>
      </div>
      <Cajas ps={[['checkout.listaTitulo', 'Título de la lista']]} />
      <Lista p="checkout.lista" tag="ul" className="lista check" plantilla="Nueva tarea" agregar="Agregar tarea" render={(_t, i, ruta, quitar) => (
        <li>
          <label>
            <input type="checkbox" checked={!!hechos[i]} onChange={() => alternar(i)} />
            <span><V p={ruta} /></span>
          </label>
          <Cajas ps={[[ruta, 'Texto de la tarea']]} />
          {quitar}
        </li>
      )} />
      <Datos p="checkout.datos" />
      <div className="btns">
        <Btn label="checkout.btnLate" wa="checkout.msgLate" icon="wa" />
        <Btn label="checkout.btnTaxi" wa="checkout.msgTaxi" icon="wa" cls="claro" />
      </div>
      <div className="gracias">
        <T as="p" p="checkout.graciasTitulo" />
        <a className="maps" href={`${base}resena`}><V p="checkout.btnResena" /> <Icon name="ext" size={16} sw={2} /></a>
        <Cajas ps={[['checkout.btnResena', 'Texto del link a la reseña']]} />
      </div>
    </>
  );
}
