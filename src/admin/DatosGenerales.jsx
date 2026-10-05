import { useState } from 'react';
import Icon from '../components/Icon.jsx';
import { Cajas } from '../components/Editable.jsx';
import { useDatos } from '../data/DataContext.jsx';
import { IDIOMAS, IDIOMAS_POR_DEFECTO } from '../idioma.js';

// Qué idiomas ofrece el selector de la guía. La traducción es automática (traductor de Google).
function Idiomas() {
  const { D, set } = useDatos();
  const activos = Array.isArray(D.hotel.idiomas) ? D.hotel.idiomas : IDIOMAS_POR_DEFECTO;
  const alternar = (code, on) => set('hotel.idiomas', IDIOMAS.map((i) => i.code).filter((c) => (c === code ? on : activos.includes(c))));
  return (
    <>
      <p className="lead">Los huéspedes eligen el idioma arriba a la derecha y la guía completa se traduce sola, también lo que edites. Es una traducción automática: revisá en tu idioma favorito cómo queda.</p>
      {IDIOMAS.map((i) => (
        <label key={i.code} className="ed-check">
          <input type="checkbox" checked={i.code === 'es' || activos.includes(i.code)} disabled={i.code === 'es'} onChange={(e) => alternar(i.code, e.target.checked)} /> {i.nombre}
        </label>
      ))}
    </>
  );
}

// Cambio de la clave del panel (se guarda en la base como hash, nunca en texto).
function CambiarClave() {
  const { cambiarClave } = useDatos();
  const [nueva, setNueva] = useState('');
  const [repetida, setRepetida] = useState('');
  const [aviso, setAviso] = useState(null);
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e) => {
    e.preventDefault();
    if (nueva !== repetida) { setAviso({ ok: false, mensaje: 'Las dos claves no coinciden.' }); return; }
    setEnviando(true);
    const r = await cambiarClave(nueva);
    setEnviando(false);
    setAviso(r);
    if (r.ok) { setNueva(''); setRepetida(''); }
  };

  return (
    <form onSubmit={enviar}>
      <label className="caja">
        <span>Clave nueva (mínimo 10 caracteres)</span>
        <input type="password" autoComplete="new-password" minLength={10} required value={nueva} onChange={(e) => setNueva(e.target.value)} />
      </label>
      <label className="caja">
        <span>Repetí la clave nueva</span>
        <input type="password" autoComplete="new-password" minLength={10} required value={repetida} onChange={(e) => setRepetida(e.target.value)} />
      </label>
      {aviso && <p className={aviso.ok ? 'ed-ok' : 'ed-error'} role="status">{aviso.mensaje}</p>}
      <div className="btns"><button type="submit" className="btn" disabled={enviando}>Cambiar clave</button></div>
    </form>
  );
}

// Datos que hacen funcionar la guía pero no se ven como un texto suelto.
export default function DatosGenerales() {
  const { base } = useDatos();
  return (
    <>
      <header style={{ position: 'relative' }}>
        <div className="tag" aria-hidden="true"><small>Nº</small><b>—</b></div>
        <div className="top">
          <p className="eyebrow">Solo para el dueño</p>
          <a className="back" href={base}><Icon name="atras" size={16} sw={2} />Menú</a>
        </div>
        <h1>Datos generales</h1>
        <p className="lead">Teléfonos, WhatsApp, links, horarios y Wi-Fi. Se usan en toda la guía.</p>
      </header>
      <h2 className="sub">El hotel</h2>
      <Cajas ps={[
        ['hotel.nombre', 'Nombre del hotel'],
        ['hotel.sigla', 'Iniciales (van en la etiqueta del menú)'],
        ['hotel.ciudad', 'Ciudad (se usa para buscar los lugares en Google Maps)'],
        ['hotel.direccion', 'Dirección'],
        ['hotel.zonaHoraria', 'Zona horaria (ej. America/Argentina/Buenos_Aires)'],
        ['hotel.pie', 'Texto al pie de la guía']
      ]} />
      <h2 className="sub">Contacto</h2>
      <Cajas ps={[
        ['hotel.whatsapp', 'WhatsApp general del hotel (lo usan todos los botones de WhatsApp que no tengan su propio número). Solo números con código de país, ej. 5491155551234'],
        ['hotel.telefonoRecepcion', 'Teléfono de recepción, con código de país (ej. +5491155551234)'],
        ['hotel.mapaRecomendados', 'Link de tu lista de lugares en Google Maps (https://…)']
      ]} />
      <h2 className="sub">Horarios</h2>
      <Cajas ps={[
        ['hotel.horarios.checkin', 'Hora de check-in (ej. 15:00)'],
        ['hotel.horarios.checkout', 'Hora de check-out (ej. 10:00)'],
        ['hotel.horarios.lateCheckout', 'Hora máxima del late check-out (ej. 14:00)']
      ]} />
      <h2 className="sub">Wi-Fi</h2>
      <Cajas ps={[['hotel.wifi.red', 'Nombre de la red'], ['hotel.wifi.clave', 'Clave']]} />
      <h2 className="sub">Reseñas</h2>
      <Cajas ps={[
        ['resena.google', 'Link para reseñar en Google (https://…)'],
        ['resena.booking', 'Link de Booking (https://…)'],
        ['resena.tripadvisor', 'Link de TripAdvisor (https://…)']
      ]} />
      <h2 className="sub">Idiomas</h2>
      <Idiomas />
      <h2 className="sub">Clave del panel</h2>
      <CambiarClave />
    </>
  );
}
