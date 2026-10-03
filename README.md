# Guía digital del huésped · Hotel Chipre

Landing para celular: el huésped escanea un QR (o recibe el link por WhatsApp) y tiene a mano check-in, Wi-Fi, emergencias, normas, preguntas frecuentes, dónde comer y qué hacer cerca.

Todo el contenido vive en una base de datos **SQLite**. El dueño lo edita desde un **panel** que es un clon de la guía, con una caja debajo de cada texto; lo que guarda se ve enseguida en la guía de los huéspedes.

```
Huésped → guía (React) → API → SQLite ← API ← panel del dueño (#/admin)
```

## Probarlo en local
Necesita Node 22 o superior.
```
npm install
npm run server     # base de datos + API en http://localhost:3001
npm run dev        # guía en http://localhost:5173 (en otra terminal)
```
- Guía de los huéspedes: http://localhost:5173/
- Panel del dueño: http://localhost:5173/#/admin (en desarrollo la clave es `admin`)

La base se crea sola en `server/data/guia.db` con el contenido de ejemplo de `src/data/hotel.js`. Esa carpeta no se sube a git.

## Cómo edita el dueño
1. Entrar a `/#/admin` con la clave.
2. Navegar la guía como lo haría un huésped. Debajo de cada texto, botón, teléfono o link hay una caja para cambiarlo, y el cambio se ve al instante.
3. En las listas (pasos, normas, preguntas, lugares, teléfonos…) hay botones **Agregar** y **Quitar**.
4. Los datos que no se ven como texto (WhatsApp, teléfonos, link del mapa, Wi-Fi, horarios, links de reseñas) están en **Datos generales**, el último botón del menú.
5. **Guardar cambios** los manda a la base de datos. Si algo sale mal, **Descartar** vuelve a lo último guardado. La base guarda las últimas 20 versiones.

Los íconos y la estructura de cada pantalla no se editan desde el panel.

## Publicarlo
```
npm run build
ADMIN_PASSWORD="una-clave-larga" npm start
```
`npm start` sirve la guía compilada y la API en un solo proceso (puerto 3001, o el de la variable `PORT`).

- Sin `ADMIN_PASSWORD` el panel queda deshabilitado en producción.
- La base es un archivo (`DB_PATH` para cambiar su ubicación), así que el servidor necesita **disco persistente**: Railway, Render, Fly.io o un VPS. En Vercel las funciones no conservan archivos y lo que guarde el dueño se perdería; para publicar ahí hay que cambiar `server/db.js` por una base en la nube (Supabase, Turso). La API y las pantallas no cambian.
- Hacé copia de seguridad de `guia.db` de vez en cuando.

## Estructura
- `server/`: API (`index.js`) y base de datos (`db.js`).
- `src/App.jsx`: rutas por hash. `#/wifi`, `#/emergencias`… son los links directos para los QR; `#/admin/…` es el panel.
- `src/sections/`: las 12 pantallas. `src/Menu.jsx`: el menú.
- `src/components/Editable.jsx`: textos, botones y listas que se vuelven editables en el panel.
- `src/admin/`: panel del dueño.
- `src/data/hotel.js`: contenido de ejemplo y respaldo si el servidor no responde.
- `src/styles.css`: paleta (salvia, hueso, terracota, mostaza, verde) y componentes.

## Detalles
- Teléfonos con `tel:`, WhatsApp con `wa.me` y mensaje armado, lugares con búsqueda en Google Maps. Los links cargados en el panel solo se aceptan si empiezan con `http://` o `https://`.
- Wi-Fi: "Copiar clave" y un QR para conectar un segundo celular (se genera en el propio sitio).
- Si el celular del huésped no tiene señal, la guía usa la última copia guardada.
- "Abierto ahora" se calcula con la zona horaria del hotel.
- La lista del check-out se guarda en el celular del huésped.
