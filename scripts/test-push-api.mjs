// La función que manda los avisos (api/push.js): que solo la pueda llamar la base con el secreto, que valide todo lo que recibe, que un celular caído no frene a los demás,
// que saque de la lista los que ya no existen y que las claves y el formato sean los que de verdad entiende Web Push (con la librería real, sin salir a internet).
//   node scripts/test-push-api.mjs
import crypto from 'node:crypto';
import { generateRequestDetails, generateVAPIDKeys } from 'web-push';
import { crearManejador } from '../api/push.js';

let fallas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK    ' : 'FALLA '}${m}`); if (!c) fallas += 1; };

const vapid = generateVAPIDKeys();
const ENV = { PUSH_SECRETO: 'secreto-de-prueba', VAPID_PUBLICA: vapid.publicKey, VAPID_PRIVADA: vapid.privateKey, VAPID_SUBJECT: 'https://hotel.ejemplo.test' };
// un celular «de verdad»: el par de claves y el secreto de autenticación que el navegador entrega al suscribirse
const celular = (nombre) => {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return { endpoint: `https://fcm.googleapis.com/fcm/send/${nombre}`, p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url'), url: '#/recepcion' };
};
const respuesta = () => {
  const r = { codigo: null, cuerpo: null, cabeceras: {} };
  r.status = (c) => { r.codigo = c; return r; };
  r.json = (b) => { r.cuerpo = b; return r; };
  r.setHeader = (k, v) => { r.cabeceras[k] = v; };
  return r;
};
const pedir = async (manejador, { metodo = 'POST', secreto = ENV.PUSH_SECRETO, body } = {}) => {
  const res = respuesta();
  await manejador({ method: metodo, headers: secreto == null ? {} : { authorization: `Bearer ${secreto}` }, body }, res);
  return res;
};
const BUENO = (extra = {}) => ({ titulo: 'Reserva nueva', cuerpo: 'Hab. 107 · Juan Pérez · llega vie 21/11 · 3 huéspedes', tag: 'anotada-1', suscripciones: [celular('uno'), celular('dos')], ...extra });

console.log('\n== 1. Quién puede llamarla');
const enviadas = [];
const m = crearManejador({ env: ENV, configurarVapid: () => {}, enviar: async (sub, payload, opc) => { enviadas.push({ sub, payload: JSON.parse(payload), opc }); return { statusCode: 201 }; }, limpiar: async () => {} });
let r = await pedir(m, { metodo: 'GET', body: BUENO() });
ok(r.codigo === 405, 'solo acepta POST');
r = await pedir(m, { secreto: null, body: BUENO() });
ok(r.codigo === 401 && enviadas.length === 0, 'sin el secreto no manda nada');
r = await pedir(m, { secreto: 'secreto-equivocado', body: BUENO() });
ok(r.codigo === 401 && enviadas.length === 0, 'con un secreto equivocado tampoco');
r = await pedir(m, { secreto: ENV.PUSH_SECRETO + 'x', body: BUENO() });
ok(r.codigo === 401, 'ni con uno casi igual');
r = await pedir(crearManejador({ env: { ...ENV, PUSH_SECRETO: '' }, enviar: async () => ({}) }), { secreto: '', body: BUENO() });
ok(r.codigo === 401, 'si el servidor no tiene secreto cargado, nadie entra (no queda abierto)');
r = await pedir(crearManejador({ env: { ...ENV, VAPID_PRIVADA: '' }, enviar: async () => ({}) }), { body: BUENO() });
ok(r.codigo === 500 && r.cuerpo.error === 'sin_configurar', 'si faltan las claves de firma, avisa que no está configurado');

console.log('\n== 2. Valida todo lo que recibe');
const malos = [
  ['sin título', { titulo: '' }], ['título larguísimo', { titulo: 'x'.repeat(101) }], ['sin texto', { cuerpo: undefined }], ['texto larguísimo', { cuerpo: 'x'.repeat(251) }],
  ['sin celulares', { suscripciones: [] }], ['celulares que no son una lista', { suscripciones: 'hola' }], ['más de 200 celulares', { suscripciones: Array.from({ length: 201 }, (_, i) => celular(`c${i}`)) }],
  ['un endpoint que no es https', { suscripciones: [{ ...celular('x'), endpoint: 'http://inseguro.test/x' }] }], ['un celular sin claves', { suscripciones: [{ endpoint: 'https://fcm.googleapis.com/x' }] }],
  ['una etiqueta que no es texto', { tag: 5 }]
];
for (const [nombre, extra] of malos) {
  r = await pedir(m, { body: BUENO(extra) });
  ok(r.codigo === 400 && r.cuerpo.error === 'datos_invalidos', `${nombre} → se rechaza`);
}
r = await pedir(m, { body: 'esto no es json' });
ok(r.codigo === 400, 'un pedido que no es JSON se rechaza');
ok(enviadas.length === 0, 'ningún pedido inválido mandó un aviso');

console.log('\n== 3. Manda a cada celular lo suyo');
r = await pedir(m, { body: BUENO() });
ok(r.codigo === 200 && r.cuerpo.ok && r.cuerpo.enviados === 2 && r.cuerpo.fallidos === 0 && r.cuerpo.vencidos === 0, 'dos celulares: dos avisos enviados');
ok(enviadas[0].payload.titulo === 'Reserva nueva' && enviadas[0].payload.cuerpo.includes('Hab. 107') && enviadas[0].payload.tag === 'anotada-1' && enviadas[0].payload.url === '#/recepcion', 'cada aviso lleva título, texto, etiqueta y a dónde abrir');
ok(enviadas[0].sub.endpoint.endsWith('/uno') && enviadas[0].sub.keys.p256dh && enviadas[0].sub.keys.auth, 'y las claves de ese celular');
ok(enviadas[0].opc.TTL === 3600 && enviadas[0].opc.urgency === 'high', 'con una hora de vida y urgencia alta (para que llegue aunque el celular esté en reposo)');
ok(!JSON.stringify(r.cuerpo).includes(ENV.PUSH_SECRETO) && !JSON.stringify(r.cuerpo).includes(ENV.VAPID_PRIVADA), 'la respuesta nunca devuelve secretos');
r = await pedir(m, { body: BUENO({ suscripciones: [{ ...celular('sinurl'), url: undefined }] }) });
ok(r.codigo === 200 && enviadas.at(-1).payload.url === '#/entrar', 'sin dirección, el aviso abre el ingreso');

console.log('\n== 4. Celulares caídos y vencidos');
const limpiadas = [];
const caidos = crearManejador({ env: ENV, configurarVapid: () => {}, limpiar: async (e) => { limpiadas.push(...e); },
  enviar: async (sub) => {
    if (sub.endpoint.endsWith('/viejo')) throw Object.assign(new Error('Gone'), { statusCode: 410 });
    if (sub.endpoint.endsWith('/lento')) throw Object.assign(new Error('timeout'), { statusCode: 503 });
    return { statusCode: 201 };
  } });
r = await pedir(caidos, { body: BUENO({ suscripciones: [celular('bueno1'), celular('viejo'), celular('lento'), celular('bueno2')] }) });
ok(r.codigo === 200 && r.cuerpo.enviados === 2 && r.cuerpo.vencidos === 1 && r.cuerpo.fallidos === 1, 'de cuatro celulares: 2 enviados, 1 vencido y 1 que falló; un celular caído no frena a los demás');
ok(limpiadas.length === 1 && limpiadas[0].endsWith('/viejo'), 'solo el que ya no existe (410) se saca de la lista; el que falló por otra causa se queda');
const ret = await pedir(crearManejador({ env: ENV, configurarVapid: () => {}, limpiar: async () => {}, enviar: async () => { throw Object.assign(new Error('Not Found'), { statusCode: 404 }); } }), { body: BUENO({ suscripciones: [celular('a')] }) });
ok(ret.cuerpo.vencidos === 1, 'un 404 también significa que el celular ya no existe');
r = await pedir(crearManejador({ env: ENV, configurarVapid: () => { throw new Error('claves mal'); }, enviar: async () => ({}) }), { body: BUENO() });
ok(r.codigo === 500 && r.cuerpo.error === 'claves_invalidas', 'unas claves de firma mal cargadas dan un error claro (no un silencio)');

console.log('\n== 5. Con la librería real (sin salir a internet)');
const real = celular('real');
const det = generateRequestDetails({ endpoint: real.endpoint, keys: { p256dh: real.p256dh, auth: real.auth } }, JSON.stringify({ titulo: 'Reserva nueva', cuerpo: 'Hab. 107' }),
  { TTL: 3600, urgency: 'high', vapidDetails: { subject: ENV.VAPID_SUBJECT, publicKey: ENV.VAPID_PUBLICA, privateKey: ENV.VAPID_PRIVADA } });
ok(det.method === 'POST' && det.headers.Authorization?.startsWith('vapid t=') && det.headers['Content-Encoding'] === 'aes128gcm' && det.headers.Urgency === 'high' && Buffer.isBuffer(det.body), 'con claves reales, el aviso se firma (VAPID), se cifra (aes128gcm) y queda listo para entregar');
ok(!det.body.toString('utf8').includes('Hab. 107'), 'y el texto no queda a la vista en lo que viaja');
let rechazo = null;
try { generateRequestDetails({ endpoint: real.endpoint, keys: { p256dh: real.p256dh, auth: real.auth } }, 'x', { vapidDetails: { subject: 'esto-no-es-una-direccion', publicKey: ENV.VAPID_PUBLICA, privateKey: ENV.VAPID_PRIVADA } }); } catch (e) { rechazo = e; }
ok(rechazo !== null, 'un VAPID_SUBJECT que no es una dirección (https:// o mailto:) lo rechaza la librería: por eso se valida al cargar las claves');

console.log(fallas ? `\n${fallas} fallas` : '\nTodo bien');
process.exit(fallas ? 1 : 0);
