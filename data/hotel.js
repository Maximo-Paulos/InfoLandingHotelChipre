// Todo el contenido de la guía vive acá. Cambiar los datos no toca el diseño.
// Más adelante este objeto puede venir de una base de datos (ver README).
window.HOTEL_DATA = {
  hotel: {
    nombre: "Hotel Chipre",
    sigla: "HC",
    ciudad: "[Ciudad]",
    direccion: "[Calle y número], [Ciudad]",
    zonaHoraria: "America/Argentina/Buenos_Aires",
    whatsapp: "5491100000000",            // solo números, con código de país
    telefonoRecepcion: "+5491100000000",
    mapaRecomendados: "https://www.google.com/maps",   // lista compartida de Google Maps del hotel
    horarios: { checkin: "15:00", checkout: "10:00", lateCheckout: "14:00" },
    wifi: { red: "HotelChipre_Huespedes", clave: "chipre2026" }
  },

  emergencias: {
    publicos: [
      { numero: "911", nombre: "Emergencias" },
      { numero: "107", nombre: "Emergencias médicas" },
      { numero: "100", nombre: "Bomberos" },
      { numero: "101", nombre: "Policía" }
    ],
    internos: [
      { interno: "9", nombre: "Recepción", detalle: "Desde tu celular: +54 9 11 XXXX-XXXX", tel: "+5491100000000" },
      { interno: "8", nombre: "Guardia de seguridad", detalle: "Urgencias dentro del hotel: +54 9 11 XXXX-XXXX", tel: "+5491100000001" }
    ],
    hospital: { nombre: "[Nombre del hospital]", distancia: "[X] km", consulta: "[Nombre del hospital] [Ciudad]" },
    evacuacion: "Seguí los carteles verdes de salida y bajá por la escalera, nunca en ascensor. El plano está detrás de la puerta de tu habitación."
  },

  checkin: {
    pasos: [
      ["Presentá tu documento", "DNI o pasaporte de cada huésped y la tarjeta con la que reservaste."],
      ["Firmá el registro", "Si querés ganar tiempo, te mandamos el formulario por WhatsApp antes de que llegues."],
      ["Recibí tu tarjeta-llave", "Abre tu habitación, el ascensor y el gimnasio. Junto con la tarjeta te damos la clave del Wi-Fi."]
    ],
    tempranoTitulo: "¿Llegás antes de las 15:00?",
    tempranoTexto: "Dejá el equipaje en recepción, sin cargo, y aprovechá el día. Si la habitación se libera antes, te avisamos por WhatsApp.",
    datos: [
      ["pin", "Dirección", "[Calle y número], [Ciudad]"],
      ["auto", "Cochera", "Propia y techada, con reserva previa. [Precio] por noche."],
      ["reloj", "Llegada de noche", "Si llegás después de las 23:00, avisanos y te esperamos con todo listo."]
    ]
  },

  habitacion: [
    ["rayo", "Luz y tarjeta-llave", "Poné la tarjeta en la ranura junto a la puerta: se encienden la luz y el aire."],
    ["termo", "Aire acondicionado", "El control está en la mesa de luz. Te recomendamos 24 °C. Se apaga solo si abrís el balcón."],
    ["tv", "Televisión", "Smart TV con apps de streaming: entrá con tu cuenta y cerrá sesión antes de irte."],
    ["candado", "Caja fuerte", "Está en el placard. Elegí un código de 4 números y presioná #. Si te trabás, llamanos."],
    ["copa", "Minibar", "Se repone todos los días. Lo que consumas se suma a tu cuenta."],
    ["brillo", "Limpieza", "Pasamos de 10:00 a 15:00. Si preferís que no entremos, colgá el cartel «No molestar»."],
    ["capas", "Toallas y almohadas extra", "Pedilas por WhatsApp o marcando 9: te las llevamos."],
    ["tel", "Teléfono de la habitación", "Recepción: marcá 9. Otra habitación: 2 + el número."]
  ],

  instalaciones: [
    { nombre: "Desayuno", icono: "taza", lugar: "Salón principal, planta baja", abre: "07:00", cierra: "10:30", nota: "Incluido en tu tarifa. Sábados y domingos, hasta las 11:00." },
    { nombre: "Pileta", icono: "olas", lugar: "Terraza, piso 8", abre: "09:00", cierra: "20:00", nota: "Pedí las toallas de pileta en recepción. Menores de 12, siempre con un adulto." },
    { nombre: "Gimnasio", icono: "pesa", lugar: "Piso 1", abre: "06:00", cierra: "23:00", nota: "Entrás con tu tarjeta-llave. Usá toalla en los aparatos." },
    { nombre: "Spa y sauna", icono: "hoja", lugar: "Piso 1", abre: "10:00", cierra: "21:00", conTurno: true, nota: "Reservá tu turno por WhatsApp o en recepción.", reservar: "Hola, quiero reservar un turno en el spa." },
    { nombre: "Cochera", icono: "p", lugar: "Entrada por [calle lateral]", siempre: true, nota: "Altura máxima: 2 m. Dejá una copia de la llave en recepción por si hay que mover el auto." },
    { nombre: "Lavandería", icono: "remera", lugar: "Se pide en recepción", dias: "Lun. a sáb.", abre: "08:00", cierra: "18:00", diasSemana: [1,2,3,4,5,6], nota: "Dejá la bolsa antes de las 10:00 y la tenés al día siguiente. [Precio] por prenda." }
  ],
  instalacionesNota: "En feriados los horarios pueden cambiar: confirmalos en recepción.",

  normas: [
    ["Silencio de 23:00 a 8:00", "Bajá la música y la tele en ese horario."],
    ["No se fuma en espacios cerrados", "Tampoco en los balcones. Podés fumar en el patio de planta baja."],
    ["Visitas", "Se anuncian en recepción y se retiran antes de las 23:00."],
    ["Mascotas", "Bienvenidas las de hasta 10 kg, con aviso previo."],
    ["Pileta", "Ducha antes de entrar y nada de vasos de vidrio. Menores de 12, con un adulto."],
    ["Objetos de valor", "Guardalos en la caja fuerte. El hotel no se hace responsable por lo que quede afuera."],
    ["Toallas", "Las de la habitación no van a la pileta: allá te damos otras."],
    ["Si algo se rompe", "Avisanos enseguida y lo resolvemos juntos."]
  ],

  comer: {
    desayunoHotel: "Desayuno del hotel: todos los días de 7:00 a 10:30 en el salón de planta baja.",
    categorias: [
      { id: "desayuno", nombre: "Desayuno" },
      { id: "almuerzo", nombre: "Almuerzo y cena" },
      { id: "llevar", nombre: "Para llevar" }
    ],
    lugares: [
      { cat: "desayuno", nombre: "Café Esquina", meta: "Café de especialidad · $$ · a 200 m (3 min a pie)", tip: "Pedí las medialunas de manteca: salen calentitas.", favorito: true },
      { cat: "desayuno", nombre: "Panadería La Espiga", meta: "Panadería y confitería · $ · a 350 m (5 min)", tip: "Abre a las 7:00, ideal para llevarte algo al paseo." },
      { cat: "desayuno", nombre: "Casa Aurora", meta: "Brunch · $$ · a 600 m (8 min)", tip: "Brunch hasta las 13:00 los fines de semana." },
      { cat: "almuerzo", nombre: "Parrilla El Fogón", meta: "Parrilla · $$$ · a 400 m (5 min a pie)", tip: "Reservá para la cena: se llena rápido.", favorito: true },
      { cat: "almuerzo", nombre: "Trattoria Nonna", meta: "Pastas caseras · $$ · a 500 m (7 min)", tip: "Probá los sorrentinos de la casa." },
      { cat: "almuerzo", nombre: "Bodegón El Encuentro", meta: "Bodegón · $$ · a 800 m (10 min)", tip: "Porciones grandes, ideales para compartir." },
      { cat: "llevar", nombre: "Pizzería Don Ángel", meta: "Pizza al molde · $ · a 300 m (4 min a pie)", tip: "Hace delivery hasta las 00:30.", favorito: true },
      { cat: "llevar", nombre: "Empanadas del Norte", meta: "Empanadas · $ · a 450 m (6 min)", tip: "La docena surtida sale en 15 minutos." },
      { cat: "llevar", nombre: "Verde Bowl", meta: "Ensaladas y bowls · $$ · a 250 m (3 min)", tip: "Tiene opciones veganas y sin TACC." }
    ]
  },

  hacer: [
    { tipo: "Paseo", icono: "plaza", nombre: "Plaza principal y catedral", dist: "A 600 m · 8 min caminando", texto: "Los domingos hay feria de artesanos.", ideal: "Ideal para la mañana" },
    { tipo: "Cultura", icono: "museo", nombre: "Museo de la Ciudad", dist: "A 1,2 km · 15 min caminando", texto: "La entrada es gratuita los miércoles.", ideal: "Ideal para un día de lluvia" },
    { tipo: "Naturaleza", icono: "arbol", nombre: "Parque Municipal", dist: "A 2 km · 6 min en auto", texto: "Llevá el mate y algo para sentarte en el pasto.", ideal: "Ideal para ir con chicos" },
    { tipo: "De noche", icono: "entrada", nombre: "Teatro y espectáculos", dist: "A 900 m · 12 min caminando", texto: "Preguntanos por la cartelera de la semana.", ideal: "Ideal para la noche" }
  ],

  compras: [
    ["carrito", "Supermercado", "De 8:00 a 22:00 · a 300 m"],
    ["pildora", "Farmacia", "La de turno cambia cada día: preguntanos · a 250 m"],
    ["billete", "Cajero automático", "A la vuelta del hotel · a 100 m"],
    ["cambio", "Casa de cambio", "Lunes a viernes de 10:00 a 17:00 · a 700 m"],
    ["tienda", "Kiosco 24 h", "Bebidas, snacks y cargadores · a 50 m"],
    ["remera", "Lavandería", "Autoservicio o por kilo · a 400 m"],
    ["surtidor", "Estación de servicio", "Con tienda y baños · a 900 m"]
  ],

  preguntas: [
    ["¿A qué hora es el desayuno?", "Todos los días de 7:00 a 10:30 en el salón de planta baja; sábados y domingos, hasta las 11:00. Está incluido en tu tarifa."],
    ["¿Puedo dejar la habitación más tarde?", "Sí: el late check-out es hasta las 14:00, según disponibilidad y con un cargo de [precio]. Pedilo el día anterior."],
    ["¿Dónde dejo el equipaje?", "En recepción, sin cargo, antes del check-in o después del check-out."],
    ["¿Tienen cochera?", "Sí, propia y techada, con reserva previa. Cuesta [precio] por noche."],
    ["¿Aceptan mascotas?", "Sí, de hasta 10 kg y con aviso previo. Escribinos para coordinar."],
    ["¿Cómo pago y pido factura?", "Efectivo, débito, crédito o transferencia. Hacemos factura A o B: pedila en recepción."],
    ["¿Cómo pido un taxi?", "Te lo pedimos desde recepción en minutos. También podés usar apps de viaje."],
    ["¿Puedo pedir toallas o almohadas extra?", "Claro: escribinos por WhatsApp o marcá 9 y te las llevamos."],
    ["¿Se puede fumar?", "En las habitaciones y balcones no. Sí en el patio de planta baja."]
  ],

  checkout: {
    lista: [
      "Revisá la caja fuerte, los cajones y los cargadores",
      "Avisanos si consumiste algo del minibar",
      "Pedí tu factura (o pedila antes por WhatsApp)",
      "Dejá la tarjeta-llave en recepción"
    ],
    datos: [
      ["valija", "Guarda-equipaje", "¿Tu vuelo sale tarde? Dejá las valijas en recepción, sin cargo."],
      ["auto", "Taxi o remís", "Pedilo con 30 minutos de anticipación y te avisamos cuando llega."]
    ]
  },

  resena: {
    google: "https://www.google.com/",
    booking: "https://www.booking.com/",
    tripadvisor: "https://www.tripadvisor.com.ar/"
  }
};
