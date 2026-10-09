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
const navegador = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });

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
  const esperadas = ['admin_checkin_auditoria', 'admin_checkin_clave_recepcion', 'admin_checkin_config', 'admin_checkin_config_guardar', 'admin_huesped_editar', 'admin_huespedes', 'cambiar_clave', 'checkin_canjear', 'checkin_enviar', 'checkin_estado', 'checkin_foto_registrar', 'checkin_sesion', 'guardar_contenido', 'recepcion_codigo_nuevo', 'recepcion_editar', 'recepcion_entrar', 'recepcion_estado', 'verificar_clave'];
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

await navegador.close();
web.close();
await back.cerrar();
fs.rmSync(carpeta, { recursive: true, force: true });
console.log(`\n${pasos} comprobaciones, ${fallas} falla(s)`);
process.exit(fallas ? 1 : 0);
