import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { leer, guardar, versiones, defaults } from './db.js';
import { validar } from '../src/data/mezclar.js';

const PUERTO = Number(process.env.PORT) || 3001;
const produccion = process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER);
// En desarrollo sirve "admin"; en producción hay que definir ADMIN_PASSWORD o el panel queda cerrado.
const CLAVE = process.env.ADMIN_PASSWORD || (produccion ? '' : 'admin');
if (!process.env.ADMIN_PASSWORD) {
  console.warn(produccion
    ? '⚠ Falta ADMIN_PASSWORD: el panel del dueño está deshabilitado.'
    : '⚠ Usando la clave de desarrollo "admin". Definí ADMIN_PASSWORD antes de publicar.');
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '500kb' }));

function claveValida(texto) {
  if (!CLAVE || typeof texto !== 'string') return false;
  const a = Buffer.from(texto), b = Buffer.from(CLAVE);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Freno simple a los intentos de adivinar la clave: 8 fallos por minuto y por IP.
const fallos = new Map();
function limitar(req, res, next) {
  const ip = req.ip;
  const ahora = Date.now();
  const lista = (fallos.get(ip) || []).filter((t) => ahora - t < 60_000);
  fallos.set(ip, lista);
  if (lista.length >= 8) return res.status(429).json({ error: 'Demasiados intentos. Esperá un minuto.' });
  req.registrarFallo = () => lista.push(ahora);
  next();
}

function exigirClave(req, res, next) {
  if (!CLAVE) return res.status(503).json({ error: 'El panel está deshabilitado: falta ADMIN_PASSWORD.' });
  if (!claveValida(req.get('x-clave'))) {
    req.registrarFallo?.();
    return res.status(401).json({ error: 'Clave incorrecta.' });
  }
  next();
}

app.get('/api/contenido', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(leer());
});

app.post('/api/login', limitar, exigirClave, (_req, res) => res.json({ ok: true }));

app.put('/api/contenido', limitar, exigirClave, (req, res) => {
  const error = validar(defaults, req.body);
  if (error) return res.status(400).json({ error });
  const actualizado = guardar(req.body);
  res.json({ ok: true, actualizado });
});

app.get('/api/versiones', limitar, exigirClave, (_req, res) => res.json(versiones()));

// En producción el mismo servidor entrega la guía compilada.
const dist = fileURLToPath(new URL('../dist', import.meta.url));
if (existsSync(dist)) app.use(express.static(dist));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: 'Error del servidor.' });
});

app.listen(PUERTO, () => console.log(`Guía del hotel en http://localhost:${PUERTO}`));
