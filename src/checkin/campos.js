// Campos del formulario de check-in. Las claves son las mismas que guarda la base (datos.<clave>).
export const TIPOS_DOC = ['DNI', 'Pasaporte'];

// Estos países van primero en las listas.
export const PRIMEROS = ['AR', 'BR', 'UY', 'CL', 'PY', 'BO'];

const ISO = ('AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ ' +
  'DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IQ IR IS IT JE JM JO JP ' +
  'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ ' +
  'OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TK TL TM TN TO TR TT TV TW TZ ' +
  'UA UG US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW').split(' ');

// Respaldo por si el navegador no sabe traducir nombres de países (muy viejo).
const NOMBRES_RESPALDO = {
  AR: 'Argentina', BR: 'Brasil', UY: 'Uruguay', CL: 'Chile', PY: 'Paraguay', BO: 'Bolivia', PE: 'Perú', CO: 'Colombia', VE: 'Venezuela',
  EC: 'Ecuador', MX: 'México', US: 'Estados Unidos', CA: 'Canadá', ES: 'España', FR: 'Francia', IT: 'Italia', DE: 'Alemania',
  GB: 'Reino Unido', PT: 'Portugal', NL: 'Países Bajos', CH: 'Suiza', AU: 'Australia', CN: 'China', JP: 'Japón', IL: 'Israel'
};

let memo = null;

// [{ iso, nombre }] con los países en español: primero los vecinos, después todos por orden alfabético.
export function listaPaises() {
  if (memo) return memo;
  let nombres = null;
  try { nombres = new Intl.DisplayNames(['es-AR', 'es'], { type: 'region' }); } catch { /* sin soporte */ }
  const nombreDe = (iso) => {
    let n = null;
    try { n = nombres?.of(iso) ?? null; } catch { /* código raro */ }
    return n && n !== iso ? n : NOMBRES_RESPALDO[iso] ?? null;
  };
  const todos = ISO.map((iso) => ({ iso, nombre: nombreDe(iso) })).filter((p) => p.nombre);
  const primeros = PRIMEROS.map((iso) => todos.find((p) => p.iso === iso)).filter(Boolean);
  const resto = todos.filter((p) => !PRIMEROS.includes(p.iso)).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  memo = [...primeros, ...resto];
  return memo;
}

export const isoDeNombre = (nombre) => listaPaises().find((p) => p.nombre === nombre)?.iso ?? null;

// Valores vacíos del formulario (los campos del huésped; la habitación solo la usa el personal).
export const VACIO = {
  nombre: '', apellido: '', email: '', telefonoPais: 'AR', telefonoNumero: '',
  nacionalidad: 'Argentina', localidad: '', domicilio: '', doc_tipo: 'DNI', doc_numero: '', habitacion: ''
};

// Orden en que aparecen los campos (para llevar el foco al primero con error).
export const ORDEN = ['nombre', 'apellido', 'email', 'telefono', 'nacionalidad', 'localidad', 'domicilio', 'doc_tipo', 'doc_numero'];
