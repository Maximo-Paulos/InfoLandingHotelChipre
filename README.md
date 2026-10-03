# Guía digital del huésped · Hotel Chipre

Landing para celular: el huésped escanea un QR (o recibe el link por WhatsApp) y tiene a mano check-in, Wi-Fi, emergencias, normas, preguntas frecuentes, dónde comer y qué hacer cerca. Sitio estático, sin build ni dependencias.

## Probarlo en local
```
python3 -m http.server 8000
```
Abrí http://localhost:8000. Cada pantalla tiene su link directo, útil para los QR: `/#/wifi`, `/#/emergencias`, `/#/checkin`, `/#/checkout`, etc. (ids: `checkin wifi habitacion instalaciones normas comer hacer compras emergencias preguntas checkout resena`).

## Cambiar la información
Todo el contenido está en [`data/hotel.js`](data/hotel.js): nombre, horarios, Wi-Fi, teléfonos, WhatsApp, normas, preguntas, lugares y links de reseñas. Los textos entre `[corchetes]` y los `XXXX` son datos de ejemplo por completar. No hace falta tocar el diseño.

Más adelante ese objeto puede venir de una base de datos (por ejemplo Supabase) sin cambiar las pantallas.

## Estructura
- `index.html`: página única.
- `css/styles.css`: paleta (salvia, hueso, terracota, mostaza, verde) y componentes.
- `js/app.js`: arma cada pantalla desde los datos; navegación por hash.
- `data/hotel.js`: contenido.

## Detalles
- Teléfonos con `tel:`, WhatsApp con `wa.me` y mensaje armado, lugares con búsqueda en Google Maps.
- Wi-Fi: "Copiar clave" y, si carga la librería de QR (necesita internet móvil), un QR para conectar un segundo celular. Una web no puede conectar el celular por sí sola.
- "Abierto ahora" se calcula con la zona horaria del hotel (`zonaHoraria`).
- La lista del check-out se guarda en el celular del huésped.

## Publicar
Cualquier hosting estático sirve (Vercel, Netlify, GitHub Pages): apuntar a la raíz del repo.
