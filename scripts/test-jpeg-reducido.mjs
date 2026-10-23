// La foto del huésped se achica en el celular sin reconstruirla entera (src/checkin/jpegReducido.js y comprimir.js).
//   node scripts/test-jpeg-reducido.mjs     (requiere Playwright y un Chromium, como el punta a punta)
//
// Por qué: una foto de cámara reconstruida entera ocupa 4 bytes por píxel (12 MP ~50 MB, 50 MP ~200 MB, 108 MP ~430 MB) y en un celular
// con poca memoria el sistema cierra la página ("memoria insuficiente"): el huésped vuelve a empezar. El decodificador liviano
// reconstruye cada bloque de 8x8 ya achicado y usa la memoria de la imagen chica, sin importar los megapíxeles.
//
// 1. Contra Chrome: la foto achicada se parece a la que achica el navegador (distintas escalas, formatos de color, marcadores de reinicio,
//    gris, tamaños que no son múltiplos de 8, orientación EXIF).
// 2. Nunca devuelve algo roto: con lo que no entiende (progresivo, CMYK, PNG, archivos cortados o rotos) devuelve null y se usa el camino normal.
// 3. La función completa en el navegador: fotos grandes sin decodificarlas enteras, orientación, PNG y JPEG chicos, errores y topes.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { decodificarReducido, infoJpeg, kParaAchicar } from '../src/checkin/jpegReducido.js';
import { ESQUINAS_EXIF, conOrientacion, esquinasDe, jpegGrande } from './fotos-ayuda.mjs';

const require = createRequire(import.meta.url);
const raiz = fileURLToPath(new URL('..', import.meta.url));
function cargarPlaywright() {
  for (const ruta of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(ruta); } catch { /* prueba la siguiente */ }
  }
  throw new Error('No encuentro Playwright. Instalalo con: npm i -D playwright');
}
const { chromium } = cargarPlaywright();

let fallas = 0;
let total = 0;
const ok = (c, m) => { total += 1; console.log(`${c ? 'OK    ' : 'FALLA '}${m}`); if (!c) fallas += 1; };

const FIX = path.join(raiz, 'scripts/fixtures/jpeg');
const leer = (n) => new Uint8Array(fs.readFileSync(path.join(FIX, `${n}.jpg`)));

// ---- servidor chico: sirve los módulos de la app para probarlos dentro del navegador
const servidor = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/m/')) {
    const f = path.join(raiz, 'src/checkin', path.basename(url.pathname));
    if (fs.existsSync(f)) { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(fs.readFileSync(f)); }
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  return res.end('<!doctype html><meta charset=utf-8><title>prueba</title>');
});
await new Promise((r) => servidor.listen(0, r));
const base = `http://localhost:${servidor.address().port}`;
const navegador = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await navegador.newPage();
page.setDefaultTimeout(60000);
await page.goto(`${base}/`);

// ---- ayudas
const b64 = (b) => Buffer.from(b).toString('base64');
// Chrome achica la foto entera (aplicando su orientación EXIF) con la escala exacta k/8: es la referencia.
async function referencia(bytes, escala, w, h) {
  const r = await page.evaluate(async ({ datos, escala, w, h }) => {
    const bin = Uint8Array.from(atob(datos), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bin], { type: 'image/jpeg' }));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(bmp, 0, 0, bmp.width * escala, bmp.height * escala);
    const d = x.getImageData(0, 0, w, h).data;
    let s = ''; for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode.apply(null, d.subarray(i, i + 0x8000));
    return btoa(s);
  }, { datos: b64(bytes), escala, w, h });
  return Buffer.from(r, 'base64');
}
// Posición visible de un píxel (x, y) de una foto de w x h guardada con la orientación EXIF `o` (1 a 8).
function visible(o, w, h, x, y) {
  switch (o) {
    case 2: return [w - 1 - x, y];
    case 3: return [w - 1 - x, h - 1 - y];
    case 4: return [x, h - 1 - y];
    case 5: return [y, x];
    case 6: return [h - 1 - y, x];
    case 7: return [h - 1 - y, w - 1 - x];
    case 8: return [y, w - 1 - x];
    default: return [x, y];
  }
}
function orientar(rgba, w, h, o) {
  if (o === 1) return { rgba, w, h };
  const W = o >= 5 ? h : w;
  const H = o >= 5 ? w : h;
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const [X, Y] = visible(o, w, h, x, y);
      const a = (y * w + x) * 4;
      const d = (Y * W + X) * 4;
      out[d] = rgba[a]; out[d + 1] = rgba[a + 1]; out[d + 2] = rgba[a + 2]; out[d + 3] = 255;
    }
  }
  return { rgba: out, w: W, h: H };
}
function comparar(a, b, w, cw, ch) {
  let suma = 0; let mse = 0; let n = 0;
  for (let y = 0; y < ch; y += 1) {
    for (let x = 0; x < cw; x += 1) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c += 1) { const d = Math.abs(a[i + c] - b[i + c]); suma += d; mse += d * d; n += 1; }
    }
  }
  return { mae: suma / n, psnr: mse ? 10 * Math.log10((255 * 255) / (mse / n)) : 99 };
}
// Le agrega a un JPEG `bytes` de datos ocultos antes de la foto (varios segmentos APP15 de 65000 bytes): hay celulares que guardan ahí,
// por ejemplo, el mapa de profundidad del modo retrato, y las medidas de la foto quedan lejos del principio del archivo.
function conRelleno(jpeg, bytes) {
  const partes = [jpeg.subarray(0, 2)];
  for (let resto = bytes; resto > 0; resto -= 65000) {
    const largo = Math.min(65000, resto);
    partes.push(Buffer.from([0xff, 0xef, (largo + 2) >> 8, (largo + 2) & 255]), Buffer.alloc(largo, 0x5a));
  }
  partes.push(jpeg.subarray(2));
  return Buffer.concat(partes);
}
// Cambia las medidas que dice tener un JPEG (para probar cabeceras que mienten).
function conMedidas(jpeg, ancho, alto) {
  const b = Buffer.from(jpeg);
  for (let i = 2; i + 9 < b.length; i += 1) {
    if (b[i] === 0xff && (b[i + 1] === 0xc0 || b[i + 1] === 0xc1)) { b.writeUInt16BE(alto, i + 5); b.writeUInt16BE(ancho, i + 7); return b; }
  }
  return b;
}

// ================================================================== 1. Contra Chrome
console.log('\n== 1. La foto achicada se parece a la que achica Chrome (400x300, escalas 8/8, 4/8, 2/8 y 1/8)');
const variantes = ['420', '422', '444', 'gris', 'optimizado', 'reinicio-bloques-420', 'reinicio-filas-444', 'impar-401x299-422-reinicio', 'orientacion-6'];
for (const nombre of variantes) {
  const bytes = leer(nombre);
  const info = infoJpeg(bytes);
  const resumen = [];
  let bien = !!info;
  // la foto girada tiene 300 de alto: a 1/8 son 37,5 filas y, al girarla, el medio bloque del borde cambia de lado; las otras escalas caen justas
  const escalas = nombre === 'orientacion-6' ? [8, 4, 2] : [8, 4, 2, 1];
  for (const k of escalas) {
    const r = await decodificarReducido(bytes, { k });
    if (!r) { bien = false; resumen.push(`k=${k} null`); continue; }
    const o = orientar(r.rgba, r.ancho, r.alto, r.orientacion);
    const ref = await referencia(bytes, k / 8, o.w, o.h);
    const girado = r.orientacion >= 5;
    const cw = Math.max(1, Math.floor(((girado ? info.alto : info.ancho) * k) / 8));
    const ch = Math.max(1, Math.floor(((girado ? info.ancho : info.alto) * k) / 8));
    const m = comparar(o.rgba, ref, o.w, cw, ch);
    const medidas = r.ancho === Math.ceil((info.ancho * k) / 8) && r.alto === Math.ceil((info.alto * k) / 8);
    const dentro = medidas && (k === 8 ? m.mae <= 2.5 && m.psnr >= 33 : m.mae <= 6 && m.psnr >= 24);
    if (!dentro) bien = false;
    resumen.push(`${k}/8: ${m.mae.toFixed(1)}`);
  }
  ok(bien, `${nombre}: ${info?.ancho}x${info?.alto}, error medio contra Chrome (de 0 a 255) → ${resumen.join(' · ')}`);
}
{
  const bytes = leer('orientacion-6');
  ok(infoJpeg(bytes).orientacion === 6 && infoJpeg(leer('420')).orientacion === 1, 'lee la orientación EXIF de la foto (6 = celular acostado) y vale 1 si no tiene');
}

// ================================================================== 2. Lo que no entiende y los archivos rotos
console.log('\n== 2. Con lo que no entiende o está roto devuelve null (y se usa el camino normal del navegador)');
ok(infoJpeg(leer('progresivo')).sof === 0xc2 && await decodificarReducido(leer('progresivo'), { k: 4 }) === null, 'un JPEG progresivo no lo toma');
ok(await decodificarReducido(leer('cmyk'), { k: 4 }) === null, 'ni uno CMYK');
ok(await decodificarReducido(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13]), { k: 4 }) === null && infoJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47])) === null, 'ni un PNG');
ok(await decodificarReducido(new Uint8Array(0)) === null && await decodificarReducido(new Uint8Array([0xff, 0xd8])) === null && await decodificarReducido(new Uint8Array(500).map((_, i) => (i * 37) & 255)) === null, 'ni un archivo vacío, uno que solo empieza o basura');
{
  const bytes = leer('422');
  const cortado = bytes.subarray(0, Math.floor(bytes.length * 0.6));
  ok(await decodificarReducido(cortado, { k: 4 }) === null, 'un JPEG cortado a la mitad no devuelve una imagen a medias');
  const roto = Uint8Array.from(bytes);
  for (let i = 3000; i < 9000; i += 7) roto[i] ^= 0x5a;
  const t0 = Date.now();
  let r;
  let exploto = false;
  try { r = await decodificarReducido(roto, { k: 4 }); } catch { exploto = true; }
  ok(!exploto && (r === null || (r.ancho === 200 && r.alto === 150)) && Date.now() - t0 < 3000, 'uno con datos dañados nunca tira error ni se cuelga (devuelve null o una imagen del tamaño que corresponde)');
  const miente = conMedidas(leer('420'), 65000, 65000);
  const t1 = Date.now();
  ok(await decodificarReducido(miente) === null && Date.now() - t1 < 500, 'una cabecera que dice ser de 65000x65000 se descarta enseguida (sin reservar memoria)');
}
ok(kParaAchicar({ sof: 0xc0, precision: 8, componentes: 3, ancho: 4000, alto: 3000 }) === 4
  && kParaAchicar({ sof: 0xc0, precision: 8, componentes: 3, ancho: 3200, alto: 2400 }) === 4
  && kParaAchicar({ sof: 0xc0, precision: 8, componentes: 3, ancho: 12000, alto: 9000 }) === 2
  && kParaAchicar({ sof: 0xc0, precision: 8, componentes: 3, ancho: 30000, alto: 500 }) === 1
  && kParaAchicar({ sof: 0xc0, precision: 8, componentes: 3, ancho: 3199, alto: 2400 }) === 0
  && kParaAchicar({ sof: 0xc0, precision: 8, componentes: 3, ancho: 1000, alto: 800 }) === 0
  && kParaAchicar({ sof: 0xc2, precision: 8, componentes: 3, ancho: 4000, alto: 3000 }) === 0
  && kParaAchicar({ sof: 0xc0, precision: 12, componentes: 3, ancho: 4000, alto: 3000 }) === 0
  && kParaAchicar({ sof: 0xc0, precision: 8, componentes: 4, ancho: 4000, alto: 3000 }) === 0,
'solo toma las fotos grandes (3200 px o más de lado) de 8 bits, secuenciales y de 1 o 3 componentes: las demás las resuelve el navegador');

// ================================================================== 3. La función completa, dentro del navegador
console.log('\n== 3. comprimirImagen en el navegador');
await page.evaluate(() => {
  window.__cib = 0; // cuántas veces se le pidió al navegador que decodifique una foto entera
  const orig = window.createImageBitmap.bind(window);
  window.createImageBitmap = (...a) => { window.__cib += 1; return orig(...a); };
});
// PNG de puro ruido (siempre el mismo): a 1600x1200 pesa más de 1 MB como JPEG de calidad .78, así que obliga a bajar de nivel.
const pngRuidoso = (w, h) => page.evaluate(async ({ w, h }) => {
  let a = 12345;
  const azar = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  const d = x.createImageData(w, h);
  for (let i = 0; i < d.data.length; i += 4) { d.data[i] = azar() * 256; d.data[i + 1] = azar() * 256; d.data[i + 2] = azar() * 256; d.data[i + 3] = 255; }
  x.putImageData(d, 0, 0);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const bin = new Uint8Array(await blob.arrayBuffer());
  let t = ''; for (let i = 0; i < bin.length; i += 0x8000) t += String.fromCharCode.apply(null, bin.subarray(i, i + 0x8000));
  c.width = 0; c.height = 0;
  return btoa(t);
}, { w, h });
// Corre comprimirImagen con esos bytes y devuelve medidas, color de cada esquina, peso y cuántas veces se usó el decodificador del navegador.
const correr = async (bytes, tipo = 'image/jpeg') => {
  const r = await page.evaluate(async ({ datos, tipo }) => {
    const { comprimirImagen } = await import('/m/comprimir.js');
    window.__cib = 0;
    const bin = Uint8Array.from(atob(datos), (c) => c.charCodeAt(0));
    const t0 = performance.now();
    try {
      const r = await comprimirImagen(new File([bin], 'foto', { type: tipo }));
      return { ok: true, ms: Math.round(performance.now() - t0), bytes: r.bytes, vista: r.vista, cib: window.__cib };
    } catch (e) {
      return { ok: false, codigo: e.codigo ?? String(e.message), ms: Math.round(performance.now() - t0), cib: window.__cib };
    }
  }, { datos: b64(bytes), tipo });
  if (r.ok) Object.assign(r, await esquinasDe(page, r.vista));
  return r;
};
const esquinas = (r) => r.esq;

const grande = await jpegGrande(page, 4000, 3000); // 12 MP
let r = await correr(grande);
ok(r.ok && r.w === 1600 && r.h === 1200 && r.bytes <= 900 * 1024, `una foto de 12 MP sale de ${r.w}x${r.h} y ${Math.round(r.bytes / 1024)} KB`);
ok(r.cib === 0, 'y el navegador NO la decodificó entera (se achicó mientras se decodificaba: ahí está el ahorro de memoria)');
ok(JSON.stringify(esquinas(r)) === JSON.stringify(ESQUINAS_EXIF[1]), `sin orientación, las esquinas quedan donde estaban: ${JSON.stringify(esquinas(r))}`);
{
  const mal = [];
  for (const o of [2, 3, 4, 5, 6, 7, 8]) {
    const rr = await correr(conOrientacion(grande, o));
    const girado = o >= 5;
    const medidasOk = girado ? rr.w === 1200 && rr.h === 1600 : rr.w === 1600 && rr.h === 1200;
    if (!rr.ok || !medidasOk || JSON.stringify(esquinas(rr)) !== JSON.stringify(ESQUINAS_EXIF[o]) || rr.cib !== 0) mal.push(`${o}: ${rr.w}x${rr.h} ${JSON.stringify(esquinas(rr))}`);
  }
  ok(mal.length === 0, 'la foto se endereza según la orientación EXIF del celular (las 7 orientaciones, con el celular de costado o dado vuelta)' + (mal.length ? ' · ' + mal.join(' | ') : ''));
}
{
  // medidas que no son múltiplos de 8 (el último bloque de la foto viene a medias) y girada: sigue derecha y con las esquinas en su lugar
  const rara = await jpegGrande(page, 4003, 3001);
  const a = await correr(conOrientacion(rara, 6));
  ok(a.ok && a.cib === 0 && a.h === 1600 && Math.abs(a.w - 1199) <= 1 && JSON.stringify(esquinas(a)) === JSON.stringify(ESQUINAS_EXIF[6]), `una de 4003x3001 con la orientación 6 (medidas raras): ${a.w}x${a.h} ${JSON.stringify(esquinas(a))}`);
}
{
  // con muchos datos ocultos antes de la foto las medidas quedan lejos del principio: hasta 4 MB se sigue achicando sin abrirla entera
  const a = await correr(conRelleno(grande, 1024 * 1024));
  ok(a.ok && a.cib === 0 && a.w === 1600 && a.h === 1200 && JSON.stringify(esquinas(a)) === JSON.stringify(ESQUINAS_EXIF[1]), `con 1 MB de datos ocultos antes de la foto también se achica sin abrirla entera: ${a.w}x${a.h}`);
  const b = await correr(conRelleno(grande, 6 * 1024 * 1024));
  ok(b.ok && b.cib >= 1 && b.w === 1600 && b.h === 1200, `con 6 MB de datos ocultos (más de lo que se mira) la abre el navegador como siempre, y sale igual: ${b.w}x${b.h}`);
}
{
  const t = await correr(await jpegGrande(page, 3300, 2200));
  ok(t.ok && t.cib === 0 && t.w === 1600 && t.h === 1067, `también una de 3300x2200 (el límite chico de lo que toma el decodificador liviano): ${t.w}x${t.h}`);
}
{
  const t = await correr(await jpegGrande(page, 9000, 3000));
  ok(t.ok && t.cib === 0 && t.w === 1600 && t.h === 533, `y una panorámica de 9000x3000: ${t.w}x${t.h}`);
}
{
  const t = await correr(Buffer.from(await pngRuidoso(1600, 1200), 'base64'), 'image/png');
  ok(t.ok && t.bytes <= 900 * 1024 && t.w < 1600, `una imagen de puro ruido (no se puede comprimir) igual entra en el tope de peso: baja de a poco el tamaño y la calidad (${t.w}x${t.h}, ${Math.round(t.bytes / 1024)} KB)`);
}
{
  const chico = await jpegGrande(page, 900, 600);
  const t = await correr(chico);
  ok(t.ok && t.cib >= 1 && t.w === 900 && t.h === 600, 'una foto chica (900x600) no hace falta achicarla con el decodificador liviano: la resuelve el navegador y no se agranda');
  const t2 = await correr(leer('progresivo'));
  ok(t2.ok && t2.cib >= 1 && t2.w === 400, 'un JPEG progresivo se resuelve con el navegador (camino de respaldo)');
  const png = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 2400; c.height = 1800; const x = c.getContext('2d');
    x.fillStyle = '#4a7'; x.fillRect(0, 0, 2400, 1800); x.fillStyle = '#fff'; x.font = '200px sans-serif'; x.fillText('PNG', 800, 900);
    const b = await new Promise((r) => c.toBlob(r, 'image/png')); const bin = new Uint8Array(await b.arrayBuffer());
    let t = ''; for (let i = 0; i < bin.length; i += 0x8000) t += String.fromCharCode.apply(null, bin.subarray(i, i + 0x8000)); return btoa(t);
  });
  const t3 = await correr(Buffer.from(png, 'base64'), 'image/png');
  ok(t3.ok && t3.cib >= 1 && t3.w === 1600 && t3.h === 1200, 'una captura de pantalla en PNG también se achica (1600x1200)');
}
{
  const e1 = await correr(Buffer.from('esto no es una foto'), 'image/jpeg');
  const e2 = await correr(Buffer.from('hola'), 'text/plain');
  ok(!e1.ok && e1.codigo === 'imagen' && !e2.ok && e2.codigo === 'tipo', 'un archivo que no es una foto da error claro ("imagen"), y uno que no es imagen, "tipo"');
  const cortada = await correr(grande.subarray(0, Math.floor(grande.length * 0.5)));
  ok(cortada.ms < 8000 && (cortada.ok || cortada.codigo === 'imagen'), `una foto grande cortada a la mitad no cuelga ni rompe la pantalla: se resuelve con el navegador o da el error claro (${cortada.ok ? `${cortada.w}x${cortada.h}` : cortada.codigo}, ${cortada.ms} ms)`);
  const t0 = Date.now();
  const mentira = await correr(conMedidas(leer('420'), 60000, 60000));
  ok(!mentira.ok && mentira.codigo === 'pesada' && Date.now() - t0 < 2000 && mentira.cib === 0, 'una cabecera que dice ser de 60000x60000 se rechaza como "pesada" sin intentar abrirla');
}

console.log(`\n${total} comprobaciones, ${fallas} falla(s)`);
await navegador.close();
servidor.close();
process.exit(fallas ? 1 : 0);
