import Icon from '../components/Icon.jsx';
import { Cajas } from '../components/Editable.jsx';
import { useDatos } from '../data/DataContext.jsx';

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
        ['hotel.whatsapp', 'WhatsApp del hotel: solo números con código de país (ej. 5491155551234)'],
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
    </>
  );
}
