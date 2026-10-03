# Guía digital del huésped · Hotel Chipre

Landing para celular: el huésped escanea un QR (o recibe el link por WhatsApp) y tiene a mano check-in, Wi-Fi, emergencias, normas, preguntas frecuentes, dónde comer y qué hacer cerca. Se compila a archivos estáticos.

## Probarlo en local
React + Vite. Necesita Node 20 o superior.
```
npm install
npm run dev
```
Abrí la dirección que muestra (http://localhost:5173). Cada pantalla tiene su link directo, útil para los QR: `/#/wifi`, `/#/emergencias`, `/#/checkin`, `/#/checkout`, etc. (ids: `checkin wifi habitacion instalaciones normas comer hacer compras emergencias preguntas checkout resena`).

## Cambiar la información
Todo el contenido está en [`src/data/hotel.js`](src/data/hotel.js): nombre, horarios, Wi-Fi, teléfonos, WhatsApp, normas, preguntas, lugares y links de reseñas. Los textos entre `[corchetes]` y los `XXXX` son datos de ejemplo por completar. No hace falta tocar el diseño.

Más adelante ese objeto puede venir de una base de datos (por ejemplo Supabase) sin cambiar las pantallas.

## Estructura
- `index.html`: página única.
- `src/App.jsx`: navegación por hash y lista de secciones.
- `src/Menu.jsx`: menú de 12 botones.
- `src/sections/`: las 12 pantallas (`Esenciales`, `Estadia`, `Alrededores`).
- `src/components/`: íconos y piezas comunes.
- `src/styles.css`: paleta (salvia, hueso, terracota, mostaza, verde) y componentes.
- `src/data/hotel.js`: contenido.

## Detalles
- Teléfonos con `tel:`, WhatsApp con `wa.me` y mensaje armado, lugares con búsqueda en Google Maps.
- Wi-Fi: "Copiar clave" y, un QR (generado en el propio sitio, sin internet extra) para conectar un segundo celular. Una web no puede conectar el celular por sí sola.
- "Abierto ahora" se calcula con la zona horaria del hotel (`zonaHoraria`).
- La lista del check-out se guarda en el celular del huésped.

## Publicar
`npm run build` genera la carpeta `dist/`. Sirve cualquier hosting estático (Vercel, Netlify, GitHub Pages): comando de build `npm run build`, carpeta de salida `dist`.
