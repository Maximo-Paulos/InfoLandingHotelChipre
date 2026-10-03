import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import defaults from '../src/data/hotel.js';
import { mezclar } from '../src/data/mezclar.js';

const archivo = process.env.DB_PATH || fileURLToPath(new URL('./data/guia.db', import.meta.url));
mkdirSync(dirname(archivo), { recursive: true });

const db = new DatabaseSync(archivo);
db.exec(`
  CREATE TABLE IF NOT EXISTS contenido (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    json TEXT NOT NULL,
    actualizado TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS historial (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    json TEXT NOT NULL,
    guardado TEXT NOT NULL
  );
`);

// Primera vez: se carga el contenido de ejemplo.
if (!db.prepare('SELECT 1 FROM contenido WHERE id = 1').get()) {
  db.prepare('INSERT INTO contenido (id, json, actualizado) VALUES (1, ?, ?)')
    .run(JSON.stringify(defaults), new Date().toISOString());
}

export function leer() {
  const fila = db.prepare('SELECT json, actualizado FROM contenido WHERE id = 1').get();
  return { contenido: mezclar(defaults, JSON.parse(fila.json)), actualizado: fila.actualizado };
}

const MAX_VERSIONES = 20;

// Guarda el contenido nuevo y archiva el anterior, todo junto o nada.
export function guardar(contenido) {
  const ahora = new Date().toISOString();
  db.exec('BEGIN');
  try {
    const previo = db.prepare('SELECT json FROM contenido WHERE id = 1').get();
    if (previo) db.prepare('INSERT INTO historial (json, guardado) VALUES (?, ?)').run(previo.json, ahora);
    db.prepare('UPDATE contenido SET json = ?, actualizado = ? WHERE id = 1').run(JSON.stringify(contenido), ahora);
    db.prepare('DELETE FROM historial WHERE id NOT IN (SELECT id FROM historial ORDER BY id DESC LIMIT ?)').run(MAX_VERSIONES);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return ahora;
}

export function versiones() {
  return db.prepare('SELECT id, guardado FROM historial ORDER BY id DESC').all();
}

export { defaults };
