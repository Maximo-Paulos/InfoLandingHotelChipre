# Genera la "cámara de prueba" de la prueba de punta a punta (ya está generada y guardada en esta carpeta; esto es para poder rehacerla).
# Chromium puede usar un archivo .mjpeg (fotogramas JPEG uno atrás del otro) como si fuera lo que ve la cámara:
#   chromium --use-fake-device-for-media-stream --use-fake-ui-for-media-stream --use-file-for-fake-video-capture=documento.mjpeg
# La escena parece un documento sobre una mesa y tiene un cuadrado de color en cada esquina (arriba-izquierda rojo, arriba-derecha verde,
# abajo-izquierda azul, abajo-derecha amarillo) para comprobar que la foto sale derecha y sin espejo.
#   Requiere Pillow:  python3 -m venv /tmp/v && /tmp/v/bin/pip install pillow && /tmp/v/bin/python generar.py
import io
import os
from PIL import Image, ImageDraw, ImageFont

AQUI = os.path.dirname(os.path.abspath(__file__))
W, H = 1280, 720

def escena():
    im = Image.new('RGB', (W, H))
    px = im.load()
    for y in range(H):
        for x in range(W):
            px[x, y] = (int(80 + 150 * x / (W - 1)), int(60 + 160 * y / (H - 1)), int(200 - 120 * (x + y) / (W + H - 2)))
    d = ImageDraw.Draw(im)
    d.rectangle([W * 0.1, H * 0.15, W * 0.9, H * 0.85], outline=(20, 20, 20), width=6, fill=(236, 232, 220))
    d.ellipse([W * 0.14, H * 0.22, W * 0.34, H * 0.52], fill=(90, 120, 170), outline=(10, 10, 10), width=3)
    f = ImageFont.load_default(size=40)
    for i in range(4):
        d.text((W * 0.4, H * (0.22 + 0.13 * i)), f'DNI 30.123.45{i} PEREZ GARCIA', fill=(15, 15, 15), font=f)
    c = 90
    d.rectangle([0, 0, c, c], fill=(255, 0, 0))
    d.rectangle([W - c, 0, W, c], fill=(0, 200, 0))
    d.rectangle([0, H - c, c, H], fill=(0, 0, 255))
    d.rectangle([W - c, H - c, W, H], fill=(255, 220, 0))
    return im

buf = io.BytesIO()
escena().save(buf, 'JPEG', quality=85, subsampling=2)
with open(os.path.join(AQUI, 'documento.mjpeg'), 'wb') as f:
    for _ in range(3):
        f.write(buf.getvalue())
