// «Próximas reservas» de recepción: cuentas puras de la lista (buscar por nombre y agrupar por día). Sin pantalla ni red: se prueban con node.

// Para comparar sin importar mayúsculas, tildes ni espacios de más: «  JOSÉ  perez » -> «jose perez».
export const normalizar = (texto) => String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Lo que se busca: el nombre del titular, la habitación, la nota, el canal, la categoría y los nombres de quienes ya ingresaron. Cada palabra escrita tiene que estar (en cualquier orden):
// «perez 107» encuentra a Juan Pérez de la 107. Sin nada escrito, vuelve todo.
export function filtrarProximas(reservas, consulta) {
  const palabras = normalizar(consulta).split(' ').filter(Boolean);
  if (!palabras.length) return reservas;
  return reservas.filter((a) => {
    const texto = normalizar([a.titular, a.habitacion, a.nota, a.canal, a.categoria, ...(a.ingresaron ?? [])].filter(Boolean).join(' '));
    return palabras.every((p) => texto.includes(p));
  });
}

// Junta las reservas que llegan el mismo día (la lista ya viene ordenada por fecha): [{ fecha, dias, items }]
export function agruparPorDia(reservas) {
  const grupos = [];
  for (const a of reservas) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.fecha === a.fecha_ingreso) ultimo.items.push(a);
    else grupos.push({ fecha: a.fecha_ingreso, dias: a.dias_para, items: [a] });
  }
  return grupos;
}

// Reparte las reservas anotadas en secciones según el check-in, para que se vea de un vistazo qué falta y qué ya pasó:
//   FALTA INGRESAR: porLlegar (todavía no empezó el check-in y la fecha no pasó) · pasadas (la fecha ya pasó y no empezó) · sinNadie (se dio el código y todavía no entró nadie)
//   YA INGRESARON (al menos una persona): faltanHuespedes (ingresaron algunos, faltan otros) · completas (ingresaron todos los esperados)
//   canceladas: aparte, no es ni lo uno ni lo otro.
// Las que esperan van de la fecha más cercana a la más lejana (como vienen); las que ya empezaron, de la actividad más reciente a la más vieja.
const masReciente = (x, y) => String(y.ultima ?? '').localeCompare(String(x.ultima ?? ''));
export function seccionesDe(reservas) {
  const s = { porLlegar: [], pasadas: [], sinNadie: [], faltanHuespedes: [], completas: [], canceladas: [] };
  for (const a of reservas) {
    if (a.estado === 'cancelada') s.canceladas.push(a);
    else if (a.estado === 'en_curso') {
      const con = Number(a.con_checkin) || 0;
      if (con === 0) s.sinNadie.push(a);
      else if (con < Number(a.esperados)) s.faltanHuespedes.push(a);
      else s.completas.push(a);
    } else if (a.dias_para < 0) s.pasadas.push(a);
    else s.porLlegar.push(a);
  }
  s.sinNadie.sort(masReciente);
  s.faltanHuespedes.sort(masReciente);
  s.completas.sort(masReciente);
  s.faltaIngresar = s.porLlegar.length + s.pasadas.length + s.sinNadie.length;
  s.yaIngresaron = s.faltanHuespedes.length + s.completas.length;
  return s;
}

// Cuántos ingresaron de los que se esperan, para el cartelito de cada reserva: «Todavía no entró nadie» · «Ingresaron 2 de 3 (faltan 1)» · «Ingresaron los 3».
export function ingresoTexto(a) {
  const con = Number(a.con_checkin) || 0;
  const esp = Number(a.esperados) || 0;
  if (con === 0) return 'Todavía no entró nadie';
  if (con < esp) return `Ingresaron ${con} de ${esp} (${esp - con === 1 ? 'falta 1' : `faltan ${esp - con}`})`;
  return con === 1 ? 'Ingresó 1 huésped' : `Ingresaron los ${con}`;
}
