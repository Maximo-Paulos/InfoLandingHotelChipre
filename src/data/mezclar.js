// Completa un contenido guardado con los valores por defecto, para que agregar
// campos nuevos al diseño no rompa lo que ya está guardado.
// Los objetos se combinan clave por clave; las listas se toman tal cual las guardó el dueño.
export function mezclar(base, valor) {
  if (Array.isArray(base)) return Array.isArray(valor) ? valor : structuredClone(base);
  if (base && typeof base === 'object') {
    const origen = valor && typeof valor === 'object' && !Array.isArray(valor) ? valor : {};
    const salida = {};
    for (const k of Object.keys(base)) salida[k] = mezclar(base[k], origen[k]);
    for (const k of Object.keys(origen)) if (!(k in salida)) salida[k] = origen[k];
    return salida;
  }
  return typeof valor === typeof base ? valor : base;
}

// Revisa que el contenido tenga la forma esperada antes de guardarlo.
export function validar(base, valor) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return 'El contenido debe ser un objeto.';
  for (const k of Object.keys(base)) {
    const esperado = Array.isArray(base[k]) ? 'array' : typeof base[k];
    const real = Array.isArray(valor[k]) ? 'array' : typeof valor[k];
    if (esperado !== real) return `Falta o es incorrecto el bloque "${k}".`;
  }
  return null;
}
