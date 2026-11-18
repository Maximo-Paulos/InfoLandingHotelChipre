// Los huéspedes de una misma reserva (fila.estadia_id) van juntos, con su reserva arriba; los de antes de las reservas van al final.
// -> [{ estadia: reserva | null, filas: [...] }] en el orden en que aparece el primer huésped de cada reserva
export function porReserva(filas) {
  const mapa = new Map();
  for (const f of filas) {
    const k = f.estadia_id ?? 0;
    if (!mapa.has(k)) mapa.set(k, { estadia: f.estadia ?? null, filas: [] });
    mapa.get(k).filas.push(f);
  }
  const todos = [...mapa.entries()];
  return [...todos.filter(([k]) => k), ...todos.filter(([k]) => !k)].map(([, g]) => g);
}
