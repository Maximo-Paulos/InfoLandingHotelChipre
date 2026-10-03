// Carga el contenido de ejemplo (src/data/hotel.js) en Supabase.
// Uso:  ADMIN_PASSWORD="tu-clave" npm run seed
// Sirve para dejar la base con los datos iniciales o para volver a ellos.
import contenido from '../src/data/hotel.js';
import { SUPABASE_KEY, SUPABASE_URL } from '../src/config.js';

const clave = process.env.ADMIN_PASSWORD;
if (!clave) {
  console.error('Falta ADMIN_PASSWORD (la clave del panel del dueño).');
  process.exit(1);
}

const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/guardar_contenido`, {
  method: 'POST',
  headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ p_clave: clave, p_data: contenido })
});
const res = await r.json();
if (!r.ok || !res.ok) {
  console.error('No se pudo cargar:', res.error || r.status);
  process.exit(1);
}
console.log('Contenido cargado en Supabase:', res.actualizado);
