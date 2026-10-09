/**
 * Guía Hotel Chipre — recibe la foto del documento del huésped y la guarda en una carpeta de este Drive.
 *
 * Cómo funciona:
 *  - El celular del huésped manda la foto a esta aplicación web junto con un permiso firmado que la base le dio
 *    al canjear el código de recepción. Sin ese permiso (o vencido) no se guarda nada.
 *  - La foto se guarda SOLO en la carpeta indicada abajo, con el nombre AAAA-MM-DD_HH-mm_Apellido_Nombre.jpg.
 *  - Después avisa a la base el nombre y el id del archivo. En la base no se guarda la imagen.
 *  - No comparte archivos ni borra nada.
 *
 * Los valores de CONFIG ya vienen cargados desde el panel del administrador.
 */
var CONFIG = {
  SUPABASE_URL: '%%SUPABASE_URL%%',
  SUPABASE_KEY: '%%SUPABASE_KEY%%',
  SECRETO: '%%SECRETO%%',
  CARPETA_ID: '%%CARPETA_ID%%',
  ZONA: '%%ZONA%%'
};

var MAX_FOTOS_POR_HUESPED = 3;
var MAX_BYTES = 1500 * 1024;

// Abrir la dirección de la aplicación en el navegador debe mostrar {"ok":true,...}
function doGet() {
  return salida_({ ok: true, servicio: 'checkin-fotos' });
}

function doPost(e) {
  try {
    var cuerpo = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (cuerpo.accion === 'probar') return salida_(probar_(cuerpo));
    return salida_(subir_(cuerpo));
  } catch (err) {
    return salida_({ ok: false, error: 'error' });
  }
}

function salida_(objeto) {
  return ContentService.createTextOutput(JSON.stringify(objeto)).setMimeType(ContentService.MimeType.JSON);
}

function iguales_(a, b) {
  a = String(a);
  b = String(b);
  if (a.length !== b.length) return false;
  var r = 0;
  for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function hex_(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i++) s += ('0' + (bytes[i] & 255).toString(16)).slice(-2);
  return s;
}

// El permiso es "ref.vence.firma"; la firma la calcula la base con la clave que comparte con este script.
function verificarPermiso_(ticket) {
  var partes = String(ticket || '').split('.');
  if (partes.length !== 3) return null;
  var ref = partes[0];
  var vence = partes[1];
  if (!/^[0-9a-f]{32}$/.test(ref) || !/^[0-9]{9,12}$/.test(vence)) return null;
  if (Number(vence) * 1000 < new Date().getTime()) return null;
  var firma = hex_(Utilities.computeHmacSha256Signature(ref + '.' + vence, CONFIG.SECRETO));
  if (!iguales_(firma, partes[2])) return null;
  return { ref: ref, vence: Number(vence) };
}

function decodificar_(base64) {
  if (typeof base64 !== 'string' || base64.length < 100 || base64.length > MAX_BYTES * 1.4) return null;
  var bytes = Utilities.base64Decode(base64);
  if (bytes.length > MAX_BYTES) return null;
  // Tiene que ser un JPEG (la app lo convierte en el celular antes de mandarlo).
  if ((bytes[0] & 255) !== 255 || (bytes[1] & 255) !== 216 || (bytes[2] & 255) !== 255) return null;
  return bytes;
}

function limpiar_(texto, largo) {
  var t = String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  t = t.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, largo);
  return t || 'sin-nombre';
}

function nombreArchivo_(apellido, nombre) {
  var fecha = Utilities.formatDate(new Date(), CONFIG.ZONA, 'yyyy-MM-dd_HH-mm');
  return fecha + '_' + limpiar_(apellido, 30) + '_' + limpiar_(nombre, 30);
}

function nombreLibre_(carpeta, base) {
  var nombre = base + '.jpg';
  var n = 2;
  while (carpeta.getFilesByName(nombre).hasNext()) {
    nombre = base + '_' + n + '.jpg';
    n++;
  }
  return nombre;
}

function subir_(c) {
  var permiso = verificarPermiso_(c.ticket);
  if (!permiso) return { ok: false, error: 'permiso' };

  var bytes = decodificar_(c.imagen);
  if (!bytes) return { ok: false, error: 'imagen' };

  var candado = LockService.getScriptLock();
  candado.waitLock(20000);
  try {
    var cache = CacheService.getScriptCache();
    var clave = 'f:' + permiso.ref;
    var usadas = Number(cache.get(clave) || 0);
    if (usadas >= MAX_FOTOS_POR_HUESPED) return { ok: false, error: 'limite' };
    cache.put(clave, String(usadas + 1), 21600);

    var carpeta = DriveApp.getFolderById(CONFIG.CARPETA_ID);
    var nombre = nombreLibre_(carpeta, nombreArchivo_(c.apellido, c.nombre));
    var archivo = carpeta.createFile(Utilities.newBlob(bytes, 'image/jpeg', nombre));

    var respuesta = UrlFetchApp.fetch(CONFIG.SUPABASE_URL + '/rest/v1/rpc/checkin_foto_registrar', {
      method: 'post',
      contentType: 'application/json',
      headers: { apikey: CONFIG.SUPABASE_KEY },
      payload: JSON.stringify({ p_secreto: CONFIG.SECRETO, p_ref: permiso.ref, p_foto_id: archivo.getId(), p_nombre: nombre }),
      muteHttpExceptions: true
    });
    var datos = {};
    try { datos = JSON.parse(respuesta.getContentText()); } catch (err) { datos = {}; }
    if (respuesta.getResponseCode() !== 200 || !datos.ok) return { ok: false, error: 'registro' };
    return { ok: true, nombre: nombre };
  } finally {
    candado.releaseLock();
  }
}

// Desde el panel del administrador: guarda un archivito de prueba en la carpeta para confirmar que todo anda.
function probar_(c) {
  if (!iguales_(c.secreto || '', CONFIG.SECRETO)) return { ok: false, error: 'secreto' };
  var carpeta = DriveApp.getFolderById(CONFIG.CARPETA_ID);
  var texto = 'Conexión con la guía del hotel verificada: ' + Utilities.formatDate(new Date(), CONFIG.ZONA, 'yyyy-MM-dd HH:mm');
  var existentes = carpeta.getFilesByName('prueba-conexion.txt');
  if (existentes.hasNext()) existentes.next().setContent(texto);
  else carpeta.createFile('prueba-conexion.txt', texto, 'text/plain');
  return { ok: true, carpeta: carpeta.getName() };
}
