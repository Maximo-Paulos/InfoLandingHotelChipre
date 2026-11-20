// Las cuentas de cobro de una reserva anotada: cuánto resta en efectivo, en transferencia y en dólares, y lo que se le completa al formulario del check-in.
//   node scripts/test-cobro.mjs
import { aCobrar, medioSugerido, redondear, reservaDeLlegada } from '../src/checkin/cobro.js';

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

console.log('\n== 4. La reserva que sale al confirmar el cobro (la habitación, noches y huéspedes salen tal cual de la anotada)');
const HOY = '2026-11-20';
let q = reservaDeLlegada(A(), 'efectivo', 1000, 2, HOY);
ok(q.habitacion === '107' && q.noches === 2 && q.huespedes === 3 && q.canal === 1 && q.categoria === 6 && q.fecha === HOY, 'lleva la habitación, noches, huéspedes, canal, categoría y el día del cobro');
ok(q.monto === 100000 && q.moneda === 'ARS' && q.medioPago === 2 && q.pagoHotel === 70000 && q.fechaSena === '2026-11-10', 'efectivo con seña: total 100.000, en el hotel 70.000 (lo que resta) y la fecha de la seña');
q = reservaDeLlegada(A(), 'transferencia', 1000, 3, HOY);
ok(q.monto === 110000 && q.pagoHotel === 80000 && q.moneda === 'ARS' && q.medioPago === 3, 'transferencia: total 110.000 y en el hotel 80.000');
q = reservaDeLlegada(A({ sena: 0 }), 'efectivo', 1000, 2, HOY);
ok(q.monto === 100000 && q.pagoHotel === 100000 && q.fechaSena === null, 'sin seña: pagó todo en el hotel y no hay fecha de seña');
q = reservaDeLlegada(A({ sena: 100000 }), 'efectivo', 1000, 2, HOY);
ok(q.monto === 100000 && q.pagoHotel === 0 && q.fechaSena === '2026-11-10', 'con una seña que cubre todo: en el hotel 0');
q = reservaDeLlegada(A(), 'usd', 1000, 4, HOY);
ok(q.moneda === 'USD' && cerca(q.monto, 100) && cerca(q.pagoHotel, 70) && q.medioPago === 4, 'dólares sin precio en dólares: se calcula con el oficial (US$ 100 en total, US$ 70 en el hotel)');
q = reservaDeLlegada(A({ precio_usd: 80 }), 'usd', 1250, 4, HOY);
ok(q.moneda === 'USD' && q.monto === 80 && cerca(q.pagoHotel, 80 - 24), 'dólares con precio en dólares cargado: US$ 80 menos la seña pasada a dólares');
ok(reservaDeLlegada(A(), 'usd', null, 4, HOY) === null, 'dólares sin cotización y con seña: no se puede calcular (null)');
q = reservaDeLlegada(A({ canal_cobra: false, precio_efectivo: 0, sena: 0 }), 'efectivo', 1000, null, HOY);
ok(q.monto === 0 && q.medioPago === null && q.pagoHotel === 0 && q.fechaSena === null && q.habitacion === '107', 'obra social: sin monto ni medio de pago, con los datos de la estadía');
q = reservaDeLlegada(A({ categoria_id: null }), 'efectivo', 1000, 2, HOY);
ok(q.categoria === null, 'una reserva anotada sin categoría sigue sin categoría');

console.log('\n== 5. Si en el mostrador se cobró otro monto: solo cambia lo cobrado, el resto de la reserva no');
q = reservaDeLlegada(A(), 'efectivo', 1000, 2, HOY, 60000);
ok(q.pagoHotel === 60000 && q.monto === 90000 && q.fechaSena === '2026-11-10', 'se cobraron 60.000 en vez de 70.000 (seña 30.000): el total de la reserva pasa a 90.000');
ok(q.habitacion === '107' && q.noches === 2 && q.huespedes === 3 && q.canal === 1 && q.categoria === 6, 'y la habitación, noches, huéspedes, canal y categoría quedan como estaban anotados');
q = reservaDeLlegada(A(), 'transferencia', 1000, 3, HOY, 90000);
ok(q.pagoHotel === 90000 && q.monto === 120000 && q.moneda === 'ARS', 'transferencia: cobraron 90.000 y con la seña el total es 120.000');
q = reservaDeLlegada(A({ sena: 0 }), 'efectivo', 1000, 2, HOY, 95000.5);
ok(q.pagoHotel === 95000.5 && q.monto === 95000.5 && q.fechaSena === null, 'sin seña el total es lo cobrado (acepta centavos)');
q = reservaDeLlegada(A(), 'usd', 1000, 4, HOY, 50);
ok(q.moneda === 'USD' && q.pagoHotel === 50 && cerca(q.monto, 80), 'dólares: cobraron US$ 50 y con la seña (US$ 30) el total es US$ 80');
for (const malo of [0, -5, 'abc', NaN, 1e9, 1e12, Infinity]) ok(reservaDeLlegada(A(), 'efectivo', 1000, 2, HOY, malo) === null, `un monto cobrado de ${String(malo)} no vale (null)`);
q = reservaDeLlegada(A({ canal_cobra: false, precio_efectivo: 0, sena: 0 }), 'efectivo', 1000, null, HOY, 5000);
ok(q.monto === 0 && q.pagoHotel === 0, 'con un canal que no cobra no se carga ningún monto, ni aunque se pase uno');

console.log(fallas ? `\n${fallas} fallas` : '\nTodo bien');
process.exit(fallas ? 1 : 0);
