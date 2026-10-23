// Ayudas para probar las fotos de los documentos (las usan test-jpeg-reducido.mjs y la prueba de punta a punta).

// Le agrega a un JPEG el dato EXIF de orientación, como lo hace el celular cuando se saca la foto de costado o dado vuelta (1 a 8).
export function conOrientacion(jpeg, o) {
  const tiff = Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, o, 0, 0, 0, 0, 0, 0]);
  const exif = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const seg = Buffer.concat([Buffer.from([0xff, 0xe1, (exif.length + 2) >> 8, (exif.length + 2) & 255]), exif]);
  return Buffer.concat([jpeg.subarray(0, 2), seg, jpeg.subarray(2)]);
}

// Una foto "de celular" armada en el navegador de `page` (así no hace falta guardar fotos pesadas en el repositorio): un degradé con
// un recuadro y un texto, como un documento, y un cuadrado de color en cada esquina (arriba-izquierda rojo, arriba-derecha verde,
// abajo-izquierda azul, abajo-derecha amarillo) para comprobar si quedó derecha. Devuelve el JPEG como Buffer.
export async function jpegGrande(page, w, h, calidad = 0.85) {
  const b64 = await page.evaluate(async ({ w, h, calidad }) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#6aa0c8'); g.addColorStop(1, '#d6a070');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.fillStyle = '#ece8dc'; x.fillRect(w * 0.1, h * 0.15, w * 0.8, h * 0.7);
    x.fillStyle = '#222'; x.font = `${Math.round(h / 12)}px sans-serif`; x.fillText('DNI 30.123.456 PEREZ GARCIA', w * 0.14, h * 0.5);
    const s = Math.round(Math.min(w, h) * 0.12);
    x.fillStyle = '#ff0000'; x.fillRect(0, 0, s, s);
    x.fillStyle = '#00c800'; x.fillRect(w - s, 0, s, s);
    x.fillStyle = '#0000ff'; x.fillRect(0, h - s, s, s);
    x.fillStyle = '#ffdc00'; x.fillRect(w - s, h - s, s, s);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', calidad));
    const bin = new Uint8Array(await blob.arrayBuffer());
    let t = ''; for (let i = 0; i < bin.length; i += 0x8000) t += String.fromCharCode.apply(null, bin.subarray(i, i + 0x8000));
    c.width = 0; c.height = 0;
    return btoa(t);
  }, { w, h, calidad });
  return Buffer.from(b64, 'base64');
}

// Nombre del color (rojo, verde, azul o amarillo) de un píxel [r, g, b] de esas esquinas.
export const nombreColor = ([r, g, b]) => (r > 170 && g < 100 && b < 100 ? 'rojo' : g > 140 && r < 100 && b < 100 ? 'verde' : b > 170 && r < 100 && g < 100 ? 'azul' : r > 170 && g > 150 && b < 110 ? 'amarillo' : `?(${r},${g},${b})`);

// Dónde queda cada esquina de la foto original (arriba-izquierda roja, arriba-derecha verde, abajo-izquierda azul, abajo-derecha amarilla)
// según la orientación EXIF, sacado a mano de la definición del estándar: 2 espejo horizontal · 3 giro de 180° · 4 espejo vertical ·
// 5 traspuesta · 6 giro de 90° a la derecha · 7 traspuesta invertida · 8 giro de 90° a la izquierda.
export const ESQUINAS_EXIF = {
  1: { TL: 'rojo', TR: 'verde', BL: 'azul', BR: 'amarillo' },
  2: { TL: 'verde', TR: 'rojo', BL: 'amarillo', BR: 'azul' },
  3: { TL: 'amarillo', TR: 'azul', BL: 'verde', BR: 'rojo' },
  4: { TL: 'azul', TR: 'amarillo', BL: 'rojo', BR: 'verde' },
  5: { TL: 'rojo', TR: 'azul', BL: 'verde', BR: 'amarillo' },
  6: { TL: 'azul', TR: 'rojo', BL: 'amarillo', BR: 'verde' },
  7: { TL: 'amarillo', TR: 'verde', BL: 'azul', BR: 'rojo' },
  8: { TL: 'verde', TR: 'amarillo', BL: 'rojo', BR: 'azul' },
};

// Lee, en el navegador de `page`, el color de las 4 esquinas de una imagen (una URL de `blob:` o de datos).
export function esquinasDe(page, url) {
  return page.evaluate(async (src) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src; });
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const w = c.width; const h = c.height; const i = 0.04;
    const mu = (px, py) => Array.from(x.getImageData(Math.round(px), Math.round(py), 1, 1).data.subarray(0, 3));
    return { w, h, rgb: { TL: mu(w * i, h * i), TR: mu(w * (1 - i), h * i), BL: mu(w * i, h * (1 - i)), BR: mu(w * (1 - i), h * (1 - i)) } };
  }, url).then((r) => ({ w: r.w, h: r.h, esq: { TL: nombreColor(r.rgb.TL), TR: nombreColor(r.rgb.TR), BL: nombreColor(r.rgb.BL), BR: nombreColor(r.rgb.BR) } }));
}
