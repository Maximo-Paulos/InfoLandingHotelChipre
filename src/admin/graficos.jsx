import { useState } from 'react';

// Gráficos chicos, hechos a mano en SVG/HTML (sin librería): columnas, línea, barras ordenadas y torta.
// Colores y tamaños salen de styles.css (.gr-*), así que se pueden ajustar sin tocar este archivo.
// Cada tarjeta trae «Ver números» con la misma información en una tabla: sirve con teclado y lector de pantalla, y nada depende de pasar el mouse.

const W = 360; // ancho del dibujo; el SVG se achica o agranda con la pantalla
const redondo = (max) => { // un tope «lindo» para el eje (10, 20, 50, 100, 200…)
  if (max <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  const f = max / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
};
const corto = (n) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : n >= 1e3 ? n.toLocaleString('es-AR') : String(n));
// Los números del eje: un solo estilo por eje (todos en K si el eje llega a 10.000, todos completos si no).
const eje = (n, tope) => (tope >= 1e4 && n >= 1e3 ? `${+(n / 1e3).toFixed(1)}K` : n.toLocaleString('es-AR'));

// Un cartelito que acompaña al puntero. `tip` = { x, texto, valor } con x en unidades del dibujo.
function Cartel({ tip, alto }) {
  if (!tip) return null;
  return (
    <div className="gr-cartel" style={{ left: `${(tip.x / W) * 100}%`, top: 0, '--alto': `${alto}px` }} role="presentation">
      <b>{tip.valor}</b><span>{tip.texto}</span>
    </div>
  );
}

// Columnas (una por etiqueta). datos: [{ texto, valor }] · formato(valor) -> texto · resaltar: índice o 'max' · enteros: el eje marca solo números enteros
export function Columnas({ datos, formato = corto, alto = 150, resaltar = 'max', nombre, enteros = false }) {
  const [tip, setTip] = useState(null);
  const m = { i: 36, d: 6, s: 14, b: 22 };
  const n = datos.length;
  const max = Math.max(...datos.map((d) => d.valor ?? 0), 0);
  const tope = enteros && max <= 4 ? 4 : redondo(max); // en cuentas de personas o habitaciones el eje no marca medias
  const ancho = (W - m.i - m.d) / Math.max(n, 1);
  const grueso = Math.min(24, ancho * 0.72);
  const y = (v) => m.s + (alto - m.s - m.b) * (1 - v / tope);
  const cadaTanto = Math.max(1, Math.ceil(n / 12));
  const iMax = resaltar === 'max' && max > 0 ? datos.findIndex((d) => d.valor === max) : resaltar;
  return (
    <div className="gr-lienzo">
      <svg viewBox={`0 0 ${W} ${alto}`} role="img" aria-label={nombre} className="gr-svg" onPointerLeave={() => setTip(null)}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line className="gr-grilla" x1={m.i} x2={W - m.d} y1={y(tope * f)} y2={y(tope * f)} />
            <text className="gr-eje" x={m.i - 6} y={y(tope * f) + 4} textAnchor="end">{eje(+(tope * f).toFixed(2), tope)}</text>
          </g>
        ))}
        {datos.map((d, i) => {
          const cx = m.i + ancho * (i + 0.5);
          const alt = Math.max(0, y(0) - y(d.valor ?? 0));
          return (
            <g key={i}>
              {alt > 0 && (
                <path className={`gr-barra${i === iMax ? ' fuerte' : ''}${tip?.i === i ? ' sobre' : ''}`}
                  d={`M${cx - grueso / 2},${y(0)} v${-Math.max(alt - 4, 0)} q0,-4 4,-4 h${grueso - 8} q4,0 4,4 v${Math.max(alt - 4, 0)} z`} />
              )}
              {i === iMax && alt > 0 && <text className="gr-valor" x={cx} y={y(d.valor) - 5} textAnchor="middle">{formato(d.valor)}</text>}
              {i % cadaTanto === 0 && <text className="gr-eje" x={cx} y={alto - 6} textAnchor="middle">{d.texto}</text>}
              <rect x={m.i + ancho * i} y={m.s} width={ancho} height={alto - m.s - m.b} fill="transparent"
                onPointerEnter={() => setTip({ i, x: cx, texto: d.texto, valor: formato(d.valor ?? 0) })} onPointerMove={() => setTip({ i, x: cx, texto: d.texto, valor: formato(d.valor ?? 0) })} />
            </g>
          );
        })}
      </svg>
      <Cartel tip={tip} alto={alto} />
    </div>
  );
}

// Línea en el tiempo. datos: [{ texto, valor }] (valor null = sin dato ese día: corta la línea)
export function Linea({ datos, formato = corto, alto = 150, nombre }) {
  const [tip, setTip] = useState(null);
  const m = { i: 36, d: 12, s: 14, b: 22 };
  const n = datos.length;
  const max = Math.max(...datos.map((d) => d.valor ?? 0), 0);
  const tope = redondo(max);
  const x = (i) => m.i + ((W - m.i - m.d) * (n <= 1 ? 0.5 : i / (n - 1)));
  const y = (v) => m.s + (alto - m.s - m.b) * (1 - v / tope);
  const tramos = [];
  datos.forEach((d, i) => {
    if (d.valor == null) { tramos.push(null); return; }
    if (!tramos.length || tramos[tramos.length - 1] === null) tramos.push([]);
    tramos[tramos.length - 1].push(`${x(i)},${y(d.valor)}`);
  });
  const ultimo = [...datos.keys()].reverse().find((i) => datos[i].valor != null);
  const cadaTanto = Math.max(1, Math.ceil(n / 8));
  return (
    <div className="gr-lienzo">
      <svg viewBox={`0 0 ${W} ${alto}`} role="img" aria-label={nombre} className="gr-svg" onPointerLeave={() => setTip(null)}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line className="gr-grilla" x1={m.i} x2={W - m.d} y1={y(tope * f)} y2={y(tope * f)} />
            <text className="gr-eje" x={m.i - 6} y={y(tope * f) + 4} textAnchor="end">{eje(+(tope * f).toFixed(2), tope)}</text>
          </g>
        ))}
        {tramos.filter(Boolean).map((p, k) => (p.length > 1 ? <polyline key={k} className="gr-linea" points={p.join(' ')} /> : null))}
        {tip && <line className="gr-mira" x1={x(tip.i)} x2={x(tip.i)} y1={m.s} y2={alto - m.b} />}
        {datos.map((d, i) => (d.valor != null && (i === ultimo || tip?.i === i || n <= 14) ? <circle key={i} className="gr-punto" cx={x(i)} cy={y(d.valor)} r={4} /> : null))}
        {ultimo != null && <text className="gr-valor" x={x(ultimo)} y={y(datos[ultimo].valor) - 9} textAnchor={ultimo > n - 3 ? 'end' : 'middle'}>{formato(datos[ultimo].valor)}</text>}
        {datos.map((d, i) => (i % cadaTanto === 0 ? <text key={i} className="gr-eje" x={x(i)} y={alto - 6} textAnchor="middle">{d.texto}</text> : null))}
        {datos.map((d, i) => (
          <rect key={i} x={x(i) - (W - m.i - m.d) / Math.max(n - 1, 1) / 2} y={m.s} width={(W - m.i - m.d) / Math.max(n - 1, 1)} height={alto - m.s - m.b} fill="transparent"
            onPointerEnter={() => setTip({ i, x: x(i), texto: d.texto, valor: d.valor == null ? 'sin datos' : formato(d.valor) })}
            onPointerMove={() => setTip({ i, x: x(i), texto: d.texto, valor: d.valor == null ? 'sin datos' : formato(d.valor) })} />
        ))}
      </svg>
      <Cartel tip={tip} alto={alto} />
    </div>
  );
}

// Barras horizontales ordenadas: el valor va en la punta. datos: [{ texto, valor, nota? }]
export function BarrasH({ datos, formato = corto, max: tope }) {
  const max = tope ?? Math.max(...datos.map((d) => d.valor), 0);
  return (
    <ul className="gr-filas">
      {datos.map((d) => (
        <li key={d.texto}>
          <span className="gr-nombre" title={d.texto}>{d.texto}</span>
          <span className="gr-pista"><span className="gr-relleno" style={{ width: `${max ? Math.max((d.valor / max) * 100, d.valor > 0 ? 2 : 0) : 0}%` }} /></span>
          <span className="gr-cifra"><b>{formato(d.valor)}</b>{d.nota && <small>{d.nota}</small>}</span>
        </li>
      ))}
    </ul>
  );
}

// Torta (con agujero) de hasta 6 partes; al pasar por una se ve su nombre y porcentaje en el centro. datos: [{ texto, n, otros? }]
export function Torta({ datos, nombre }) {
  const [activa, setActiva] = useState(null);
  const total = datos.reduce((a, d) => a + d.n, 0);
  const R = 15.9155; // la circunferencia mide 100: así el largo de cada arco es su porcentaje
  let acumulado = 0;
  const arcos = datos.map((d, i) => {
    const largo = total ? (d.n / total) * 100 : 0;
    const arco = { ...d, i, largo, desde: acumulado };
    acumulado += largo;
    return arco;
  });
  const a = activa != null ? arcos[activa] : null;
  return (
    <div className="gr-torta">
      <svg viewBox="0 0 42 42" role="img" aria-label={nombre} onPointerLeave={() => setActiva(null)}>
        <circle className="gr-hueco" cx="21" cy="21" r={R} />
        {arcos.map((s) => s.largo > 0 && (
          <circle key={s.i} className={`gr-trozo c${s.otros ? 'o' : s.i}${activa === s.i ? ' sobre' : ''}`} cx="21" cy="21" r={R}
            strokeDasharray={`${Math.max(s.largo - (arcos.length > 1 ? 0.6 : 0), 0.1)} ${100 - Math.max(s.largo - (arcos.length > 1 ? 0.6 : 0), 0.1)}`}
            strokeDashoffset={25 - s.desde}
            onPointerEnter={() => setActiva(s.i)} onPointerMove={() => setActiva(s.i)} />
        ))}
        <text className="gr-centro" x="21" y={a ? 20.2 : 22} textAnchor="middle">{a ? `${Math.round((a.n / total) * 100)}%` : total}</text>
        <text className="gr-centro-sub" x="21" y="25.2" textAnchor="middle">{a ? (a.texto.length > 14 ? `${a.texto.slice(0, 13)}…` : a.texto) : 'huéspedes'}</text>
      </svg>
      <ul className="gr-leyenda">
        {arcos.map((s) => (
          <li key={s.i} className={activa === s.i ? 'sobre' : ''} onPointerEnter={() => setActiva(s.i)} onPointerLeave={() => setActiva(null)}>
            <i className={`gr-llave c${s.otros ? 'o' : s.i}`} aria-hidden="true" />
            <span className="gr-nombre" title={s.texto}>{s.texto}</span>
            <b>{s.n}</b>
            <small>{total ? Math.round((s.n / total) * 100) : 0}%</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

// El marco de cada gráfico: título, una línea que explica para qué sirve, el gráfico y «Ver números».
//   tabla: { cols: ['Mes', 'USD'], filas: [['ene', '1.200'], …] }
export function Tarjeta({ titulo, ayuda, tabla, children, ancha = false }) {
  return (
    <section className={`gr-tarjeta${ancha ? ' ancha' : ''}`}>
      <h3>{titulo}</h3>
      {ayuda && <p className="gr-ayuda">{ayuda}</p>}
      {children}
      {tabla && (
        <details className="gr-numeros">
          <summary>Ver números</summary>
          <div className="gr-tabla-scroll">
            <table>
              <thead><tr>{tabla.cols.map((c, i) => <th key={c} scope="col" className={i ? 'der' : ''}>{c}</th>)}</tr></thead>
              <tbody>{tabla.filas.map((f, i) => <tr key={i}>{f.map((c, j) => (j ? <td key={j} className="der">{c}</td> : <th key={j} scope="row">{c}</th>))}</tr>)}</tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}

// Un número grande con cuánto cambió respecto del período anterior. bueno: ¿subir es bueno? (para pintar el cambio)
export function Cifra({ etiqueta, valor, sub, cambio = null, bueno = true }) {
  const sube = cambio != null && cambio > 0.5;
  const baja = cambio != null && cambio < -0.5;
  return (
    <div className="gr-cifra-card">
      <p className="gr-etiqueta">{etiqueta}</p>
      <p className="gr-grande">{valor}</p>
      {cambio != null && (
        <p className={`gr-cambio${sube ? (bueno ? ' bien' : ' mal') : baja ? (bueno ? ' mal' : ' bien') : ''}`}>
          {sube ? '▲' : baja ? '▼' : '='} {sube || baja ? `${Math.abs(Math.round(cambio))}%` : 'igual'} <span>vs. período anterior</span>
        </p>
      )}
      {sub && <p className="gr-sub">{sub}</p>}
    </div>
  );
}
