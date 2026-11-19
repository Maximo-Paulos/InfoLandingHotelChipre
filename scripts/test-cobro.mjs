// Las cuentas de cobro de una reserva anotada: cuánto resta en efectivo, en transferencia y en dólares, y lo que se le completa al formulario del check-in.
//   node scripts/test-cobro.mjs
import { aCobrar, medioSugerido, prefillDe, redondear } from '../src/checkin/cobro.js';

let fallas = 0;
const ok = (c, m) => { console.log(`${c ? 'OK    ' : 'FALLA '}${m}`); if (!c) fallas += 1; };
const cerca = (x, y, e = 0.005) => Math.abs(x - y) <= e;
const A = (extra = {}) => ({ precio_efectivo: 100000, precio_transferencia: 110000, precio_usd: null, sena: 30000, fecha_sena: '2026-11-10', canal_cobra: true, habitacion: '107', categoria_id: 6, noches: 2, esperados: 3, canal_id: 1, ...extra });

console.log('\n== 1. Pesos: efectivo y transferencia (el ejemplo del dueño)');
let c = aCobrar(A(), 1000);
ok(c.efectivo.total === 100000 && c.efectivo.resta === 70000, 'efectivo 100.000 con seña de 30.000: quedan 70.000');
ok(c.transferencia.total === 110000 && c.transferencia.resta === 80000 && c.transferencia.igualEfectivo === false, 'transferencia 110.000 con seña de 30.000: quedan 80.000');
c = aCobrar(A({ precio_transferencia: null }), 1000);
ok(c.transferencia.total === 100000 && c.transferencia.resta === 70000 && c.transferencia.igualEfectivo === true, 'sin precio en transferencia se cobra igual que en efectivo');
c = aCobrar(A({ sena: 0 }), 1000);
ok(c.efectivo.resta === 100000 && c.transferencia.resta === 110000, 'sin seña se cobra todo');
c = aCobrar(A({ sena: 100000, precio_transferencia: 110000 }), 1000);
ok(c.efectivo.resta === 0 && c.transferencia.resta === 10000, 'una seña que cubre todo el efectivo deja 0, y en transferencia solo la diferencia');
ok(aCobrar(A({ sena: '30000.50', precio_efectivo: '100000' }), 1000).efectivo.resta === 69999.5, 'los números que llegan de la base como texto se leen bien');

console.log('\n== 2. Dólares con el dólar oficial');
c = aCobrar(A(), 1000); // sin precio en dólares: lo que resta en efectivo (70.000) al oficial
ok(c.usd.estimado === true && cerca(c.usd.total, 100) && cerca(c.usd.sena, 30) && cerca(c.usd.resta, 70), 'sin precio en dólares: lo que resta en efectivo (70.000) pasado al oficial de 1.000 = US$ 70, marcado como estimado');
c = aCobrar(A(), 1250);
ok(cerca(c.usd.resta, 56) && cerca(c.usd.total, 80), 'con el oficial a 1.250: 70.000 ÷ 1.250 = US$ 56');
c = aCobrar(A({ precio_usd: 90 }), 1000);
ok(c.usd.estimado === false && c.usd.total === 90 && cerca(c.usd.sena, 30) && cerca(c.usd.resta, 60), 'con precio en dólares (US$ 90): se descuenta la seña pasada a dólares: quedan US$ 60, sin estimar');
c = aCobrar(A({ precio_usd: 90, sena: 0 }), 1000);
ok(c.usd.resta === 90, 'sin seña se cobra el precio en dólares entero');
c = aCobrar(A({ precio_usd: 20 }), 1000);
ok(c.usd.resta === 0, 'una seña mayor que el precio en dólares no da negativo');
c = aCobrar(A(), null);
ok(c.usd === null && c.efectivo.resta === 70000, 'sin dólar oficial no se inventa nada: dólares queda sin calcular y los pesos siguen');
c = aCobrar(A({ precio_usd: 90, sena: 0 }), null);
ok(c.usd && c.usd.resta === 90 && c.usd.estimado === false, 'sin dólar oficial pero con precio en dólares y sin seña, sí se sabe');
c = aCobrar(A({ precio_usd: 90 }), null);
ok(c.usd === null, 'sin dólar oficial y con seña en pesos que convertir, no se puede');
ok(redondear(1.005) === 1.01 || redondear(1.005) === 1, 'redondea a centavos');

console.log('\n== 3. El medio de pago que mejor le queda a cada forma de cobrar');
const medios = [{ id: 1, nombre: 'Efectivo' }, { id: 2, nombre: 'Transferencia' }, { id: 3, nombre: 'USD efectivo' }, { id: 4, nombre: 'PayPal' }, { id: 5, nombre: 'Otros' }];
ok(medioSugerido(medios, 'efectivo') === 1 && medioSugerido(medios, 'transferencia') === 2 && medioSugerido(medios, 'usd') === 3, 'efectivo → «Efectivo», transferencia → «Transferencia», dólares → «USD efectivo» (no confunde «USD efectivo» con efectivo en pesos)');
ok(medioSugerido([{ id: 9, nombre: 'Pago en dólares' }], 'usd') === 9 && medioSugerido([{ id: 8, nombre: 'Tarjeta' }], 'efectivo') === null, 'si se llama distinto lo encuentra igual; si nada se parece, null');
ok(medioSugerido(null, 'usd') === null, 'sin lista no se rompe');

console.log('\n== 4. Lo que se le completa al formulario del check-in');
let p = prefillDe(A(), 'efectivo', 1000, medios);
ok(p.moneda === 'ARS' && p.monto === 100000 && p.sena === true && p.pago === 70000 && p.fecha_sena === '2026-11-10' && p.medio_pago === 1, 'efectivo: total 100.000, con seña, pagó en el hotel 70.000, su fecha y medio «Efectivo»');
ok(p.habitacion === '107' && p.noches === 2 && p.huespedes === 3 && p.categoria_id === 6 && p.canal_id === 1, 'y trae habitación, noches, huéspedes, categoría y canal');
p = prefillDe(A(), 'transferencia', 1000, medios);
ok(p.monto === 110000 && p.pago === 80000 && p.medio_pago === 2, 'transferencia: total 110.000, pagó en el hotel 80.000');
p = prefillDe(A(), 'usd', 1000, medios);
ok(p.moneda === 'USD' && cerca(p.monto, 100) && cerca(p.pago, 70) && p.sena === true && p.medio_pago === 3, 'dólares: moneda USD, total US$ 100 (el efectivo al oficial) y pagó en el hotel US$ 70');
p = prefillDe(A({ sena: 0, fecha_sena: null }), 'efectivo', 1000, medios);
ok(p.sena === false && p.pago === null && p.monto === 100000, 'sin seña el formulario queda como «pagó todo en el hotel»');
p = prefillDe(A(), 'usd', null, medios);
ok(p.moneda === 'USD' && p.monto === null && p.pago === null, 'dólares sin dólar oficial: el formulario queda para escribir el monto a mano');
p = prefillDe(A({ canal_cobra: false, precio_efectivo: 0 }), 'efectivo', 1000, medios);
ok(p.monto === undefined && p.habitacion === '107' && p.huespedes === 3, 'obra social: sin montos, con los datos de la estadía');

console.log(fallas ? `\n${fallas} fallas` : '\nTodo bien');
process.exit(fallas ? 1 : 0);
