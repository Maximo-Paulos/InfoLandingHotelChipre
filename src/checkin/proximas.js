// «Próximas reservas» de recepción: cuentas puras de la lista (buscar por nombre y agrupar por día). Sin pantalla ni red: se prueban con node.

// Para comparar sin importar mayúsculas, tildes ni espacios de más: «  JOSÉ  perez » -> «jose perez».
export const normalizar = (texto) => String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// La base también devuelve las reservas que ya empezaron el check-in (estado «en_curso»); esta lista es solo de las que todavía esperan al huésped.
export const soloEsperando = (reservas) => reservas.filter((a) => !a.estado || a.estado === 'anotada');

// Lo que se busca: el nombre del titular, la habitación, la nota, el canal y la categoría. Cada palabra escrita tiene que estar (en cualquier orden):
// «perez 107» encuentra a Juan Pérez de la 107. Sin nada escrito, vuelve todo.
export function filtrarProximas(reservas, consulta) {
  const palabras = normalizar(consulta).split(' ').filter(Boolean);
  if (!palabras.length) return reservas;
  return reservas.filter((a) => {
    const texto = normalizar([a.titular, a.habitacion, a.nota, a.canal, a.categoria].filter(Boolean).join(' '));
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
