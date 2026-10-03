(function () {
  'use strict';
  var D = window.HOTEL_DATA, H = D.hotel;
  var app = document.getElementById('app');
  var pie = document.getElementById('pie');
  var toastEl = document.getElementById('toast');

  /* ---------- utilidades ---------- */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function wa(msg) { return 'https://wa.me/' + H.whatsapp + '?text=' + encodeURIComponent(msg); }
  function maps(q) { return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q); }
  function tel(n) { return 'tel:' + String(n).replace(/[^\d+]/g, ''); }
  function hora(t) { return t.replace(/^0/, ''); }

  var toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 2600);
  }

  var P = {
    llave: '<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/>',
    wifi: '<path d="M12 20h.01"/><path d="M2 8.82a15 15 0 0 1 20 0"/><path d="M5 12.86a10 10 0 0 1 14 0"/><path d="M8.5 16.43a5 5 0 0 1 7 0"/>',
    cama: '<path d="M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8"/><path d="M4 10V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4"/><path d="M12 4v6"/><path d="M2 18h20"/>',
    olas: '<path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>',
    normas: '<path d="M15 12h-5"/><path d="M15 8h-5"/><path d="M19 17V5a2 2 0 0 0-2-2H4"/><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"/>',
    cubierto: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
    brujula: '<circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-1.8 5.41a2 2 0 0 1-1.27 1.27l-5.41 1.8 1.8-5.41a2 2 0 0 1 1.27-1.27z"/>',
    bolsa: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
    alerta: '<path d="M7 18v-6a5 5 0 1 1 10 0v6"/><path d="M5 21a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2z"/><path d="M21 12h1"/><path d="M18.5 4.5 18 5"/><path d="M2 12h1"/><path d="M12 2v1"/><path d="m4.93 4.93.71.71"/><path d="M12 12v6"/>',
    duda: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
    valija: '<path d="M6 20a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2"/><path d="M8 18V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v14"/><path d="M10 20h4"/><circle cx="16" cy="20" r="2"/><circle cx="8" cy="20" r="2"/>',
    estrella: '<path d="M11.53 2.3a.53.53 0 0 1 .95 0l2.31 4.68a2.12 2.12 0 0 0 1.6 1.16l5.16.76a.53.53 0 0 1 .3.9l-3.74 3.64a2.12 2.12 0 0 0-.61 1.88l.88 5.14a.53.53 0 0 1-.77.56l-4.62-2.43a2.12 2.12 0 0 0-1.97 0L6.4 21.01a.53.53 0 0 1-.77-.56l.88-5.14a2.12 2.12 0 0 0-.61-1.88L2.16 9.8a.53.53 0 0 1 .3-.9l5.16-.76a2.12 2.12 0 0 0 1.6-1.16z"/>',
    pin: '<path d="M20 10c0 4.99-5.54 10.19-7.4 11.8a1 1 0 0 1-1.2 0C9.54 20.19 4 14.99 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
    tel: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
    wa: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    atras: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    ext: '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
    mapa: '<path d="M14.11 5.55a2 2 0 0 0 1.78 0l3.66-1.83A1 1 0 0 1 21 4.62v12.76a1 1 0 0 1-.55.9l-4.56 2.27a2 2 0 0 1-1.78 0l-4.22-2.1a2 2 0 0 0-1.78 0l-3.66 1.83A1 1 0 0 1 3 19.38V6.62a1 1 0 0 1 .55-.9l4.56-2.27a2 2 0 0 1 1.78 0z"/><path d="M15 5.76v15"/><path d="M9 3.24v15"/>',
    taza: '<path d="M10 2v2"/><path d="M14 2v2"/><path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"/><path d="M6 2v2"/>',
    pesa: '<path d="M14.4 14.4 9.6 9.6"/><path d="M18.66 21.49a2 2 0 1 1-2.83-2.83l-1.77 1.77a2 2 0 1 1-2.83-2.83l6.36-6.36a2 2 0 1 1 2.83 2.83l-1.77 1.77a2 2 0 1 1 2.83 2.83z"/><path d="m21.5 21.5-1.4-1.4"/><path d="M3.9 3.9 2.5 2.5"/><path d="M6.4 12.77a2 2 0 1 1-2.83-2.83l1.77-1.77a2 2 0 1 1-2.83-2.83l2.83-2.83a2 2 0 1 1 2.83 2.83l1.77-1.77a2 2 0 1 1 2.83 2.83z"/>',
    hoja: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>',
    p: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 17V7h4a3 3 0 0 1 0 6H9"/>',
    remera: '<path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/>',
    rayo: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
    termo: '<path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"/>',
    tv: '<rect width="20" height="15" x="2" y="7" rx="2" ry="2"/><path d="m17 2-5 5-5-5"/>',
    candado: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    copa: '<path d="M8 22h8"/><path d="M7 10h10"/><path d="M12 15v7"/><path d="M12 15a5 5 0 0 0 5-5c0-2-.5-4-2-8H9c-1.5 4-2 6-2 8a5 5 0 0 0 5 5Z"/>',
    brillo: '<path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.14 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z"/>',
    capas: '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
    auto: '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>',
    reloj: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    plaza: '<path d="M3 22h18"/><path d="M6 18v-7"/><path d="M10 18v-7"/><path d="M14 18v-7"/><path d="M18 18v-7"/><path d="M12 2 20 7H4z"/>',
    museo: '<path d="M3 22h18"/><path d="M6 18v-7"/><path d="M10 18v-7"/><path d="M14 18v-7"/><path d="M18 18v-7"/><path d="M12 2 20 7H4z"/>',
    arbol: '<path d="M10 10v.2A3 3 0 0 1 8.9 16H5a3 3 0 0 1-1-5.8V10a3 3 0 0 1 6 0Z"/><path d="M7 16v6"/><path d="M13 19v3"/><path d="M12 19h8.3a1 1 0 0 0 .7-1.7L18 14h.3a1 1 0 0 0 .7-1.7L16 9h.2a1 1 0 0 0 .8-1.7L13 3l-1.4 1.5"/>',
    entrada: '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/>',
    carrito: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
    pildora: '<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/>',
    billete: '<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
    cambio: '<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>',
    tienda: '<path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4"/><path d="M2 7h20"/>',
    surtidor: '<path d="M3 22h12"/><path d="M4 9h10"/><path d="M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18"/><path d="M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 2 2 2 2 0 0 0 2-2V9.83a2 2 0 0 0-.59-1.42L18 5"/>',
    copiar: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    ok: '<path d="M20 6 9 17l-5-5"/>',
    hospital: '<path d="M11 2a2 2 0 0 0-2 2v5H4a2 2 0 0 0-2 2v2c0 1.1.9 2 2 2h5v5c0 1.1.9 2 2 2h2a2 2 0 0 0 2-2v-5h5a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2h-5V4a2 2 0 0 0-2-2h-2z"/>',
    salida: '<path d="M13 4h3a2 2 0 0 1 2 2v14"/><path d="M2 20h3"/><path d="M13 20h9"/><path d="M10 12v.01"/><path d="M13 4.56v16.16a1 1 0 0 1-1.24.97L5 20V5.56a2 2 0 0 1 1.52-1.94l4-1A2 2 0 0 1 13 4.56Z"/>'
  };
  function ic(name, size, sw) {
    size = size || 22;
    return '<svg class="svg" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (sw || 1.6) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[name] || '') + '</svg>';
  }

  /* ---------- piezas comunes ---------- */
  function cabecera(num, eyebrow, titulo, lead) {
    return '<header style="position:relative"><div class="tag" aria-hidden="true"><small>Nº</small><b>' + num + '</b></div>' +
      '<div class="top"><p class="eyebrow">' + esc(eyebrow) + '</p>' +
      '<a class="back" href="#/">' + ic('atras', 16, 2) + 'Menú</a></div>' +
      '<h1>' + esc(titulo) + '</h1>' + (lead ? '<p class="lead">' + esc(lead) + '</p>' : '') + '</header>';
  }
  function btnWa(texto, msg, cls) {
    return '<a class="btn ' + (cls || '') + '" href="' + wa(msg) + '" target="_blank" rel="noopener">' + ic('wa', 20) + esc(texto) + '</a>';
  }
  function btnWaMini(texto, msg, cls) {
    return '<a class="btn mini ' + (cls || 'negro') + '" href="' + wa(msg) + '" target="_blank" rel="noopener">' + ic('wa', 18) + esc(texto) + '</a>';
  }
  function linkMaps(q, texto) {
    return '<a class="maps" href="' + maps(q) + '" target="_blank" rel="noopener">' + ic('pin', 16, 1.8) + esc(texto || 'Ver en Google Maps') + '</a>';
  }
  function itemsIcono(lista) {
    return '<ul class="lista">' + lista.map(function (x) {
      return '<li class="item"><span class="ico">' + ic(x[0], 20) + '</span><div><h2>' + esc(x[1]) + '</h2><p>' + esc(x[2]) + '</p></div></li>';
    }).join('') + '</ul>';
  }
  function datos(lista) {
    return '<dl>' + lista.map(function (x) {
      return '<div class="dato">' + ic(x[0], 22) + '<div><dt>' + esc(x[1]) + '</dt><dd>' + esc(x[2]) + '</dd></div></div>';
    }).join('') + '</dl>';
  }

  /* ---------- horarios ---------- */
  function ahora() {
    try {
      var p = new Intl.DateTimeFormat('en-GB', { timeZone: H.zonaHoraria, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
      var o = {};
      p.forEach(function (x) { o[x.type] = x.value; });
      return { min: +o.hour * 60 + +o.minute, dia: { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[o.weekday] };
    } catch (e) {
      var d = new Date();
      return { min: d.getHours() * 60 + d.getMinutes(), dia: d.getDay() };
    }
  }
  function aMin(t) { var s = t.split(':'); return +s[0] * 60 + +s[1]; }
  function estado(f) {
    if (f.siempre) return { txt: 'Abierta 24 h', cls: 'ok' };
    if (f.conTurno) return { txt: 'Con turno', cls: 'turno' };
    var n = ahora();
    if (f.diasSemana && f.diasSemana.indexOf(n.dia) < 0) return { txt: 'Hoy cerrado', cls: '' };
    if (n.min >= aMin(f.abre) && n.min < aMin(f.cierra)) return { txt: 'Abierto ahora', cls: 'ok' };
    if (n.min < aMin(f.abre)) return { txt: 'Abre a las ' + hora(f.abre), cls: '' };
    return { txt: 'Cerrado por hoy', cls: '' };
  }

  /* ---------- pantallas ---------- */
  var comerCat = D.comer.categorias[0].id;

  var SECCIONES = [
    { id: 'checkin', num: '01', titulo: 'Check-in', icono: 'llave', hot: true, render: vCheckin },
    { id: 'wifi', num: '02', titulo: 'Wi-Fi', icono: 'wifi', hot: true, render: vWifi },
    { id: 'habitacion', num: '03', titulo: 'Tu habitación', icono: 'cama', render: vHabitacion },
    { id: 'instalaciones', num: '04', titulo: 'Instalaciones', icono: 'olas', render: vInstalaciones },
    { id: 'normas', num: '05', titulo: 'Normas', icono: 'normas', render: vNormas },
    { id: 'comer', num: '06', titulo: 'Dónde comer', icono: 'cubierto', render: vComer },
    { id: 'hacer', num: '07', titulo: 'Qué hacer', icono: 'brujula', render: vHacer },
    { id: 'compras', num: '08', titulo: 'Compras', icono: 'bolsa', render: vCompras },
    { id: 'emergencias', num: '09', titulo: 'Emergencias', icono: 'alerta', render: vEmergencias, oscuro: true },
    { id: 'preguntas', num: '10', titulo: 'Preguntas', icono: 'duda', render: vPreguntas },
    { id: 'checkout', num: '11', titulo: 'Check-out', icono: 'valija', render: vCheckout },
    { id: 'resena', num: '12', titulo: 'Tu reseña', icono: 'estrella', render: vResena }
  ];

  function vMenu() {
    var tiles = SECCIONES.map(function (s) {
      return '<a class="tile' + (s.hot ? ' hot' : '') + '" href="#/' + s.id + '">' + ic(s.icono, 24, s.hot ? 1.7 : 1.6) + '<span>' + esc(s.titulo) + '</span></a>';
    }).join('');
    return '<div class="menu"><header style="position:relative"><div class="tag" aria-hidden="true"><i>' + esc(H.sigla) + '</i></div>' +
      '<p class="eyebrow" style="padding:6px 0 0 60px;min-height:22px">' + esc(H.nombre) + '</p>' +
      '<h1>¿Qué necesitás?</h1><p class="lead">Tocá una opción para ir directo.</p></header>' +
      '<nav class="grid" aria-label="Secciones de la guía">' + tiles + '</nav>' +
      '<p class="note"><strong>¿Con apuro?</strong> Check-out hasta las ' + hora(H.horarios.checkout) + ' · Wi-Fi: ' + esc(H.wifi.red) + ' · Recepción: marcá 9 desde tu habitación.</p>' +
      '<div class="btns">' + btnWa('Escribinos por WhatsApp', 'Hola, necesito ayuda con mi estadía.', 'negro') + '</div></div>';
  }

  function vCheckin() {
    var c = D.checkin;
    var pasos = c.pasos.map(function (p, i) {
      return '<li><span class="n" aria-hidden="true">0' + (i + 1) + '</span><div><b>' + esc(p[0]) + '</b><span class="t">' + esc(p[1]) + '</span></div></li>';
    }).join('');
    return cabecera('01', 'Tu llegada', 'Check-in') +
      '<section class="big" aria-label="Horario de check-in"><div><p>Tu habitación está lista desde las</p><p class="hora">' + esc(H.horarios.checkin) + '</p></div><p class="al">Recepción abierta las 24 h</p></section>' +
      '<h2 class="sub">Cómo es</h2><ol class="pasos">' + pasos + '</ol>' +
      '<div class="box"><p>' + esc(c.tempranoTitulo) + '</p><p>' + esc(c.tempranoTexto) + '</p></div>' +
      datos(c.datos) +
      '<div class="btns"><a class="btn" href="' + maps(H.nombre + ' ' + H.direccion) + '" target="_blank" rel="noopener">' + ic('mapa', 20) + 'Cómo llegar</a>' +
      btnWa('Avisar mi horario de llegada', 'Hola, llego al hotel a las __:__. Mi nombre es ', 'claro') + '</div>';
  }

  function vWifi() {
    var w = H.wifi;
    return cabecera('02', 'Conectate en un toque', 'Wi-Fi') +
      '<section class="wifi" aria-label="Datos de la red"><p class="etq">Red</p><p class="red">' + esc(w.red) + '</p><hr>' +
      '<p class="etq">Clave</p><p class="clave">' + esc(w.clave) + '</p>' +
      '<button type="button" class="btn" data-accion="copiar-clave" style="margin-top:16px">' + ic('copiar', 20) + '<span>Copiar clave</span></button></section>' +
      '<h2 class="sub">En 3 pasos</h2><ol class="pasos">' +
      '<li><span class="n" aria-hidden="true">01</span><div><span class="t" style="margin:0;color:inherit;font-size:15px">Tocá <b style="display:inline">Copiar clave</b>.</span></div></li>' +
      '<li><span class="n" aria-hidden="true">02</span><div><span class="t" style="margin:0;color:inherit;font-size:15px;overflow-wrap:anywhere">Abrí <b style="display:inline">Ajustes › Wi-Fi</b> y elegí <b style="display:inline">' + esc(w.red) + '</b>.</span></div></li>' +
      '<li><span class="n" aria-hidden="true">03</span><div><span class="t" style="margin:0;color:inherit;font-size:15px">Pegá la clave y listo: ya tenés internet en todo el hotel.</span></div></li></ol>' +
      '<section class="qr" id="qr-wifi" hidden aria-label="Código QR del Wi-Fi"><div class="img" id="qr-img" role="img" aria-label="Código QR para conectarse al Wi-Fi"></div><div><h2>¿Viene alguien con vos?</h2><p>Que escanee este código con la cámara: se conecta solo, sin escribir la clave.</p></div></section>' +
      '<div class="box azul"><p>¿No conecta?</p><p>Apagá y prendé el Wi-Fi del celular, o tocá «Olvidar esta red» y volvé a intentar. Si sigue sin andar, escribinos y lo resolvemos.</p>' +
      btnWaMini('Pedir ayuda', 'Hola, no logro conectarme al Wi-Fi.') + '</div>';
  }

  function vHabitacion() {
    return cabecera('03', 'Cómo funciona todo', 'Tu habitación', 'Lo básico para que te sientas en casa desde el primer minuto.') +
      itemsIcono(D.habitacion) +
      '<div class="btns">' + btnWa('Pedir algo para la habitación', 'Hola, necesito en mi habitación: ', '') + '</div>';
  }

  function vInstalaciones() {
    var cards = D.instalaciones.map(function (f) {
      var e = estado(f);
      var h = f.siempre ? f.lugar + ' · las 24 h' : f.lugar + ' · ' + hora(f.abre) + ' a ' + hora(f.cierra);
      return '<article class="cardi"><div class="cab"><span class="ico">' + ic(f.icono, 20) + '</span><h2>' + esc(f.nombre) + '</h2><span class="chip ' + e.cls + '">' + esc(e.txt) + '</span></div>' +
        '<p class="lugar" style="color:inherit">' + esc(h) + '</p><p>' + esc(f.nota) + '</p></article>';
    }).join('');
    var reserva = D.instalaciones.filter(function (f) { return f.reservar; })[0];
    return cabecera('04', 'Horarios y uso', 'Instalaciones') + cards +
      (reserva ? '<div class="btns">' + btnWa('Reservar turno en el spa', reserva.reservar, '') + '</div>' : '') +
      '<p class="lead" style="font:400 13px/1.5 var(--sans);text-align:center;margin-top:12px">' + esc(D.instalacionesNota) + '</p>';
  }

  function vNormas() {
    var l = D.normas.map(function (n, i) {
      var num = (i + 1 < 10 ? '0' : '') + (i + 1);
      return '<li><span class="n" aria-hidden="true">' + num + '</span><div><b>' + esc(n[0]) + '</b><span class="t">' + esc(n[1]) + '</span></div></li>';
    }).join('');
    return cabecera('05', 'Para convivir bien', 'Normas del hotel', 'Pocas, claras y pensadas para que todos descansen.') +
      '<ol class="pasos" style="margin-top:10px">' + l + '</ol>' +
      '<div class="box azul"><p>¿Algo no funciona?</p><p>Avisanos y lo arreglamos rápido, a cualquier hora.</p>' + btnWaMini('Avisar a recepción', 'Hola, quiero avisar que ') + '</div>';
  }

  function vComer() {
    var C = D.comer;
    var chips = C.categorias.map(function (c) {
      return '<button type="button" data-cat="' + c.id + '" aria-pressed="' + (c.id === comerCat) + '">' + esc(c.nombre) + '</button>';
    }).join('');
    var lugares = C.lugares.filter(function (l) { return l.cat === comerCat; }).map(function (l) {
      return '<article class="cardi"><div class="cab" style="align-items:flex-start"><h2>' + esc(l.nombre) + '</h2>' + (l.favorito ? '<span class="chip fav">Nuestro favorito</span>' : '') + '</div>' +
        '<p style="font-size:13px;margin-top:6px">' + esc(l.meta) + '</p><p class="tip">' + esc(l.tip) + '</p>' + linkMaps(l.nombre + ' ' + H.ciudad) + '</article>';
    }).join('');
    return cabecera('06', 'Cerca del hotel', 'Dónde comer') +
      '<p class="note"><strong>' + esc(C.desayunoHotel.split(':')[0]) + ':</strong>' + esc(C.desayunoHotel.slice(C.desayunoHotel.indexOf(':') + 1)) + '</p>' +
      '<div class="chips" role="group" aria-label="Filtrar lugares">' + chips + '</div>' + lugares +
      '<div class="btns"><a class="btn claro" href="' + esc(H.mapaRecomendados) + '" target="_blank" rel="noopener">' + ic('mapa', 20) + 'Ver todos en el mapa</a></div>';
  }

  function vHacer() {
    var l = D.hacer.map(function (x) {
      return '<article class="cardi hacer"><span class="ico">' + ic(x.icono, 22) + '</span><div style="flex:1;min-width:0"><p class="tipo">' + esc(x.tipo) + '</p>' +
        '<h2 style="margin:3px 0 0;font-size:20px">' + esc(x.nombre) + '</h2><p style="font-size:13px">' + esc(x.dist) + '</p>' +
        '<p style="color:var(--texto);margin-top:8px">' + esc(x.texto) + '</p><div class="pie-card"><span class="chip">' + esc(x.ideal) + '</span>' + linkMaps(x.nombre + ' ' + H.ciudad, 'Ver en Maps') + '</div></div></article>';
    }).join('');
    return cabecera('07', 'Para disfrutar', 'Qué hacer', 'Nuestros favoritos, a pie o a pocos minutos.') +
      '<div class="btns"><a class="btn" href="' + esc(H.mapaRecomendados) + '" target="_blank" rel="noopener">' + ic('mapa', 20) + 'Ver todo en el mapa</a></div>' +
      '<div style="margin-top:6px">' + l + '</div>' +
      '<div class="box azul"><p>¿Querés una excursión?</p><p>Te ayudamos a reservar paseos y traslados desde recepción.</p>' + btnWaMini('Consultar por WhatsApp', 'Hola, quiero consultar por excursiones.') + '</div>';
  }

  function vCompras() {
    var l = D.compras.map(function (x) {
      return '<li class="lugares"><span class="ico">' + ic(x[0], 20) + '</span><div><h2>' + esc(x[1]) + '</h2><p>' + esc(x[2]) + '</p></div>' +
        '<a class="pin" href="' + maps(x[1] + ' ' + H.ciudad) + '" target="_blank" rel="noopener" aria-label="Ver ' + esc(x[1]) + ' en Google Maps">' + ic('pin', 18, 1.8) + '</a></li>';
    }).join('');
    return cabecera('08', 'Lo que necesites', 'Compras y servicios') +
      '<ul class="lista" style="margin-top:10px">' + l + '</ul>' +
      '<div class="box"><p>¿Necesitás un taxi o remís?</p><p>Te lo pedimos desde recepción en minutos.</p>' + btnWaMini('Pedir un taxi', 'Hola, necesito un taxi para las __:__.', '') + '</div>';
  }

  function vEmergencias() {
    var E = D.emergencias;
    var pub = E.publicos.map(function (n) {
      return '<a class="tel" href="' + tel(n.numero) + '" aria-label="Llamar al ' + n.numero + ', ' + esc(n.nombre) + '"><span class="num">' + n.numero + '</span><span class="nom">' + esc(n.nombre) + '</span>' + ic('tel', 20) + '</a>';
    }).join('');
    var inte = E.internos.map(function (n) {
      return '<a class="tel interno" href="' + tel(n.tel) + '" aria-label="Llamar a ' + esc(n.nombre) + ', interno ' + n.interno + '"><span class="int"><small>Interno</small><b>' + n.interno + '</b></span><span class="nom"><b>' + esc(n.nombre) + '</b><span>' + esc(n.detalle) + '</span></span>' + ic('tel', 20) + '</a>';
    }).join('');
    return cabecera('09', 'Tocá para llamar', 'Emergencias') +
      '<div style="margin-top:14px">' + pub + '</div>' +
      '<p class="tit-sec">Del hotel · las 24 h</p>' + inte +
      '<div class="btns"><a class="btn terra" href="' + tel(H.telefonoRecepcion) + '">' + ic('tel', 20, 1.7) + 'Llamar a recepción</a>' +
      btnWa('Escribir por WhatsApp', 'Hola, necesito ayuda urgente.', 'claro') + '</div>' +
      '<div class="datos"><div class="dato">' + ic('hospital', 22) + '<div><b>Hospital más cercano</b><p>' + esc(E.hospital.nombre) + ' · a ' + esc(E.hospital.distancia) + '. Guardia las 24 h.</p>' +
      linkMaps(E.hospital.consulta, 'Cómo llegar') + '</div></div>' +
      '<div class="dato">' + ic('salida', 22) + '<div><b>Si hay que evacuar</b><p>' + esc(E.evacuacion) + '</p></div></div></div>';
  }

  function vPreguntas() {
    var l = D.preguntas.map(function (q, i) {
      return '<details' + (i === 0 ? ' open' : '') + '><summary>' + esc(q[0]) + '</summary><p>' + esc(q[1]) + '</p></details>';
    }).join('');
    return cabecera('10', 'Respuestas rápidas', 'Preguntas frecuentes') +
      '<div class="faq">' + l + '</div>' +
      '<div class="box"><p>¿No encontraste tu respuesta?</p><p>Escribinos: respondemos en minutos, las 24 h.</p>' + btnWaMini('Escribinos por WhatsApp', 'Hola, tengo una consulta: ') + '</div>';
  }

  var KEY = 'chipre-checkout';
  function leerChecks() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; }
  }
  function guardarChecks(a) {
    try { localStorage.setItem(KEY, JSON.stringify(a)); } catch (e) { /* sin almacenamiento: sigue funcionando */ }
  }
  function textoProgreso(a) {
    var n = D.checkout.lista.filter(function (_, i) { return a[i]; }).length;
    return n === D.checkout.lista.length ? '¡Todo listo!' : n + ' de ' + D.checkout.lista.length + ' listos';
  }
  function vCheckout() {
    var C = D.checkout, a = leerChecks();
    var l = C.lista.map(function (t, i) {
      return '<li><label><input type="checkbox" data-check="' + i + '"' + (a[i] ? ' checked' : '') + '><span>' + esc(t) + '</span></label></li>';
    }).join('');
    return cabecera('11', 'Antes de irte', 'Check-out') +
      '<section class="big" aria-label="Horario de check-out"><div><p>Dejá la habitación hasta las</p><p class="hora">' + esc(H.horarios.checkout) + '</p></div><p class="al">Late check-out hasta las ' + hora(H.horarios.lateCheckout) + ', según disponibilidad</p></section>' +
      '<div class="head-row"><h2>Antes de salir</h2><p class="progreso" id="progreso" aria-live="polite">' + textoProgreso(a) + '</p></div>' +
      '<ul class="lista check">' + l + '</ul>' + datos(C.datos) +
      '<div class="btns">' + btnWa('Pedir late check-out', 'Hola, quisiera pedir late check-out hasta las ' + H.horarios.lateCheckout + '. Habitación: ', '') +
      btnWa('Pedir un taxi', 'Hola, necesito un taxi para las __:__.', 'claro') + '</div>' +
      '<div class="gracias"><p>¡Gracias por elegirnos!</p><a class="maps" href="#/resena">Dejanos tu reseña ' + ic('ext', 16, 2) + '</a></div>';
  }

  function vResena() {
    var R = D.resena;
    var est = '';
    for (var i = 0; i < 5; i++) est += '<svg width="26" height="26" viewBox="0 0 24 24" fill="#EFC374" stroke="#B98A35" stroke-width="1.2" stroke-linejoin="round" aria-hidden="true">' + P.estrella + '</svg>';
    function fila(txt, url, cls) {
      return '<a class="btn fila ' + (cls || '') + '" href="' + esc(url) + '" target="_blank" rel="noopener"><span>' + esc(txt) + '</span>' + ic('ext', 18, 2) + '</a>';
    }
    return cabecera('12', 'Tu opinión', '¿Cómo fue tu estadía?') +
      '<p style="margin:12px 0 0;font-size:15px;line-height:1.5">Tu reseña ayuda a otros viajeros a elegirnos y a nosotros a mejorar. Te lleva un minuto.</p>' +
      '<div class="estrellas" aria-hidden="true">' + est + '</div>' +
      '<div class="btns">' + fila('Dejar reseña en Google', R.google) + fila('Opinar en Booking', R.booking, 'claro') + fila('Opinar en TripAdvisor', R.tripadvisor, 'claro') + '</div>' +
      '<div class="box azul" style="margin-top:22px"><p>¿Algo para mejorar?</p><p>Contanos en privado: lo leemos todos los días y lo resolvemos.</p>' + btnWaMini('Escribinos por WhatsApp', 'Hola, quiero contarles cómo fue mi estadía: ') + '</div>' +
      '<p class="cierre">Gracias por hospedarte con nosotros. ¡Volvé cuando quieras!</p>';
  }

  /* ---------- QR del Wi-Fi (opcional: necesita la librería) ---------- */
  function dibujarQr() {
    var cont = document.getElementById('qr-img'), sec = document.getElementById('qr-wifi');
    if (!cont || typeof window.qrcode !== 'function') return;
    try {
      var w = H.wifi.red.replace(/([\;,":])/g, '\\$1'), p = H.wifi.clave.replace(/([\;,":])/g, '\\$1');
      var q = window.qrcode(0, 'M');
      q.addData('WIFI:T:WPA;S:' + w + ';P:' + p + ';;');
      q.make();
      cont.innerHTML = q.createSvgTag({ scalable: true, margin: 0 });
      sec.hidden = false;
    } catch (e) { /* si falla, la sección queda oculta */ }
  }
  function cargarQr() {
    if (typeof window.qrcode === 'function') { dibujarQr(); return; }
    if (document.getElementById('lib-qr')) return;
    var s = document.createElement('script');
    s.id = 'lib-qr';
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
    s.onload = dibujarQr;
    document.head.appendChild(s);
  }

  /* ---------- navegación ---------- */
  function ruta() {
    return location.hash.replace(/^#\/?/, '').split('?')[0];
  }
  function mostrar() {
    var id = ruta();
    var s = SECCIONES.filter(function (x) { return x.id === id; })[0];
    app.className = 'card' + (s && s.oscuro ? ' oscuro' : '');
    app.innerHTML = s ? s.render() : vMenu();
    document.title = (s ? s.titulo + ' · ' : 'Guía del huésped · ') + H.nombre;
    if (s && s.id === 'wifi') cargarQr();
    window.scrollTo(0, 0);
    app.focus({ preventScroll: true });
  }

  function copiar(texto) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(texto);
    }
    return new Promise(function (ok, no) {
      var t = document.createElement('textarea');
      t.value = texto; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      try { document.execCommand('copy') ? ok() : no(); } catch (e) { no(e); }
      document.body.removeChild(t);
    });
  }

  app.addEventListener('click', function (e) {
    var b = e.target.closest('[data-accion],[data-cat]');
    if (!b) return;
    if (b.dataset.cat) { comerCat = b.dataset.cat; mostrar(); return; }
    if (b.dataset.accion === 'copiar-clave') {
      copiar(H.wifi.clave).then(function () { toast('¡Clave copiada!'); }, function () { toast('No se pudo copiar. La clave es ' + H.wifi.clave); });
    }
  });
  app.addEventListener('change', function (e) {
    var i = e.target.getAttribute && e.target.getAttribute('data-check');
    if (i === null || i === undefined) return;
    var a = leerChecks();
    a[+i] = e.target.checked;
    guardarChecks(a);
    var p = document.getElementById('progreso');
    if (p) p.textContent = textoProgreso(a);
  });

  pie.textContent = H.nombre + ' · Recepción abierta las 24 h';
  window.addEventListener('hashchange', mostrar);
  mostrar();
})();
