# Guía digital del huésped · Hotel Chipre

Landing para celular: el huésped escanea un QR (o recibe el link por WhatsApp) y tiene a mano check-in, Wi-Fi, emergencias, normas, preguntas frecuentes, dónde comer y qué hacer cerca.

El contenido vive en una base de datos **Supabase**. El dueño lo edita desde un **panel** que es un clon de la guía, con una caja debajo de cada texto; lo que guarda se ve enseguida en la guía de los huéspedes. Todo se publica en **Vercel**: no hay servidor propio.

```
Huésped → guía (React, Vercel) ──lee──▶ Supabase ◀──guarda con clave── panel del dueño (#/admin)
```

## Cómo edita el dueño
1. Entrar a `/#/admin` con la clave.
2. Navegar la guía como lo haría un huésped. Debajo de cada texto, botón, teléfono o link hay una caja para cambiarlo, y el cambio se ve al instante.
3. En las listas (pasos, normas, preguntas, lugares, teléfonos…) hay botones **Agregar** y **Quitar**.
4. Los datos que no se ven como texto (WhatsApp, teléfonos, link del mapa, Wi-Fi, horarios, links de reseñas) y el **cambio de la clave** están en **Datos generales**, el último botón del menú.
5. **Guardar cambios** los manda a la base. **Descartar** vuelve a lo último guardado. La base conserva las últimas 20 versiones.

Los íconos y el orden de las pantallas no se editan desde el panel. Cada pantalla tiene su link directo para los QR: `/#/wifi`, `/#/emergencias`, `/#/checkin`, `/#/checkout`…

## Probarlo en tu laptop
Necesita [Node 20 o superior](https://nodejs.org) y Git.
```
git clone https://github.com/Maximo-Paulos/InfoLandingHotelChipre.git
cd InfoLandingHotelChipre
npm install
npm run dev
```
Abrí http://localhost:5173 (guía) y http://localhost:5173/#/admin (panel). Usa la misma base de Supabase que la versión publicada, así que lo que guardes en el panel **cambia la guía real**.

Para verla desde el celular en la misma red Wi-Fi: `npm run dev -- --host` y abrir `http://IP-DE-TU-LAPTOP:5173`.

## Publicar (Vercel)
El proyecto de Vercel está conectado a este repo: cada cambio en `main` se publica solo. Configuración: preset **Vite**, comando `npm run build`, carpeta de salida `dist`. No hacen falta variables de entorno.

## La clave del dueño
- Se guarda en la base solo como hash (bcrypt), nunca en texto ni en el código.
- Se cambia desde el panel: **Datos generales → Clave del panel**.
- Si se pierde, se restablece desde el SQL Editor de Supabase:
  ```sql
  update private.admin set hash = extensions.crypt('clave-nueva-larga', extensions.gen_salt('bf')) where id = 1;
  ```
- Hay un freno: 8 intentos fallidos por minuto y por IP.

## Seguridad
La URL de Supabase y la clave `publishable` van en el navegador **a propósito**: son públicas por diseño. Lo que protege los datos son las reglas de la base (`supabase/schema.sql`):
- la tabla del contenido solo se puede **leer**; escribirla directo está bloqueado;
- guardar exige la clave del dueño, valida la forma del contenido y archiva la versión anterior;
- las tablas privadas (clave, historial, intentos) no se pueden ver por la API.

Los links cargados en el panel solo se aceptan si empiezan con `http://` o `https://`.

## Rehacer la base en otro proyecto de Supabase
1. En el SQL Editor, ejecutar `supabase/schema.sql` y la línea final comentada con tu clave.
2. Poner la URL y la clave publishable del proyecto nuevo en `.env` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_KEY`) o en `src/config.js`.
3. Cargar el contenido inicial: `ADMIN_PASSWORD="tu-clave" npm run seed` (usa `src/data/hotel.js`; sirve también para volver a los datos de ejemplo).

## Estructura
- `src/App.jsx`: rutas por hash (`#/wifi`, `#/admin/…`).
- `src/sections/`, `src/Menu.jsx`: las 12 pantallas y el menú.
- `src/components/Editable.jsx`: textos, botones y listas que se vuelven editables en el panel.
- `src/admin/`: panel del dueño.
- `src/data/api.js`: conexión con Supabase. `src/data/hotel.js`: contenido de ejemplo.
- `supabase/schema.sql`: la base de datos. `scripts/seed.mjs`: carga inicial.
- `src/styles.css`: paleta (salvia, hueso, terracota, mostaza, verde) y componentes.

## Detalles
- Teléfonos con `tel:`, WhatsApp con `wa.me` y mensaje armado, lugares con búsqueda en Google Maps.
- Wi-Fi: "Copiar clave" y un QR para conectar un segundo celular (se genera en el propio sitio).
- Si el celular del huésped no tiene señal, la guía usa la última copia guardada; sin copia y sin señal muestra "Reintentar" y los teléfonos de emergencia, nunca datos de ejemplo.
- "Abierto ahora" se calcula con la zona horaria del hotel.
- La lista del check-out se guarda en el celular del huésped.
