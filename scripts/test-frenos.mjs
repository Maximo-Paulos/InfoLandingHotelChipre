// Los frenos de intentos (clave de admin, clave de recepción, código de 6 números) cuentan por la IP real de quien llama.
// El cliente puede escribir lo que quiera en x-forwarded-for; cf-connecting-ip y sb-forwarded-for las escribe
// Cloudflare / Supabase y no se pueden falsificar. Corre sobre el mismo SQL que producción, sin tocar nada real.
//   node scripts/test-frenos.mjs
import { CLAVE_ADMIN, CLAVE_RECEPCION, iniciarBackend } from './backend-local.mjs';

const back = await iniciarBackend({ puerto: 54320 });
let fallas = 0;
let total = 0;
const ok = (c, m) => { total += 1; console.log(`${c ? 'OK    ' : 'FALLA '}${m}`); if (!c) fallas += 1; };
await back.sql(`update private.checkin_config set activo = true, hash_recepcion = extensions.crypt($1, extensions.gen_salt('bf')) where id = 1`, [CLAVE_RECEPCION]);

// manda `veces` intentos con clave mala y devuelve la última respuesta
async function fallar(fn, cabeceras, veces = 9) {
  let r;
  for (let i = 0; i < veces; i += 1) r = await back.llamar(fn, { p_clave: 'mala-clave' }, cabeceras(i));
  return r;
}
const ipDe = async (cabeceras) => {
  await back.exec(`select set_config('request.headers', '${JSON.stringify(cabeceras).replace(/'/g, "''")}', false)`);
  return (await back.sql('select private.ip_actual() as ip'))[0].ip;
};

// --- de dónde sale la IP
ok(await ipDe({ 'cf-connecting-ip': '198.51.100.1', 'sb-forwarded-for': '198.51.100.2', 'x-forwarded-for': '1.1.1.1, 198.51.100.3' }) === '198.51.100.1', 'manda cf-connecting-ip (Cloudflare)');
ok(await ipDe({ 'sb-forwarded-for': '198.51.100.2', 'x-forwarded-for': '1.1.1.1, 198.51.100.3' }) === '198.51.100.2', 'si no está, sb-forwarded-for (gateway de Supabase)');
ok(await ipDe({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2,198.51.100.3' }) === '198.51.100.3', 'si no, el ÚLTIMO valor de x-forwarded-for (el primero lo escribe el cliente)');
ok(await ipDe({}) === 'desconocida', 'sin cabeceras: "desconocida" (no falla)');
ok(await ipDe({ 'x-forwarded-for': '  ' }) === 'desconocida', 'cabecera vacía: "desconocida"');
ok(await ipDe({ 'cf-connecting-ip': '2001:db8:1:2::5' }) === '2001:db8:1:2::', 'IPv6: se agrupa por /64 (2001:db8:1:2::)');
ok(await ipDe({ 'cf-connecting-ip': '2001:db8:1:2:aaaa:bbbb:cccc:dddd' }) === '2001:db8:1:2::', 'IPv6 completa: mismo grupo /64');
ok(await ipDe({ 'cf-connecting-ip': '::ffff:198.51.100.9' }) === '198.51.100.9', 'IPv4 escrita como IPv6 (::ffff:a.b.c.d) vuelve a IPv4');
ok(await ipDe({ 'cf-connecting-ip': 'esto-no-es-una-ip:x' }) === 'esto-no-es-una-ip:x', 'un valor raro no rompe nada');
await back.exec(`select set_config('request.headers', 'esto no es json', false)`);
ok((await back.sql('select private.ip_actual() as ip'))[0].ip === 'desconocida', 'cabeceras con formato roto: "desconocida" (el login del admin no se rompe)');
await back.exec(`select set_config('request.headers', '', false)`);

// --- frenos
let r = await fallar('recepcion_entrar', (i) => ({ 'cf-connecting-ip': '198.51.100.10', 'x-forwarded-for': `10.0.0.${i}, 198.51.100.10` }));
ok(r.error === 'demasiados_intentos', 'recepción: cambiar el x-forwarded-for en cada intento NO esquiva el freno (con cf-connecting-ip)');
r = await fallar('recepcion_entrar', (i) => ({ 'x-forwarded-for': `10.0.1.${i}, 198.51.100.11` }));
ok(r.error === 'demasiados_intentos', 'recepción: ni sin cf-connecting-ip (cuenta por el último valor)');
r = await fallar('recepcion_entrar', (i) => ({ 'sb-forwarded-for': '198.51.100.13', 'x-forwarded-for': `10.0.2.${i}` }));
ok(r.error === 'demasiados_intentos', 'recepción: ni con sb-forwarded-for');
r = await back.llamar('recepcion_entrar', { p_clave: 'mala-clave' }, { 'cf-connecting-ip': '198.51.100.12' });
ok(r.error === 'clave_incorrecta', 'otra persona (otra IP) no queda bloqueada');
r = await fallar('recepcion_entrar', (i) => ({ 'cf-connecting-ip': `2001:db8:9:9::${(i + 1).toString(16)}` }));
ok(r.error === 'demasiados_intentos', 'IPv6: cambiar de dirección dentro de su /64 no esquiva el freno');
r = await back.llamar('recepcion_entrar', { p_clave: 'mala-clave' }, { 'cf-connecting-ip': '2001:db8:9:a::1' });
ok(r.error === 'clave_incorrecta', 'IPv6: otro /64 no queda bloqueado');

r = await fallar('verificar_clave', (i) => ({ 'cf-connecting-ip': '198.51.100.20', 'x-forwarded-for': `10.0.3.${i}, 198.51.100.20` }));
ok(r.error === 'demasiados_intentos', 'admin: el freno de la clave del dueño tampoco se esquiva con x-forwarded-for falso');
r = await back.llamar('verificar_clave', { p_clave: CLAVE_ADMIN }, { 'cf-connecting-ip': '198.51.100.21', 'x-forwarded-for': '10.0.3.99, 198.51.100.21' });
ok(r.ok === true, 'admin: con la clave buena desde otra IP entra normalmente');
r = await back.llamar('verificar_clave', { p_clave: CLAVE_ADMIN }, {});
ok(r.ok === true, 'admin: sin cabeceras (como desde el panel de SQL) también entra');

// códigos de 6 números
let c;
for (let i = 0; i < 7; i += 1) c = await back.llamar('checkin_canjear', { p_codigo: '000000' }, { 'cf-connecting-ip': '198.51.100.30', 'x-forwarded-for': `10.0.4.${i}, 198.51.100.30` });
ok(c.error === 'demasiados_intentos', 'códigos de 6 números: probar uno tras otro con x-forwarded-for distinto se frena igual');

console.log(`\n${total} comprobaciones, ${fallas} falla(s)`);
await back.cerrar();
process.exit(fallas ? 1 : 0);
