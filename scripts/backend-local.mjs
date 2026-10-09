// Backend de prueba 100 % local: un Postgres real (PGlite, en memoria) con exactamente los mismos archivos SQL
// que la base de producción (supabase/schema.sql y supabase/checkin.sql), más un "PostgREST" mínimo y un
// "script de Google" simulado. Sirve para probar todo el check-in sin tocar la base real ni tu Drive.
//
//   node scripts/backend-local.mjs        (queda escuchando en http://localhost:54321)
//
// Claves de prueba: admin = admin-test-123  ·  recepción = recepcion-test-123 (después de prender el check-in).
import fs from 'node:fs';
import http from 'node:http';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import hotel from '../src/data/hotel.js';

const raiz = (ruta) => fileURLToPath(new URL(`../${ruta}`, import.meta.url));
export const CLAVE_ADMIN = 'admin-test-123';
export const CLAVE_RECEPCION = 'recepcion-test-123';
const CARPETA = 'CARPETA1234567890';

async function crearBase() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema extensions; create extension pgcrypto with schema extensions;
    grant usage on schema extensions to anon, authenticated;
  `);
  await db.exec(fs.readFileSync(raiz('supabase/schema.sql'), 'utf8'));
  await db.exec(fs.readFileSync(raiz('supabase/checkin.sql'), 'utf8'));
  await db.query(`insert into private.admin (id, hash) values (1, extensions.crypt($1, extensions.gen_salt('bf')))`, [CLAVE_ADMIN]);
  // CONTENIDO_JSON=archivo.json arranca con el contenido de la guía real (sin los bloques nuevos), para probar con datos de verdad.
  const contenido = process.env.CONTENIDO_JSON ? JSON.parse(fs.readFileSync(process.env.CONTENIDO_JSON, 'utf8')) : hotel;
  await db.query(`insert into public.contenido (id, data) values (1, $1::jsonb)`, [JSON.stringify(contenido)]);
  return db;
}

// El "script de Google": es el mismo apps-script/Codigo.gs, con un Drive simulado.
function crearScript(llamarBase) {
  const archivos = [];
  const cache = new Map();
  const firmados = (b) => Array.from(b).map((x) => (x > 127 ? x - 256 : x));
  const carpeta = {
    getName: () => 'Check-in documentos (prueba)',
    getFilesByName: (n) => { const r = archivos.filter((a) => a.nombre === n); let i = 0; return { hasNext: () => i < r.length, next: () => r[i++] }; },
    createFile: (a, contenido) => {
      const f = typeof a === 'string' ? { nombre: a, texto: contenido } : { nombre: a.name, bytes: a.bytes.length, mime: a.mime };
      f.id = `IDARCHIVO${String(archivos.length).padStart(8, '0')}`; // el id queda fijo al crear el archivo, como en Drive
      f.getId = () => f.id;
      f.setContent = (t) => { f.texto = t; };
      archivos.push(f);
      return f;
    }
  };
  let pendiente = null;
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
    DriveApp: { getFolderById: (id) => { if (id !== CARPETA) throw new Error('carpeta'); return carpeta; } },
    // UrlFetchApp es síncrono en Google; acá se anota el pedido y se hace de verdad apenas termina el script.
    UrlFetchApp: { fetch: (url, opc) => { pendiente = JSON.parse(opc.payload); return { getResponseCode: () => 200, getContentText: () => '{"ok":true}' }; } },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ s, setMimeType() { return this; } }) },
    console
  };
  const fuente = fs.readFileSync(raiz('apps-script/Codigo.gs'), 'utf8');
  const cargar = (secreto) => {
    vm.createContext(ctx);
    vm.runInContext(fuente.replace('%%SUPABASE_URL%%', 'http://local').replace('%%SUPABASE_KEY%%', 'local')
      .replace('%%SECRETO%%', secreto).replace('%%CARPETA_ID%%', CARPETA).replace('%%ZONA%%', 'America/Argentina/Buenos_Aires'), ctx);
  };
  return {
    archivos,
    cargar,
    async post(cuerpo) {
      pendiente = null;
      const r = JSON.parse(ctx.doPost({ postData: { contents: cuerpo } }).s);
      if (r.ok && pendiente) {
        const reg = await llamarBase('checkin_foto_registrar', pendiente);
        if (!reg?.ok) return { ok: false, error: 'registro' };
      }
      return r;
    }
  };
}

export async function iniciarBackend({ puerto = 54321, silencioso = true } = {}) {
  let db = await crearBase();
  const secretoDe = async () => (await db.query('select foto_secreto from private.checkin_config where id = 1')).rows[0].foto_secreto;

  // Llama a una función pública como lo haría PostgREST: con el rol "anon" y las cabeceras de la IP.
  // `ip` puede ser un texto (va en x-forwarded-for) o un objeto con todas las cabeceras (cf-connecting-ip, etc.).
  const llamar = async (nombre, args = {}, ip = '203.0.113.7') => {
    if (!/^[a-z_]+$/.test(nombre)) throw new Error('nombre');
    const claves = Object.keys(args);
    if (!claves.every((k) => /^p_[a-z_]+$/.test(k))) throw new Error('parametros');
    const lista = claves.map((k, i) => `${k} => $${i + 1}`).join(', ');
    const valores = claves.map((k) => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]));
    return db.transaction(async (tx) => {
      const cabeceras = typeof ip === 'object' && ip !== null ? ip : { 'x-forwarded-for': ip };
      await tx.query(`select set_config('request.headers', $1, true)`, [JSON.stringify(cabeceras)]);
      await tx.exec('set local role anon');
      const r = await tx.query(`select public.${nombre}(${lista}) as r`, valores);
      return r.rows[0].r;
    });
  };

  let script = crearScript(async (n, a) => llamar(n, a));
  script.cargar(await secretoDe());

  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
  const leer = (req) => new Promise((res) => { const t = []; req.on('data', (c) => t.push(c)); req.on('end', () => res(Buffer.concat(t).toString('utf8'))); });
  const responder = (res, codigo, cuerpo, tipo = 'application/json') => { res.writeHead(codigo, { ...cors, 'content-type': tipo }); res.end(typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo)); };

  const servidor = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://localhost:${puerto}`);
      if (req.method === 'OPTIONS') return responder(res, 204, '');
      // Igual que en Supabase: llegan todas las cabeceras del pedido (así se prueba que x-forwarded-for falso no sirve).
      const ip = { 'x-forwarded-for': String(req.headers['x-forwarded-for'] ?? '203.0.113.7'), ...(req.headers['cf-connecting-ip'] ? { 'cf-connecting-ip': String(req.headers['cf-connecting-ip']) } : {}) };

      if (url.pathname === '/rest/v1/contenido' && req.method === 'GET') {
        const r = await db.query('select data, actualizado from public.contenido where id = 1');
        return responder(res, 200, r.rows);
      }
      if (url.pathname.startsWith('/rest/v1/rpc/') && req.method === 'POST') {
        const cuerpo = JSON.parse((await leer(req)) || '{}');
        return responder(res, 200, await llamar(url.pathname.split('/').pop(), cuerpo, ip));
      }
      // "Aplicación web" de Google Apps Script (simulada)
      if (url.pathname === '/apps-script/exec') {
        if (req.method === 'GET') return responder(res, 200, { ok: true, servicio: 'checkin-fotos' });
        return responder(res, 200, await script.post(await leer(req)));
      }
      // ---- ayudas solo para las pruebas ----
      if (url.pathname === '/__test/sql' && req.method === 'POST') {
        const { sql, params } = JSON.parse(await leer(req));
        const r = await db.query(sql, params ?? []);
        return responder(res, 200, r.rows);
      }
      if (url.pathname === '/__test/reiniciar' && req.method === 'POST') {
        await db.close();
        db = await crearBase();
        script = crearScript(async (n, a) => llamar(n, a));
        script.cargar(await secretoDe());
        return responder(res, 200, { ok: true });
      }
      if (url.pathname === '/__test/drive') return responder(res, 200, script.archivos);
      return responder(res, 404, { error: 'no existe' });
    } catch (e) {
      // PostgREST contesta 400 con el detalle cuando una función falla
      if (!silencioso) console.error(e);
      return responder(res, 400, { message: String(e.message ?? e) });
    }
  });
  await new Promise((r) => servidor.listen(puerto, r));
  return {
    url: `http://localhost:${puerto}`,
    llamar,
    sql: (sql, params) => db.query(sql, params).then((r) => r.rows),
    exec: (sql) => db.exec(sql),
    cerrar: async () => { await new Promise((r) => servidor.close(r)); await db.close(); }
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const b = await iniciarBackend({ silencioso: false });
  console.log(`Backend de prueba en ${b.url}\n  admin: ${CLAVE_ADMIN}\n  recepción: ${CLAVE_RECEPCION} (se carga desde el panel o con /__test/sql)`);
}
