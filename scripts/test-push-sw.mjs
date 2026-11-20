// El programita del celular (public/sw.js): se prueba cargándolo en un entorno que imita al del navegador, con un «celular» falso que anota lo que le piden.
//   node scripts/test-push-sw.mjs
import fs from 'node:fs';
import vm from 'node:vm';

let fallas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK    ' : 'FALLA '}${m}`); if (!c) fallas += 1; };

function cargar({ ventanas = [] } = {}) {
  const oyentes = {};
  const hechos = { avisos: [], abiertas: [], mensajes: [], enfocadas: 0, omitido: false, reclamado: false };
  const self = {
    addEventListener: (tipo, f) => { oyentes[tipo] = f; },
    skipWaiting: () => { hechos.omitido = true; },
    registration: { scope: 'https://hotel.ejemplo.test/', showNotification: async (titulo, opc) => { hechos.avisos.push({ titulo, ...opc }); } },
    clients: {
      claim: async () => { hechos.reclamado = true; },
      matchAll: async () => ventanas.map((v) => ({ url: v, focus: async () => { hechos.enfocadas += 1; }, postMessage: (m) => hechos.mensajes.push(m) })),
      openWindow: async (u) => { hechos.abiertas.push(u); }
    }
  };
  vm.runInNewContext(fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), { self, URL, console });
  // dispara un evento y espera a lo que pidió con waitUntil
  const disparar = async (tipo, extra = {}) => {
    let espera = Promise.resolve();
    await (oyentes[tipo]({ ...extra, waitUntil: (p) => { espera = p; } }), espera);
    await espera;
  };
  return { disparar, hechos, oyentes };
}
const dato = (obj) => ({ data: { json: () => obj, text: () => JSON.stringify(obj) } });

console.log('\n== 1. Instalación');
let sw = cargar();
await sw.disparar('install');
await sw.disparar('activate');
ok(sw.hechos.omitido && sw.hechos.reclamado, 'se instala y toma el control enseguida (sin esperar a que se cierren las pestañas)');
ok(!('fetch' in sw.oyentes), 'no intercepta ninguna página ni pedido: no guarda copias de nada');

console.log('\n== 2. Llega un aviso');
await sw.disparar('push', dato({ titulo: 'Reserva nueva', cuerpo: 'Hab. 107 · Juan Pérez · llega vie 21/11 · 3 huéspedes', tag: 'anotada-9', url: '#/recepcion' }));
let a = sw.hechos.avisos[0];
ok(a.titulo === 'Reserva nueva' && a.body.includes('Hab. 107') && a.tag === 'anotada-9' && a.renotify === true && a.data.url === '#/recepcion', 'muestra título, texto, etiqueta (y vuelve a sonar al reemplazar) y recuerda a dónde abrir');
ok(a.icon === 'iconos/icono-192.png' && a.badge === 'iconos/icono-192.png', 'con el ícono del hotel');
await sw.disparar('push', dato({ titulo: 'Sin etiqueta', cuerpo: 'x' }));
a = sw.hechos.avisos[1];
ok(a.tag === undefined && a.renotify === false && a.data.url === '#/entrar', 'sin etiqueta no reemplaza nada, y sin dirección abre el ingreso');
await sw.disparar('push', {});
ok(sw.hechos.avisos[2].titulo === 'Hotel Chipre', 'un aviso sin contenido igual muestra algo (iPhone exige que todo aviso se vea)');
await sw.disparar('push', { data: { json: () => { throw new Error('no es json'); }, text: () => 'texto suelto' } });
ok(sw.hechos.avisos[3].body === 'texto suelto', 'un aviso que no es JSON se muestra como texto, sin romperse');
await sw.disparar('push', dato({ titulo: 5, cuerpo: { x: 1 }, tag: [1], url: 7 }));
a = sw.hechos.avisos[4];
ok(a.titulo === 'Hotel Chipre' && a.body === '' && a.tag === undefined && a.data.url === '#/entrar', 'si los datos vienen con formas raras, no se rompe ni muestra basura');

console.log('\n== 3. Se toca el aviso');
let cerrada = false;
const toque = (url) => ({ notification: { close: () => { cerrada = true; }, data: { url } } });
sw = cargar({ ventanas: ['https://hotel.ejemplo.test/#/recepcion'] });
await sw.disparar('notificationclick', toque('#/admin'));
ok(cerrada && sw.hechos.enfocadas === 1 && sw.hechos.mensajes[0]?.tipo === 'abrir' && sw.hechos.mensajes[0].url === '#/admin' && sw.hechos.abiertas.length === 0, 'con la app abierta: se cierra el aviso, se trae la app al frente y se le dice que vaya a #/admin');
cerrada = false;
sw = cargar({ ventanas: ['https://otro-sitio.test/'] });
await sw.disparar('notificationclick', toque('#/recepcion'));
ok(sw.hechos.abiertas[0] === 'https://hotel.ejemplo.test/#/recepcion' && sw.hechos.enfocadas === 0, 'si solo hay ventanas de otros sitios, abre la app (en su dirección, no en la del otro)');
sw = cargar();
await sw.disparar('notificationclick', { notification: { close: () => {}, data: null } });
ok(sw.hechos.abiertas[0] === 'https://hotel.ejemplo.test/#/entrar', 'un aviso sin dirección abre el ingreso');

console.log(fallas ? `\n${fallas} fallas` : '\nTodo bien');
process.exit(fallas ? 1 : 0);
