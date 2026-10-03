// Datos de conexión a Supabase. La URL y la clave "publishable" son públicas por diseño
// (van en el navegador): lo que protege los datos son las reglas de la base, no esta clave.
// Para usar otro proyecto, definí VITE_SUPABASE_URL y VITE_SUPABASE_KEY.
export const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL || 'https://sruzrnhbyosnoqdkhric.supabase.co';
export const SUPABASE_KEY = import.meta.env?.VITE_SUPABASE_KEY || 'sb_publishable_iZHlO_HU0dYiQyxb3S6GtA_gswMmmj7';
