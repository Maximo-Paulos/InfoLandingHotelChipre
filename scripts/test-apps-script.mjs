// Prueba el script de Google (apps-script/Codigo.gs) con un Drive y una base simulados.
// Uso: node scripts/test-apps-script.mjs
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';

let fallas = 0;
const ok = (c, m) => { console.log((c ? 'OK    ' : 'FALLA ') + m); if (!c) fallas += 1; };

const SECRETO = 'secreto-de-prueba-0123456789';
const fuente = fs.readFileSync(new URL('../apps-script/Codigo.gs', import.meta.url), 'utf8')
  .replace('%%SUPABASE_URL%%', 'https://ejemplo.supabase.co').replace('%%SUPABASE_KEY%%', 'sb_publishable_prueba')
  .replace('%%SECRETO%%', SECRETO).replace('%%CARPETA_ID%%', 'CARPETA1234567890').replace('%%ZONA%%', 'America/Argentina/Buenos_Aires');

function entorno({ respuestaBase = { codigo: 200, cuerpo: { ok: true } } } = {}) {
  const archivos = [];
  const cache = new Map();
  const llamadas = [];
  const firmados = (b) => Array.from(b).map((x) => (x > 127 ? x - 256 : x));
  const carpeta = {
    getName: () => 'Check-in documentos',
    getFilesByName: (n) => { const r = archivos.filter((a) => a.nombre === n); let i = 0; return { hasNext: () => i < r.length, next: () => r[i++] }; },
    createFile: (a, contenido) => {
      const f = typeof a === 'string' ? { nombre: a, texto: contenido } : { nombre: a.name, bytes: a.bytes, mime: a.mime };
      f.getId = () => `ID${String(archivos.length).padStart(12, 'X')}`;
      f.setContent = (t) => { f.texto = t; };
      archivos.push(f);
      return f;
    }
  };
  const ctx = {
    Utilities: {
      computeHmacSha256Signature: (m, k) => firmados(crypto.createHmac('sha256', k).update(m).digest()),
      base64Decode: (s) => firmados(Buffer.from(s, 'base64')),
      newBlob: (bytes, mime, name) => ({ bytes, mime, name }),
      formatDate: (d, zona, f) => {
        const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
        return f.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour).replace('mm', p.minute);
      }
    },
    CacheService: { getScriptCache: () => ({ get: (k) => cache.get(k) ?? null, put: (k, v) => cache.set(k, v) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    DriveApp: { getFolderById: (id) => { if (id !== 'CARPETA1234567890') throw new Error('carpeta'); return carpeta; } },
    UrlFetchApp: { fetch: (url, opc) => { llamadas.push({ url, opc }); return { getResponseCode: () => respuestaBase.codigo, getContentText: () => JSON.stringify(respuestaBase.cuerpo) }; } },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ s, setMimeType() { return this; } }) },
    console
  };
  vm.createContext(ctx);
  vm.runInContext(fuente, ctx);
  const post = (obj) => JSON.parse(ctx.doPost({ postData: { contents: typeof obj === 'string' ? obj : JSON.stringify(obj) } }).s);
  return { ctx, post, archivos, llamadas };
}

const ahoraSeg = () => Math.floor(Date.now() / 1000);
const permiso = (ref, vence = ahoraSeg() + 600, secreto = SECRETO) =>
  `${ref}.${vence}.${crypto.createHmac('sha256', secreto).update(`${ref}.${vence}`).digest('hex')}`;
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(400)]).toString('base64');
const REF = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

{
  const e = entorno();
  ok(JSON.parse(e.ctx.doGet().s).ok === true, 'doGet responde que el servicio está vivo');

  let r = e.post({ ticket: permiso(REF), apellido: 'Pérez García', nombre: 'Ana María', imagen: jpeg() });
  ok(r.ok === true && /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}_Perez-Garcia_Ana-Maria\.jpg$/.test(r.nombre), 'guarda la foto con fecha, hora y nombre: ' + r.nombre);
  ok(e.archivos.length === 1 && e.archivos[0].mime === 'image/jpeg', 'el archivo quedó en la carpeta como JPEG');
  const l = e.llamadas[0];
  const cuerpo = JSON.parse(l.opc.payload);
  ok(l.url === 'https://ejemplo.supabase.co/rest/v1/rpc/checkin_foto_registrar' && l.opc.headers.apikey === 'sb_publishable_prueba', 'avisa a la base en la dirección correcta');
  ok(cuerpo.p_secreto === SECRETO && cuerpo.p_ref === REF && cuerpo.p_nombre === r.nombre && /^ID/.test(cuerpo.p_foto_id), 'le manda a la base el id, el nombre y la clave compartida');

  r = e.post({ ticket: permiso(REF), apellido: 'Pérez García', nombre: 'Ana María', imagen: jpeg() });
  ok(r.ok === true && /_2\.jpg$/.test(r.nombre), 'mismo nombre en el mismo minuto: agrega _2 y no pisa nada');
  r = e.post({ ticket: permiso(REF), apellido: 'Ñandú', nombre: 'José', imagen: jpeg() });
  ok(r.ok === true && /_Nandu_Jose\.jpg$/.test(r.nombre), 'saca tildes y eñes del nombre del archivo');
  r = e.post({ ticket: permiso(REF), apellido: 'X', nombre: 'Y', imagen: jpeg() });
  ok(r.ok === false && r.error === 'limite', 'a la cuarta foto del mismo huésped dice que no (límite 3)');
  ok(e.archivos.length === 3, 'no se guardó ninguna foto de más');
}
{
  const e = entorno();
  let r = e.post({ ticket: permiso(REF, ahoraSeg() + 600, 'otra-clave'), apellido: 'A', nombre: 'B', imagen: jpeg() });
  ok(r.ok === false && r.error === 'permiso' && e.archivos.length === 0, 'permiso con firma falsa: se rechaza y no guarda nada');
  r = e.post({ ticket: permiso(REF, ahoraSeg() - 5), apellido: 'A', nombre: 'B', imagen: jpeg() });
  ok(r.ok === false && r.error === 'permiso', 'permiso vencido: se rechaza');
  r = e.post({ ticket: '', apellido: 'A', nombre: 'B', imagen: jpeg() });
  ok(r.ok === false && r.error === 'permiso', 'sin permiso: se rechaza');
  r = e.post({ ticket: permiso('zz'.repeat(16)), apellido: 'A', nombre: 'B', imagen: jpeg() });
  ok(r.ok === false && r.error === 'permiso', 'referencia mal formada: se rechaza');
  r = e.post({ ticket: permiso(REF), apellido: 'A', nombre: 'B', imagen: Buffer.from('esto no es una foto '.repeat(20)).toString('base64') });
  ok(r.ok === false && r.error === 'imagen' && e.archivos.length === 0, 'un archivo que no es JPEG se rechaza');
  r = e.post({ ticket: permiso(REF), apellido: 'A', nombre: 'B', imagen: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(1600 * 1024)]).toString('base64') });
  ok(r.ok === false && r.error === 'imagen', 'una imagen demasiado pesada se rechaza');
  r = e.post('esto no es json');
  ok(r.ok === false, 'un pedido roto no rompe el script');
  r = e.post({ ticket: permiso(REF), imagen: jpeg() });
  ok(r.ok === true && /_sin-nombre_sin-nombre\.jpg$/.test(r.nombre), 'sin nombre ni apellido igual guarda, con nombre genérico');
}
{
  const e = entorno({ respuestaBase: { codigo: 200, cuerpo: { ok: false, error: 'sesion_invalida' } } });
  const r = e.post({ ticket: permiso(REF), apellido: 'A', nombre: 'B', imagen: jpeg() });
  ok(r.ok === false && r.error === 'registro', 'si la base no reconoce la foto, el script lo informa');
}
{
  const e = entorno();
  let r = e.post({ accion: 'probar', secreto: 'mala' });
  ok(r.ok === false && r.error === 'secreto' && e.archivos.length === 0, 'probar con clave mala: se rechaza');
  r = e.post({ accion: 'probar', secreto: SECRETO });
  ok(r.ok === true && r.carpeta === 'Check-in documentos' && e.archivos.length === 1, 'probar con la clave buena: guarda el archivito y dice la carpeta');
  r = e.post({ accion: 'probar', secreto: SECRETO });
  ok(r.ok === true && e.archivos.length === 1, 'probar de nuevo actualiza el mismo archivo (no llena la carpeta)');
}

if (fallas) { console.log(`\n${fallas} falla(s)`); process.exit(1); }
console.log('\nTodo bien');
