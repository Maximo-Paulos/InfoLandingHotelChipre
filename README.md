# Guía digital del huésped · Hotel Chipre

Landing para celular: el huésped escanea un QR (o recibe el link por WhatsApp) y tiene a mano check-in, Wi-Fi, emergencias, normas, preguntas frecuentes, dónde comer y qué hacer cerca.

Todo el contenido vive en una base de datos **SQLite**. El dueño lo edita desde un **panel** que es un clon de la guía, con una caja debajo de cada texto; lo que guarda se ve enseguida en la guía de los huéspedes.

```
Huésped → guía (React) → API → SQLite ← API ← panel del dueño (#/admin)
```

## Probarlo en tu laptop
Funciona igual en Windows y en Mac. Necesitás [Node 22 o superior](https://nodejs.org) (el instalador "LTS" más nuevo) y Git.

```
git clone https://github.com/Maximo-Paulos/InfoLandingHotelChipre.git
cd InfoLandingHotelChipre
npm install
npm run local
```

Cuando termine, en la terminal aparece `Guía del hotel en http://localhost:3001`. Dejá esa ventana abierta (con Ctrl+C se apaga) y abrí:

- **Guía de los huéspedes:** http://localhost:3001
- **Panel del dueño:** http://localhost:3001/#/admin (clave: `admin`)

**Recorrido corto para probarlo**
1. Entrá al panel, abrí **Check-in** y cambiá la hora en la caja "Hora de check-in". Mirá cómo se actualiza arriba.
2. Tocá **Guardar cambios**.
3. Abrí la guía en otra pestaña (o el botón **Ver guía**) y recargá: tiene que mostrar la hora nueva.
4. Probá agregar una pregunta frecuente, cambiar un teléfono en Emergencias y el WhatsApp en **Datos generales**.

**Verla desde tu celular** (con la laptop y el celular en la misma red Wi-Fi): averiguá la IP de la laptop (Windows: `ipconfig`; Mac: `ipconfig getifaddr en0`) y abrí `http://ESA-IP:3001` en el celular. Si no abre, puede ser el firewall de la laptop.

**Empezar de cero:** apagá el servidor y borrá `server/data/guia.db`; al volver a encender se carga el contenido de ejemplo.

**Si cambiás el código** (no hace falta para probar): `npm run server` y `npm run dev` en dos terminales; la guía queda en http://localhost:5173 y se recarga sola.

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
NODE_ENV=production ADMIN_PASSWORD="una-clave-larga" npm start
```
`npm start` sirve la guía compilada y la API en un solo proceso (puerto 3001, o el de la variable `PORT`). En un hosting se definen `NODE_ENV=production` y `ADMIN_PASSWORD` en su panel de variables (Render ya cuenta como producción).

- Sin `ADMIN_PASSWORD` el panel queda deshabilitado en producción. La clave `admin` solo sirve en tu laptop.
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
