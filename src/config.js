// Datos de conexión a Supabase. La URL y la clave "publishable" son públicas por diseño
// (van en el navegador): lo que protege los datos son las reglas de la base, no esta clave.
// Para usar otro proyecto, definí VITE_SUPABASE_URL y VITE_SUPABASE_KEY.
export const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL || 'https://sruzrnhbyosnoqdkhric.supabase.co';
export const SUPABASE_KEY = import.meta.env?.VITE_SUPABASE_KEY || 'sb_publishable_iZHlO_HU0dYiQyxb3S6GtA_gswMmmj7';
// Clave PÚBLICA para los avisos en el celular (notificaciones push). Es pública por diseño: la privada vive solo en Vercel (VAPID_PRIVADA) y nunca va al repositorio.
export const VAPID_PUBLICA = import.meta.env?.VITE_VAPID_PUBLICA || 'BJASFGuHBJGh_YIFbswps6aDWeRoDICup1UjdpU5MjK-w0hp3I2CA7LIW1oh8sXHS_pq8MOEpAckdEneL5C_SvI';
