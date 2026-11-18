// Dólar oficial día por día, para pasar lo cobrado en pesos a dólares con la cotización del día del cobro.
// Sale de una API pública y gratuita (ArgentinaDatos); no se le manda ningún dato del hotel ni de los huéspedes: es solo una consulta de lectura.
// Se usa el valor de VENTA del oficial. Si la API no responde, las estadísticas siguen andando y avisan cuántos cobros en pesos quedaron sin convertir.
const URL = 'https://api.argentinadatos.com/v1/cotizaciones/dolares/oficial';

let pedido = null;
// -> [{ fecha: 'AAAA-MM-DD', venta: 1575 }] de menor a mayor fecha
export function cargarCotizaciones() {
  if (!pedido) {
    pedido = fetch(URL, { headers: { accept: 'application/json' } })
      .then((r) => { if (!r.ok) throw new Error('cotizaciones'); return r.json(); })
      .then((lista) => lista
        .filter((x) => typeof x.fecha === 'string' && Number(x.venta) > 0 && x.fecha >= '2020-01-01')
        .map((x) => ({ fecha: x.fecha, venta: Number(x.venta) }))
        .sort((a, b) => (a.fecha < b.fecha ? -1 : 1)))
      .catch((e) => { pedido = null; throw e; }); // si falló, la próxima vez vuelve a intentar
  }
  return pedido;
}
