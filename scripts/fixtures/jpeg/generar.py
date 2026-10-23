# Genera las fotos de prueba de test-jpeg-reducido.mjs (ya están generadas y guardadas en esta carpeta; esto es para poder rehacerlas).
# Son chicas (400x300): el decodificador se prueba ahí con distintas escalas. Las fotos grandes de celular se arman en la propia prueba.
# Son imágenes con degradés, formas y texto (parecen la foto de un documento) en las variantes que usan las cámaras y los editores:
# distintos formatos de color (4:4:4, 4:2:2, 4:2:0, gris), tablas de Huffman estándar y optimizadas, marcadores de reinicio, tamaños que no son múltiplos de 8, orientación EXIF,
# y los tipos que el decodificador liviano NO entiende (progresivo, CMYK) para comprobar que se usa el camino normal del navegador.
#   Requiere Pillow:  python3 -m venv /tmp/v && /tmp/v/bin/pip install pillow && /tmp/v/bin/python generar.py
import os
from PIL import Image, ImageDraw, ImageFont

AQUI = os.path.dirname(os.path.abspath(__file__))

def escena(w, h, gris=False):
    im = Image.new('RGB', (w, h))
    px = im.load()
    for y in range(h):
        for x in range(w):
            px[x, y] = (int(80 + 150 * x / max(1, w - 1)), int(60 + 160 * y / max(1, h - 1)), int(200 - 120 * (x + y) / max(1, w + h - 2)))
    d = ImageDraw.Draw(im)
    s = max(w, h)
    d.rectangle([w * 0.1, h * 0.15, w * 0.9, h * 0.85], outline=(20, 20, 20), width=max(2, s // 200), fill=(236, 232, 220))
    d.ellipse([w * 0.14, h * 0.22, w * 0.34, h * 0.52], fill=(90, 120, 170), outline=(10, 10, 10), width=max(1, s // 300))
    f = ImageFont.load_default(size=max(10, s // 25))
    for i in range(4):
        d.text((w * 0.4, h * (0.22 + 0.13 * i)), f'DNI 30.123.45{i} PEREZ GARCIA', fill=(15, 15, 15), font=f)
    c = max(3, s // 12)
    d.rectangle([0, 0, c, c], fill=(255, 0, 0))                    # arriba-izquierda: rojo
    d.rectangle([w - c, 0, w, c], fill=(0, 200, 0))                # arriba-derecha: verde
    d.rectangle([0, h - c, c, h], fill=(0, 0, 255))                # abajo-izquierda: azul
    d.rectangle([w - c, h - c, w, h], fill=(255, 220, 0))          # abajo-derecha: amarillo
    return im.convert('L') if gris else im

def exif(o):
    e = Image.Exif()
    e[0x0112] = o
    return e.tobytes()

def guardar(nombre, im, **kw):
    im.save(os.path.join(AQUI, nombre + '.jpg'), 'JPEG', **kw)

chica = escena(400, 300)
guardar('420', chica, subsampling=2, quality=85)
guardar('422', chica, subsampling=1, quality=85)
guardar('444', chica, subsampling=0, quality=85)
guardar('gris', escena(400, 300, gris=True), quality=85)
guardar('optimizado', chica, subsampling=2, quality=85, optimize=True)                 # tablas de Huffman propias de la foto (las otras usan las estándar)
guardar('reinicio-bloques-420', chica, subsampling=2, quality=85, restart_marker_blocks=4)
guardar('reinicio-filas-444', chica, subsampling=0, quality=85, restart_marker_rows=1)
guardar('impar-401x299-422-reinicio', escena(401, 299), subsampling=1, quality=85, restart_marker_blocks=5)
guardar('orientacion-6', chica, subsampling=2, quality=85, exif=exif(6))
guardar('progresivo', chica, progressive=True, quality=85)
guardar('cmyk', chica.convert('CMYK'), quality=85)
guardar('mini-17x9', escena(17, 9), subsampling=2, quality=85)
