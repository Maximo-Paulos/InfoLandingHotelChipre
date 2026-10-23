// Prueba de punta a punta del check-in digital, con navegador real y un backend local (Postgres real en memoria
// con los mismos archivos SQL que producción). No toca la base real ni tu Drive.
//
//   Requiere Playwright instalado (npm i -D playwright) y un Chromium.   Uso: node scripts/e2e-checkin.mjs
//   Variables: CAPTURAS=/carpeta  guarda capturas de cada pantalla (celular)  ·  CHROMIUM=/ruta/al/chromium
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { CLAVE_ADMIN, CLAVE_RECEPCION, iniciarBackend } from './backend-local.mjs';
import { infoJpeg } from '../src/checkin/jpegReducido.js';
import { ESQUINAS_EXIF, conOrientacion, esquinasDe, jpegGrande } from './fotos-ayuda.mjs';

const require = createRequire(import.meta.url);
const raiz = fileURLToPath(new URL('..', import.meta.url));
const PUERTO_BACK = 54321;
const PUERTO_WEB = 4174;
const PUERTO_DEV = 4175;
const BASE = `http://localhost:${PUERTO_WEB}/`;
const CAPTURAS = process.env.CAPTURAS || '';

function cargarPlaywright() {
  for (const ruta of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(ruta); } catch { /* prueba la siguiente */ }
  }
  throw new Error('No encuentro Playwright. Instalalo con: npm i -D playwright');
}
const { chromium } = cargarPlaywright();

let fallas = 0;
let pasos = 0;
const ok = (c, m) => { pasos += 1; console.log(`${c ? 'OK    ' : 'FALLA '}${m}`); if (!c) fallas += 1; };
// SOLO=7,8 corre únicamente esas secciones (la 3 necesita lo que deja la 2: correlas juntas con SOLO=2,3).
const SOLO = (process.env.SOLO || '').split(',').map((x) => x.trim()).filter(Boolean);
async function seccion(titulo, fn) {
  if (SOLO.length && !SOLO.includes(titulo.split('.')[0])) return;
  console.log(`\n== ${titulo}`);
  try { await fn(); } catch (e) { fallas += 1; console.log(`FALLA ${titulo}: ${String(e.message).split('\n')[0]}`); if (process.env.DEPURAR) console.log(e.stack); }
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
async function hasta(cond, ms = 8000, cada = 150) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) { if (await cond()) return true; await espera(cada); }
  return false;
}
const captura = async (page, nombre, opc = {}) => { if (CAPTURAS) { fs.mkdirSync(CAPTURAS, { recursive: true }); await page.screenshot({ path: path.join(CAPTURAS, `${nombre}.png`), ...opc }); } };

// ---------- compilar la app apuntando al backend local y servirla
const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-checkin-'));
execFileSync('npx', ['vite', 'build', '--outDir', path.join(carpeta, 'dist'), '--emptyOutDir'], {
  cwd: raiz, stdio: 'ignore', env: { ...process.env, VITE_SUPABASE_URL: `http://localhost:${PUERTO_BACK}`, VITE_SUPABASE_KEY: 'local-key' }
});
const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
const web = http.createServer((req, res) => {
  const url = new URL(req.url, BASE);
  let archivo = path.join(carpeta, 'dist', decodeURIComponent(url.pathname));
  if (!archivo.startsWith(path.join(carpeta, 'dist')) || !fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()) archivo = path.join(carpeta, 'dist', 'index.html');
  res.writeHead(200, { 'content-type': tipos[path.extname(archivo)] ?? 'application/octet-stream' });
  fs.createReadStream(archivo).pipe(res);
});
await new Promise((r) => web.listen(PUERTO_WEB, r));

const back = await iniciarBackend({ puerto: PUERTO_BACK });
const reiniciar = () => fetch(`${back.url}/__test/reiniciar`, { method: 'POST' });
// La cámara es simulada: en vez de la real, el navegador "ve" un documento sobre una mesa (scripts/fixtures/camara/documento.mjpeg).
const navegador = await chromium.launch({
  executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${path.join(raiz, 'scripts/fixtures/camara/documento.mjpeg')}`]
});

async function contexto(opciones = {}) {
  const ctx = await navegador.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'es-AR', ...opciones });
  await ctx.route(/fonts\.g(oogleapis|static)\.com|translate\.google/, (r) => r.abort());
  const page = await ctx.newPage();
  page.setDefaultTimeout(12000);
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|ERR_FAILED|Failed to load resource/.test(m.text())) errores.push(m.text()); });
  return { ctx, page, errores };
}

// Una página que se ensancha más que la pantalla se ve rota en el celular (aparece un scroll horizontal de toda la página).
async function sinDesborde(page, donde) {
  const r = await page.evaluate(() => ({ ancho: window.innerWidth, scroll: document.documentElement.scrollWidth }));
  ok(r.scroll <= r.ancho + 1, `${donde}: la página no se ensancha más que la pantalla (${r.scroll} de ${r.ancho} px)`);
}
// ¿Está el cursor en el campo con ese nombre? (si se escapa, en el celular se baja el teclado)
const enfocado = (page, nombre) => page.evaluate((n) => document.activeElement?.name === n, nombre);
// Carga un huésped por la base, como si hubiera completado el formulario (para no repetir la pantalla en cada prueba).
async function huespedPorApi(datos = {}, { conFoto = false } = {}) {
  const est = await back.llamar('recepcion_estado', { p_clave: CLAVE_RECEPCION });
  const ses = await back.llamar('checkin_canjear', { p_codigo: String(est.codigo.valor) }, '198.51.100.99');
  if (conFoto) {
    const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7)]).toString('base64'); // lo que revisa el script es la firma del archivo
    const r = await fetch(`${back.url}/apps-script/exec`, { method: 'POST', body: JSON.stringify({ ticket: ses.foto.ticket, nombre: datos.nombre ?? 'Ana María', apellido: datos.apellido ?? 'Pérez García', imagen: jpg }) }).then((x) => x.json());
    if (!r.ok) throw new Error('no se pudo subir la foto del huésped: ' + JSON.stringify(r));
  }
  const env = await back.llamar('checkin_enviar', { p_token: ses.token, p_idioma: 'es', p_acepta: true, p_datos: { nombre: 'Ana María', apellido: 'Pérez García', email: 'ana@correo.com', telefono: '+541155551234', nacionalidad: 'Argentina', localidad: 'Capital Federal', domicilio: 'Av. Corrientes 1234 5° B', doc_tipo: 'DNI', doc_numero: '30123456', ...datos } }, '198.51.100.99');
  if (!env.ok) throw new Error('no se pudo cargar el huésped: ' + JSON.stringify(env));
}
const menuVisible = (page) => page.getByRole('link', { name: 'Realizar check-in' }).isVisible().catch(() => false);
async function entrarAdmin(page, destino = '#/admin') {
  await page.goto(BASE + destino);
  await page.locator('input[name=clave]').fill(CLAVE_ADMIN);
  await page.getByRole('button', { name: 'Entrar' }).click();
}
async function configurar(cambios) {
  const campos = Object.keys(cambios).map((k, i) => `${k} = $${i + 1}`).join(', ');
  await back.sql(`update private.checkin_config set ${campos} where id = 1`, Object.values(cambios));
}
const sql1 = async (sql, p) => (await back.sql(sql, p))[0];
const DATOS = { nombre: 'Ana María', apellido: 'Pérez García', email: 'Ana@Correo.com', telefono: '11 5555-1234', localidad: 'Capital Federal', domicilio: 'Av. Corrientes 1234 5° B', doc_numero: '30.123.456' };

async function completarFormulario(page, d = DATOS, { tipo = 'DNI', nacionalidad = 'Argentina' } = {}) {
  await page.getByLabel('Nombre', { exact: true }).fill(d.nombre);
  await page.getByLabel('Apellido', { exact: true }).fill(d.apellido);
  await page.getByLabel('Email', { exact: true }).fill(d.email);
  await page.getByLabel('Teléfono', { exact: true }).fill(d.telefono);
  await page.getByLabel('Nacionalidad', { exact: true }).selectOption({ label: nacionalidad });
  await page.getByLabel('Localidad', { exact: true }).fill(d.localidad);
  await page.getByLabel('Domicilio', { exact: true }).fill(d.domicilio);
  await page.getByLabel('Tipo de documento', { exact: true }).selectOption(tipo);
  await page.getByLabel('Número de documento', { exact: true }).fill(d.doc_numero);
}
async function codigoDeRecepcion(rec) {
  await rec.locator('.codigo-grande:not(.generando)').waitFor();
  return (await rec.locator('.codigo-grande').innerText()).replace(/\D/g, '');
}
async function ingresarCodigo(page, codigo) {
  await page.locator('#registro-codigo').fill(codigo);
}
async function recepcionLogin(page) {
  await page.goto(BASE + '#/recepcion');
  await page.locator('input[name=clave]').fill(CLAVE_RECEPCION);
  await page.getByRole('button', { name: 'Entrar' }).click();
}
const jpegBase64 = (page) => page.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 900; c.height = 600;
  const x = c.getContext('2d'); x.fillStyle = '#d68b61'; x.fillRect(0, 0, 900, 600); x.fillStyle = '#fff'; x.font = '60px sans-serif'; x.fillText('DNI de prueba', 80, 300);
  return c.toDataURL('image/jpeg', 0.9).split(',')[1];
});

// Anotación que deja el formulario mientras se saca o se prepara la foto (para avisar si el sistema cerró la página) y el aviso.
const MARCA = 'chipre-registro-foto';
const marca = (page) => page.evaluate((k) => { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } }, MARCA);
const AVISO = 'La página se cerró mientras elegías la foto';
const aviso = (page) => page.getByText(AVISO);

// =====================================================================
await seccion('1. Con el check-in apagado la guía queda como estaba', async () => {
  await reiniciar();
  const { ctx, page, errores } = await contexto();
  await page.goto(BASE);
  await page.locator('.tile').first().waitFor();
  ok((await page.locator('.tile').count()) === 12, 'el menú sigue teniendo sus 12 botones');
  await espera(600);
  ok(!(await menuVisible(page)), 'el botón "Realizar check-in" NO aparece con el check-in apagado');
  ok(await page.getByRole('link', { name: 'Términos y condiciones' }).isVisible(), 'el link de Términos sigue');
  await page.goto(BASE + '#/registro');
  await page.getByText('El check-in digital no está disponible').waitFor();
  ok(true, 'entrando directo a #/registro avisa que no está disponible');
  const r = await fetch(`${back.url}/rest/v1/rpc/checkin_canjear`, { method: 'POST', body: JSON.stringify({ p_codigo: '123456' }) }).then((x) => x.json());
  ok(r.ok === false && r.error === 'no_disponible', 'la base rechaza los códigos mientras está apagado');
  await page.goto(BASE + '#/recepcion');
  await page.locator('input[name=clave]').fill('lo-que-sea');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByText('Clave incorrecta').waitFor();
  ok(true, 'recepción sin clave cargada no deja entrar');
  ok(errores.length === 0, 'sin errores en la consola ' + errores.join('|'));
  await ctx.close();
});

await seccion('2. Admin general: inicio, editor de la guía (sin cambios) y huéspedes', async () => {
  await reiniciar();
  const { ctx, page, errores } = await contexto();
  await page.goto(BASE + '#/admin');
  await page.locator('input[name=clave]').fill('mala-clave');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByText('Clave incorrecta').waitFor();
  ok(true, 'clave de admin incorrecta: no entra');
  await page.locator('input[name=clave]').fill(CLAVE_ADMIN);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByRole('heading', { name: 'Panel del administrador' }).waitFor();
  ok((await page.locator('nav a.tile').count()) === 2, 'inicio del admin con 2 botones');
  await captura(page, '20-admin-inicio');

  await page.getByRole('link', { name: /Editar landing page/ }).click();
  await page.locator('.barra-admin').waitFor();
  ok(await page.locator('.tile-wrap').count() >= 12, 'el editor de la landing es el de siempre (12 botones con sus cajas)');
  const caja = page.locator('.caja textarea').first();
  await caja.fill('¿Qué necesitás hoy?');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await hasta(async () => ((await back.sql('select data -> \'menu\' ->> \'titulo\' as t from public.contenido where id = 1'))[0].t) === '¿Qué necesitás hoy?');
  ok((await sql1(`select data -> 'menu' ->> 'titulo' as t from public.contenido where id = 1`)).t === '¿Qué necesitás hoy?', 'guardar un texto del editor sigue funcionando');
  ok(await page.getByText('Este botón les aparece a los huéspedes solo cuando el check-in digital está encendido').isVisible(), 'el editor muestra el botón nuevo con su caja de texto');
  await captura(page, '21-admin-editor-menu');
  await page.getByRole('link', { name: /Realizar check-in/ }).click();
  await page.getByText('Acá cambiás los textos del check-in').waitFor();
  ok((await page.locator('.caja').count()) >= 30, 'tocando el botón en el editor se abren los textos del check-in para editarlos');
  await page.getByRole('link', { name: /Menú/ }).first().click();
  await page.locator('.tile-wrap').first().waitFor();
  await page.getByRole('link', { name: 'Inicio' }).click();
  await page.getByRole('heading', { name: 'Panel del administrador' }).waitFor();
  ok(true, 'el link "Inicio" vuelve al inicio del admin');

  await page.goto(BASE + '#/admin/wifi');
  await page.locator('.barra-admin').waitFor();
  ok((await page.locator('.caja').count()) > 3, 'los links viejos (#/admin/wifi) siguen abriendo el editor');
  await page.goto(BASE + '#/admin/editar/datos');
  await page.getByRole('heading', { name: 'Datos generales' }).waitFor();
  ok(true, 'y #/admin/editar/datos abre Datos generales');

  await page.goto(BASE + '#/admin/huespedes');
  await page.getByRole('heading', { name: 'Huéspedes', exact: true }).waitFor();
  await page.locator('#cfg-activo').waitFor();
  ok((await page.locator('#cfg-codigo_seg').inputValue()) === '15' && (await page.locator('#cfg-usos_max').inputValue()) === '3', 'configuración con los valores iniciales (15 s, 3 personas)');
  ok((await page.locator('#cfg-edicion_min').inputValue()) === '10', 'edición de recepción: 10 minutos');
  await page.locator('#cfg-codigo_seg').fill('2');
  await page.locator('#cfg-activo').selectOption('si');
  await page.getByRole('button', { name: 'Guardar configuración' }).click();
  await page.getByText(/poné un número entre 5 y 300/).waitFor();
  ok(true, 'un valor fuera de rango se avisa antes de guardar');
  await page.locator('#cfg-codigo_seg').fill('120');
  await page.locator('#cfg-usos_max').fill('3');
  await page.getByRole('button', { name: 'Guardar configuración' }).click();
  await page.getByText('Configuración guardada.').waitFor();
  const cfg = await sql1('select activo, codigo_seg, usos_max from private.checkin_config where id = 1');
  ok(cfg.activo === true && cfg.codigo_seg === 120, 'la configuración queda guardada en la base');
  await page.getByText('Falta cargar la clave de recepción').waitFor();
  ok(true, 'avisa que falta la clave de recepción');
  await page.locator('#cfg-clave-recepcion').fill('corta');
  ok(await page.getByRole('button', { name: 'Guardar clave de recepción' }).isDisabled(), 'una clave corta no se puede guardar');
  await page.locator('#cfg-clave-recepcion').fill(CLAVE_RECEPCION);
  await page.getByRole('button', { name: 'Guardar clave de recepción' }).click();
  await page.getByText('Clave de recepción guardada').waitFor();
  ok((await sql1('select hash_recepcion is not null as h from private.checkin_config where id = 1')).h, 'la clave de recepción queda guardada (con hash)');
  await captura(page, '22-admin-huespedes-config', { fullPage: true });
  ok(errores.length === 0, 'sin errores en la consola ' + errores.join('|'));
  await ctx.close();
});

let codigoRota = null;
await seccion('3. Check-in completo: recepción muestra el código, el huésped lo carga y recepción ve la fila', async () => {
  const rec = await contexto({ viewport: { width: 390, height: 844 } });
  const hue = await contexto();
  await recepcionLogin(rec.page);
  const codigo = await codigoDeRecepcion(rec.page);
  ok(/^\d{6}$/.test(codigo), `recepción muestra un código de 6 números (${codigo})`);
  ok(/Usado 0 de 3/.test(await rec.page.locator('.codigo-meta').innerText()), 'indica cuántas veces se usó (0 de 3)');
  await captura(rec.page, '30-recepcion-codigo');

  await hue.page.goto(BASE);
  await hue.page.getByRole('link', { name: 'Realizar check-in' }).waitFor();
  ok(true, 'con el check-in prendido el botón aparece en el menú');
  const ultimo = await hue.page.locator('.menu > *:last-child, .menu .btns:last-of-type').last().innerText().catch(() => '');
  ok((await hue.page.locator('.link-terminos').boundingBox()).y < (await hue.page.getByRole('link', { name: 'Realizar check-in' }).boundingBox()).y, 'el botón está debajo de "Términos y condiciones"');
  await sinDesborde(hue.page, 'menú con el botón nuevo');
  await captura(hue.page, '10-menu-con-boton', { fullPage: true });
  await hue.page.getByRole('link', { name: 'Realizar check-in' }).click();
  await hue.page.locator('#registro-codigo').waitFor();
  await sinDesborde(hue.page, 'pantalla del código');
  await captura(hue.page, '11-codigo');

  await ingresarCodigo(hue.page, '000000');
  await hue.page.getByText('El código no es correcto o ya venció').waitFor();
  ok(true, 'código equivocado: mensaje claro');
  await hasta(() => hue.page.evaluate(() => document.activeElement?.id === 'registro-codigo'), 3000);
  ok(await hue.page.evaluate(() => document.activeElement?.id === 'registro-codigo'), 'tras un código equivocado el cursor vuelve al campo para escribir de nuevo');
  await ingresarCodigo(hue.page, codigo);
  await hue.page.getByRole('heading', { name: 'Tus datos' }).waitFor();
  ok(true, 'código correcto: abre el formulario');
  ok(/Te quedan 29:|Te quedan 30:/.test(await hue.page.locator('.chip.tiempo').innerText()), 'cuenta regresiva de ~30 minutos');
  await sinDesborde(hue.page, 'formulario');
  await captura(hue.page, '12-formulario', { fullPage: true });
  // escribir despacio no pierde letras ni el foco (el formulario se redibuja cada segundo por la cuenta regresiva)
  const mail = hue.page.getByLabel('Email', { exact: true });
  await mail.click();
  await hue.page.keyboard.type('maria.lucia@correo.com', { delay: 200 });
  ok((await mail.inputValue()) === 'maria.lucia@correo.com' && await enfocado(hue.page, 'email'), 'escribiendo despacio en el formulario no se pierden letras ni el foco (5 segundos)');
  await mail.fill('');

  // datos inválidos
  await hue.page.getByRole('button', { name: 'Enviar formulario' }).click();
  await hue.page.getByText('Revisá los campos marcados en rojo').waitFor();
  ok((await hue.page.locator('.campo.error').count()) >= 7, 'formulario vacío: marca los campos con error');
  await sinDesborde(hue.page, 'formulario con errores');
  await captura(hue.page, '13-formulario-errores', { fullPage: true });
  await completarFormulario(hue.page, { ...DATOS, telefono: '12345', doc_numero: '12' });
  await hue.page.getByRole('button', { name: 'Enviar formulario' }).click();
  ok(await hue.page.getByText('Ese teléfono no parece válido').isVisible(), 'teléfono que no es válido: se rechaza');
  ok(await hue.page.getByText('El DNI tiene 7 u 8 números').isVisible(), 'DNI con pocos números: se rechaza');
  await hue.page.getByLabel('Teléfono', { exact: true }).fill('11 5555-1234');
  await hue.page.getByLabel('Número de documento', { exact: true }).fill('30.123.456');
  await hue.page.getByRole('button', { name: 'Enviar formulario' }).click();
  await hue.page.getByText('Tenés que aceptar para poder enviar').waitFor();
  ok(true, 'sin aceptar los términos no se envía');
  await hue.page.getByLabel(/Acepto que el hotel/).check();

  // cambio de tipo de documento
  await hue.page.getByLabel('Tipo de documento', { exact: true }).selectOption('Pasaporte');
  await hue.page.getByLabel('Número de documento', { exact: true }).fill('ab 123456');
  await hue.page.getByLabel('Tipo de documento', { exact: true }).selectOption('DNI');
  await hue.page.getByLabel('Número de documento', { exact: true }).fill('30.123.456');

  await hue.page.getByRole('button', { name: 'Enviar formulario' }).click();
  await hue.page.getByRole('heading', { name: '¡Check-in realizado!' }).waitFor();
  ok(true, 'envío correcto: pantalla "Check-in realizado"');
  await captura(hue.page, '14-exito');
  ok(!(await hue.page.getByText('Pérez').count()), 'la pantalla final no muestra datos personales');
  const fila = await sql1(`select datos, habitacion, idioma, consentimiento from private.checkins order by id desc limit 1`);
  ok(fila.datos.telefono === '+541155551234' && fila.datos.email === 'ana@correo.com' && fila.datos.doc_numero === '30123456' && fila.datos.doc_tipo === 'DNI', 'en la base queda normalizado (teléfono +54…, email en minúsculas, DNI sin puntos)');
  ok(fila.habitacion === null && fila.consentimiento.aceptado === true, 'sin habitación y con la aceptación registrada');
  await hue.page.waitForURL(/#\/$/, { timeout: 10000 });
  await hue.page.locator('.tile').first().waitFor();
  ok(true, 'a los pocos segundos vuelve solo al menú de la guía');
  ok(await hue.page.evaluate(() => sessionStorage.getItem('chipre-registro') === null), 'no quedan datos del huésped guardados en el navegador');

  // recepción ve la fila
  await rec.page.locator('.planilla tbody tr').first().waitFor({ timeout: 8000 });
  ok(/Pérez García/.test(await rec.page.locator('.planilla tbody tr').first().innerText()), 'recepción ve al huésped en la planilla (se actualiza sola)');
  ok(await rec.page.locator('.planilla tbody tr').first().locator('.pendiente').isVisible(), 'figura "Sin asignar" en la habitación');
  ok(/\+54 11 5555 1234/.test(await rec.page.locator('.planilla tbody tr').first().innerText()), 'el teléfono se muestra con formato internacional');
  await sinDesborde(rec.page, 'recepción con la planilla (celular)');
  await captura(rec.page, '31-recepcion-planilla', { fullPage: true });
  ok(await rec.page.locator('.planilla tbody tr').first().locator('.hab-boton').isVisible(), 'la habitación se puede tocar desde la columna fija (sin deslizar la planilla)');

  // recepción asigna la habitación y corrige un dato
  await rec.page.getByRole('button', { name: /Editar/ }).first().click();
  await rec.page.getByRole('dialog').waitFor();
  ok(/Podés editar durante (9|10):/.test(await rec.page.locator('.nota-tiempo').innerText()), 'muestra cuánto tiempo queda para editar (≈10 min)');
  await hasta(async () => (await rec.page.getByRole('dialog').getByLabel('Teléfono', { exact: true }).inputValue()) !== '+541155551234');
  ok((await rec.page.getByRole('dialog').getByLabel('Teléfono', { exact: true }).inputValue()) === '011 5555-1234', 'al editar el teléfono se ve en formato local (011 5555-1234), no como +541155551234');
  await captura(rec.page, '32-recepcion-edicion');
  ok(await enfocado(rec.page, 'habitacion'), 'al abrir la edición el cursor ya está en Habitación (todavía sin habitación)');
  await rec.page.keyboard.type('204', { delay: 900 });
  ok((await rec.page.getByRole('dialog').getByLabel('Habitación').inputValue()) === '204' && await enfocado(rec.page, 'habitacion'), 'escribir la habitación despacio no pierde el foco ni los números (la ventana se redibuja cada segundo)');
  await rec.page.waitForTimeout(3500);
  ok(await enfocado(rec.page, 'habitacion'), 'ni cuando la pantalla de recepción se actualiza sola (consulta a la base cada 3 segundos)');
  ok((await rec.page.getByRole('button', { name: 'Guardar cambios' }).isVisible()), 'el botón "Guardar cambios" queda siempre a la vista');
  await rec.page.getByRole('dialog').getByLabel('Localidad', { exact: true }).fill('Buenos Aires');
  await rec.page.getByRole('button', { name: 'Guardar cambios' }).click();
  await rec.page.getByRole('dialog').waitFor({ state: 'hidden' });
  await hasta(() => rec.page.evaluate(() => document.activeElement?.classList.contains('hab-boton')), 3000);
  ok(await rec.page.evaluate(() => document.activeElement?.classList.contains('hab-boton')), 'al cerrarse la ventana el foco vuelve al botón que la abrió');
  await hasta(async () => /204/.test(await rec.page.locator('.planilla tbody tr').first().innerText()));
  ok(/204/.test(await rec.page.locator('.planilla tbody tr').first().innerText()), 'la habitación aparece en la planilla');
  ok((await sql1('select habitacion, datos ->> \'localidad\' as l, editado_por from private.checkins order by id desc limit 1')).l === 'Buenos Aires', 'la corrección de recepción quedó guardada');
  ok(!(await rec.page.locator('.planilla tbody tr').first().locator('.pendiente').count()), 'ya no dice "Sin asignar"');

  // habitación inválida
  await rec.page.getByRole('button', { name: /Editar/ }).first().click();
  await rec.page.getByRole('dialog').getByLabel('Habitación').fill('<b>');
  await rec.page.getByRole('button', { name: 'Guardar cambios' }).click();
  await rec.page.getByText('La habitación puede tener hasta 12 letras o números').first().waitFor();
  ok(true, 'habitación inválida: se avisa');
  await rec.page.keyboard.press('Escape');
  ok(rec.errores.length === 0 && hue.errores.length === 0, 'sin errores en la consola ' + [...rec.errores, ...hue.errores].join('|'));
  await rec.ctx.close();
  await hue.ctx.close();
});

await seccion('4. Un código para varias personas (habitación triple) y límite de usos', async () => {
  await reiniciar();
  await configurar({ activo: true, codigo_seg: 120, usos_max: 3, hash_recepcion: null });
  await back.sql(`update private.checkin_config set hash_recepcion = extensions.crypt($1, extensions.gen_salt('bf')) where id = 1`, [CLAVE_RECEPCION]);
  const rec = await contexto();
  await recepcionLogin(rec.page);
  const codigo = await codigoDeRecepcion(rec.page);
  const personas = ['Ana', 'Beto', 'Carla'];
  for (const [i, n] of personas.entries()) {
    const g = await contexto();
    await g.page.goto(BASE + '#/registro');
    await ingresarCodigo(g.page, codigo);
    await g.page.getByRole('heading', { name: 'Tus datos' }).waitFor();
    await completarFormulario(g.page, { ...DATOS, nombre: n, doc_numero: String(30000000 + i) });
    await g.page.getByLabel(/Acepto que el hotel/).check();
    await g.page.getByRole('button', { name: 'Enviar formulario' }).click();
    await g.page.getByRole('heading', { name: '¡Check-in realizado!' }).waitFor();
    await g.ctx.close();
  }
  ok((await sql1('select count(*)::int as n from private.checkins')).n === 3, 'las 3 personas completaron el check-in con el mismo código');
  const cuarta = await contexto();
  await cuarta.page.goto(BASE + '#/registro');
  await ingresarCodigo(cuarta.page, codigo);
  await cuarta.page.getByText('El código no es correcto o ya venció').waitFor();
  ok(true, 'la cuarta persona con el mismo código: rechazada (se gastó)');
  await cuarta.ctx.close();
  await rec.page.locator('.planilla tbody tr').nth(2).waitFor({ timeout: 8000 });
  ok((await rec.page.locator('.planilla tbody tr').count()) === 3, 'recepción ve las 3 filas');
  await hasta(async () => (await codigoDeRecepcion(rec.page)) !== codigo, 8000);
  ok((await codigoDeRecepcion(rec.page)) !== codigo, 'al gastarse, recepción recibe un código nuevo sin tocar nada');
  await captura(rec.page, '33-recepcion-3-huespedes', { fullPage: true });
  // la misma pantalla en una compu
  const desk = await contexto({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await recepcionLogin(desk.page);
  await desk.page.locator('.planilla tbody tr').nth(2).waitFor();
  await sinDesborde(desk.page, 'recepción en la compu');
  await captura(desk.page, '35-recepcion-escritorio');
  ok(desk.errores.length === 0, 'sin errores en la consola ' + desk.errores.join('|'));
  await desk.ctx.close();
  await rec.ctx.close();
});

await seccion('5. El código cambia solo y recepción puede pedir uno nuevo', async () => {
  await reiniciar();
  await configurar({ activo: true, codigo_seg: 5, usos_max: 3 });
  await back.sql(`update private.checkin_config set hash_recepcion = extensions.crypt($1, extensions.gen_salt('bf')) where id = 1`, [CLAVE_RECEPCION]);
  const rec = await contexto();
  await recepcionLogin(rec.page);
  const a = await codigoDeRecepcion(rec.page);
  ok(await hasta(async () => { const t = await rec.page.locator('.codigo-grande').innerText(); return /\d/.test(t) && t.replace(/\D/g, '') !== a; }, 14000), 'a los 5 segundos el código cambia solo');
  await configurar({ codigo_seg: 120 });
  const b = await codigoDeRecepcion(rec.page);
  await hasta(async () => (await rec.page.locator('.codigo-meta').innerText()).includes('s ·'));
  await rec.page.getByRole('button', { name: /Código nuevo ahora/ }).click();
  ok(await hasta(async () => { const t = (await rec.page.locator('.codigo-grande').innerText()).replace(/\D/g, ''); return t.length === 6 && t !== b; }, 8000), '"Código nuevo ahora" genera otro enseguida');
  const c = (await rec.page.locator('.codigo-grande').innerText()).replace(/\D/g, '');
  const g = await contexto();
  await g.page.goto(BASE + '#/registro');
  await ingresarCodigo(g.page, b);
  await g.page.getByText('El código no es correcto o ya venció').waitFor();
  ok(true, 'el código anterior quedó anulado');
  await ingresarCodigo(g.page, c);
  await g.page.getByRole('heading', { name: 'Tus datos' }).waitFor();
  ok(true, 'el nuevo sí sirve');
  await g.ctx.close();
  await rec.ctx.close();
});

await seccion('6. Ventana de edición: pasados los minutos, recepción ya no edita; el admin sí', async () => {
  await reiniciar();
  await configurar({ activo: true, codigo_seg: 120 });
  await back.sql(`update private.checkin_config set hash_recepcion = extensions.crypt($1, extensions.gen_salt('bf')) where id = 1`, [CLAVE_RECEPCION]);
  const rec = await contexto();
  await recepcionLogin(rec.page);
  const codigo = await codigoDeRecepcion(rec.page);
  const g = await contexto();
  await g.page.goto(BASE + '#/registro');
  await ingresarCodigo(g.page, codigo);
  await g.page.getByRole('heading', { name: 'Tus datos' }).waitFor();
  await completarFormulario(g.page);
  await g.page.getByLabel(/Acepto que el hotel/).check();
  await g.page.getByRole('button', { name: 'Enviar formulario' }).click();
  await g.page.getByRole('heading', { name: '¡Check-in realizado!' }).waitFor();
  await g.ctx.close();
  await rec.page.getByRole('button', { name: /Editar/ }).first().waitFor({ timeout: 8000 });
  await back.sql(`update private.checkins set creado = now() - interval '11 minutes'`);
  await rec.page.getByText('Cerrado').first().waitFor({ timeout: 8000 });
  ok(!(await rec.page.getByRole('button', { name: /Editar/ }).count()), 'pasados los 10 minutos desaparece el botón Editar en recepción');
  const r = await fetch(`${back.url}/rest/v1/rpc/recepcion_editar`, { method: 'POST', body: JSON.stringify({ p_clave: CLAVE_RECEPCION, p_id: 1, p_datos: { nombre: 'Hack' }, p_habitacion: '1' }) }).then((x) => x.json());
  ok(r.ok === false, 'y la base también lo rechaza si se intenta igual (' + r.error + ')');

  const adm = await contexto({ viewport: { width: 1280, height: 900 } });
  await entrarAdmin(adm.page, '#/admin/huespedes');
  await adm.page.locator('.planilla tbody tr').first().waitFor();
  ok(/Pérez García/.test(await adm.page.locator('.planilla tbody tr').first().innerText()), 'el admin ve al huésped');
  await adm.page.getByRole('button', { name: /Editar/ }).first().click();
  await adm.page.getByRole('dialog').waitFor();
  ok(!(await adm.page.locator('.nota-tiempo').count()), 'el admin no tiene límite de tiempo');
  const nom = adm.page.getByRole('dialog').getByLabel('Nombre', { exact: true });
  await nom.fill('');
  await nom.click();
  await adm.page.keyboard.type('Anita', { delay: 600 });
  ok((await nom.inputValue()) === 'Anita' && await enfocado(adm.page, 'nombre'), 'admin: escribir despacio en la edición tampoco pierde el foco');
  await adm.page.getByRole('dialog').getByLabel('Habitación').fill('305');
  await adm.page.getByRole('button', { name: 'Guardar cambios' }).click();
  await adm.page.getByText('Cambios guardados.').waitFor();
  const f = await sql1(`select datos ->> 'nombre' as n, habitacion, editado_por from private.checkins order by id desc limit 1`);
  ok(f.n === 'Anita' && f.habitacion === '305' && f.editado_por === 'admin', 'el admin corrigió nombre y habitación fuera de la ventana');
  await rec.page.getByText('Anita').first().waitFor({ timeout: 8000 });
  ok(true, 'recepción ve el cambio del admin');
  await sinDesborde(adm.page, 'admin: huéspedes');
  // un huésped de otro país: al editar, el teléfono vuelve con el país correcto
  const sesBr = await back.llamar('checkin_canjear', { p_codigo: codigo });
  const envBr = await back.llamar('checkin_enviar', { p_token: sesBr.token, p_idioma: 'pt', p_acepta: true, p_datos: { nombre: 'João', apellido: 'Silva', email: 'joao@exemplo.com.br', telefono: '+5511987654321', nacionalidad: 'Brasil', localidad: 'São Paulo', domicilio: 'Rua Augusta 1500', doc_tipo: 'Pasaporte', doc_numero: 'FZ123456' } });
  ok(envBr.ok === true, 'se carga un huésped brasileño con pasaporte y teléfono +55');
  await adm.page.getByRole('button', { name: 'Actualizar' }).click();
  await adm.page.getByText('Silva').first().waitFor();
  await adm.page.getByRole('button', { name: /Editar a Silva João/ }).click();
  await adm.page.getByRole('dialog').waitFor();
  await hasta(async () => (await adm.page.getByRole('dialog').getByLabel('Teléfono', { exact: true }).inputValue()).startsWith('('), 4000);
  ok((await adm.page.getByRole('dialog').getByLabel('Teléfono', { exact: true }).inputValue()) === '(11) 98765-4321', 'el teléfono brasileño se muestra en su formato local: (11) 98765-4321');
  ok((await adm.page.getByRole('dialog').getByLabel('País del teléfono').inputValue()) === 'BR', 'y el selector de país del teléfono marca Brasil (+55)');
  await adm.page.keyboard.press('Escape');
  await adm.page.getByRole('dialog').waitFor({ state: 'hidden' });
  await captura(adm.page, '23-admin-huespedes', { fullPage: true });

  const buscar = adm.page.getByLabel(/Buscar por nombre/);
  await buscar.click();
  await adm.page.keyboard.type('PEREZ', { delay: 500 });
  ok((await buscar.inputValue()) === 'PEREZ' && await adm.page.evaluate(() => document.activeElement?.id === 'buscar'), 'admin: escribir despacio en el buscador no pierde letras ni el foco (aunque la lista se recargue sola)');
  await hasta(async () => (await adm.page.locator('.planilla tbody tr').count()) === 1);
  ok((await adm.page.locator('.planilla tbody tr').count()) === 1, 'la búsqueda ignora mayúsculas y tildes (PEREZ = Pérez)');
  await adm.page.getByLabel(/Buscar por nombre/).fill('zzzz');
  await adm.page.getByText('No hay huéspedes que coincidan con la búsqueda').waitFor();
  ok(true, 'búsqueda sin resultados: avisa');
  await adm.page.getByLabel(/Buscar por nombre/).fill('');
  await adm.page.getByText('Historial de cambios').click();
  await adm.page.getByText(/editó a un huésped/).first().waitFor();
  ok(true, 'el historial muestra quién cambió qué');
  await adm.ctx.close();
  await rec.ctx.close();
});

await seccion('7. Foto del documento → Drive (simulado) y asistente de conexión', async () => {
  await reiniciar();
  await configurar({ activo: true, codigo_seg: 120 });
  await back.sql(`update private.checkin_config set hash_recepcion = extensions.crypt($1, extensions.gen_salt('bf')) where id = 1`, [CLAVE_RECEPCION]);

  // asistente en el admin (el nombre de la foto lleva la hora del hotel: se usa la zona cargada en Datos generales)
  await back.sql(`update public.contenido set data = jsonb_set(data, '{hotel,zonaHoraria}', '"America/Montevideo"') where id = 1`);
  const adm = await contexto({ viewport: { width: 1000, height: 900 } });
  await entrarAdmin(adm.page, '#/admin/huespedes');
  await adm.page.getByText('Conectar Drive para las fotos').click();
  await adm.page.getByLabel('Link de la carpeta de Drive').fill('https://drive.google.com/drive/folders/CARPETA1234567890?usp=sharing');
  const codigo = await adm.page.getByLabel('Código del script').inputValue();
  const secreto = (await sql1('select foto_secreto from private.checkin_config where id = 1')).foto_secreto;
  ok(codigo.includes("CARPETA_ID: 'CARPETA1234567890'") && codigo.includes(`SECRETO: '${secreto}'`) && !codigo.includes('%%'), 'el asistente arma el código del script con la carpeta y la clave ya cargadas');
  ok(await hasta(async () => (await adm.page.getByLabel('Código del script').inputValue()).includes("ZONA: 'America/Montevideo'"), 6000), 'y con la zona horaria que tiene cargada el hotel (America/Montevideo en la prueba)');
  await adm.page.getByLabel('URL de la aplicación web').fill('https://malo.com/x');
  await adm.page.getByRole('button', { name: 'Guardar y probar' }).click();
  await adm.page.getByText(/tiene que terminar en \/exec/).waitFor();
  ok(true, 'una URL que no es de Google Apps Script se rechaza');
  await sinDesborde(adm.page, 'admin: asistente de Drive');
  await captura(adm.page, '24-admin-conectar-drive', { fullPage: true });
  // la base solo acepta direcciones de Google; para la prueba se apunta al script simulado
  await configurar({ foto_url: `${back.url}/apps-script/exec` });
  await adm.ctx.close();

  const rec = await contexto();
  await recepcionLogin(rec.page);
  const cod = await codigoDeRecepcion(rec.page);
  const g = await contexto();
  await g.page.goto(BASE + '#/registro');
  await ingresarCodigo(g.page, cod);
  await g.page.getByRole('heading', { name: 'Tus datos' }).waitFor();
  ok(await g.page.getByText('Foto del documento').isVisible(), 'con Drive conectado aparece el área de la foto');
  ok(await g.page.getByRole('button', { name: /Sacar foto/ }).isVisible() && await g.page.getByRole('button', { name: /Elegir de la galería/ }).isVisible(), 'con los botones "Sacar foto" y "Elegir de la galería"');
  ok((await g.page.locator('input[type=file]:visible').count()) === 0, 'los selectores de archivo del navegador quedan ocultos (solo se ven los dos botones)');
  await g.page.getByText('Foto del documento').scrollIntoViewIfNeeded();
  await captura(g.page, '15b-formulario-foto-vacia');
  await sinDesborde(g.page, 'formulario con foto');
  await completarFormulario(g.page);
  await g.page.getByLabel(/Acepto que el hotel/).check();
  // archivo que no es imagen
  await g.page.locator('input[type=file]').nth(1).setInputFiles({ name: 'cosa.txt', mimeType: 'text/plain', buffer: Buffer.from('hola') });
  await g.page.getByText(/No pudimos usar ese archivo/).waitFor();
  ok(true, 'un archivo que no es imagen se rechaza');
  const b64 = await jpegBase64(g.page);
  await g.page.locator('input[type=file]').nth(1).setInputFiles({ name: 'dni.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') });
  await g.page.locator('.foto-prev').waitFor();
  ok(true, 'la foto elegida se ve en una vista previa');
  await captura(g.page, '15-formulario-con-foto', { fullPage: true });
  await g.page.getByRole('button', { name: 'Quitar foto' }).click();
  ok(!(await g.page.locator('.foto-prev').count()), 'se puede quitar la foto');
  await g.page.locator('input[type=file]').nth(0).setInputFiles({ name: 'camara.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') });
  await g.page.locator('.foto-prev').waitFor();
  await g.page.getByRole('button', { name: 'Enviar formulario' }).click();
  await g.page.getByRole('heading', { name: '¡Check-in realizado!' }).waitFor({ timeout: 15000 });
  ok(true, 'envía el formulario con la foto');
  const drive = await fetch(`${back.url}/__test/drive`).then((x) => x.json());
  ok(drive.length === 1 && /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}_Perez-Garcia_Ana-Maria\.jpg$/.test(drive[0].nombre) && drive[0].mime === 'image/jpeg', 'la foto quedó en Drive con fecha, hora y nombre: ' + drive[0]?.nombre);
  ok(drive[0].bytes < 900 * 1024, 'y pesa poco (' + Math.round(drive[0].bytes / 1024) + ' KB)');
  const fila = await sql1('select foto_id, foto_nombre from private.checkins order by id desc limit 1');
  ok(fila.foto_id === drive[0].id && fila.foto_nombre === drive[0].nombre, `en la base solo quedó el id y el nombre del archivo (la imagen no está en la base) ${JSON.stringify(fila)} vs ${JSON.stringify(drive[0].id)}`);
  const peso = await sql1(`select pg_column_size(datos) as d from private.checkins order by id desc limit 1`);
  ok(peso.d < 1000, 'la fila del huésped pesa menos de 1 KB');
  await rec.page.locator('.ver-foto').first().waitFor({ timeout: 8000 });
  ok((await rec.page.locator('.ver-foto').first().getAttribute('href')) === `https://drive.google.com/file/d/${drive[0].id}/view`, 'recepción ve el link "Ver foto" que abre Drive');
  await captura(rec.page, '34-recepcion-con-foto', { fullPage: true });
  await g.ctx.close();

  // foto obligatoria
  await configurar({ foto_modo: 'obligatoria' });
  await back.sql('update private.checkin_codigo set usos = 0 where id = 1');
  const cod2 = await codigoDeRecepcion(rec.page);
  const g2 = await contexto();
  await g2.page.goto(BASE + '#/registro');
  await ingresarCodigo(g2.page, cod2);
  await g2.page.getByRole('heading', { name: 'Tus datos' }).waitFor();
  await completarFormulario(g2.page, { ...DATOS, doc_numero: '30999888' });
  await g2.page.getByLabel(/Acepto que el hotel/).check();
  await g2.page.getByRole('button', { name: 'Enviar formulario' }).click();
  await g2.page.getByText('Falta la foto del documento').first().waitFor();
  ok(true, 'con la foto obligatoria no deja enviar sin foto');
  const r = await fetch(`${back.url}/rest/v1/rpc/checkin_enviar`, { method: 'POST', body: JSON.stringify({ p_token: 'x', p_datos: {}, p_idioma: 'es', p_acepta: true }) }).then((x) => x.json());
  ok(r.ok === false, 'y la base tampoco acepta saltearse la sesión');
  await g2.ctx.close();

  // si Drive falla: se puede reintentar o enviar sin foto (cuando es opcional)
  await configurar({ foto_modo: 'opcional', foto_url: `${back.url}/apps-script/no-existe` });
  await back.sql('update private.checkin_codigo set usos = 0 where id = 1');
  const g3 = await contexto();
  await g3.page.goto(BASE + '#/registro');
  await ingresarCodigo(g3.page, await codigoDeRecepcion(rec.page));
  await g3.page.getByRole('heading', { name: 'Tus datos' }).waitFor();
  await completarFormulario(g3.page, { ...DATOS, doc_numero: '30555444' });
  await g3.page.getByLabel(/Acepto que el hotel/).check();
  await g3.page.locator('input[type=file]').nth(1).setInputFiles({ name: 'dni.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') });
  await g3.page.getByRole('button', { name: 'Enviar formulario' }).click();
  await g3.page.getByText(/No pudimos subir la foto/).waitFor({ timeout: 20000 });
  ok(true, 'si Drive no responde se avisa claramente');
  await g3.page.getByRole('button', { name: 'Enviar sin foto' }).click();
  await g3.page.getByRole('heading', { name: '¡Check-in realizado!' }).waitFor();
  ok((await sql1('select count(*)::int as n from private.checkins')).n === 2 && (await sql1('select foto_id from private.checkins order by id desc limit 1')).foto_id === null, 'y se puede enviar el formulario sin foto');
  await g3.ctx.close();
  await rec.ctx.close();
});

await seccion('8. Sesión: se retoma al recargar y vence a los 30 minutos', async () => {
  await reiniciar();
  await configurar({ activo: true, codigo_seg: 120 });
  await back.sql(`update private.checkin_config set hash_recepcion = extensions.crypt($1, extensions.gen_salt('bf')) where id = 1`, [CLAVE_RECEPCION]);
  const rec = await contexto();
  await recepcionLogin(rec.page);
  const codigo = await codigoDeRecepcion(rec.page);
  const g = await contexto();
  await g.page.goto(BASE + '#/registro');
  await ingresarCodigo(g.page, codigo);
  await g.page.getByRole('heading', { name: 'Tus datos' }).waitFor();
  await g.page.getByLabel('Nombre', { exact: true }).fill('Lucía');
  await g.page.getByLabel(/Acepto que el hotel/).check();
  await g.page.reload();
  await g.page.getByRole('heading', { name: 'Tus datos' }).waitFor();
  ok((await g.page.getByLabel('Nombre', { exact: true }).inputValue()) === 'Lucía', 'al recargar sigue en el formulario y conserva lo escrito');
  await back.sql(`update private.checkin_sesiones set vence = now() - interval '1 minute'`);
  await g.page.reload();
  await g.page.getByLabel(/Código de 6 números/).waitFor();
  ok(true, 'con la sesión vencida vuelve a pedir el código');
  // vence mientras completa
  await back.sql('update private.checkin_codigo set usos = 0 where id = 1');
  await ingresarCodigo(g.page, await codigoDeRecepcion(rec.page));
  await g.page.getByRole('heading', { name: 'Tus datos' }).waitFor();
  await back.sql(`update private.checkin_sesiones set vence = now() - interval '1 second'`);
  await completarFormulario(g.page);
  await g.page.getByLabel(/Acepto que el hotel/).check();
  await g.page.getByRole('button', { name: 'Enviar formulario' }).click();
  await g.page.getByText('Se terminó el tiempo para completar el formulario').waitFor();
  ok(true, 'si la sesión venció al enviar: avisa que pida otro código');
  ok((await sql1('select count(*)::int as n from private.checkins')).n === 0, 'y no se guardó nada');
  await g.ctx.close();
  await rec.ctx.close();
});

await seccion('9. Seguridad de la base', async () => {
  await reiniciar();
  const intento = async (sql) => { try { await back.exec(`begin; set local role anon; ${sql}; rollback;`); return null; } catch (e) { await back.exec('rollback').catch(() => {}); return String(e.message); } };
  ok(/permission denied/.test(await intento('select * from private.checkins') ?? ''), 'anónimo no puede leer los huéspedes directo');
  ok(/permission denied/.test(await intento('select * from private.checkin_config') ?? ''), 'ni la configuración (con la clave del script)');
  ok(/permission denied/.test(await intento('select private.codigo_vigente()') ?? ''), 'ni llamar a las funciones internas');
  ok(/permission denied/.test(await intento(`update private.checkins set habitacion = 'x'`) ?? ''), 'ni modificar nada');
  const publicas = await back.sql(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute') order by 1`);
  const esperadas = ['admin_checkin_auditoria', 'admin_checkin_clave_recepcion', 'admin_checkin_config', 'admin_checkin_config_guardar', 'admin_foto_permiso', 'admin_foto_quitar', 'admin_fotos', 'admin_huesped_editar', 'admin_huespedes', 'admin_medios_pago', 'admin_medios_pago_guardar', 'cambiar_clave', 'checkin_canjear', 'checkin_enviar', 'checkin_estado', 'checkin_foto_registrar', 'checkin_sesion', 'guardar_contenido', 'recepcion_codigo_nuevo', 'recepcion_editar', 'recepcion_entrar', 'recepcion_estado', 'verificar_clave'];
  ok(JSON.stringify(publicas.map((p) => p.proname)) === JSON.stringify(esperadas), 'las únicas funciones que puede llamar un anónimo son las previstas (' + publicas.length + ')');
  // todas las funciones expuestas rechazan claves malas
  for (const [fn, args] of [['admin_huespedes', { p_clave: 'x' }], ['admin_checkin_config', { p_clave: 'x' }], ['recepcion_estado', { p_clave: 'x' }], ['admin_checkin_auditoria', { p_clave: 'x' }]]) {
    const r = await back.llamar(fn, args, `198.51.100.${Math.floor(Math.random() * 200)}`);
    ok(r.ok === false && r.error === 'clave_incorrecta', `${fn} rechaza una clave incorrecta`);
  }
  // frenos por IP
  let ultimo;
  for (let i = 0; i < 9; i += 1) ultimo = await back.llamar('recepcion_entrar', { p_clave: 'mala' }, '198.51.100.250');
  ok(ultimo.error === 'demasiados_intentos', 'la clave de recepción se frena tras varios intentos fallidos desde la misma IP');
  const otraIp = await back.llamar('recepcion_entrar', { p_clave: 'mala' }, '198.51.100.251');
  ok(otraIp.error === 'clave_incorrecta', 'y otra IP no queda bloqueada');
  await configurar({ activo: true });
  let r;
  for (let i = 0; i < 7; i += 1) r = await back.llamar('checkin_canjear', { p_codigo: '000000' }, '198.51.100.240');
  ok(r.error === 'demasiados_intentos', 'los códigos al azar se frenan (6 intentos por minuto por IP)');
});

await seccion('10. Modo desarrollo (React en modo estricto, como con npm run dev / npm run local)', async () => {
  await reiniciar();
  await configurar({ activo: true, codigo_seg: 120 });
  await back.sql(`update private.checkin_config set hash_recepcion = extensions.crypt($1, extensions.gen_salt('bf')) where id = 1`, [CLAVE_RECEPCION]);
  const est = await back.llamar('recepcion_estado', { p_clave: CLAVE_RECEPCION });
  const ses = await back.llamar('checkin_canjear', { p_codigo: String(est.codigo.valor) });
  await back.llamar('checkin_enviar', { p_token: ses.token, p_idioma: 'es', p_acepta: true, p_datos: { nombre: 'Ana María', apellido: 'Pérez García', email: 'ana@correo.com', telefono: '+541155551234', nacionalidad: 'Argentina', localidad: 'Capital Federal', domicilio: 'Av. Corrientes 1234 5° B', doc_tipo: 'DNI', doc_numero: '30123456' } });
  const dev = spawn('npx', ['vite', '--port', String(PUERTO_DEV), '--strictPort'], {
    cwd: raiz, stdio: 'ignore', env: { ...process.env, VITE_SUPABASE_URL: `http://localhost:${PUERTO_BACK}`, VITE_SUPABASE_KEY: 'local-key' }
  });
  try {
    ok(await hasta(() => fetch(`http://localhost:${PUERTO_DEV}/`).then((r) => r.ok).catch(() => false), 40000, 500), 'el servidor de desarrollo arranca');
    // un celular de verdad: toca con el dedo
    const rec = await contexto({ hasTouch: true, isMobile: true });
    rec.page.setDefaultTimeout(40000);
    await rec.page.goto(`http://localhost:${PUERTO_DEV}/#/recepcion`);
    await rec.page.locator('input[name=clave]').fill(CLAVE_RECEPCION);
    await rec.page.getByRole('button', { name: 'Entrar' }).click();
    await rec.page.locator('.planilla tbody tr').first().waitFor();
    await rec.page.locator('.hab-boton').first().tap();
    await rec.page.getByRole('dialog').waitFor();
    ok(await enfocado(rec.page, 'habitacion'), 'en desarrollo: al tocar "Sin asignar" se abre la ventana con el cursor en Habitación');
    await rec.page.keyboard.type('306', { delay: 800 });
    ok((await rec.page.getByRole('dialog').getByLabel('Habitación').inputValue()) === '306' && await enfocado(rec.page, 'habitacion'), 'en desarrollo: se escribe la habitación despacio sin perder el foco');
    await rec.page.getByRole('button', { name: 'Guardar cambios' }).tap();
    await rec.page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 10000 });
    ok(true, 'en desarrollo: tocar "Guardar cambios" cierra la ventana (no se queda en "Guardando…")');
    await hasta(async () => /306/.test(await rec.page.locator('.planilla tbody tr').first().innerText()), 10000);
    ok(/306/.test(await rec.page.locator('.planilla tbody tr').first().innerText()), 'en desarrollo: la planilla muestra enseguida la habitación guardada');
    ok(rec.errores.filter((e) => !/Failed to load resource|ERR_FAILED/.test(e)).length === 0, 'sin errores en la consola ' + rec.errores.join('|'));
    await rec.ctx.close();
  } finally {
    dev.kill();
  }
});

await seccion('11. Medio de pago: recepción lo elige y el dueño edita la lista', async () => {
  await reiniciar();
  await configurar({ activo: true, codigo_seg: 300, usos_max: 20 });
  await back.sql(`update private.checkin_config set hash_recepcion = extensions.crypt($1, extensions.gen_salt('bf')) where id = 1`, [CLAVE_RECEPCION]);
  await huespedPorApi({ nombre: 'Ana', apellido: 'Uno', doc_numero: '30000001' });
  await huespedPorApi({ nombre: 'Beto', apellido: 'Dos', doc_numero: '30000002' });
  await huespedPorApi({ nombre: 'Carla', apellido: 'Tres', doc_numero: '30000003' });
  const medioDe = async (apellido) => (await sql1(`select m.nombre from private.checkins k join private.medios_pago m on m.id = k.medio_pago_id where k.datos ->> 'apellido' = $1`, [apellido])).nombre;

  // ---- recepción, en un celular
  const rec = await contexto({ hasTouch: true, isMobile: true });
  await recepcionLogin(rec.page);
  await rec.page.locator('.planilla tbody tr').nth(2).waitFor();
  ok(await rec.page.locator('.planilla thead th', { hasText: 'Medio de pago' }).isVisible(), 'la planilla tiene la columna "Medio de pago"');
  const pagos = await rec.page.locator('.planilla tbody tr .pago').allInnerTexts();
  ok(pagos.length === 3 && pagos.every((t) => t === 'Otros'), 'los huéspedes sin medio elegido figuran como "Otros" (ninguno vacío)');
  await sinDesborde(rec.page, 'recepción con la columna nueva (celular)');
  await rec.page.locator('.planilla tbody tr').first().locator('.hab-boton').tap();
  const dlg = rec.page.getByRole('dialog');
  await dlg.waitFor();
  const selector = dlg.getByLabel('Medio de pago');
  ok(await selector.isVisible(), 'la ventana de edición tiene el selector "Medio de pago"');
  ok((await selector.locator('option').allInnerTexts()).join('|') === 'Efectivo|Transferencia|USD efectivo|PayPal|Link de pago|Otros', 'con las opciones Efectivo, Transferencia, USD efectivo, PayPal, Link de pago y Otros');
  ok((await selector.inputValue()) === '6', 'arranca en "Otros"');
  ok(await enfocado(rec.page, 'habitacion'), 'el cursor sigue abriendo en Habitación (lo primero que se carga)');
  await rec.page.keyboard.type('204', { delay: 700 });
  await selector.selectOption({ label: 'Efectivo' });
  ok((await selector.inputValue()) === '1' && (await dlg.getByLabel('Habitación').inputValue()) === '204', 'se escribe la habitación y se elige "Efectivo" en el selector');
  await captura(rec.page, '40-recepcion-medio-de-pago');
  await sinDesborde(rec.page, 'ventana de edición con el selector (celular)');
  await rec.page.getByRole('button', { name: 'Guardar cambios' }).tap();
  await dlg.waitFor({ state: 'hidden' });
  await hasta(async () => /Efectivo/.test(await rec.page.locator('.planilla tbody tr').first().innerText()), 8000);
  const fila1 = (await rec.page.locator('.planilla tbody tr').first().innerText()).replace(/\s+/g, ' ');
  ok(/204/.test(fila1) && /Efectivo/.test(fila1), 'al guardar, la planilla muestra enseguida la habitación y el medio de pago: ' + fila1.slice(0, 40));
  ok(await medioDe('Tres') === 'Efectivo', 'y quedó guardado en la base');
  await captura(rec.page, '41-recepcion-planilla-medio-de-pago');

  // ---- el dueño, en un celular
  const adm = await contexto({ hasTouch: true, isMobile: true });
  await entrarAdmin(adm.page, '#/admin/huespedes');
  await adm.page.getByText('Medios de pago', { exact: false }).first().click();
  await adm.page.locator('.medios .entrada').first().waitFor();
  const nombres = () => adm.page.locator('.medios .entrada').evaluateAll((els) => els.map((e) => e.value));
  ok((await nombres()).join('|') === 'Efectivo|Transferencia|USD efectivo|PayPal|Link de pago|Otros', 'el dueño ve la lista de medios de pago para editar');
  ok(!(await adm.page.getByRole('button', { name: /Quitar Otros/ }).count()), '"Otros" no tiene botón para quitar');
  ok(await adm.page.getByRole('button', { name: 'Guardar medios de pago' }).isDisabled(), 'sin cambios, el botón de guardar está apagado');
  await sinDesborde(adm.page, 'panel de medios de pago (celular)');
  await captura(adm.page, '42-admin-medios-de-pago', { fullPage: true });
  // agregar escribiendo despacio
  const nuevoCampo = adm.page.getByLabel('Agregar un medio de pago');
  await nuevoCampo.tap();
  await adm.page.keyboard.type('Tarjeta de crédito', { delay: 250 });
  ok((await nuevoCampo.inputValue()) === 'Tarjeta de crédito', 'escribir despacio el nombre nuevo no pierde letras');
  await adm.page.getByRole('button', { name: 'Agregar', exact: true }).tap();
  ok((await nombres()).join('|') === 'Efectivo|Transferencia|USD efectivo|PayPal|Link de pago|Tarjeta de crédito|Otros', 'el nuevo aparece antes de "Otros", que sigue último');
  // un nombre repetido se avisa
  await nuevoCampo.fill('efectivo');
  await adm.page.getByRole('button', { name: 'Agregar', exact: true }).tap();
  ok(await adm.page.getByText('Ya hay un medio de pago con ese nombre').isVisible(), 'un nombre repetido se avisa (sin importar mayúsculas)');
  await nuevoCampo.fill('');
  // cambiar un nombre y quitar otro
  const paypal = adm.page.locator('.medios .entrada').nth(3);
  await paypal.fill('PayPal / MercadoPago');
  await adm.page.getByRole('button', { name: 'Quitar Link de pago' }).tap();
  ok((await nombres()).join('|') === 'Efectivo|Transferencia|USD efectivo|PayPal / MercadoPago|Tarjeta de crédito|Otros', 'cambiar un nombre y quitar "Link de pago" se ve al instante en la lista');
  ok(await adm.page.locator('.medios-quitados li', { hasText: 'Link de pago' }).isVisible(), 'lo quitado queda en "Quitados" (con "Volver a poner")');
  await paypal.fill('Efectivo');
  ok(await adm.page.getByText('Ya hay otro medio de pago con ese nombre').isVisible() && await adm.page.getByRole('button', { name: 'Guardar medios de pago' }).isDisabled(), 'un nombre repetido en la lista apaga el guardado y lo explica');
  await paypal.fill('PayPal / MercadoPago');
  await captura(adm.page, '43-admin-medios-cambios', { fullPage: true });
  if (CAPTURAS) await adm.page.locator('details.panel', { hasText: 'Agregar un medio de pago' }).screenshot({ path: path.join(CAPTURAS, '44-panel-medios-de-pago.png') });
  await adm.page.getByRole('button', { name: 'Guardar medios de pago' }).tap();
  await adm.page.getByText('Medios de pago guardados').waitFor();
  const guardados = (await back.sql('select nombre, activo from private.medios_pago order by id')).map((m) => `${m.nombre}${m.activo ? '' : ' (quitado)'}`).join('|');
  ok(guardados === 'Efectivo|Transferencia|USD efectivo|PayPal / MercadoPago|Link de pago (quitado)|Otros|Tarjeta de crédito', 'la base guarda los cambios: el quitado sigue existiendo, solo oculto: ' + guardados);
  await sinDesborde(adm.page, 'panel de medios de pago con cambios (celular)');
  ok(/Lo tiene 1 huésped\./.test(await adm.page.locator('.medios').innerText()), 'el panel informa cuántos huéspedes tiene cada medio ("Lo tiene 1 huésped.")');

  // ---- recepción ve los cambios y los huéspedes no pierden nada
  await rec.page.locator('.planilla tbody tr').nth(1).locator('.hab-boton').tap();
  await dlg.waitFor();
  await hasta(async () => (await dlg.getByLabel('Medio de pago').locator('option').allInnerTexts()).includes('Tarjeta de crédito'), 8000);
  ok((await dlg.getByLabel('Medio de pago').locator('option').allInnerTexts()).join('|') === 'Efectivo|Transferencia|USD efectivo|PayPal / MercadoPago|Tarjeta de crédito|Otros', 'recepción ve la lista nueva (sin "Link de pago", con "Tarjeta de crédito") sin recargar');
  await dlg.getByLabel('Medio de pago').selectOption({ label: 'Tarjeta de crédito' });
  await rec.page.getByRole('button', { name: 'Guardar cambios' }).tap();
  await dlg.waitFor({ state: 'hidden' });
  await hasta(async () => (await medioDe('Dos')) === 'Tarjeta de crédito', 6000);
  ok(await medioDe('Dos') === 'Tarjeta de crédito', 'recepción puede elegir el medio nuevo');

  // un huésped con un medio que después se quitó lo sigue mostrando
  await adm.page.goto(BASE + '#/admin/huespedes');
  await adm.page.reload();
  await adm.page.locator('.planilla tbody tr').first().waitFor();
  await adm.page.getByText('Medios de pago', { exact: false }).first().click();
  await back.sql(`update private.checkins set medio_pago_id = 5 where datos ->> 'apellido' = 'Uno'`);
  await adm.page.getByRole('button', { name: 'Actualizar' }).tap();
  await hasta(async () => /Link de pago/.test(await adm.page.locator('.planilla tbody').innerText()), 6000);
  ok(/Link de pago/.test(await adm.page.locator('.planilla tbody').innerText()), 'un huésped que tenía un medio ya quitado lo sigue mostrando en la planilla');
  await adm.page.locator('.planilla tbody tr', { hasText: 'Uno' }).locator('.hab-boton').tap();
  const dlgA = adm.page.getByRole('dialog');
  await dlgA.waitFor();
  ok((await dlgA.getByLabel('Medio de pago').locator('option:checked').innerText()) === 'Link de pago (ya no se ofrece)', 'y al editarlo, el selector lo conserva marcado como "ya no se ofrece"');
  await dlgA.getByLabel('Nombre', { exact: true }).fill('Anita');
  await adm.page.getByRole('button', { name: 'Guardar cambios' }).tap();
  await dlgA.waitFor({ state: 'hidden' });
  ok(await medioDe('Uno') === 'Link de pago', 'guardar otro dato no le cambia el medio de pago');

  // volver a poner
  await adm.page.getByRole('button', { name: 'Volver a poner' }).first().tap();
  await adm.page.getByRole('button', { name: 'Guardar medios de pago' }).tap();
  await adm.page.getByText('Medios de pago guardados').waitFor();
  ok((await sql1(`select activo from private.medios_pago where nombre = 'Link de pago'`)).activo === true, 'el dueño puede volver a poner un medio quitado');
  ok((await sql1('select count(*)::int as n from private.checkins')).n === 3 && (await sql1('select count(*)::int as n from private.medios_pago')).n === 7, 'ningún huésped ni medio de pago se borró en todo el recorrido');
  ok(rec.errores.length === 0 && adm.errores.length === 0, 'sin errores en la consola ' + [...rec.errores, ...adm.errores].join('|'));
  await rec.ctx.close();
  await adm.ctx.close();
});

await seccion('12. Planilla del admin: «Cargar más» muestra a todos los huéspedes, del más nuevo al más viejo', async () => {
  await reiniciar();
  await configurar({ activo: true, codigo_seg: 300, usos_max: 20 });
  // 120 huéspedes ya cargados (la planilla muestra de a 50)
  await back.sql(`insert into private.checkins (grupo, idioma, datos, consentimiento)
    select 1, 'es', jsonb_build_object('nombre', 'Nombre' || g, 'apellido', 'Apellido' || lpad(g::text, 3, '0'), 'email', 'h' || g || '@correo.com', 'telefono', '+541155551234', 'nacionalidad', 'Argentina', 'localidad', 'Capital Federal', 'domicilio', 'Calle ' || g, 'doc_tipo', 'DNI', 'doc_numero', (30000000 + g)::text), '{"aceptado":true}'::jsonb
      from generate_series(1, 120) g`);
  const adm = await contexto({ hasTouch: true, isMobile: true });
  await entrarAdmin(adm.page, '#/admin/huespedes');
  const filas = () => adm.page.locator('.planilla tbody tr');
  const apellidos = () => adm.page.evaluate(() => [...document.querySelectorAll('.planilla tbody tr')].map((tr) => tr.querySelectorAll('td')[2]?.innerText.trim()));
  const botonMas = adm.page.getByRole('button', { name: 'Cargar más' });
  const todos = async () => adm.page.locator('main').innerText();
  await filas().nth(49).waitFor();
  ok((await filas().count()) === 50 && await botonMas.isVisible(), 'la planilla arranca con los 50 más nuevos y el botón "Cargar más"');
  let a = await apellidos();
  ok(a[0] === 'Apellido120' && a[49] === 'Apellido071', 'del más nuevo (120) al 71');

  await botonMas.tap();
  await hasta(async () => (await filas().count()) >= 100, 8000);
  a = await apellidos();
  ok(a.length === 100 && new Set(a).size === 100, `"Cargar más" suma los 50 siguientes sin repetir a nadie (${a.length} filas, ${new Set(a).size} distintos)`);
  ok(a[50] === 'Apellido070' && a[99] === 'Apellido021', 'y sigue justo donde terminaba la lista (del 70 al 21)');
  await botonMas.scrollIntoViewIfNeeded();
  await captura(adm.page, '48-admin-cargar-mas');
  await botonMas.tap();
  await hasta(async () => (await filas().count()) >= 120, 8000);
  a = await apellidos();
  ok(a.length === 120 && new Set(a).size === 120 && a[119] === 'Apellido001', `otra vez trae los 20 que faltan: se ven los 120 y el último es el más viejo (${a.length} filas, ${new Set(a).size} distintos)`);
  ok(!(await botonMas.isVisible().catch(() => false)), 'y el botón desaparece cuando ya se ve a todos');
  ok(/Mostrando 120 huéspedes/.test(await todos()), 'la pantalla dice cuántos se ven ("Mostrando 120 huéspedes")');
  await sinDesborde(adm.page, 'admin: planilla con todos los huéspedes (celular)');

  // con una búsqueda también: filtra y "Cargar más" sigue desde donde corresponde
  await adm.page.locator('#buscar').fill('Capital');
  await hasta(async () => (await filas().count()) === 50 && await botonMas.isVisible().catch(() => false), 8000);
  ok((await filas().count()) === 50 && await botonMas.isVisible(), 'al buscar, la lista vuelve a los primeros 50 de la búsqueda');
  await botonMas.tap();
  await hasta(async () => (await filas().count()) >= 100, 8000);
  await botonMas.tap();
  await hasta(async () => (await filas().count()) >= 120, 8000);
  a = await apellidos();
  ok(a.length === 120 && new Set(a).size === 120 && a[0] === 'Apellido120' && a[119] === 'Apellido001', 'con la búsqueda, "Cargar más" también llega a los 120 sin repetir');
  await adm.page.locator('#buscar').fill('Apellido05');
  await hasta(async () => (await filas().count()) === 10, 8000);
  a = await apellidos();
  ok(a.length === 10 && a[0] === 'Apellido059' && a[9] === 'Apellido050' && !(await botonMas.isVisible().catch(() => false)), 'una búsqueda con pocos resultados no muestra "Cargar más"');
  await adm.page.locator('#buscar').fill('');
  await hasta(async () => (await filas().count()) === 50, 8000);

  // "Actualizar" y guardar un cambio no mandan al principio a quien ya cargó más
  await botonMas.tap();
  await hasta(async () => (await filas().count()) >= 100, 8000);
  // (el formulario de edición no acepta números en el nombre: se le pone uno válido a este huésped, que está en la segunda tanda)
  await back.sql(`update private.checkins set habitacion = '999', datos = datos || '{"nombre":"Beto","apellido":"Segunda Tanda"}'::jsonb where datos ->> 'apellido' = 'Apellido070'`);
  await adm.page.getByRole('button', { name: 'Actualizar' }).tap();
  const fila70 = adm.page.locator('.planilla tbody tr', { hasText: 'Segunda Tanda' });
  await hasta(async () => /999/.test(await fila70.innerText().catch(() => '')), 8000);
  a = await apellidos();
  ok(/999/.test(await fila70.innerText()) && a.length === 100 && new Set(a).size === 100, `"Actualizar" refresca lo que ya se ve y no vuelve a los primeros 50 (${a.length} filas)`);
  await fila70.locator('.hab-boton').tap();
  const dlg = adm.page.getByRole('dialog');
  await dlg.waitFor();
  await dlg.getByLabel('Habitación').fill('777');
  await adm.page.getByRole('button', { name: 'Guardar cambios' }).tap();
  await dlg.waitFor({ state: 'hidden' });
  await hasta(async () => /777/.test(await fila70.innerText().catch(() => '')), 8000);
  a = await apellidos();
  ok(/777/.test(await fila70.innerText()) && a.length === 100, `al guardar un cambio de alguien de la segunda tanda, la lista no vuelve al principio (${a.length} filas)`);
  await botonMas.tap();
  await hasta(async () => (await filas().count()) >= 120, 8000);
  a = await apellidos();
  ok(a.length === 120 && new Set(a).size === 120, 'y después se puede seguir cargando hasta el final');
  ok((await sql1('select count(*)::int as n from private.checkins')).n === 120, 'no se borró ni se duplicó ningún huésped');
  ok(adm.errores.length === 0, 'sin errores en la consola ' + adm.errores.join('|'));
  await adm.ctx.close();
});

await seccion('13. Fotos del documento: el dueño las carga a mano, agrega otra y quita la que no se ve', async () => {
  await reiniciar();
  await configurar({ activo: true, codigo_seg: 300, usos_max: 20, foto_url: `${back.url}/apps-script/exec` });
  await back.sql(`update private.checkin_config set hash_recepcion = extensions.crypt($1, extensions.gen_salt('bf')) where id = 1`, [CLAVE_RECEPCION]);
  // Ana mandó su foto al hacer el check-in; Beto no (la foto era opcional y se la salteó)
  await huespedPorApi({ nombre: 'Ana', apellido: 'Uno', doc_numero: '30000001' }, { conFoto: true });
  await huespedPorApi({ nombre: 'Beto', apellido: 'Dos', doc_numero: '30000002' });
  const drive = async () => (await fetch(`${back.url}/__test/drive`).then((x) => x.json())).filter((a) => a.mime === 'image/jpeg');
  const fotosDeBeto = () => back.sql(`select f.id, f.foto_id, f.nombre, f.origen, f.activa from private.checkin_fotos f join private.checkins k on k.id = f.checkin_id where k.datos ->> 'nombre' = 'Beto' order by f.id`);
  ok((await drive()).length === 1, 'arranca con una sola foto en Drive: la que mandó Ana');

  const adm = await contexto({ hasTouch: true, isMobile: true });
  await entrarAdmin(adm.page, '#/admin/huespedes');
  await adm.page.locator('.planilla tbody tr').nth(1).waitFor();
  const filaDe = (nombre) => adm.page.locator('.planilla tbody tr', { hasText: nombre });
  ok((await filaDe('Ana').locator('.ver-foto').count()) === 1 && (await filaDe('Ana').locator('.ver-foto').innerText()).trim() === 'Ver', 'en la planilla, Ana tiene su foto ("Ver")');
  ok(await filaDe('Ana').getByRole('button', { name: 'Fotos de Uno Ana' }).isVisible(), 'y un botón "Fotos" para verlas o agregar otra');
  ok((await filaDe('Beto').locator('.ver-foto').count()) === 0 && await filaDe('Beto').getByRole('button', { name: 'Agregar foto de Dos Beto' }).isVisible(), 'Beto no tiene foto: figura sin foto y con el botón "Agregar foto"');
  await sinDesborde(adm.page, 'admin: planilla con el botón de fotos (celular)');

  // ---- agregar la foto que Beto no mandó
  await filaDe('Beto').getByRole('button', { name: 'Agregar foto de Dos Beto' }).tap();
  const dlg = adm.page.getByRole('dialog', { name: 'Fotos de Beto Dos' });
  await dlg.waitFor();
  await dlg.getByText('Este huésped no tiene ninguna foto cargada.').waitFor();
  ok(await dlg.getByRole('button', { name: /Sacar foto/ }).isEnabled() && await dlg.getByRole('button', { name: /Elegir de la galería/ }).isEnabled(), 'el dueño ve "Sacar foto" y "Elegir de la galería"');
  ok(!(await dlg.getByRole('button', { name: 'Subir esta foto' }).count()), 'y todavía no hay nada para subir');
  ok((await dlg.locator('input[type=file]:visible').count()) === 0, 'los selectores de archivo del navegador quedan ocultos');
  await captura(adm.page, '45-admin-fotos-sin-foto');
  await dlg.locator('input[type=file]').nth(1).setInputFiles({ name: 'cosa.txt', mimeType: 'text/plain', buffer: Buffer.from('hola') });
  await dlg.getByText(/No pudimos usar ese archivo/).waitFor();
  ok(true, 'un archivo que no es una imagen se rechaza');
  const b64 = await jpegBase64(adm.page);
  await dlg.locator('input[type=file]').nth(1).setInputFiles({ name: 'dni-que-saco-recepcion.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') });
  await dlg.locator('.foto-prev').waitFor();
  ok(await dlg.getByRole('button', { name: 'Subir esta foto' }).isVisible() && await dlg.getByRole('button', { name: 'Descartar' }).isVisible(), 'la foto elegida se ve en una vista previa, con "Subir esta foto" y "Descartar"');
  await captura(adm.page, '46-admin-fotos-elegida');
  await dlg.getByRole('button', { name: 'Descartar' }).tap();
  ok(!(await dlg.locator('.foto-prev').count()), '"Descartar" la saca sin subir nada');
  ok((await drive()).length === 1 && (await fotosDeBeto()).length === 0, 'y no se guardó nada');
  await dlg.locator('input[type=file]').nth(1).setInputFiles({ name: 'dni.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') });
  await dlg.locator('.foto-prev').waitFor();
  await dlg.getByRole('button', { name: 'Subir esta foto' }).tap();
  await dlg.getByText('Foto agregada.').waitFor({ timeout: 15000 });
  ok(true, 'el dueño sube la foto y la ventana avisa "Foto agregada."');
  ok(await dlg.getByText('Foto 1', { exact: true }).isVisible() && await dlg.getByText(/La cargó el dueño/).isVisible(), 'queda en la lista como "Foto 1", cargada por el dueño');
  const d1 = await drive();
  let fb = await fotosDeBeto();
  ok(d1.length === 2 && /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}_Dos_Beto\.jpg$/.test(d1[1].nombre) && d1[1].bytes < 900 * 1024, 'el archivo quedó en la carpeta de Drive con el nombre de siempre (' + d1[1]?.nombre + ', ' + Math.round(d1[1].bytes / 1024) + ' KB)');
  ok(fb.length === 1 && fb[0].origen === 'admin' && fb[0].activa === true && fb[0].foto_id === d1[1].id, 'y en la base solo quedan el id y el nombre del archivo, marcada como cargada por el dueño');
  await dlg.locator('.modal-pie').getByRole('button', { name: 'Cerrar' }).tap();
  await dlg.waitFor({ state: 'hidden' });
  await hasta(async () => (await filaDe('Beto').locator('.ver-foto').count()) === 1, 8000);
  ok((await filaDe('Beto').locator('.ver-foto').getAttribute('href')) === `https://drive.google.com/file/d/${d1[1].id}/view` && await filaDe('Beto').getByRole('button', { name: 'Fotos de Dos Beto' }).isVisible(), 'al cerrar, la planilla ya muestra el link "Ver" que abre esa foto en Drive');

  // ---- otra foto al mismo huésped (por si la primera no se ve)
  await filaDe('Beto').getByRole('button', { name: 'Fotos de Dos Beto' }).tap();
  await dlg.waitFor();
  await dlg.getByText('Foto 1', { exact: true }).waitFor();
  await dlg.getByRole('heading', { name: 'Agregar otra foto' }).waitFor();
  await dlg.locator('input[type=file]').nth(0).setInputFiles({ name: 'camara.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') });
  await dlg.locator('.foto-prev').waitFor();
  await dlg.getByRole('button', { name: 'Subir esta foto' }).tap();
  await dlg.getByText('Foto 2', { exact: true }).waitFor({ timeout: 15000 });
  fb = await fotosDeBeto();
  ok(fb.length === 2 && fb.every((f) => f.activa) && (await drive()).length === 3, 'el dueño agrega otra foto al mismo huésped: ahora tiene dos (y hay 3 archivos en Drive)');
  await sinDesborde(adm.page, 'admin: ventana de fotos (celular)');

  // ---- quitar la que no se ve: se oculta, no se borra
  const archivosAntes = (await drive()).length;
  const filasAntes = (await sql1('select count(*)::int as n from private.checkin_fotos')).n;
  await dlg.getByRole('button', { name: 'Quitar la foto 1' }).tap();
  await dlg.getByText(/¿Quitar esta foto de la lista\?/).waitFor();
  ok(true, 'al tocar "Quitar" pregunta antes: no se borra de tu Drive y se puede volver a poner');
  await dlg.getByRole('button', { name: 'No', exact: true }).tap();
  ok(!(await dlg.getByText(/¿Quitar esta foto de la lista\?/).count()) && (await fotosDeBeto()).every((f) => f.activa), 'si toca "No", no pasa nada');
  await dlg.getByRole('button', { name: 'Quitar la foto 1' }).tap();
  await dlg.getByRole('button', { name: 'Sí, quitar' }).tap();
  await dlg.getByText('Foto quitada de la lista. Sigue en tu Drive.').waitFor();
  await dlg.getByRole('heading', { name: 'Quitadas' }).waitFor();
  fb = await fotosDeBeto();
  ok(fb.length === 2 && fb[0].activa === false && fb[1].activa === true, 'la foto 1 pasa a "Quitadas" y la otra sigue activa');
  ok((await drive()).length === archivosAntes && (await sql1('select count(*)::int as n from private.checkin_fotos')).n === filasAntes, 'NO se borró nada: el archivo sigue en Drive y la fila sigue en la base');
  await captura(adm.page, '47-admin-fotos-quitada');
  await dlg.locator('.modal-pie').getByRole('button', { name: 'Cerrar' }).tap();
  await dlg.waitFor({ state: 'hidden' });
  await hasta(async () => (await filaDe('Beto').locator('.ver-foto').count()) === 1, 8000);
  ok((await filaDe('Beto').locator('.ver-foto').innerText()).trim() === 'Ver' && (await filaDe('Beto').locator('.ver-foto').getAttribute('href')).endsWith(`${fb[1].foto_id}/view`), 'la planilla muestra solo la que quedó activa');

  // ---- volver a poner
  await filaDe('Beto').getByRole('button', { name: 'Fotos de Dos Beto' }).tap();
  await dlg.waitFor();
  await dlg.getByRole('button', { name: 'Volver a poner' }).tap();
  await dlg.getByText('Foto puesta de nuevo.').waitFor();
  ok(!(await dlg.getByRole('heading', { name: 'Quitadas' }).count()) && (await fotosDeBeto()).every((f) => f.activa), 'el dueño puede volver a poner la foto quitada');
  await dlg.locator('.modal-pie').getByRole('button', { name: 'Cerrar' }).tap();
  await dlg.waitFor({ state: 'hidden' });
  await hasta(async () => (await filaDe('Beto').locator('.ver-foto').count()) === 2, 8000);
  ok((await filaDe('Beto').locator('.ver-foto').allInnerTexts()).map((t) => t.trim()).join('|') === 'Ver 1|Ver 2', 'con dos fotos, la planilla muestra "Ver 1" y "Ver 2"');
  await captura(adm.page, '49-admin-planilla-dos-fotos');

  // ---- recepción solo las ve
  const rec = await contexto({ hasTouch: true, isMobile: true });
  await recepcionLogin(rec.page);
  await rec.page.locator('.planilla tbody tr').nth(1).waitFor();
  const recBeto = rec.page.locator('.planilla tbody tr', { hasText: 'Beto' });
  ok((await recBeto.locator('.ver-foto').allInnerTexts()).map((t) => t.trim()).join('|') === 'Ver 1|Ver 2', 'recepción ve las dos fotos de Beto (para consultarlas)');
  ok((await rec.page.getByRole('button', { name: /Agregar foto|Fotos de/ }).count()) === 0, 'pero no tiene botones para agregar ni quitar fotos');
  await rec.ctx.close();

  // ---- el historial de cambios
  await adm.page.getByText('Historial de cambios').tap();
  await adm.page.locator('.historial li').first().waitFor();
  const historial = await adm.page.locator('.historial').innerText();
  ok(/agregó una foto/.test(historial) && /quitó una foto/.test(historial) && /volvió a poner una foto/.test(historial), 'queda en el historial de cambios: agregó, quitó y volvió a poner una foto');
  ok(!/Dos_Beto/.test(historial), 'sin el nombre del archivo (lleva el nombre del huésped)');

  // ---- sin Drive conectado
  await configurar({ foto_url: null });
  await filaDe('Ana').getByRole('button', { name: 'Fotos de Uno Ana' }).tap();
  const dlgAna = adm.page.getByRole('dialog', { name: 'Fotos de Ana Uno' });
  await dlgAna.waitFor();
  await dlgAna.getByText(/primero hay que conectar Drive/).waitFor();
  ok(await dlgAna.getByText('Foto 1', { exact: true }).isVisible() && await dlgAna.getByRole('button', { name: /Sacar foto/ }).isDisabled() && await dlgAna.getByRole('button', { name: /Elegir de la galería/ }).isDisabled(), 'sin Drive conectado se siguen viendo las fotos, pero no se puede subir (y avisa por qué)');
  await dlgAna.locator('.modal-pie').getByRole('button', { name: 'Cerrar' }).tap();

  ok((await sql1('select count(*)::int as n from private.checkins')).n === 2 && (await sql1('select count(*)::int as n from private.checkin_fotos')).n === 3, 'no se borró ningún huésped ni ninguna foto en todo el recorrido');
  ok(adm.errores.length === 0, 'sin errores en la consola ' + adm.errores.join('|'));
  await adm.ctx.close();
});

await seccion('14. Foto grande del celular y página cerrada por falta de memoria', async () => {
  await reiniciar();
  await configurar({ activo: true, codigo_seg: 300, usos_max: 20, foto_url: `${back.url}/apps-script/exec` });
  await back.sql(`update private.checkin_config set hash_recepcion = extensions.crypt($1, extensions.gen_salt('bf')) where id = 1`, [CLAVE_RECEPCION]);
  const rec = await contexto();
  await recepcionLogin(rec.page);
  const cod = await codigoDeRecepcion(rec.page);
  const drive = async () => (await fetch(`${back.url}/__test/drive`).then((x) => x.json())).filter((a) => a.mime === 'image/jpeg');
  const usos = async () => (await sql1('select usos from private.checkin_codigo where id = 1')).usos;

  // Un celular de verdad (toca con el dedo). Además se cuenta cuántas veces la página le pide al navegador abrir una foto entera
  // (una foto grande no debería: se achica mientras se decodifica) y, para poder ver el aviso "Preparando…", se puede demorar el armado de
  // la foto (esta computadora es mucho más rápida que un celular).
  const abrirFormulario = async (tag) => {
    const g = await contexto({ hasTouch: true, isMobile: true });
    await g.page.addInitScript(() => {
      window.__enteras = 0;
      const abrir = window.createImageBitmap?.bind(window);
      if (abrir) window.createImageBitmap = (...a) => { window.__enteras += 1; return abrir(...a); };
      const aBlob = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (cb, ...r) { if (window.__retraso) setTimeout(() => aBlob.call(this, cb, ...r), window.__retraso); else aBlob.call(this, cb, ...r); };
    });
    await g.page.goto(BASE + '#/registro');
    await ingresarCodigo(g.page, cod);
    await g.page.getByRole('heading', { name: 'Tus datos' }).waitFor();
    return g;
  };

  // ---- 1. Una foto de 12 MP de un celular acostado: se achica, se endereza y llega a Drive
  const g = await abrirFormulario();
  await completarFormulario(g.page);
  await g.page.getByLabel(/Acepto que el hotel/).check();
  const grande = conOrientacion(await jpegGrande(g.page, 4000, 3000), 6);
  const cab = infoJpeg(new Uint8Array(grande));
  ok(cab.ancho === 4000 && cab.alto === 3000 && cab.orientacion === 6, `se arma una foto de 12 MP (${cab.ancho}x${cab.alto}) con la orientación de un celular acostado (${Math.round(grande.length / 1024)} KB)`);
  await g.page.evaluate(() => { window.__retraso = 900; });
  await g.page.locator('input[type=file]').nth(1).setInputFiles({ name: 'IMG_20260101_120000.jpg', mimeType: 'image/jpeg', buffer: grande });
  await g.page.getByText('Preparando la foto…').waitFor({ timeout: 4000 });
  ok(true, 'mientras se prepara la foto, avisa "Preparando la foto…"');
  ok(await g.page.getByRole('button', { name: /Sacar foto/ }).isDisabled() && await g.page.getByRole('button', { name: /Elegir de la galería/ }).isDisabled(), 'y los dos botones de la foto quedan apagados (así no se pisan dos fotos a la vez)');
  ok((await marca(g.page))?.estado === 'procesando', 'y queda anotado que se está procesando (para saber si la página se cierra justo ahí)');
  await captura(g.page, '16-formulario-preparando-foto');
  await g.page.locator('.foto-prev').waitFor();
  ok(!(await g.page.getByText('Preparando la foto…').count()) && (await marca(g.page)) === null, 'al terminar se saca el aviso y se borra la anotación');
  ok((await g.page.evaluate(() => window.__enteras)) === 0, 'el navegador NO decodificó la foto grande entera (esto es lo que evita quedarse sin memoria)');
  const prev = await esquinasDe(g.page, await g.page.locator('.foto-prev').getAttribute('src'));
  ok(prev.w === 1200 && prev.h === 1600, `la vista previa quedó derecha (vertical) y achicada: ${prev.w}x${prev.h}`);
  ok(JSON.stringify(prev.esq) === JSON.stringify(ESQUINAS_EXIF[6]), 'y con las esquinas donde corresponden: la foto se ve como la sacó el huésped');
  await g.page.getByRole('button', { name: 'Enviar formulario' }).click();
  await g.page.getByRole('heading', { name: '¡Check-in realizado!' }).waitFor({ timeout: 15000 });
  const subidas = await drive();
  ok(subidas.length === 1 && subidas[0].bytes < 900 * 1024, `la foto llegó a Drive y pesa poco (${Math.round((subidas[0]?.bytes ?? 0) / 1024)} KB, la original pesaba ${Math.round(grande.length / 1024)} KB)`);
  ok(g.errores.length === 0, 'sin errores en la consola ' + g.errores.join('|'));
  await g.ctx.close();

  // ---- 2. Se cierra la página mientras se saca la foto (le falta memoria al celular): vuelve al formulario y se le explica
  const g2 = await abrirFormulario();
  await g2.page.getByLabel('Nombre', { exact: true }).fill('Lucía');
  await g2.page.getByLabel('Apellido', { exact: true }).fill('Fernández');
  await g2.page.getByLabel(/Acepto que el hotel/).check();
  const u0 = await usos();
  await g2.page.getByRole('button', { name: /Elegir de la galería/ }).scrollIntoViewIfNeeded();
  const [selector] = await Promise.all([g2.page.waitForEvent('filechooser'), g2.page.getByRole('button', { name: /Elegir de la galería/ }).tap()]);
  ok(selector.isMultiple() === false && (await marca(g2.page))?.estado === 'eligiendo', 'al tocar "Elegir de la galería" se abre el selector de fotos y queda anotado que se está eligiendo la foto');
  // el sistema cierra la página en segundo plano y la vuelve a abrir cuando el huésped regresa de la cámara
  await g2.page.reload();
  await g2.page.getByRole('heading', { name: 'Tus datos' }).waitFor();
  await aviso(g2.page).waitFor();
  ok(true, 'al volver, el formulario sigue abierto y explica que la página se cerró mientras elegía la foto');
  ok((await g2.page.getByLabel('Nombre', { exact: true }).inputValue()) === 'Lucía' && (await g2.page.getByLabel('Apellido', { exact: true }).inputValue()) === 'Fernández' && await g2.page.getByLabel(/Acepto que el hotel/).isChecked(), 'no perdió lo que había escrito ni la casilla de aceptación');
  ok((await usos()) === u0, 'y no gastó otro uso del código (no tuvo que pedirlo de nuevo)');
  const alto = g2.page.viewportSize().height;
  const aLaVista = async () => { const c = await g2.page.locator('#campo-foto').boundingBox(); return !!c && c.y >= 0 && c.y + c.height <= alto + 1; };
  const llego = await hasta(aLaVista, 4000, 100); // la pantalla se desliza suave hasta la foto
  const caja = await g2.page.locator('#campo-foto').boundingBox();
  ok(llego, `la pantalla se desliza sola hasta la foto (no hay que buscarla): el área de la foto queda a la vista (${Math.round(caja?.y ?? -1)} a ${Math.round((caja?.y ?? 0) + (caja?.height ?? 0))} px de ${alto})`);
  ok(/sacale la foto al documento con la cámara del celular, afuera de esta página, y elegila de la galería/.test(await aviso(g2.page).innerText()) && /También podés enviar el formulario sin foto/.test(await aviso(g2.page).innerText()), 'el aviso dice qué hacer si vuelve a pasar (sacarla afuera y elegirla de la galería) y que puede enviar sin foto');
  await sinDesborde(g2.page, 'formulario con el aviso de página cerrada');
  await captura(g2.page, '17-formulario-pagina-cerrada');
  // vuelve a elegir la foto y todo sigue normal
  await g2.page.locator('input[type=file]').nth(1).setInputFiles({ name: 'dni.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(await jpegBase64(g2.page), 'base64') });
  await g2.page.locator('.foto-prev').waitFor();
  ok(!(await aviso(g2.page).count()), 'al elegir la foto de nuevo, el aviso desaparece');
  await g2.page.reload();
  await g2.page.getByRole('heading', { name: 'Tus datos' }).waitFor();
  await espera(300);
  ok(!(await aviso(g2.page).count()), 'y si recarga después de que la foto se eligió bien, no vuelve a aparecer');
  ok(g2.errores.length === 0, 'sin errores en la consola ' + g2.errores.join('|'));
  await g2.ctx.close();

  // ---- 3. Cuándo NO hay que avisar
  const g3 = await abrirFormulario();
  await g3.page.getByLabel('Nombre', { exact: true }).fill('Beto');
  // 3a. Eligió "Elegir de la galería" pero canceló: la página sigue viva, así que tocar la pantalla borra la anotación y recargar no avisa nada
  const [selector2] = await Promise.all([g3.page.waitForEvent('filechooser'), g3.page.getByRole('button', { name: /Elegir de la galería/ }).tap()]);
  ok((await marca(g3.page))?.estado === 'eligiendo', 'al tocar "Elegir de la galería" también queda anotado');
  await espera(1300);
  await g3.page.getByRole('heading', { name: 'Tus datos' }).tap();
  ok((await marca(g3.page)) === null, 'si canceló y la página sigue viva, tocar la pantalla borra la anotación');
  await g3.page.reload();
  await g3.page.getByRole('heading', { name: 'Tus datos' }).waitFor();
  await espera(300);
  ok(!(await aviso(g3.page).count()) && (await g3.page.getByLabel('Nombre', { exact: true }).inputValue()) === 'Beto', 'recargar después de cancelar no muestra el aviso (y conserva lo escrito)');
  // 3b. Se cerró mientras se preparaba la foto: avisa
  await g3.page.evaluate((k) => sessionStorage.setItem(k, JSON.stringify({ estado: 'procesando', en: Date.now() })), MARCA);
  await g3.page.reload();
  await aviso(g3.page).waitFor();
  ok((await marca(g3.page)) === null, 'se cerró mientras se preparaba la foto: avisa, y la anotación se borra para que no avise dos veces');
  // 3c. Una anotación vieja (más de 30 minutos) ya no sirve
  await g3.page.evaluate((k) => sessionStorage.setItem(k, JSON.stringify({ estado: 'procesando', en: Date.now() - 31 * 60 * 1000 })), MARCA);
  await g3.page.reload();
  await g3.page.getByRole('heading', { name: 'Tus datos' }).waitFor();
  await espera(300);
  ok(!(await aviso(g3.page).count()), 'una anotación de hace más de 30 minutos no genera el aviso');
  // 3d. La sesión venció mientras tanto: vuelve a pedir el código, sin aviso de foto (ni cuando entre con un código nuevo)
  await g3.page.evaluate((k) => sessionStorage.setItem(k, JSON.stringify({ estado: 'eligiendo', en: Date.now() })), MARCA);
  await back.sql(`update private.checkin_sesiones set vence = now() - interval '1 minute'`);
  await g3.page.reload();
  await g3.page.getByLabel(/Código de 6 números/).waitFor();
  ok(!(await aviso(g3.page).count()), 'con la sesión vencida vuelve a pedir el código, sin hablar de la foto');
  await ingresarCodigo(g3.page, cod);
  await g3.page.getByRole('heading', { name: 'Tus datos' }).waitFor();
  await espera(300);
  ok(!(await aviso(g3.page).count()), 'y con el código nuevo el formulario abre limpio, sin el aviso');
  ok(g3.errores.length === 0, 'sin errores en la consola ' + g3.errores.join('|'));
  await g3.ctx.close();
  await rec.ctx.close();
  ok((await sql1('select count(*)::int as n from private.checkins')).n === 1, 'ninguna de estas pruebas dejó huéspedes de más ni borró nada');
});

await seccion('15. Cámara dentro de la página: se saca la foto sin abrir la aplicación de cámara del celular', async () => {
  await reiniciar();
  await configurar({ activo: true, codigo_seg: 300, usos_max: 20, foto_url: `${back.url}/apps-script/exec` });
  await back.sql(`update private.checkin_config set hash_recepcion = extensions.crypt($1, extensions.gen_salt('bf')) where id = 1`, [CLAVE_RECEPCION]);
  const rec = await contexto();
  await recepcionLogin(rec.page);
  const cod = await codigoDeRecepcion(rec.page);
  const drive = async () => (await fetch(`${back.url}/__test/drive`).then((x) => x.json())).filter((a) => a.mime === 'image/jpeg');

  // Un huésped con el formulario abierto. `modo` dice cómo responde el navegador a la cámara:
  //   real (la cámara simulada) · permiso (el huésped no dio permiso) · sin-api (el navegador no tiene cámara web) · colgada (no responde)
  // Además se anotan los flujos de cámara que se abren, para comprobar que se cierran (que la cámara se apague).
  const abrir = async (modo = 'real') => {
    const g = await contexto({ hasTouch: true, isMobile: true });
    await g.page.addInitScript((m) => {
      window.__flujos = [];
      if (m === 'sin-api') { Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true }); return; }
      const md = navigator.mediaDevices;
      const real = md.getUserMedia.bind(md);
      md.getUserMedia = (c) => {
        if (m === 'permiso') return Promise.reject(Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }));
        if (m === 'colgada') return new Promise(() => {});
        return real(c).then((s) => { window.__flujos.push(s); return s; });
      };
    }, modo);
    await g.page.goto(BASE + '#/registro');
    await ingresarCodigo(g.page, cod);
    await g.page.getByRole('heading', { name: 'Tus datos' }).waitFor();
    await completarFormulario(g.page);
    await g.page.getByLabel(/Acepto que el hotel/).check();
    await g.page.getByRole('button', { name: /Sacar foto/ }).scrollIntoViewIfNeeded();
    return g;
  };
  const sacarFoto = (g) => g.page.getByRole('button', { name: /Sacar foto/ });
  const camaraDe = (g) => g.page.getByRole('dialog', { name: /Cámara/ });
  const flujosAbiertos = (g) => g.page.evaluate(() => window.__flujos.filter((f) => f.getTracks().some((t) => t.readyState === 'live')).length);

  // ---- 1. Se saca la foto con la cámara de la página
  const g = await abrir();
  await sacarFoto(g).tap();
  const cam = camaraDe(g);
  await cam.waitFor();
  ok(true, 'al tocar "Sacar foto" se abre la cámara DENTRO de la página (no la aplicación de cámara del celular)');
  await cam.locator('.camara-disparo:not([disabled])').waitFor();
  const v = await cam.locator('video').evaluate((el) => ({ w: el.videoWidth, h: el.videoHeight, andando: !el.paused && !el.ended }));
  ok(v.w === 1280 && v.h === 720 && v.andando, `se ve la imagen de la cámara andando (${v.w}x${v.h})`);
  ok(await g.page.evaluate(() => document.body.style.overflow === 'hidden') && await g.page.evaluate(() => document.querySelector('.camara')?.contains(document.activeElement)), 'el fondo no se desplaza y el foco queda adentro de la cámara');
  ok((await marca(g.page))?.estado === 'eligiendo', 'queda anotado que se está sacando la foto (por si el sistema cierra la página)');
  ok(!(await cam.getByRole('button', { name: /luz/i }).count()), 'sin linterna en este dispositivo, no se ofrece el botón de luz');
  await espera(1300);
  await cam.locator('video').tap();
  ok((await marca(g.page))?.estado === 'eligiendo', 'tocar la pantalla de la cámara (para enfocar, por ejemplo) no borra la anotación: la cámara sigue abierta');
  await sinDesborde(g.page, 'cámara dentro de la página');
  await captura(g.page, '18-camara-en-la-pagina');
  await cam.locator('.camara-disparo').tap();
  await cam.waitFor({ state: 'hidden' });
  await g.page.locator('.foto-prev').waitFor();
  ok(await flujosAbiertos(g) === 0, 'al sacar la foto la cámara se apaga');
  const prev = await esquinasDe(g.page, await g.page.locator('.foto-prev').getAttribute('src'));
  ok(prev.w === 1280 && prev.h === 720 && JSON.stringify(prev.esq) === JSON.stringify(ESQUINAS_EXIF[1]), `la foto sale derecha y sin espejo, con las esquinas en su lugar (${prev.w}x${prev.h})`);
  ok((await marca(g.page)) === null, 'y se borra la anotación');
  await captura(g.page, '19-camara-foto-sacada');
  await g.page.getByRole('button', { name: 'Enviar formulario' }).click();
  await g.page.getByRole('heading', { name: '¡Check-in realizado!' }).waitFor({ timeout: 15000 });
  const subidas = await drive();
  ok(subidas.length === 1 && subidas[0].bytes < 900 * 1024, `la foto llegó a Drive (${Math.round((subidas[0]?.bytes ?? 0) / 1024)} KB)`);
  ok(g.errores.length === 0, 'sin errores en la consola ' + g.errores.join('|'));
  await g.ctx.close();

  // ---- 2. Cancelar (con el botón o con Esc) no deja nada
  const g2 = await abrir();
  await sacarFoto(g2).tap();
  await camaraDe(g2).locator('.camara-disparo:not([disabled])').waitFor();
  await camaraDe(g2).getByRole('button', { name: 'Cancelar' }).tap();
  await camaraDe(g2).waitFor({ state: 'hidden' });
  ok(!(await g2.page.locator('.foto-prev').count()) && await flujosAbiertos(g2) === 0 && (await marca(g2.page)) === null, 'cancelar cierra la cámara, la apaga, no deja foto y borra la anotación');
  await hasta(() => g2.page.evaluate(() => document.activeElement?.textContent?.includes('Sacar foto')), 3000);
  ok(await g2.page.evaluate(() => document.activeElement?.textContent?.includes('Sacar foto')), 'y el foco vuelve al botón "Sacar foto"');
  await sacarFoto(g2).tap();
  await camaraDe(g2).locator('.camara-disparo:not([disabled])').waitFor();
  await g2.page.keyboard.press('Escape');
  await camaraDe(g2).waitFor({ state: 'hidden' });
  ok(await flujosAbiertos(g2) === 0, 'con Esc también se cierra y se apaga');

  // ---- 3. Si la página se cierra mientras la cámara está abierta (la cerró el sistema), al volver se explica
  await sacarFoto(g2).tap();
  await camaraDe(g2).locator('.camara-disparo:not([disabled])').waitFor();
  await g2.page.reload();
  await g2.page.getByRole('heading', { name: 'Tus datos' }).waitFor();
  await aviso(g2.page).waitFor();
  ok(true, 'si la página se cierra con la cámara abierta, al volver el formulario sigue y explica qué pasó');
  ok(g2.errores.length === 0, 'sin errores en la consola ' + g2.errores.join('|'));
  await g2.ctx.close();

  // ---- 4. Sin permiso: se explica y se ofrece la cámara del celular; después no se insiste
  const g3 = await abrir('permiso');
  await sacarFoto(g3).tap();
  await camaraDe(g3).getByRole('alert').waitFor();
  ok(/No tenemos permiso para usar la cámara/.test(await camaraDe(g3).getByRole('alert').innerText()) && await camaraDe(g3).locator('.camara-disparo').isDisabled(), 'sin permiso para la cámara: lo explica y el botón de sacar queda apagado');
  await captura(g3.page, '20-camara-sin-permiso');
  const [selector] = await Promise.all([g3.page.waitForEvent('filechooser'), camaraDe(g3).getByRole('button', { name: 'Usar la cámara del celular' }).tap()]);
  ok(selector && !(await camaraDe(g3).count()), '"Usar la cámara del celular" cierra esa cámara y abre la del celular (fuera de la página)');
  const [selector2] = await Promise.all([g3.page.waitForEvent('filechooser'), sacarFoto(g3).tap()]);
  ok(selector2 && !(await camaraDe(g3).count()), 'y la próxima vez que toca "Sacar foto" va directo a la cámara del celular (no se insiste con la que falló)');
  await g3.ctx.close();

  // ---- 5. Un navegador sin cámara web va directo a la cámara del celular
  const g4 = await abrir('sin-api');
  const [selector3] = await Promise.all([g4.page.waitForEvent('filechooser'), sacarFoto(g4).tap()]);
  ok(selector3 && !(await camaraDe(g4).count()), 'si el navegador no tiene cámara web, "Sacar foto" abre directo la cámara del celular');
  await g4.ctx.close();

  // ---- 6. Una cámara que no responde no deja al huésped esperando para siempre
  const g5 = await abrir('colgada');
  await g5.page.clock.install(); // reloj simulado: así no hace falta esperar de verdad los 25 segundos
  await sacarFoto(g5).tap();
  await camaraDe(g5).getByText(/Abriendo la cámara/).waitFor();
  ok(true, 'mientras abre dice "Abriendo la cámara…" y avisa del permiso');
  await g5.page.clock.fastForward(20000);
  ok(!(await camaraDe(g5).getByRole('alert').count()), 'a los 20 segundos todavía espera (el huésped puede estar leyendo el pedido de permiso del navegador)');
  await g5.page.clock.fastForward(6000);
  await camaraDe(g5).getByRole('alert').waitFor();
  ok(/La cámara no responde/.test(await camaraDe(g5).getByRole('alert').innerText()) && await camaraDe(g5).getByRole('button', { name: 'Usar la cámara del celular' }).isVisible(), 'si en 25 segundos no hay respuesta, avisa y ofrece la cámara del celular');
  await g5.ctx.close();

  ok((await sql1('select count(*)::int as n from private.checkins')).n === 1, 'ninguna de estas pruebas dejó huéspedes de más ni borró nada');
  await rec.ctx.close();
});

await navegador.close();
web.close();
await back.cerrar();
fs.rmSync(carpeta, { recursive: true, force: true });
console.log(`\n${pasos} comprobaciones, ${fallas} falla(s)`);
process.exit(fallas ? 1 : 0);
