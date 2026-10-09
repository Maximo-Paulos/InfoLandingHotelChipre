// La foto sale del celular directo al script de Google (Apps Script) del hotel, que la guarda en Drive.
// Ni la base ni nuestros servidores guardan la imagen.
// El navegador a veces no deja leer la respuesta del script aunque haya guardado la foto; por eso, si no se
// puede leer, el que decide es la base (checkin_sesion -> foto.listo), porque el script la avisa antes de contestar.

export async function subirFoto({ url, ticket, nombre, apellido, imagen }) {
  try {
    const r = await fetch(url, {
      method: 'POST',
      // text/plain evita la consulta previa (preflight) que el script de Google no responde
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ticket, nombre, apellido, imagen }),
      signal: AbortSignal.timeout(60000),
      redirect: 'follow'
    });
    const texto = await r.text();
    try { return JSON.parse(texto); } catch { return { ok: null }; }
  } catch {
    return { ok: null };
  }
}

// Prueba la conexión desde el panel del admin: el script guarda un archivo de prueba en la carpeta.
// Devuelve { ok: true, carpeta } si pudo leer la respuesta, { ok: false, error } si el script contestó que no,
// o { ok: null } si no se pudo leer (hay que mirar la carpeta de Drive).
export async function probarConexion(url, secreto) {
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ accion: 'probar', secreto }),
      signal: AbortSignal.timeout(45000),
      redirect: 'follow'
    });
    const texto = await r.text();
    try { return JSON.parse(texto); } catch { return { ok: null }; }
  } catch {
    return { ok: null };
  }
}
