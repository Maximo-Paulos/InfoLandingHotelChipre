// Programita de la app del personal para los AVISOS en el celular. Solo hace dos cosas: mostrar el aviso cuando llega y abrir la app cuando se toca.
// No guarda nada (ni datos de huéspedes ni páginas): la app sigue sin copia sin conexión, a propósito.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Llega un aviso: { titulo, cuerpo, tag, url }. Siempre se muestra algo (iPhone no permite avisos que no se vean).
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { cuerpo: e.data ? e.data.text() : '' }; }
  const texto = (v) => (typeof v === 'string' ? v : '');
  e.waitUntil(self.registration.showNotification(texto(d.titulo) || 'Hotel Chipre', {
    body: texto(d.cuerpo),
    tag: texto(d.tag) || undefined, // con la misma etiqueta el aviso nuevo reemplaza al anterior en vez de apilarse
    renotify: !!d.tag,
    icon: 'iconos/icono-192.png',
    badge: 'iconos/icono-192.png',
    data: { url: texto(d.url) || '#/entrar' }
  }));
});

// Se toca el aviso: si la app ya está abierta se la trae al frente y se le dice a dónde ir; si no, se abre.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || '#/entrar';
  e.waitUntil((async () => {
    const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const mia = ventanas.find((c) => c.url.startsWith(self.registration.scope));
    if (mia) {
      try { await mia.focus(); } catch { /* algunos celulares no dejan: igual se le avisa */ }
      mia.postMessage({ tipo: 'abrir', url });
      return;
    }
    await self.clients.openWindow(new URL(url, self.registration.scope).href);
  })());
});
