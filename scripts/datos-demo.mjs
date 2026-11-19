// Datos ficticios para probar la guía en tu compu: casi un año de reservas (con noches, categoría y canal de venta, incluida la obra social), huéspedes de varios países, pagos en pesos y dólares.
//   npm run local            (con estos datos)      ·      npm run local -- --vacio     (sin nada, para probar desde cero)
// Todo es inventado (nombres, documentos, emails y teléfonos no existen). Siempre da lo mismo: usa un generador de números fijo.
// Las fechas son relativas a hoy, así las estadísticas siempre tienen un año «reciente» para mirar.

const DIAS = 330;
// cat: categoría (la del arranque de supabase/estadias.sql) · base: tarifa por noche en dólares · cap: huéspedes que entran en la habitación
const CATEGORIAS = { Single: 2, Doble: 3, Triple: 4, Cuádruple: 5 };
const HABITACIONES = [
  ...['101', '102', '103', '104'].map((n) => ({ n, cat: 'Single', base: 34, peso: 1 })),
  ...['105', '106', '107', '108'].map((n) => ({ n, cat: 'Doble', base: 44, peso: n === '108' ? 0.25 : n === '105' ? 1.5 : 1 })),
  ...['201', '202', '203', '204'].map((n) => ({ n, cat: 'Doble', base: 48, peso: n === '204' ? 1.7 : 1.2 })),
  ...['205', '206', '207', '208'].map((n) => ({ n, cat: 'Triple', base: 60, peso: n === '205' ? 1.7 : 1.2 })),
  ...['301', '302', '303', '304'].map((n) => ({ n, cat: 'Triple', base: 62, peso: 0.8 })),
  ...['305', '306'].map((n) => ({ n, cat: 'Cuádruple', base: 76, peso: n === '306' ? 0.2 : 0.8 }))
];
// canal de venta: [nombre, peso]. La obra social no lleva monto: se factura aparte (y viene gente más grande, casi toda de Argentina).
const CANALES = [['Directo', 62], ['Online', 13], ['Agencia', 8], ['Obra social', 17]];
const NOCHES = [[1, 26], [2, 31], [3, 19], [4, 10], [5, 6], [6, 3], [7, 3], [10, 2]];
// país: [peso, idioma, prefijo de teléfono, localidades, nombres de pila, apellidos]
const PAISES = {
  Argentina: [52, 'es', '+54911', ['Capital Federal', 'Córdoba', 'Rosario', 'Mendoza', 'La Plata', 'Mar del Plata', 'San Miguel de Tucumán', 'Salta', 'Neuquén', 'Bahía Blanca', 'San Isidro', 'Quilmes'],
    ['Lucas', 'Sofía', 'Mateo', 'Valentina', 'Martín', 'Camila', 'Nicolás', 'Julieta', 'Federico', 'Agustina', 'Diego', 'Florencia', 'Gonzalo', 'Paula', 'Santiago', 'Carolina'],
    ['González', 'Rodríguez', 'Fernández', 'López', 'Martínez', 'Pérez', 'Gómez', 'Sánchez', 'Díaz', 'Romero', 'Sosa', 'Álvarez', 'Torres', 'Ruiz', 'Acosta', 'Benítez']],
  Brasil: [12, 'pt', '+5511', ['São Paulo', 'Rio de Janeiro', 'Porto Alegre', 'Curitiba', 'Belo Horizonte', 'Florianópolis'],
    ['Pedro', 'Ana', 'João', 'Beatriz', 'Rafael', 'Larissa', 'Bruno', 'Camila'], ['Silva', 'Santos', 'Oliveira', 'Souza', 'Costa', 'Pereira', 'Almeida', 'Ribeiro']],
  Uruguay: [7, 'es', '+5989', ['Montevideo', 'Colonia del Sacramento', 'Punta del Este', 'Salto'], ['Joaquín', 'Lucía', 'Bruno', 'Micaela', 'Santiago', 'Valeria'], ['Techera', 'Píriz', 'Cabrera', 'Rodríguez', 'Olivera', 'Silveira']],
  Chile: [6, 'es', '+5698', ['Santiago', 'Valparaíso', 'Concepción', 'Viña del Mar'], ['Matías', 'Francisca', 'Vicente', 'Catalina', 'Tomás', 'Javiera'], ['Muñoz', 'Rojas', 'Soto', 'Contreras', 'Silva', 'Tapia']],
  'Estados Unidos': [5, 'en', '+1415', ['Nueva York', 'Miami', 'Los Ángeles', 'Chicago', 'Austin'], ['James', 'Emily', 'Michael', 'Olivia', 'Daniel', 'Hannah'], ['Smith', 'Johnson', 'Miller', 'Davis', 'Wilson', 'Taylor']],
  España: [5, 'es', '+346', ['Madrid', 'Barcelona', 'Valencia', 'Sevilla', 'Bilbao'], ['Álvaro', 'Marta', 'Javier', 'Laura', 'Pablo', 'Elena'], ['García', 'Martín', 'Jiménez', 'Navarro', 'Molina', 'Ortega']],
  Paraguay: [3, 'es', '+5959', ['Asunción', 'Ciudad del Este', 'Encarnación'], ['Derlis', 'Fátima', 'Rodrigo', 'Liz'], ['Villalba', 'Benítez', 'Giménez', 'Ayala']],
  Alemania: [2, 'en', '+4915', ['Berlín', 'Múnich', 'Hamburgo', 'Colonia'], ['Lukas', 'Anna', 'Jonas', 'Lena'], ['Müller', 'Schmidt', 'Schneider', 'Fischer']],
  Francia: [2, 'en', '+336', ['París', 'Lyon', 'Marsella', 'Burdeos'], ['Hugo', 'Camille', 'Louis', 'Chloé'], ['Martin', 'Bernard', 'Dubois', 'Moreau']],
  Italia: [2, 'en', '+393', ['Roma', 'Milán', 'Turín', 'Nápoles'], ['Marco', 'Giulia', 'Luca', 'Chiara'], ['Rossi', 'Russo', 'Ferrari', 'Esposito']],
  Colombia: [2, 'es', '+5731', ['Bogotá', 'Medellín', 'Cali'], ['Santiago', 'Valentina', 'Juan', 'Mariana'], ['Ramírez', 'Torres', 'Vargas', 'Cardona']],
  Perú: [1.5, 'es', '+5191', ['Lima', 'Cusco', 'Arequipa'], ['Diego', 'Lucía', 'Carlos', 'Rosa'], ['Quispe', 'Flores', 'Huamán', 'Vega']],
  México: [1.5, 'es', '+5255', ['Ciudad de México', 'Guadalajara', 'Monterrey'], ['Alejandro', 'Ximena', 'Fernando', 'Regina'], ['Hernández', 'Ramírez', 'Cruz', 'Morales']]
};
// medio de pago: [id, peso, moneda]. Los extranjeros pagan más en dólares y con tarjeta.
const MEDIOS_ARG = [[1, 30, 'ARS'], [2, 32, 'ARS'], [5, 14, 'ARS'], [3, 20, 'USD'], [6, 4, 'ARS']];
const MEDIOS_EXT = [[3, 40, 'USD'], [4, 22, 'USD'], [5, 24, 'ARS'], [2, 8, 'ARS'], [1, 6, 'ARS']];
const EQUIPO = [['Recepción', 40], ['Lucía', 30], ['Martín', 22], ['Dueño', 8]];

// Generador de números fijo (mulberry32): mismos datos en cada arranque.
function azar(semilla) {
  let a = semilla;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const r = azar(20261118);
const entre = (a, b) => a + r() * (b - a);
const elegir = (lista) => lista[Math.floor(r() * lista.length)];
const ponderado = (pares) => { // [[valor, peso, ...]]
  let t = r() * pares.reduce((s, p) => s + p[1], 0);
  for (const p of pares) { t -= p[1]; if (t <= 0) return p; }
  return pares[pares.length - 1];
};
const normal = (media, desvio) => media + desvio * Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
const iso = (d) => d.toISOString().slice(0, 10);
const sumar = (d, n) => new Date(d.getTime() + n * 864e5);

// El dólar oficial de cada día, para que los pesos cobrados «cierren» con la tarifa en dólares. Si no hay internet, una curva parecida.
async function dolarPorDia(hoy) {
  const mapa = new Map();
  try {
    const lista = await (await fetch('https://api.argentinadatos.com/v1/cotizaciones/dolares/oficial', { signal: AbortSignal.timeout(8000) })).json();
    for (const x of lista) if (x.fecha >= '2025-01-01') mapa.set(x.fecha, Number(x.venta));
  } catch { /* sin internet: queda la curva de abajo */ }
  let ultimo = null;
  const desde = sumar(hoy, -(DIAS + 40));
  const f = {};
  for (let i = 0; i <= DIAS + 40; i += 1) {
    const d = iso(sumar(desde, i));
    if (mapa.has(d)) ultimo = mapa.get(d);
    f[d] = ultimo ?? 1200 + (1575 - 1200) * (i / (DIAS + 40));
  }
  return f;
}

const sinTildes = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z]/g, '').toLowerCase();

export async function cargarDemo(back, { log = console.log } = {}) {
  // La hora de Argentina es UTC-3: una fecha y hora «de reloj» se guarda sumándole 3 horas.
  const AR = (fecha, h, m) => new Date(`${fecha}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-03:00`).toISOString();
  const hoy = new Date(`${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())}T12:00:00Z`);
  const dolar = await dolarPorDia(hoy);
  const horaAhora = Math.max(0, Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', hourCycle: 'h23' }).format(new Date())) - 1);

  // El equipo: tres personas con clave (todas «clave-demo-123»), además del dueño.
  for (const [alias] of EQUIPO.filter(([a]) => a !== 'Dueño' && a !== 'Recepción')) {
    await back.sql(`insert into private.usuarios (alias, rol, hash_clave) values ($1, 'recepcion', extensions.crypt('clave-demo-123', extensions.gen_salt('bf'))) on conflict do nothing`, [alias]);
  }

  const estadias = [];
  const huespedes = [];
  const pool = []; // huéspedes que ya estuvieron: algunos vuelven
  let idEst = 0;
  let idHue = 0;
  for (let i = DIAS; i >= 0; i -= 1) {
    const dia = sumar(hoy, -i);
    const fecha = iso(dia);
    const mes = dia.getUTCMonth();
    const semana = (dia.getUTCDay() + 6) % 7; // 0 = lunes
    // Temporada: alta en dic-feb y julio, baja en may-jun y sep. Más movimiento viernes y sábado.
    const temporada = [1.35, 1.4, 1.0, 0.85, 0.65, 0.6, 1.3, 0.9, 0.7, 0.95, 1.05, 1.4][mes];
    const finde = [0.8, 0.8, 0.85, 0.95, 1.4, 1.5, 0.9][semana];
    const crecimiento = 0.8 + 0.3 * ((DIAS - i) / DIAS); // el hotel viene creciendo
    const cuantas = Math.min(HABITACIONES.length, Math.max(0, Math.round(normal(3.6 * temporada * finde * crecimiento, 1.3))));
    const libres = [...HABITACIONES];
    for (let k = 0; k < cuantas; k += 1) {
      const sel = ponderado(libres.map((h) => [h, h.peso]));
      libres.splice(libres.indexOf(sel[0]), 1);
      const hab = sel[0];
      const canal = ponderado(CANALES)[0];
      const obraSocial = canal === 'Obra social';
      const pais = obraSocial && r() < 0.93 ? 'Argentina' : ponderado(Object.entries(PAISES).map(([nombre, d]) => [nombre, d[0] * (canal === 'Online' && nombre !== 'Argentina' ? 1.8 : 1)]))[0];
      const dp = PAISES[pais];
      const extranjero = pais !== 'Argentina';
      const noches = ponderado(NOCHES.map(([n, w]) => [n, w * (n >= 4 && temporada >= 1.3 ? 1.4 : 1)]))[0];
      const medio = obraSocial ? [6, 0, 'ARS'] : ponderado(extranjero ? MEDIOS_EXT : MEDIOS_ARG);
      const alta = temporada >= 1.3 ? 1.22 : temporada <= 0.7 ? 0.88 : 1;
      // Tarifa por noche en dólares (más barata cuanto más noches se queda) × las noches = el valor total de la habitación.
      const usdTarifa = hab.base * alta * (extranjero ? 1.08 : 1) * (noches >= 5 ? 0.93 : 1) * entre(0.93, 1.1) * noches;
      // El hotel cobra el día de la llegada (fecha_cobro). Cerca de 4 de cada 10 reservas dejaron antes una seña (20 a 50 % del total).
      const fechaCobro = fecha;
      const paso = medio[2] === 'USD' ? 5 : 1000;
      const monto = obraSocial ? 0 : medio[2] === 'USD' ? Math.round(usdTarifa / 5) * 5 : Math.round((usdTarifa * dolar[fechaCobro]) / 1000) * 1000;
      let pagoHotel = monto;
      let fechaSena = null;
      if (!obraSocial && r() < 0.38) {
        const sena = Math.max(paso, Math.round((monto * elegir([0.2, 0.25, 0.3, 0.4, 0.5])) / paso) * paso);
        pagoHotel = Math.max(0, monto - sena);
        fechaSena = iso(sumar(dia, -Math.floor(entre(3, 28))));
      }
      const quien = ponderado(EQUIPO)[0];
      // Hoy no puede haber check-ins «del futuro»: se corta en la hora de ahora.
      const hora = Math.min(i === 0 ? horaAhora : 23, Math.max(i === 0 ? 0 : 9, Math.round(normal(16, 3.2))));
      const minuto = Math.floor(r() * 60);
      idEst += 1;
      estadias.push({ id: idEst, creado: AR(fecha, hora, minuto), habitacion: hab.n, monto, moneda: medio[2], medio_pago_id: medio[0], fecha_cobro: fechaCobro, cargado_por: quien, pago_hotel: pagoHotel, fecha_sena: fechaSena, noches, canal, categoria: hab.cat });

      const n = Math.min(CATEGORIAS[hab.cat], ponderado([[1, 30], [2, 46], [3, 14], [4, 8], [5, 2]])[0]);
      estadias[estadias.length - 1].esperados = n; // las reservas de demostración están completas: entraron todos los huéspedes que se esperaban
      const edadBase = obraSocial ? Math.max(45, Math.round(normal(61, 8))) : Math.max(19, Math.round(normal(38, 12)));
      for (let g = 0; g < n; g += 1) {
        // Algunos ya se habían alojado: vuelven con los mismos datos.
        const vuelve = pool.length > 20 && r() < 0.09;
        let p;
        if (vuelve) {
          p = { ...elegir(pool) };
        } else {
          const pa = pais;
          const d = PAISES[pa];
          const nombre = elegir(d[4]);
          const apellido = g > 0 && r() < 0.8 ? huespedes[huespedes.length - 1].datos.apellido : elegir(d[5]);
          const menor = g > 0 && n >= 3 && r() < 0.3;
          const edad = menor ? Math.floor(entre(2, 16)) : Math.min(80, Math.max(18, Math.round(normal(edadBase, g === 0 ? 4 : 9))));
          const dni = pa === 'Argentina' && r() < 0.9;
          const tel = `${d[2]}${String(Math.floor(entre(10000000, 99999999)))}`;
          p = {
            nombre, apellido, nacionalidad: pa,
            localidad: elegir(d[3]),
            domicilio: `${elegir(['Av. Libertador', 'Calle Mitre', 'San Martín', 'Belgrano', 'Av. Rivadavia', 'Sarmiento', 'Urquiza'])} ${Math.floor(entre(100, 4900))}`,
            doc_tipo: dni ? 'DNI' : 'Pasaporte',
            doc_numero: dni ? String(Math.floor(entre(18000000, 47000000))) : `${elegir(['AA', 'AB', 'C', 'P', 'X'])}${Math.floor(entre(100000, 999999))}`,
            telefono: tel, nac: Number(fecha.slice(0, 4)) - edad, idioma: d[1]
          };
          p.email = r() < 0.94 ? `${sinTildes(nombre)}.${sinTildes(apellido)}${Math.floor(entre(1, 99))}@correo-demo.test` : '';
          if (r() < 0.04) p.telefono = '';
          if (!menor) pool.push(p);
        }
        idHue += 1;
        huespedes.push({
          id: idHue, estadia_id: idEst, creado: AR(fecha, hora, Math.min(59, minuto + Math.floor(entre(1, 14)) + g * 2)), idioma: p.idioma,
          datos: { nombre: p.nombre, apellido: p.apellido, email: p.email, telefono: p.telefono, nacionalidad: p.nacionalidad, localidad: p.localidad, domicilio: p.domicilio, doc_tipo: p.doc_tipo, doc_numero: p.doc_numero, anio_nac: p.nac },
          habitacion: hab.n, medio_pago_id: medio[0], habilitado_por: quien
        });
      }
    }
  }

  await back.sql(`insert into private.estadias (id, creado, habitacion, monto, moneda, medio_pago_id, fecha_cobro, cargado_por, pago_hotel, fecha_sena, noches, huespedes_esperados, canal_id, categoria_id)
    overriding system value
    select (x->>'id')::bigint, (x->>'creado')::timestamptz, x->>'habitacion', (x->>'monto')::numeric, x->>'moneda', (x->>'medio_pago_id')::int, (x->>'fecha_cobro')::date, x->>'cargado_por',
           (x->>'pago_hotel')::numeric, (x->>'fecha_sena')::date, (x->>'noches')::int, (x->>'esperados')::int,
           (select id from private.catalogo where tipo = 'canal' and nombre = x->>'canal'), (select id from private.catalogo where tipo = 'categoria' and nombre = x->>'categoria')
    from jsonb_array_elements($1::jsonb) x`, [JSON.stringify(estadias)]);
  await back.sql(`insert into private.checkins (id, creado, grupo, idioma, datos, consentimiento, habitacion, medio_pago_id, habilitado_por, estadia_id)
    overriding system value
    select (x->>'id')::bigint, (x->>'creado')::timestamptz, (x->>'estadia_id')::bigint, x->>'idioma', x->'datos',
           jsonb_build_object('aceptado', true, 'version', 1, 'en', x->>'creado'), x->>'habitacion', (x->>'medio_pago_id')::int, x->>'habilitado_por', (x->>'estadia_id')::bigint
    from jsonb_array_elements($1::jsonb) x`, [JSON.stringify(huespedes)]);
  await back.sql(`select setval(pg_get_serial_sequence('private.estadias', 'id'), (select max(id) from private.estadias))`);
  await back.sql(`select setval(pg_get_serial_sequence('private.checkins', 'id'), (select max(id) from private.checkins))`);
  await back.sql(`update private.checkin_config set dias_recepcion = greatest(dias_recepcion, 7) where id = 1`);
  log(`Datos de demostración: ${estadias.length} reservas y ${huespedes.length} huéspedes de los últimos ${DIAS} días (inventados).`);
  return { reservas: estadias.length, huespedes: huespedes.length };
}
