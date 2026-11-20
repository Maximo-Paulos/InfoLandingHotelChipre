// Manda los avisos al celular (notificaciones push). Corre en Vercel, junto con el resto de la app: no hay servidor propio.
//
// Quién la llama: la base de datos (supabase/estadias.sql, función private.push_enviar, con pg_net) cuando se anota una reserva o se hace un check-in.
// Le pasa el texto y la lista de celulares que tienen que recibirlo. Acá solo se FIRMA (con las claves VAPID del hotel) y se ENTREGA a Apple / Google / Mozilla,
// que lo llevan al celular. El texto viaja cifrado de punta a punta (estándar Web Push): esos servidores solo ven datos ilegibles.
//
// Variables de entorno en Vercel (ver README, «Avisos en el celular»):
//   PUSH_SECRETO  la clave que tiene que traer quien llama (la misma que se carga en la base: private.push_config.secreto)
//   VAPID_PUBLICA / VAPID_PRIVADA  el par de claves del hotel para firmar los avisos
//   VAPID_SUBJECT  quién manda, como dirección web (https://…) o mailto:
import { timingSafeEqual } from 'node:crypto';
import { sendNotification, setVapidDetails } from 'web-push';
import { SUPABASE_KEY, SUPABASE_URL } from '../src/config.js';

const MAX_CELULARES = 200;
const iguales = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};
const texto = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;

// Le avisa a la base qué celulares ya no existen (se desinstaló la app o se sacó el permiso) para sacarlos de la lista. Si falla, no pasa nada: se reintenta con el próximo aviso.
async function limpiarEnBase(endpoints, env) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/push_limpiar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: SUPABASE_KEY, authorization: `Bearer ${SUPABASE_KEY}` },
      body: JSON.stringify({ p_secreto: env.PUSH_SECRETO, p_endpoints: endpoints })
    });
  } catch { /* se reintenta */ }
}

// crearManejador permite probarla sin Apple ni Google: se le pasa un `enviar` falso.
export function crearManejador({ enviar = sendNotification, configurarVapid = setVapidDetails, limpiar = limpiarEnBase, env = process.env } = {}) {
  return async function manejador(req, res) {
    if (req.method !== 'POST') {
      res.setHeader?.('allow', 'POST');
      return res.status(405).json({ ok: false, error: 'metodo' });
    }
    if (!env.PUSH_SECRETO || !iguales(req.headers?.authorization ?? '', `Bearer ${env.PUSH_SECRETO}`)) {
      return res.status(401).json({ ok: false, error: 'no_autorizado' });
    }
    if (!env.VAPID_PUBLICA || !env.VAPID_PRIVADA || !env.VAPID_SUBJECT) {
      return res.status(500).json({ ok: false, error: 'sin_configurar' });
    }
    let cuerpo = req.body;
    if (typeof cuerpo === 'string') { try { cuerpo = JSON.parse(cuerpo); } catch { cuerpo = null; } }
    const { titulo, cuerpo: mensaje, tag, suscripciones } = cuerpo ?? {};
    const validas = Array.isArray(suscripciones) && suscripciones.length > 0 && suscripciones.length <= MAX_CELULARES
      && suscripciones.every((s) => s && typeof s.endpoint === 'string' && /^https:\/\//.test(s.endpoint) && texto(s.p256dh, 200) && texto(s.auth, 100) && (s.url == null || texto(s.url, 200)));
    if (!texto(titulo, 100) || !texto(mensaje, 250) || (tag != null && !texto(tag, 100)) || !validas) {
      return res.status(400).json({ ok: false, error: 'datos_invalidos' });
    }
    try {
      configurarVapid(env.VAPID_SUBJECT, env.VAPID_PUBLICA, env.VAPID_PRIVADA);
    } catch {
      return res.status(500).json({ ok: false, error: 'claves_invalidas' });
    }
    // En paralelo: que un celular lento o caído no demore ni impida los demás.
    const resultados = await Promise.allSettled(suscripciones.map((s) => enviar(
      { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
      JSON.stringify({ titulo, cuerpo: mensaje, tag: tag ?? undefined, url: s.url ?? '#/entrar' }),
      { TTL: 3600, urgency: 'high', timeout: 8000 } // si el celular no se conecta en una hora, el aviso ya no sirve
    )));
    const vencidos = [];
    let enviados = 0;
    resultados.forEach((r, i) => {
      if (r.status === 'fulfilled') enviados += 1;
      else if ([404, 410].includes(r.reason?.statusCode)) vencidos.push(suscripciones[i].endpoint);
    });
    if (vencidos.length) await limpiar(vencidos, env);
    return res.status(200).json({ ok: true, enviados, fallidos: suscripciones.length - enviados - vencidos.length, vencidos: vencidos.length });
  };
}

export default crearManejador();
