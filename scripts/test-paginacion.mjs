// La lista de huéspedes del admin se pide de a tandas ("Cargar más"): cada tanda tiene que seguir justo donde terminó la anterior.
//   node scripts/test-paginacion.mjs
import { CLAVE_ADMIN, iniciarBackend } from './backend-local.mjs';

let fallas = 0;
let total = 0;
const ok = (c, m) => { total += 1; console.log(`${c ? 'OK    ' : 'FALLA '}${m}`); if (!c) fallas += 1; };

const back = await iniciarBackend({ puerto: 54397 });
await back.sql(`insert into private.checkins (grupo, idioma, datos, consentimiento)
  select 1, 'es', jsonb_build_object('nombre', 'Nombre' || g, 'apellido', 'Apellido' || lpad(g::text, 3, '0'), 'email', 'h' || g || '@correo.com', 'telefono', '+541155551234', 'nacionalidad', 'Argentina', 'localidad', case when g % 2 = 0 then 'Capital Federal' else 'Rosario' end, 'domicilio', 'Calle ' || g, 'doc_tipo', 'DNI', 'doc_numero', (30000000 + g)::text), '{"aceptado":true}'::jsonb
    from generate_series(1, 120) g`);
const pagina = (antes = null, limite = 50, buscar = null) => back.llamar('admin_huespedes', { p_clave: CLAVE_ADMIN, p_buscar: buscar, p_limite: limite, p_antes: antes }, '198.51.100.60');
const ids = (r) => r.huespedes.map((h) => h.id);
const rango = (desde, hasta) => Array.from({ length: Math.abs(desde - hasta) + 1 }, (_, i) => (desde >= hasta ? desde - i : desde + i));

console.log('\n== Tandas de la lista de huéspedes (120 huéspedes, de a 50)');
const p1 = await pagina();
ok(p1.ok === true && p1.huespedes.length === 50 && p1.hay_mas === true && ids(p1).join() === rango(120, 71).join(), 'la primera tanda trae los 50 más nuevos (120 al 71) y avisa que hay más');
const p2 = await pagina(ids(p1).at(-1));
ok(p2.huespedes.length === 50 && p2.hay_mas === true && ids(p2).join() === rango(70, 21).join(), 'la segunda sigue justo donde terminó la primera (70 al 21) y avisa que hay más');
const p3 = await pagina(ids(p2).at(-1));
ok(p3.huespedes.length === 20 && p3.hay_mas === false && ids(p3).join() === rango(20, 1).join(), 'la tercera trae los 20 que faltan (20 al 1) y avisa que ya no hay más');
const todos = [...ids(p1), ...ids(p2), ...ids(p3)];
ok(todos.length === 120 && new Set(todos).size === 120, 'juntas, las tres tandas son los 120 huéspedes, sin repetir ni saltear a nadie');
const p4 = await pagina(1);
ok(p4.ok === true && p4.huespedes.length === 0 && p4.hay_mas === false, 'después del más viejo no viene nada');

console.log('\n== Justo en el borde');
let r = await pagina(51);
ok(r.huespedes.length === 50 && r.hay_mas === false && ids(r)[0] === 50 && ids(r).at(-1) === 1, 'si quedan exactamente 50, los trae y no ofrece "más"');
r = await pagina(52);
ok(r.huespedes.length === 50 && r.hay_mas === true && ids(r).at(-1) === 2, 'si queda uno más, lo avisa');

console.log('\n== Tamaño de la tanda');
r = await pagina(null, 0);
ok(r.huespedes.length === 1 && r.hay_mas === true, 'un tamaño de 0 se toma como 1');
r = await pagina(null, 1000);
ok(r.huespedes.length === 120 && r.hay_mas === false, 'un tamaño enorme se limita a 200 (acá hay 120, y los trae todos)');
r = await back.llamar('admin_huespedes', { p_clave: CLAVE_ADMIN }, '198.51.100.60');
ok(r.huespedes.length === 50 && r.hay_mas === true, 'sin indicar nada son 50');

console.log('\n== Con búsqueda');
const b1 = await pagina(null, 50, 'rosario');
ok(b1.huespedes.length === 50 && b1.hay_mas === true && ids(b1).every((i) => i % 2 === 1), 'la búsqueda filtra (60 de Rosario) y la primera tanda trae 50');
const b2 = await pagina(ids(b1).at(-1), 50, 'rosario');
ok(b2.huespedes.length === 10 && b2.hay_mas === false && ids(b2).every((i) => i % 2 === 1), 'la segunda trae los 10 que faltan');
ok(new Set([...ids(b1), ...ids(b2)]).size === 60, 'sin repetir a nadie');
r = await pagina(null, 50, '%');
ok(r.huespedes.length === 0, 'el "%" de una búsqueda no se toma como comodín');
r = await pagina(null, 50, 'APELLIDO05');
ok(r.huespedes.length === 10 && ids(r)[0] === 59, 'la búsqueda no distingue mayúsculas');

console.log(`\n${total} comprobaciones, ${fallas} falla(s)`);
await back.cerrar();
process.exit(fallas ? 1 : 0);
