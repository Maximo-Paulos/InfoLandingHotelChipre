# Guía digital del huésped · Hotel Chipre

Landing para celular: el huésped escanea un QR (o recibe el link por WhatsApp) y tiene a mano check-in, Wi-Fi, emergencias, normas, preguntas frecuentes, dónde comer y qué hacer cerca.

El contenido vive en una base de datos **Supabase**. El dueño lo edita desde un **panel** que es un clon de la guía, con una caja debajo de cada texto; lo que guarda se ve enseguida en la guía de los huéspedes. Todo se publica en **Vercel**: no hay servidor propio.

```
Huésped → guía (React, Vercel) ──lee──▶ Supabase ◀──guarda con clave── panel del dueño (#/admin)
```

## Cómo edita el dueño
1. Entrar a `/#/admin` con la clave y tocar **Editar landing page** (el otro botón, **Ver huéspedes**, es del check-in digital: ver más abajo).
2. Navegar la guía como lo haría un huésped. Debajo de cada texto, botón, teléfono o link hay una caja para cambiarlo, y el cambio se ve al instante.
3. En las listas (pasos, normas, preguntas, lugares, teléfonos…) hay botones **Agregar** y **Quitar**.
4. Los datos que no se ven como texto (WhatsApp, teléfonos, link del mapa, Wi-Fi, horarios, links de reseñas) y el **cambio de la clave** están en **Datos generales**, el último botón del menú.
5. **Guardar cambios** los manda a la base. **Descartar** vuelve a lo último guardado. La base conserva las últimas 20 versiones.

Los íconos y el orden de las pantallas no se editan desde el panel. Cada pantalla tiene su link directo para los QR: `/#/wifi`, `/#/emergencias`, `/#/checkin`, `/#/checkout`…
**A dónde lleva cada botón** también se cambia desde el panel, debajo del botón o del lugar:
   - Botones de WhatsApp: "Número de WhatsApp de este botón". Vacío = usa el número general (Datos generales). Con número = ese botón escribe a otro WhatsApp.
   - "Cómo llegar" y "Ver hospital": "Link de Google Maps de este botón". Vacío = se arma solo.
   - Cada lugar (dónde comer, qué hacer, compras): "Link de Google Maps de este lugar". Vacío = busca por nombre.
   - Reseñas, lista de mapa y teléfono de recepción: su link o número está en la caja del botón.

## Check-in digital
El huésped carga sus datos antes de llegar (o en el mostrador) con un **código de 6 números** que le da recepción, y recepción ve la planilla. No reemplaza al QR: la guía sigue igual y el check-in es **un botón más**, abajo de todo, que solo aparece cuando lo encendés.

```
Huésped ─ código de 6 números ─▶ formulario ─▶ "¡Check-in realizado!" ─▶ vuelve al menú
Recepción (#/recepcion): ve el código (cambia solo) y la planilla · corrige datos y carga la habitación por 10 min
Admin (#/admin): Editar landing page · Ver huéspedes (todos, config, Drive, historial)
Foto del documento: celular ─▶ script de Google (tu cuenta) ─▶ carpeta de tu Drive   (en la base solo queda el id y el nombre)
```

| Link | Para quién | Qué hace |
|---|---|---|
| `/#/registro` | huésped | pide el código y muestra el formulario (el botón del menú lleva acá) |
| `/#/recepcion` | recepción | clave propia · código con cuenta regresiva y usos · planilla de los últimos días · edición |
| `/#/admin` | dueño | inicio con dos botones |
| `/#/admin/editar` | dueño | el editor de la guía de siempre (los links viejos, como `/#/admin/wifi`, siguen andando) |
| `/#/admin/huespedes` | dueño | todos los huéspedes con búsqueda, configuración, conexión con Drive e historial de cambios |

### Cómo se enciende
1. **Base de datos** (una sola vez por proyecto de Supabase): ejecutar `supabase/checkin.sql` en el SQL Editor, después de `schema.sql`. Solo agrega tablas y funciones nuevas.
2. **Admin → Ver huéspedes → Configuración del check-in**: poner *Check-in digital* en **Encendido** y guardar. Mientras esté **Apagado** el botón no aparece y los códigos no funcionan.
3. **Clave de recepción** (misma pantalla, mínimo 8 caracteres). Solo el admin general la puede cambiar. Se guarda como hash, nunca en texto.
4. **Fotos** (opcional): *Conectar Drive para las fotos*, un asistente de 4 pasos (ver abajo). Hasta que lo conectes, el área de foto no aparece y el resto funciona igual.

### Qué se puede configurar
| Opción | Valor inicial |
|---|---|
| Cada cuántos segundos cambia el código | 15 |
| Cuántas personas pueden usar el mismo código | 3 |
| Recepción puede editar a los huéspedes / por cuántos minutos | sí / 10 |
| Días de huéspedes que ve recepción | 3 |
| Foto del documento | opcional (también: obligatoria · no pedir) |

Otros valores quedan fijos en la base (`private.checkin_config`): el huésped tiene 30 minutos para completar el formulario desde que canjea el código.

### Foto del documento → Drive
- El celular achica la foto (máx. 1600 px, menos de 900 KB, sin los datos ocultos como la ubicación) y la manda a un **script de Google que corre en tu cuenta** (`apps-script/Codigo.gs`), que la guarda en **una carpeta de tu Drive** con el nombre `AAAA-MM-DD_HH-mm_Apellido_Nombre.jpg`. Ni la base ni Vercel guardan la imagen; la planilla muestra «Ver foto», que abre el archivo en Drive (la ve quien tenga acceso a esa carpeta).
- Se usa un script y no una «cuenta de servicio» de Google porque, con Gmail común, Google no deja subir a una carpeta personal con una cuenta de servicio (no tienen espacio propio). El script corre como vos, no necesita consola de Google Cloud ni tarjeta.
- El script solo acepta fotos con un **permiso firmado y de pocos minutos** que la base le da al huésped que canjeó un código (hasta 3 fotos por huésped); solo escribe en esa carpeta y no comparte ni borra nada.
- Conexión (una vez, unos 10 minutos): *Admin → Ver huéspedes → Conectar Drive para las fotos*: 1) crear la carpeta y pegar su link, 2) pegar en [script.google.com](https://script.google.com) el código que arma el asistente, 3) *Implementar → Aplicación web → ejecutar como yo → acceso: cualquier persona*, 4) pegar la URL que termina en `/exec` y tocar *Guardar y probar* (guarda un archivo de prueba en la carpeta).

### Reglas importantes
- **Nada se borra**: no hay botones ni funciones para borrar huéspedes ni fotos. Cuando Drive se llene, se pasa a mano a un disco.
- La **habitación** la carga solo recepción (dentro de la ventana de edición) o el admin. Pasada la ventana, solo el admin corrige.
- Los cambios de recepción y de admin quedan en el **historial** (quién, cuándo y qué campos, no los valores).
- Las tablas con datos de huéspedes están en el esquema `private`, sin acceso directo desde la API: se entra solo por funciones que verifican el código, la clave de recepción o la del admin, con freno por IP en los intentos fallidos.
- El formulario guarda la aceptación del huésped (casilla con link a Términos y condiciones) y cuándo la dio. El hotel es responsable de esos datos (Ley 25.326): conviene que un abogado revise el texto de aceptación, cuánto tiempo se conservan los datos y el hecho de que Supabase y Drive son servicios del exterior.
- Que un teléfono sea **válido** (largo y formato del país) no prueba que **exista** o sea del huésped; eso requeriría verificar por SMS o WhatsApp.
- **Derechos del huésped** (acceso, rectificación, supresión): el sistema no borra nada a propósito. Si un huésped pide que se borren sus datos, hoy se haría a mano desde Supabase y Drive; conviene definir con el abogado cuánto tiempo se conservan y cómo se atienden esos pedidos.
- Mientras el huésped completa el formulario, lo escrito se guarda en la pestaña de su navegador (para no perderlo si recarga o cambia de idioma). Se borra al enviar o al cerrar la pestaña.

#### Texto sugerido para los Términos y condiciones (borrador, que lo revise un abogado)
Se edita desde el panel (Términos y condiciones). Completá lo que está entre corchetes:
```
# Datos personales y check-in digital
Al completar el check-in digital el huésped nos brinda su nombre, apellido, email, teléfono, nacionalidad, localidad, domicilio, tipo y número de documento y una foto del documento. Usamos esos datos para registrar la estadía, cumplir con las obligaciones de registro de huéspedes y gestionar el alojamiento. Responsable de la base de datos: [razón social, CUIT, domicilio y email de contacto del hotel].
Los datos se guardan en servidores de Supabase y la foto del documento en Google Drive, ambos con sede en el exterior (Estados Unidos), bajo la responsabilidad del hotel. Solo accede el personal autorizado.
El huésped puede ejercer sus derechos de acceso, rectificación y supresión escribiendo a [email], salvo cuando el hotel deba conservar los datos por obligaciones legales.
La Agencia de Acceso a la Información Pública, en su carácter de Órgano de Control de la Ley N° 25.326, tiene la atribución de atender las denuncias y reclamos que interpongan quienes resulten afectados en sus derechos por incumplimiento de las normas vigentes en materia de protección de datos personales.
```

### Probarlo sin tocar la base real
```
npm run local
```
Levanta una base de prueba **en memoria** (con los mismos archivos SQL que producción) y la guía apuntando a ella, con el check-in prendido y un Drive simulado. Claves de prueba que muestra el comando. Lo que cargues ahí se pierde al cerrar.

Pruebas automáticas (no usan la base real):
- `node scripts/test-validar.mjs`: reglas de validación del formulario (teléfonos, documentos, etc.).
- `node scripts/test-apps-script.mjs`: la lógica del script de Google con un Drive simulado.
- `node scripts/e2e-checkin.mjs`: punta a punta con navegador (huésped y recepción a la vez). Requiere Playwright (`npm i -D playwright`) y Chromium; `CAPTURAS=carpeta` guarda capturas de cada pantalla.

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
1. En el SQL Editor, ejecutar `supabase/schema.sql` y la línea final comentada con tu clave. Para el check-in digital, ejecutar después `supabase/checkin.sql`.
2. Poner la URL y la clave publishable del proyecto nuevo en `.env` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_KEY`) o en `src/config.js`.
3. Cargar el contenido inicial: `ADMIN_PASSWORD="tu-clave" npm run seed` (usa `src/data/hotel.js`; sirve también para volver a los datos de ejemplo).

## Estructura
- `src/App.jsx`: rutas por hash (`#/wifi`, `#/admin/…`).
- `src/sections/`, `src/Menu.jsx`: las 12 pantallas y el menú.
- `src/components/Editable.jsx`: textos, botones y listas que se vuelven editables en el panel.
- `src/admin/`: panel del dueño (inicio, editor de la guía, huéspedes y configuración del check-in).
- `src/checkin/`: check-in digital (formulario del huésped, pantalla de recepción, planilla, validaciones).
- `apps-script/Codigo.gs`: script de Google que guarda las fotos en Drive (lo pega el asistente del panel).
- `scripts/`: `local.mjs` y `backend-local.mjs` (base de prueba en memoria), `test-*.mjs` y `e2e-checkin.mjs` (pruebas).
- `src/data/api.js`: conexión con Supabase. `src/data/hotel.js`: contenido de ejemplo.
- `supabase/schema.sql`: la base de datos. `supabase/checkin.sql`: tablas y funciones del check-in. `scripts/seed.mjs`: carga inicial.
- `src/styles.css`: paleta (salvia, hueso, terracota, mostaza, verde) y componentes.

## Detalles
- Teléfonos con `tel:`, WhatsApp con `wa.me` y mensaje armado, lugares con búsqueda en Google Maps.
- Wi-Fi: "Copiar clave" y un QR para conectar un segundo celular (se genera en el propio sitio).
- Si el celular del huésped no tiene señal, la guía usa la última copia guardada; sin copia y sin señal muestra "Reintentar" y los teléfonos de emergencia, nunca datos de ejemplo.
- "Abierto ahora" se calcula con la zona horaria del hotel.
- La lista del check-out se guarda en el celular del huésped.
