import { Checkin, Wifi, Emergencias, Checkout } from './sections/Esenciales.jsx';
import { Habitacion, Instalaciones, Normas, Preguntas } from './sections/Estadia.jsx';
import { Comer, Hacer, Compras, Resena } from './sections/Alrededores.jsx';
import { Terminos } from './sections/Terminos.jsx';

// Orden del menú. `id` es el link directo de cada pantalla (#/wifi) y la clave de sus textos.
export const SECCIONES = [
  { id: 'checkin', icono: 'llave', hot: true, Vista: Checkin },
  { id: 'wifi', icono: 'wifi', hot: true, Vista: Wifi },
  { id: 'habitacion', icono: 'cama', Vista: Habitacion },
  { id: 'instalaciones', icono: 'olas', Vista: Instalaciones },
  { id: 'normas', icono: 'normas', Vista: Normas },
  { id: 'comer', icono: 'cubierto', Vista: Comer },
  { id: 'hacer', icono: 'brujula', Vista: Hacer },
  { id: 'compras', icono: 'bolsa', Vista: Compras },
  { id: 'emergencias', icono: 'alerta', oscuro: true, Vista: Emergencias },
  { id: 'preguntas', icono: 'duda', Vista: Preguntas },
  { id: 'checkout', icono: 'valija', Vista: Checkout },
  { id: 'resena', icono: 'estrella', Vista: Resena },
  // `fuera`: no es un botón de la grilla; se abre desde el link del final del menú.
  { id: 'terminos', icono: 'normas', fuera: true, Vista: Terminos }
];
