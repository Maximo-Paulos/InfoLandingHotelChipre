// Achica la foto del documento en el celular antes de mandarla:
//   - máximo 1600 px de lado y formato JPEG (unos 200-400 KB)
//   - al volver a dibujarla se pierden los datos ocultos (ubicación, modelo del celular)
export const MAX_BYTES = 900 * 1024;

async function abrir(archivo) {
  if (typeof createImageBitmap === 'function') {
    try { return { fuente: await createImageBitmap(archivo, { imageOrientation: 'from-image' }), liberar: () => {} }; } catch { /* sigue con <img> */ }
  }
  const url = URL.createObjectURL(archivo);
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('imagen'));
    i.src = url;
  });
  return { fuente: img, liberar: () => URL.revokeObjectURL(url) };
}

const aBlob = (canvas, calidad) => new Promise((res) => canvas.toBlob(res, 'image/jpeg', calidad));

const aBase64 = (blob) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1] ?? '');
  r.onerror = () => rej(new Error('lectura'));
  r.readAsDataURL(blob);
});

// Devuelve { base64, vista (URL para mostrar), bytes } o lanza un error con `codigo`.
export async function comprimirImagen(archivo) {
  if (!archivo || !String(archivo.type).startsWith('image/')) throw Object.assign(new Error('tipo'), { codigo: 'tipo' });
  const { fuente, liberar } = await abrir(archivo).catch(() => { throw Object.assign(new Error('imagen'), { codigo: 'imagen' }); });
  try {
    const ancho0 = fuente.width || fuente.naturalWidth;
    const alto0 = fuente.height || fuente.naturalHeight;
    if (!ancho0 || !alto0) throw Object.assign(new Error('imagen'), { codigo: 'imagen' });
    for (const [lado, calidad] of [[1600, 0.78], [1400, 0.68], [1200, 0.6], [1000, 0.55]]) {
      const escala = Math.min(1, lado / Math.max(ancho0, alto0));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(ancho0 * escala));
      canvas.height = Math.max(1, Math.round(alto0 * escala));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(fuente, 0, 0, canvas.width, canvas.height);
      const blob = await aBlob(canvas, calidad);
      if (blob && blob.size <= MAX_BYTES) {
        return { base64: await aBase64(blob), vista: URL.createObjectURL(blob), bytes: blob.size };
      }
    }
    throw Object.assign(new Error('pesada'), { codigo: 'pesada' });
  } finally {
    liberar();
    fuente.close?.();
  }
}
