// Achica la foto del documento en el celular antes de mandarla:
//   - máximo 1600 px de lado y formato JPEG (unos 200-400 KB)
//   - al volver a dibujarla se pierden los datos ocultos (ubicación, modelo del celular)
//   - con POCA MEMORIA: una foto de cámara reconstruida entera ocupa 4 bytes por píxel (12 MP ~50 MB, 50 MP ~200 MB, 108 MP ~430 MB)
//     y en un celular con poca memoria el sistema cierra la página ("memoria insuficiente") y el huésped vuelve a empezar. Por eso los
//     JPEG grandes se decodifican directamente ya achicados, derechos y en su tamaño final (jpegReducido.js), sin armar nunca la foto entera,
//     y la memoria se devuelve apenas deja de hacer falta. Solo lo que no es un JPEG común pasa por el navegador.
import { decodificarFinal, infoJpeg, kParaAchicar, liberar } from './jpegReducido.js';

export const MAX_BYTES = 900 * 1024;
const NIVELES = [[1600, 0.78], [1400, 0.68], [1200, 0.6], [1000, 0.55]]; // [lado máximo, calidad]: se baja de a poco hasta que entre en MAX_BYTES
const MAX_PIXELES = 250e6; // ninguna cámara llega a tanto: se rechaza sin intentar abrirla
const MAX_ARCHIVO = 120 * 1024 * 1024;
const CABECERA = 512 * 1024; // alcanza para encontrar las medidas de casi cualquier JPEG; si no, se lee más (ver cabeceraDe)

const falla = (codigo) => Object.assign(new Error(codigo), { codigo });

const leerBytes = (blob) => (blob.arrayBuffer ? blob.arrayBuffer() : new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = () => rej(new Error('lectura'));
  r.readAsArrayBuffer(blob);
}));

// Medidas y orientación del JPEG sin abrirlo. Algunos celulares (los que guardan el mapa de profundidad del modo retrato, por ejemplo)
// ponen muchísimos datos ocultos antes de la foto: si en los primeros 512 KB no aparecen las medidas, se prueba con 4 MB.
async function cabeceraDe(archivo) {
  const ini = new Uint8Array(await leerBytes(archivo.slice(0, CABECERA)));
  if (ini[0] !== 0xff || ini[1] !== 0xd8) return null;
  const info = infoJpeg(ini);
  if (info || archivo.size <= CABECERA) return info;
  return infoJpeg(new Uint8Array(await leerBytes(archivo.slice(0, 8 * CABECERA))));
}

// Un JPEG grande: se decodifica ya terminado (achicado, derecho y en colores). Devuelve null si no corresponde (no es JPEG, es chico, es progresivo...).
async function abrirLiviano(archivo, onProgreso) {
  const info = await cabeceraDe(archivo);
  if (!info) return null;
  if (info.ancho * info.alto > MAX_PIXELES) throw falla('pesada');
  const ladoMax = NIVELES[0][0];
  if (!kParaAchicar(info, ladoMax)) return null;
  const bytes = new Uint8Array(await leerBytes(archivo));
  const fin = await decodificarFinal(bytes, { ladoMax, onProgreso });
  liberar(bytes);
  if (!fin) return null;
  const lienzo = document.createElement('canvas');
  lienzo.width = fin.ancho;
  lienzo.height = fin.alto;
  lienzo.getContext('2d').putImageData(new ImageData(fin.rgba, fin.ancho, fin.alto), 0, 0);
  liberar(fin.rgba);
  return { fuente: lienzo, ancho: fin.ancho, alto: fin.alto, orientacion: 1, esLienzo: true, liberar: () => { lienzo.width = 0; lienzo.height = 0; } };
}

// Lo demás (PNG, JPEG progresivos o chicos...): lo abre el navegador, que ya aplica la orientación de la foto.
async function abrirNavegador(archivo) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(archivo, { imageOrientation: 'from-image' });
      return { fuente: bmp, ancho: bmp.width, alto: bmp.height, orientacion: 1, liberar: () => bmp.close?.() };
    } catch { /* sigue con <img> */ }
  }
  const url = URL.createObjectURL(archivo);
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('imagen'));
    i.src = url;
  });
  return { fuente: img, ancho: img.naturalWidth, alto: img.naturalHeight, orientacion: 1, liberar: () => URL.revokeObjectURL(url) };
}

// Dibuja la foto en `destino` con el lado largo en `lado` como máximo, enderezada según su orientación EXIF (1 a 8).
function pintar(destino, origen, lado) {
  const { fuente, ancho, alto, orientacion } = origen;
  const girado = orientacion >= 5;
  const vw = girado ? alto : ancho;
  const vh = girado ? ancho : alto;
  const esc = Math.min(1, lado / Math.max(vw, vh));
  const cw = Math.max(1, Math.round(vw * esc));
  const ch = Math.max(1, Math.round(vh * esc));
  destino.width = cw;
  destino.height = ch;
  const ctx = destino.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cw, ch);
  ctx.imageSmoothingQuality = 'high';
  switch (orientacion) {
    case 2: ctx.transform(-1, 0, 0, 1, cw, 0); break;
    case 3: ctx.transform(-1, 0, 0, -1, cw, ch); break;
    case 4: ctx.transform(1, 0, 0, -1, 0, ch); break;
    case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;
    case 6: ctx.transform(0, 1, -1, 0, cw, 0); break;
    case 7: ctx.transform(0, -1, -1, 0, cw, ch); break;
    case 8: ctx.transform(0, -1, 1, 0, 0, ch); break;
    default: break;
  }
  // con la foto girada, su ancho y su alto se intercambian al dibujarla
  ctx.drawImage(fuente, 0, 0, girado ? ch : cw, girado ? cw : ch);
}

const aBlob = (canvas, calidad) => new Promise((res) => canvas.toBlob(res, 'image/jpeg', calidad));

const aBase64 = (blob) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1] ?? '');
  r.onerror = () => rej(new Error('lectura'));
  r.readAsDataURL(blob);
});

// Codifica la foto en JPEG de a niveles hasta que entre en MAX_BYTES. Devuelve { base64, vista (URL para mostrar), bytes } o lanza 'pesada'.
async function codificar(origen) {
  // un solo lienzo de salida que se reutiliza en cada intento, y se libera al terminar (en algunos celulares la memoria de los lienzos no se devuelve sola)
  const destino = document.createElement('canvas');
  try {
    for (const [lado, calidad] of NIVELES) {
      const girado = origen.orientacion >= 5;
      const vw = girado ? origen.alto : origen.ancho;
      const vh = girado ? origen.ancho : origen.alto;
      let salida = origen.fuente;
      // si la foto ya está del tamaño que toca, se codifica el mismo lienzo: no se arma otra copia
      if (!(origen.esLienzo && origen.orientacion === 1 && Math.min(1, lado / Math.max(vw, vh)) === 1)) {
        pintar(destino, origen, lado);
        salida = destino;
      }
      const blob = await aBlob(salida, calidad);
      if (blob && blob.size <= MAX_BYTES) {
        return { base64: await aBase64(blob), vista: URL.createObjectURL(blob), bytes: blob.size };
      }
    }
    throw falla('pesada');
  } finally {
    destino.width = 0;
    destino.height = 0;
    origen.liberar();
  }
}

// Devuelve { base64, vista (URL para mostrar), bytes } o lanza un error con `codigo` ('tipo', 'imagen' o 'pesada').
// onProgreso(0 a 1): se avisa cada tanto mientras se prepara una foto grande.
export async function comprimirImagen(archivo, { onProgreso } = {}) {
  if (!archivo || !String(archivo.type).startsWith('image/')) throw falla('tipo');
  if (archivo.size > MAX_ARCHIVO) throw falla('pesada');
  let origen = null;
  try {
    origen = await abrirLiviano(archivo, onProgreso);
  } catch (e) {
    if (e.codigo) throw e;
  }
  if (!origen) {
    origen = await abrirNavegador(archivo).catch(() => { throw falla('imagen'); });
    if (!origen.ancho || !origen.alto) { origen.liberar(); throw falla('imagen'); }
    if (origen.ancho * origen.alto > MAX_PIXELES) { origen.liberar(); throw falla('pesada'); }
  }
  return codificar(origen);
}

// Lo mismo para una foto que ya está en un lienzo (la cámara de la página): el lienzo pasa a ser de esta función, que lo libera al terminar.
export async function comprimirCanvas(lienzo) {
  if (!lienzo?.width || !lienzo?.height) throw falla('imagen');
  return codificar({ fuente: lienzo, ancho: lienzo.width, alto: lienzo.height, orientacion: 1, esLienzo: true, liberar: () => { lienzo.width = 0; lienzo.height = 0; } });
}
