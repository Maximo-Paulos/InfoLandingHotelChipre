// Decodificador de JPEG "de cámara" que devuelve la foto YA ACHICADA.
//
// Por qué existe: para achicar una foto el navegador primero la reconstruye entera en memoria (4 bytes por píxel: una foto de
// 12 MP ocupa ~50 MB, una de 50 MP ~200 MB y una de 108 MP ~430 MB). En celulares con poca memoria eso hace que el sistema cierre
// la página ("memoria insuficiente") y el huésped vuelve a empezar. Acá, en cambio, cada bloque de 8x8 del JPEG se reconstruye
// directamente a 1/2, 1/3, 1/4... de su tamaño usando solo las frecuencias bajas de la DCT (lo mismo que hace libjpeg con
// "scale_denom"): la memoria que se usa es la de la imagen chica (unos pocos MB), sin importar los megapíxeles de la cámara.
//
// Solo entiende lo que sacan las cámaras: JPEG secuencial (baseline), Huffman, 8 bits, 1 o 3 componentes. Con cualquier otra cosa
// (progresivo, CMYK, PNG, fotos chicas que no hace falta achicar...) devuelve null y la app usa el camino de siempre del navegador.
// Nunca devuelve una imagen a medias: ante cualquier cosa rara (archivo cortado, tablas inválidas) devuelve null.

// Devuelve ya mismo la memoria de un arreglo grande que no se va a usar más (sin esperar a que el navegador limpie solo). Si el navegador
// no sabe hacerlo, no pasa nada: la limpia más tarde. Después de llamarla el arreglo no se puede volver a usar.
export function liberar(arreglo) {
  try { arreglo?.buffer?.transfer?.(0); } catch { /* el navegador no puede: se limpia solo más tarde */ }
}

const ZZ = new Uint8Array([
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63
]);

// Con k > 4 (fotos de menos de ~3200 px de lado) el navegador las resuelve bien solo y no hace falta este decodificador.
const K_MAX = 4;
const MAX_PIXELES_SALIDA = 16e6;

// Orientación EXIF (1 a 8) del segmento APP1, o null.
function leerOrientacion(b, ini, fin) {
  if (fin - ini < 14 || b[ini] !== 0x45 || b[ini + 1] !== 0x78 || b[ini + 2] !== 0x69 || b[ini + 3] !== 0x66 || b[ini + 4] || b[ini + 5]) return null;
  const t = ini + 6;
  const le = b[t] === 0x49 && b[t + 1] === 0x49;
  if (!le && !(b[t] === 0x4d && b[t + 1] === 0x4d)) return null;
  const u16 = (o) => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
  const u32 = (o) => (le ? b[o] + b[o + 1] * 256 + b[o + 2] * 65536 + b[o + 3] * 16777216 : b[o] * 16777216 + b[o + 1] * 65536 + b[o + 2] * 256 + b[o + 3]);
  if (u16(t + 2) !== 42) return null;
  const ifd = t + u32(t + 4);
  if (ifd + 2 > fin) return null;
  const n = u16(ifd);
  for (let i = 0; i < n; i += 1) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > fin) return null;
    if (u16(e) === 0x0112) {
      const v = u16(e + 8);
      return v >= 1 && v <= 8 ? v : null;
    }
  }
  return null;
}

// Lee solo la cabecera (rápido, sin decodificar nada): { ancho, alto, componentes, precision, sof, orientacion } o null si no es JPEG.
export function infoJpeg(b) {
  if (!b || b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let pos = 2;
  let orientacion = 1;
  while (pos + 3 < b.length) {
    if (b[pos] !== 0xff) { pos += 1; continue; }
    const m = b[pos + 1];
    if (m === 0xff) { pos += 1; continue; }
    pos += 2;
    if (m === 0 || m === 1 || (m >= 0xd0 && m <= 0xd8)) continue;
    if (m === 0xd9) break;
    const len = (b[pos] << 8) | b[pos + 1];
    if (len < 2 || pos + len > b.length) return null;
    if (m === 0xe1) orientacion = leerOrientacion(b, pos + 2, pos + len) ?? orientacion;
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      if (len < 8) return null;
      return { sof: m, precision: b[pos + 2], alto: (b[pos + 3] << 8) | b[pos + 4], ancho: (b[pos + 5] << 8) | b[pos + 6], componentes: b[pos + 7], orientacion };
    }
    pos += len;
  }
  return null;
}

// ¿Vale la pena (y se puede) decodificar este JPEG ya achicado? Devuelve la escala k (la foto sale a k/8 de su tamaño) o 0 si no:
// solo JPEG secuencial de 8 bits con 1 o 3 componentes, y solo si es lo bastante grande (con k > 4 el navegador se arregla solo).
export function kParaAchicar(info, ladoMin = 1600) {
  if (!info || (info.sof !== 0xc0 && info.sof !== 0xc1) || info.precision !== 8 || (info.componentes !== 1 && info.componentes !== 3) || !info.ancho || !info.alto) return 0;
  const k = Math.ceil((ladoMin * 8) / Math.max(info.ancho, info.alto));
  return k >= 1 && k <= K_MAX ? k : 0;
}

// Tabla de Huffman: búsqueda rápida para los códigos de hasta 9 bits y lenta (por largo) para los de 10 a 16.
function construirHuffman(cuentas, valores) {
  const rapida = new Uint16Array(512);
  const maxcode = new Int32Array(18).fill(-1);
  const mincode = new Int32Array(18);
  const valptr = new Int32Array(18);
  let code = 0;
  let idx = 0;
  for (let len = 1; len <= 16; len += 1) {
    const c = cuentas[len - 1];
    valptr[len] = idx;
    mincode[len] = code;
    for (let i = 0; i < c; i += 1) {
      if (len <= 9) {
        const base = code << (9 - len);
        const n = 1 << (9 - len);
        for (let j = 0; j < n; j += 1) rapida[base + j] = (len << 8) | valores[idx];
      }
      code += 1;
      idx += 1;
    }
    if (code > 1 << len) throw new Error('huffman');
    maxcode[len] = c ? code - 1 : -1;
    code <<= 1;
  }
  return { rapida, maxcode, mincode, valptr, valores };
}

// Le devuelve el control a la pantalla para que no se trabe. Se usa un mensaje y no setTimeout: si el huésped cambia de aplicación
// mientras se prepara la foto, el navegador hace esperar 1 segundo a cada setTimeout de una pestaña en segundo plano.
const cederPaso = () => new Promise((resolver) => {
  if (typeof MessageChannel !== 'function') { setTimeout(resolver, 0); return; }
  const canal = new MessageChannel();
  canal.port1.onmessage = () => { canal.port1.close(); resolver(); };
  canal.port2.postMessage(null);
});

// final: lado más largo (en píxeles) de la foto que se quiere recibir YA TERMINADA (derecha y con colores); sin eso se devuelve la foto achicada
// a k/8 tal como sale del JPEG (solo para pruebas). onProgreso(0 a 1) se avisa cada vez que se le devuelve el control a la pantalla.
async function decodificar(b, { ladoMin, k: kForzado, final, onProgreso } = {}) {
  const info = infoJpeg(b);
  const k = kForzado ?? kParaAchicar(info, ladoMin);
  // (con k forzado, solo para pruebas, se salta la regla de tamaño pero no la de formato)
  if (!k || !info || (info.sof !== 0xc0 && info.sof !== 0xc1) || info.precision !== 8 || (info.componentes !== 1 && info.componentes !== 3) || !info.ancho || !info.alto || k > 8) return null;
  const W = info.ancho;
  const H = info.alto;
  const outW = Math.ceil((W * k) / 8);
  const outH = Math.ceil((H * k) / 8);
  if (outW * outH > MAX_PIXELES_SALIDA) return null;
  const n = b.length;

  // base de la DCT inversa de k puntos (ortonormal) ya multiplicada por sqrt(k/8) en cada pasada: así el resultado es el de
  // achicar el bloque de 8x8 a k x k
  const base = new Float32Array(k * k);
  for (let x = 0; x < k; x += 1) {
    for (let u = 0; u < k; u += 1) base[x * k + u] = (u === 0 ? Math.sqrt(1 / k) : Math.sqrt(2 / k)) * Math.cos(((2 * x + 1) * u * Math.PI) / (2 * k)) * Math.sqrt(k / 8);
  }
  const blk = new Float32Array(k * k);
  const tmp = new Float32Array(k * k);

  const qt = [null, null, null, null];
  const dcT = [null, null, null, null];
  const acT = [null, null, null, null];
  let ri = 0;
  let adobe = -1;
  let comps = null;
  let hmax = 1;
  let vmax = 1;
  let mcusX = 0;
  let mcusY = 0;
  let escaneos = 0;
  let esperados = 1; // cuántos recorridos tiene la foto (1, o uno por color si vienen separados): sirve para el avance

  // ---- lector de bits (con el relleno 0xFF00 de JPEG y los marcadores que cortan los datos)
  let pos = 0;
  let bitBuf = 0;
  let bitCnt = 0;
  let marcador = false;
  let faltante = 0;
  const llenar = () => {
    while (bitCnt <= 24) {
      let byte = 0;
      if (!marcador && pos < n) {
        byte = b[pos];
        pos += 1;
        if (byte === 0xff) {
          const sig = b[pos];
          if (sig === 0) pos += 1; // 0xFF00 = un 0xFF de datos
          else if (sig === 0xff) continue; // relleno
          else { marcador = true; pos -= 1; byte = 0; } // marcador (RSTn, EOI...): lo que falta se completa con ceros
        }
      } else if (!marcador) {
        faltante += 1; // se terminó el archivo antes de tiempo
      }
      bitBuf = (bitBuf << 8) | byte;
      bitCnt += 8;
    }
  };
  const bits = (s) => {
    if (bitCnt < s) llenar();
    bitCnt -= s;
    return (bitBuf >>> bitCnt) & ((1 << s) - 1);
  };
  const huff = (t) => {
    if (bitCnt < 16) llenar();
    const e = t.rapida[(bitBuf >>> (bitCnt - 9)) & 511];
    if (e) { bitCnt -= e >> 8; return e & 255; }
    for (let len = 10; len <= 16; len += 1) {
      const code = (bitBuf >>> (bitCnt - len)) & ((1 << len) - 1);
      if (t.maxcode[len] >= 0 && code <= t.maxcode[len] && code >= t.mincode[len]) { bitCnt -= len; return t.valores[t.valptr[len] + code - t.mincode[len]]; }
    }
    throw new Error('huffman');
  };

  // ---- un bloque de 8x8: se leen todos los coeficientes (hay que recorrer los bits), pero solo se usan los de baja frecuencia
  const bloque = (c, plano, off, stride) => {
    const s = huff(c.dc);
    if (s > 11) throw new Error('dc');
    if (s) {
      const v = bits(s);
      c.pred += v < 1 << (s - 1) ? v - (1 << s) + 1 : v;
    }
    blk.fill(0);
    const q = c.q;
    blk[0] = c.pred * q[0];
    let z = 1;
    while (z < 64) {
      const rs = huff(c.ac);
      const sz = rs & 15;
      const run = rs >> 4;
      if (sz === 0) {
        if (run === 15) { z += 16; continue; }
        break;
      }
      z += run;
      if (z > 63) break;
      const v = bits(sz);
      const nat = ZZ[z];
      const u = nat & 7;
      const w = nat >> 3;
      if (u < k && w < k) blk[w * k + u] = (v < 1 << (sz - 1) ? v - (1 << sz) + 1 : v) * q[z];
      z += 1;
    }
    // DCT inversa reducida (k x k)
    for (let v = 0; v < k; v += 1) {
      const vo = v * k;
      for (let x = 0; x < k; x += 1) {
        let acc = 0;
        const xo = x * k;
        for (let u = 0; u < k; u += 1) acc += base[xo + u] * blk[vo + u];
        tmp[vo + x] = acc;
      }
    }
    for (let y = 0; y < k; y += 1) {
      const yo = y * k;
      const po = off + y * stride;
      for (let x = 0; x < k; x += 1) {
        let acc = 128;
        for (let v = 0; v < k; v += 1) acc += base[yo + v] * tmp[v * k + x];
        plano[po + x] = acc <= 0 ? 0 : acc >= 255 ? 255 : (acc + 0.5) | 0;
      }
    }
  };

  const siguienteMarcador = () => {
    while (pos + 1 < n && !(b[pos] === 0xff && b[pos + 1] !== 0 && b[pos + 1] !== 0xff && !(b[pos + 1] >= 0xd0 && b[pos + 1] <= 0xd7))) pos += 1;
  };

  const escanear = async (ini, fin) => {
    const ns = b[ini];
    if (!comps || ns < 1 || ns > 3 || ini + 4 + ns * 2 > fin) throw new Error('sos');
    const sc = [];
    for (let i = 0; i < ns; i += 1) {
      const c = comps.find((x) => x.id === b[ini + 1 + i * 2]);
      const tb = b[ini + 2 + i * 2];
      if (!c) throw new Error('sos');
      c.dc = dcT[tb >> 4];
      c.ac = acT[tb & 15];
      c.q = qt[c.tq];
      if (!c.dc || !c.ac || !c.q) throw new Error('tablas');
      sc.push(c);
    }
    if (b[ini + 1 + ns * 2] !== 0 || b[ini + 2 + ns * 2] !== 63 || b[ini + 3 + ns * 2] !== 0) throw new Error('progresivo');
    pos = fin;
    bitBuf = 0;
    bitCnt = 0;
    marcador = false;
    faltante = 0;
    for (const c of sc) c.pred = 0;
    if (!escaneos) esperados = ns === 1 && comps.length > 1 ? comps.length : 1;
    let mcusAncho = mcusX;
    let mcusAlto = mcusY;
    if (ns === 1) {
      mcusAncho = Math.ceil(Math.ceil((W * sc[0].h) / hmax) / 8);
      mcusAlto = Math.ceil(Math.ceil((H * sc[0].v) / vmax) / 8);
    }
    let mcu = 0;
    let t0 = performance.now();
    for (let my = 0; my < mcusAlto; my += 1) {
      for (let mx = 0; mx < mcusAncho; mx += 1) {
        if (ri && mcu && mcu % ri === 0) {
          // marcador de reinicio: se descartan los bits que sobran y se vuelve a empezar con las diferencias en cero
          bitBuf = 0;
          bitCnt = 0;
          let intentos = 0;
          while (!(b[pos] === 0xff && b[pos + 1] >= 0xd0 && b[pos + 1] <= 0xd7)) {
            pos += 1;
            intentos += 1;
            if (pos + 1 >= n || intentos > 64) throw new Error('reinicio');
          }
          pos += 2;
          marcador = false;
          for (const c of sc) c.pred = 0;
        }
        if (ns === 1) {
          const c = sc[0];
          bloque(c, c.plano, my * k * c.stride + mx * k, c.stride);
        } else {
          for (const c of sc) {
            for (let v = 0; v < c.v; v += 1) {
              for (let h = 0; h < c.h; h += 1) bloque(c, c.plano, (my * c.v + v) * k * c.stride + (mx * c.h + h) * k, c.stride);
            }
          }
        }
        mcu += 1;
      }
      if (faltante > 16) throw new Error('cortado');
      // cada tanto se le devuelve el control a la pantalla para que no se trabe
      if (performance.now() - t0 > 30) {
        onProgreso?.(Math.min(0.9, ((escaneos + (my + 1) / mcusAlto) / esperados) * 0.9));
        await cederPaso();
        t0 = performance.now();
      }
    }
    for (const c of sc) c.cubierto = true;
    escaneos += 1;
    siguienteMarcador();
  };

  // ---- foto terminada: cada componente se lleva directo al tamaño de salida (interpolación bilineal: los de color suelen tener menos
  // resolución y la foto achicada a k/8 casi nunca coincide con lo que se pide), se pasa a RGB y se acomoda según la orientación del celular.
  // Así NO hace falta armar la foto achicada entera en colores (4 bytes por píxel) ni copiarla después a otro lienzo: es lo que más memoria ocupaba.
  const aFinal = async (ladoMax) => {
    const esc = Math.min(1, ladoMax / Math.max(W, H));
    const Ws = Math.max(1, Math.round(W * esc)); // tamaño de salida tal como está guardada la foto (sin girar)
    const Hs = Math.max(1, Math.round(H * esc));
    const o = info.orientacion;
    const Wf = o >= 5 ? Hs : Ws; // tamaño de salida ya girada
    const Hf = o >= 5 ? Ws : Hs;
    if (Wf * Hf > MAX_PIXELES_SALIDA) return null;
    const Wr = (W * k) / 8; // tamaño real de la foto achicada (puede no ser un número entero de píxeles)
    const Hr = (H * k) / 8;

    // Para cada columna (y fila) de salida: de qué dos píxeles del componente sale y con qué peso (0 a 256).
    const tabla = (n, real, factor, validos) => {
      const i0 = new Int32Array(n);
      const i1 = new Int32Array(n);
      const w = new Uint16Array(n);
      for (let i = 0; i < n; i += 1) {
        let u = (i + 0.5) * (real / n) * factor - 0.5;
        if (u < 0) u = 0;
        if (u > validos - 1) u = validos - 1;
        const a = Math.floor(u);
        i0[i] = a;
        i1[i] = Math.min(a + 1, validos - 1);
        w[i] = Math.round((u - a) * 256);
      }
      return { i0, i1, w };
    };
    const ejes = comps.map((c) => {
      const fh = c.h / hmax;
      const fv = c.v / vmax;
      return { x: tabla(Ws, Wr, fh, Math.ceil(Wr * fh)), y: tabla(Hs, Hr, fv, Math.ceil(Hr * fv)), stride: c.stride, plano: c.plano };
    });

    // De dónde sale cada píxel de la foto terminada: xs = ax + bx*X + cx*Y, ys = ay + by*X + cy*Y (X, Y: columna y fila de salida).
    const [ax, bx, cx, ay, by, cy] = {
      1: [0, 1, 0, 0, 0, 1],
      2: [Ws - 1, -1, 0, 0, 0, 1],
      3: [Ws - 1, -1, 0, Hs - 1, 0, -1],
      4: [0, 1, 0, Hs - 1, 0, -1],
      5: [0, 0, 1, 0, 1, 0],
      6: [0, 0, 1, Hs - 1, -1, 0],
      7: [Ws - 1, 0, -1, Hs - 1, -1, 0],
      8: [Ws - 1, 0, -1, 0, 1, 0]
    }[o];

    const rgba = new Uint8ClampedArray(Wf * Hf * 4);
    const gris = ejes.length === 1;
    const rgbDirecto = !gris && (adobe === 0 || (comps[0].id === 0x52 && comps[1].id === 0x47 && comps[2].id === 0x42));
    const [e0, e1, e2] = ejes;
    const P0 = e0.plano;
    const P1 = e1?.plano;
    const P2 = e2?.plano;
    let ysPrev = -1;
    let a0 = 0; let b0 = 0; let fy0 = 0; let a1 = 0; let b1 = 0; let fy1 = 0; let a2 = 0; let b2 = 0; let fy2 = 0; // filas de cada componente para la fila de origen ys
    let t0 = performance.now();
    for (let Y = 0; Y < Hf; Y += 1) {
      let po = Y * Wf * 4;
      for (let X = 0; X < Wf; X += 1) {
        const xs = ax + bx * X + cx * Y;
        const ys = ay + by * X + cy * Y;
        if (ys !== ysPrev) {
          ysPrev = ys;
          a0 = e0.y.i0[ys] * e0.stride; b0 = e0.y.i1[ys] * e0.stride; fy0 = e0.y.w[ys];
          if (!gris) {
            a1 = e1.y.i0[ys] * e1.stride; b1 = e1.y.i1[ys] * e1.stride; fy1 = e1.y.w[ys];
            a2 = e2.y.i0[ys] * e2.stride; b2 = e2.y.i1[ys] * e2.stride; fy2 = e2.y.w[ys];
          }
        }
        let tx = e0.x.i0[xs]; let ux = e0.x.i1[xs]; let fx = e0.x.w[xs];
        const Yv = ((P0[a0 + tx] * (256 - fx) + P0[a0 + ux] * fx) * (256 - fy0) + (P0[b0 + tx] * (256 - fx) + P0[b0 + ux] * fx) * fy0 + 32768) >> 16;
        if (gris) {
          rgba[po] = Yv; rgba[po + 1] = Yv; rgba[po + 2] = Yv;
        } else {
          tx = e1.x.i0[xs]; ux = e1.x.i1[xs]; fx = e1.x.w[xs];
          const Cb = ((P1[a1 + tx] * (256 - fx) + P1[a1 + ux] * fx) * (256 - fy1) + (P1[b1 + tx] * (256 - fx) + P1[b1 + ux] * fx) * fy1 + 32768) >> 16;
          tx = e2.x.i0[xs]; ux = e2.x.i1[xs]; fx = e2.x.w[xs];
          const Cr = ((P2[a2 + tx] * (256 - fx) + P2[a2 + ux] * fx) * (256 - fy2) + (P2[b2 + tx] * (256 - fx) + P2[b2 + ux] * fx) * fy2 + 32768) >> 16;
          if (rgbDirecto) {
            rgba[po] = Yv; rgba[po + 1] = Cb; rgba[po + 2] = Cr;
          } else {
            rgba[po] = Yv + 1.402 * (Cr - 128);
            rgba[po + 1] = Yv - 0.344136 * (Cb - 128) - 0.714136 * (Cr - 128);
            rgba[po + 2] = Yv + 1.772 * (Cb - 128);
          }
        }
        rgba[po + 3] = 255;
        po += 4;
      }
      if (performance.now() - t0 > 30) {
        onProgreso?.(0.9 + (0.1 * (Y + 1)) / Hf);
        await cederPaso();
        t0 = performance.now();
      }
    }
    for (const c of comps) liberar(c.plano); // los componentes ya no hacen falta: se devuelve esa memoria enseguida
    onProgreso?.(1);
    return { ancho: Wf, alto: Hf, rgba, orientacion: o, k };
  };

  // ---- recorrido de los segmentos
  pos = 2;
  while (pos + 3 < n) {
    if (b[pos] !== 0xff) { pos += 1; continue; }
    const m = b[pos + 1];
    if (m === 0xff) { pos += 1; continue; }
    pos += 2;
    if (m === 0 || m === 1 || (m >= 0xd0 && m <= 0xd8)) continue;
    if (m === 0xd9) break;
    const len = (b[pos] << 8) | b[pos + 1];
    const ini = pos + 2;
    const fin = pos + len;
    if (len < 2 || fin > n) throw new Error('segmento');
    if (m === 0xdb) {
      let p = ini;
      while (p < fin) {
        const pq = b[p] >> 4;
        const tq = b[p] & 15;
        p += 1;
        if (tq > 3) throw new Error('dqt');
        const t = new Int32Array(64);
        for (let i = 0; i < 64; i += 1) {
          if (pq) { t[i] = (b[p] << 8) | b[p + 1]; p += 2; } else { t[i] = b[p]; p += 1; }
        }
        qt[tq] = t;
      }
    } else if (m === 0xc4) {
      let p = ini;
      while (p < fin) {
        const tc = b[p] >> 4;
        const th = b[p] & 15;
        p += 1;
        if (tc > 1 || th > 3) throw new Error('dht');
        const cuentas = b.subarray(p, p + 16);
        p += 16;
        let total = 0;
        for (let i = 0; i < 16; i += 1) total += cuentas[i];
        if (total > 256 || p + total > fin) throw new Error('dht');
        (tc === 0 ? dcT : acT)[th] = construirHuffman(cuentas, b.subarray(p, p + total));
        p += total;
      }
    } else if (m === 0xdd) {
      ri = (b[ini] << 8) | b[ini + 1];
    } else if (m === 0xee && fin - ini >= 12 && b[ini] === 0x41 && b[ini + 1] === 0x64 && b[ini + 2] === 0x6f && b[ini + 3] === 0x62 && b[ini + 4] === 0x65) {
      adobe = b[ini + 11];
    } else if (m === 0xc0 || m === 0xc1) {
      if (comps) throw new Error('dos SOF');
      const nc = b[ini + 5];
      if (nc !== info.componentes || ini + 6 + nc * 3 > fin) throw new Error('sof');
      comps = [];
      for (let i = 0; i < nc; i += 1) {
        const hv = b[ini + 7 + i * 3];
        const c = { id: b[ini + 6 + i * 3], h: nc === 1 ? 1 : hv >> 4, v: nc === 1 ? 1 : hv & 15, tq: b[ini + 8 + i * 3], pred: 0, cubierto: false };
        if (c.h < 1 || c.h > 4 || c.v < 1 || c.v > 4 || c.tq > 3) throw new Error('sof');
        comps.push(c);
      }
      hmax = Math.max(...comps.map((c) => c.h));
      vmax = Math.max(...comps.map((c) => c.v));
      mcusX = Math.ceil(W / (8 * hmax));
      mcusY = Math.ceil(H / (8 * vmax));
      for (const c of comps) {
        c.stride = mcusX * c.h * k;
        c.plano = new Uint8Array(c.stride * mcusY * c.v * k).fill(128);
      }
    } else if (m === 0xda) {
      await escanear(ini, fin);
      continue;
    }
    pos = fin;
  }
  if (!comps || !escaneos || comps.some((c) => !c.cubierto)) throw new Error('incompleto');

  if (final) return aFinal(final);

  // ---- a colores: se estira cada componente al tamaño de la imagen chica (los de color suelen tener menos resolución) y se pasa de YCbCr a RGB
  const rgba = new Uint8ClampedArray(outW * outH * 4);
  const cols = comps.map((c) => { const m = new Uint32Array(outW); for (let x = 0; x < outW; x += 1) m[x] = Math.floor((x * c.h) / hmax); return m; });
  const filas = comps.map((c) => { const m = new Uint32Array(outH); for (let y = 0; y < outH; y += 1) m[y] = Math.floor((y * c.v) / vmax) * c.stride; return m; });
  if (comps.length === 1) {
    const [c] = comps;
    for (let y = 0; y < outH; y += 1) {
      const fo = filas[0][y];
      let o = y * outW * 4;
      for (let x = 0; x < outW; x += 1) {
        const g = c.plano[fo + cols[0][x]];
        rgba[o] = g; rgba[o + 1] = g; rgba[o + 2] = g; rgba[o + 3] = 255;
        o += 4;
      }
    }
  } else {
    const [cy, cb, cr] = comps;
    const rgbDirecto = adobe === 0 || (cy.id === 0x52 && cb.id === 0x47 && cr.id === 0x42);
    for (let y = 0; y < outH; y += 1) {
      const fy = filas[0][y];
      const fb = filas[1][y];
      const fr = filas[2][y];
      let o = y * outW * 4;
      for (let x = 0; x < outW; x += 1) {
        const Y = cy.plano[fy + cols[0][x]];
        const Cb = cb.plano[fb + cols[1][x]];
        const Cr = cr.plano[fr + cols[2][x]];
        if (rgbDirecto) {
          rgba[o] = Y; rgba[o + 1] = Cb; rgba[o + 2] = Cr;
        } else {
          rgba[o] = Y + 1.402 * (Cr - 128);
          rgba[o + 1] = Y - 0.344136 * (Cb - 128) - 0.714136 * (Cr - 128);
          rgba[o + 2] = Y + 1.772 * (Cb - 128);
        }
        rgba[o + 3] = 255;
        o += 4;
      }
    }
  }
  return { ancho: outW, alto: outH, rgba, orientacion: info.orientacion, k };
}

// b: los bytes del archivo (Uint8Array). Devuelve { ancho, alto, rgba, orientacion } con la foto achicada (sin aplicar la orientación EXIF),
// o null si no se puede (el que llama usa entonces el camino normal del navegador).
//   ladoMin: lado más largo que se quiere conservar como mínimo (la foto se achica lo más posible sin quedar más chica que eso)
//   k: (solo para pruebas) fuerza la escala k/8
export async function decodificarReducido(b, { ladoMin = 1600, k } = {}) {
  try {
    return await decodificar(b, { ladoMin, k });
  } catch {
    return null;
  }
}

// b: los bytes del archivo (Uint8Array). Devuelve { ancho, alto, rgba, orientacion } con la foto YA TERMINADA: con el lado más largo en
// `ladoMax` como máximo (nunca se agranda), derecha según la orientación del celular y en colores (4 bytes por píxel). O null si no se puede
// (el que llama usa entonces el camino normal del navegador).
//   onProgreso(0 a 1): se avisa cada tanto mientras trabaja
//   k: (solo para pruebas) fuerza la escala k/8 del JPEG
export async function decodificarFinal(b, { ladoMax = 1600, onProgreso, k } = {}) {
  try {
    return await decodificar(b, { ladoMin: ladoMax, final: ladoMax, onProgreso, k });
  } catch {
    return null;
  }
}
