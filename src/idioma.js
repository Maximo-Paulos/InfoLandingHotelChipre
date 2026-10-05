// Traducción de toda la guía con el traductor de Google (gratis, sin claves ni cuentas).
// La guía se escribe en español; al elegir otro idioma se carga el traductor y traduce lo que se ve,
// incluidos los textos que el dueño cambie después desde el panel.
// El idioma elegido queda en la cookie `googtrans` ("/es/en"), que es la que lee el traductor.

export const IDIOMAS = [
  { code: 'es', nombre: 'Español' },
  { code: 'en', nombre: 'English' },
  { code: 'pt', nombre: 'Português' },
  { code: 'fr', nombre: 'Français' },
  { code: 'it', nombre: 'Italiano' },
  { code: 'de', nombre: 'Deutsch' },
  { code: 'zh-CN', nombre: '中文' },
  { code: 'ja', nombre: '日本語' }
];
export const IDIOMAS_POR_DEFECTO = IDIOMAS.map((i) => i.code);

export function idiomaActual() {
  const m = document.cookie.match(/(?:^|;\s*)googtrans=\/[^/]*\/([^;]+)/);
  const code = m ? decodeURIComponent(m[1]) : 'es';
  return IDIOMAS.some((i) => i.code === code) ? code : 'es';
}

function borrarCookie() {
  const caduca = 'expires=Thu, 01 Jan 1970 00:00:00 GMT';
  const host = location.hostname;
  document.cookie = `googtrans=; path=/; ${caduca}`;
  document.cookie = `googtrans=; path=/; domain=${host}; ${caduca}`;
  document.cookie = `googtrans=; path=/; domain=.${host}; ${caduca}`;
}

// Cambia el idioma y recarga: es lo más seguro para que el traductor arranque desde cero.
export function cambiarIdioma(code) {
  borrarCookie();
  if (code !== 'es') document.cookie = `googtrans=/es/${code}; path=/; max-age=31536000; SameSite=Lax`;
  location.reload();
}

// El traductor reemplaza nodos de texto y React puede fallar al actualizar la pantalla.
// Este parche evita ese error (es el que recomienda la propia comunidad de React).
export function protegerDomDelTraductor() {
  if (Node.prototype.__protegido) return;
  Node.prototype.__protegido = true;
  const quitar = Node.prototype.removeChild;
  Node.prototype.removeChild = function removeChild(hijo) {
    if (hijo.parentNode !== this) return hijo;
    return quitar.call(this, hijo);
  };
  const insertar = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function insertBefore(nuevo, ref) {
    if (ref && ref.parentNode !== this) return nuevo;
    return insertar.call(this, nuevo, ref);
  };
}

// Carga el traductor solo si hay un idioma distinto del español. `alFallar` se llama si no pudo traducir.
export function iniciarTraductor(permitidos, alFallar) {
  const code = idiomaActual();
  if (code === 'es' || window.iniciarTraductorGoogle) return;
  window.iniciarTraductorGoogle = () => {
    // eslint-disable-next-line no-new
    new window.google.translate.TranslateElement(
      { pageLanguage: 'es', includedLanguages: permitidos.filter((c) => c !== 'es').join(','), autoDisplay: false },
      'google_translate_element'
    );
  };
  const caja = document.createElement('div');
  caja.id = 'google_translate_element';
  caja.hidden = true;
  document.body.appendChild(caja);
  const s = document.createElement('script');
  s.src = 'https://translate.google.com/translate_a/element.js?cb=iniciarTraductorGoogle';
  s.async = true;
  s.onerror = () => alFallar?.();
  document.head.appendChild(s);
  setTimeout(() => {
    if (!/translated-(ltr|rtl)/.test(document.documentElement.className)) alFallar?.();
  }, 15000);
}
