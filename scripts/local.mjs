// Prueba el check-in en tu compu SIN tocar la base real ni tu Drive.
//   npm run local
// Levanta una base de prueba en memoria (los mismos archivos SQL que producción) y la guía apuntando a ella.
// Al cerrar (Ctrl+C) todo lo cargado se pierde: es solo para probar.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CLAVE_ADMIN, CLAVE_RECEPCION, iniciarBackend } from './backend-local.mjs';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const PUERTO = 54321;

const back = await iniciarBackend({ puerto: PUERTO, silencioso: false });
// El check-in arranca prendido, con la clave de recepción cargada y con un Drive simulado, para ahorrar pasos.
await back.sql(
  `update private.checkin_config set activo = true, foto_url = $2, hash_recepcion = extensions.crypt($1, extensions.gen_salt('bf')) where id = 1`,
  [CLAVE_RECEPCION, `${back.url}/apps-script/exec`]
);

console.log(`
Base de prueba lista en ${back.url} (vive solo en memoria).
  Guía:        http://localhost:5173/
  Admin:       http://localhost:5173/#/admin           clave: ${CLAVE_ADMIN}
  Recepción:   http://localhost:5173/#/recepcion       clave: ${CLAVE_RECEPCION}
  Huésped:     http://localhost:5173/#/registro        (el código lo muestra la pantalla de recepción)
  Fotos:       van a un Drive simulado (solo para probar); lo guardado se ve con el link "Ver foto" de la planilla.
Para salir: Ctrl+C.
`);

const vite = spawn('npx', ['vite', '--host'], {
  cwd: raiz,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, VITE_SUPABASE_URL: back.url, VITE_SUPABASE_KEY: 'clave-local' }
});
const salir = async () => { vite.kill(); await back.cerrar().catch(() => {}); process.exit(0); };
process.on('SIGINT', salir);
process.on('SIGTERM', salir);
vite.on('exit', salir);
