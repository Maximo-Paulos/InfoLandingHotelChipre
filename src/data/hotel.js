// Contenido de ejemplo de la guía. Es el que se carga la primera vez en la base de datos
// y el respaldo si el servidor no responde. El dueño lo edita desde el panel (#/admin).
export default {
  hotel: {
    nombre: "Hotel Chipre",
    sigla: "HC",
    ciudad: "[Ciudad]",
    direccion: "[Calle y número], [Ciudad]",
    zonaHoraria: "America/Argentina/Buenos_Aires",
    whatsapp: "5491100000000",
    telefonoRecepcion: "+5491100000000",
    mapaRecomendados: "https://www.google.com/maps",
    horarios: { checkin: "15:00", checkout: "10:00", lateCheckout: "14:00" },
    wifi: { red: "HotelChipre_Huespedes", clave: "chipre2026" },
    pie: "Recepción abierta las 24 h"
  },

  menu: {
    titulo: "¿Qué necesitás?",
    lead: "Tocá una opción para ir directo.",
    apuroTitulo: "¿Con apuro?",
    apuroTexto: "Check-out hasta las 10:00 · Wi-Fi: HotelChipre_Huespedes · Recepción: marcá 9 desde tu habitación.",
    btnWa: "Escribinos por WhatsApp",
    msgWa: "Hola, necesito ayuda con mi estadía.",
    tiles: {
      checkin: "Check-in", wifi: "Wi-Fi", habitacion: "Tu habitación", instalaciones: "Instalaciones",
      normas: "Normas", comer: "Dónde comer", hacer: "Qué hacer", compras: "Compras",
      emergencias: "Emergencias", preguntas: "Preguntas", checkout: "Check-out", resena: "Tu reseña"
    }
  },

  checkin: {
    eyebrow: "Tu llegada",
    titulo: "Check-in",
    horaLead: "Tu habitación está lista desde las",
    recepcion: "Recepción abierta las 24 h",
    subtitulo: "Cómo es",
    pasos: [
      ["Presentá tu documento", "DNI o pasaporte de cada huésped y la tarjeta con la que reservaste."],
      ["Firmá el registro", "Si querés ganar tiempo, te mandamos el formulario por WhatsApp antes de que llegues."],
      ["Recibí tu tarjeta-llave", "Abre tu habitación, el ascensor y el gimnasio. Junto con la tarjeta te damos la clave del Wi-Fi."]
    ],
    tempranoTitulo: "¿Llegás antes de las 15:00?",
    tempranoTexto: "Dejá el equipaje en recepción, sin cargo, y aprovechá el día. Si la habitación se libera antes, te avisamos por WhatsApp.",
    direccionEtq: "Dirección",
    datos: [
      ["auto", "Cochera", "Propia y techada, con reserva previa. [Precio] por noche."],
      ["reloj", "Llegada de noche", "Si llegás después de las 23:00, avisanos y te esperamos con todo listo."]
    ],
    btnMapa: "Cómo llegar",
    btnAvisar: "Avisar mi horario de llegada",
    msgAvisar: "Hola, llego al hotel a las __:__. Mi nombre es "
  },

  wifi: {
    eyebrow: "Conectate en un toque",
    titulo: "Wi-Fi",
    redEtq: "Red",
    claveEtq: "Clave",
    btnCopiar: "Copiar clave",
    copiado: "¡Clave copiada!",
    pasosTitulo: "En 3 pasos",
    pasos: [
      "Tocá «Copiar clave».",
      "Abrí Ajustes › Wi-Fi y elegí la red del hotel.",
      "Pegá la clave y listo: ya tenés internet en todo el hotel."
    ],
    qrTitulo: "¿Viene alguien con vos?",
    qrTexto: "Que escanee este código con la cámara: se conecta solo, sin escribir la clave.",
    ayudaTitulo: "¿No conecta?",
    ayudaTexto: "Apagá y prendé el Wi-Fi del celular, o tocá «Olvidar esta red» y volvé a intentar. Si sigue sin andar, escribinos y lo resolvemos.",
    btnAyuda: "Pedir ayuda",
    msgAyuda: "Hola, no logro conectarme al Wi-Fi."
  },

  habitacion: {
    eyebrow: "Cómo funciona todo",
    titulo: "Tu habitación",
    lead: "Lo básico para que te sientas en casa desde el primer minuto.",
    items: [
      ["rayo", "Luz y tarjeta-llave", "Poné la tarjeta en la ranura junto a la puerta: se encienden la luz y el aire."],
      ["termo", "Aire acondicionado", "El control está en la mesa de luz. Te recomendamos 24 °C. Se apaga solo si abrís el balcón."],
      ["tv", "Televisión", "Smart TV con apps de streaming: entrá con tu cuenta y cerrá sesión antes de irte."],
      ["candado", "Caja fuerte", "Está en el placard. Elegí un código de 4 números y presioná #. Si te trabás, llamanos."],
      ["copa", "Minibar", "Se repone todos los días. Lo que consumas se suma a tu cuenta."],
      ["brillo", "Limpieza", "Pasamos de 10:00 a 15:00. Si preferís que no entremos, colgá el cartel «No molestar»."],
      ["capas", "Toallas y almohadas extra", "Pedilas por WhatsApp o marcando 9: te las llevamos."],
      ["tel", "Teléfono de la habitación", "Recepción: marcá 9. Otra habitación: 2 + el número."]
    ],
    btn: "Pedir algo para la habitación",
    msg: "Hola, necesito en mi habitación: "
  },

  instalaciones: {
    eyebrow: "Horarios y uso",
    titulo: "Instalaciones",
    items: [
      { nombre: "Desayuno", icono: "taza", lugar: "Salón principal, planta baja", abre: "07:00", cierra: "10:30", nota: "Incluido en tu tarifa. Sábados y domingos, hasta las 11:00." },
      { nombre: "Pileta", icono: "olas", lugar: "Terraza, piso 8", abre: "09:00", cierra: "20:00", nota: "Pedí las toallas de pileta en recepción. Menores de 12, siempre con un adulto." },
      { nombre: "Gimnasio", icono: "pesa", lugar: "Piso 1", abre: "06:00", cierra: "23:00", nota: "Entrás con tu tarjeta-llave. Usá toalla en los aparatos." },
      { nombre: "Spa y sauna", icono: "hoja", lugar: "Piso 1", abre: "10:00", cierra: "21:00", conTurno: true, nota: "Reservá tu turno por WhatsApp o en recepción." },
      { nombre: "Cochera", icono: "p", lugar: "Entrada por [calle lateral]", abre: "00:00", cierra: "23:59", siempre: true, nota: "Altura máxima: 2 m. Dejá una copia de la llave en recepción por si hay que mover el auto." },
      { nombre: "Lavandería", icono: "remera", lugar: "Se pide en recepción", abre: "08:00", cierra: "18:00", diasSemana: [1, 2, 3, 4, 5, 6], nota: "Dejá la bolsa antes de las 10:00 y la tenés al día siguiente. [Precio] por prenda." }
    ],
    btnReservar: "Reservar turno en el spa",
    msgReservar: "Hola, quiero reservar un turno en el spa.",
    nota: "En feriados los horarios pueden cambiar: confirmalos en recepción."
  },

  normas: {
    eyebrow: "Para convivir bien",
    titulo: "Normas del hotel",
    lead: "Pocas, claras y pensadas para que todos descansen.",
    items: [
      ["Silencio de 23:00 a 8:00", "Bajá la música y la tele en ese horario."],
      ["No se fuma en espacios cerrados", "Tampoco en los balcones. Podés fumar en el patio de planta baja."],
      ["Visitas", "Se anuncian en recepción y se retiran antes de las 23:00."],
      ["Mascotas", "Bienvenidas las de hasta 10 kg, con aviso previo."],
      ["Pileta", "Ducha antes de entrar y nada de vasos de vidrio. Menores de 12, con un adulto."],
      ["Objetos de valor", "Guardalos en la caja fuerte. El hotel no se hace responsable por lo que quede afuera."],
      ["Toallas", "Las de la habitación no van a la pileta: allá te damos otras."],
      ["Si algo se rompe", "Avisanos enseguida y lo resolvemos juntos."]
    ],
    avisoTitulo: "¿Algo no funciona?",
    avisoTexto: "Avisanos y lo arreglamos rápido, a cualquier hora.",
    btn: "Avisar a recepción",
    msg: "Hola, quiero avisar que "
  },

  comer: {
    eyebrow: "Cerca del hotel",
    titulo: "Dónde comer",
    desayunoEtq: "Desayuno del hotel:",
    desayunoTexto: "todos los días de 7:00 a 10:30 en el salón de planta baja.",
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
    ],
    favorito: "Nuestro favorito",
    btnMaps: "Ver en Google Maps",
    btnMapa: "Ver todos en el mapa"
  },

  hacer: {
    eyebrow: "Para disfrutar",
    titulo: "Qué hacer",
    lead: "Nuestros favoritos, a pie o a pocos minutos.",
    btnMapa: "Ver todo en el mapa",
    items: [
      { tipo: "Paseo", icono: "plaza", nombre: "Plaza principal y catedral", dist: "A 600 m · 8 min caminando", texto: "Los domingos hay feria de artesanos.", ideal: "Ideal para la mañana" },
      { tipo: "Cultura", icono: "museo", nombre: "Museo de la Ciudad", dist: "A 1,2 km · 15 min caminando", texto: "La entrada es gratuita los miércoles.", ideal: "Ideal para un día de lluvia" },
      { tipo: "Naturaleza", icono: "arbol", nombre: "Parque Municipal", dist: "A 2 km · 6 min en auto", texto: "Llevá el mate y algo para sentarte en el pasto.", ideal: "Ideal para ir con chicos" },
      { tipo: "De noche", icono: "entrada", nombre: "Teatro y espectáculos", dist: "A 900 m · 12 min caminando", texto: "Preguntanos por la cartelera de la semana.", ideal: "Ideal para la noche" }
    ],
    btnMaps: "Ver en Maps",
    excursionTitulo: "¿Querés una excursión?",
    excursionTexto: "Te ayudamos a reservar paseos y traslados desde recepción.",
    btn: "Consultar por WhatsApp",
    msg: "Hola, quiero consultar por excursiones."
  },

  compras: {
    eyebrow: "Lo que necesites",
    titulo: "Compras y servicios",
    items: [
      ["carrito", "Supermercado", "De 8:00 a 22:00 · a 300 m"],
      ["pildora", "Farmacia", "La de turno cambia cada día: preguntanos · a 250 m"],
      ["billete", "Cajero automático", "A la vuelta del hotel · a 100 m"],
      ["cambio", "Casa de cambio", "Lunes a viernes de 10:00 a 17:00 · a 700 m"],
      ["tienda", "Kiosco 24 h", "Bebidas, snacks y cargadores · a 50 m"],
      ["remera", "Lavandería", "Autoservicio o por kilo · a 400 m"],
      ["surtidor", "Estación de servicio", "Con tienda y baños · a 900 m"]
    ],
    taxiTitulo: "¿Necesitás un taxi o remís?",
    taxiTexto: "Te lo pedimos desde recepción en minutos.",
    btn: "Pedir un taxi",
    msg: "Hola, necesito un taxi para las __:__."
  },

  emergencias: {
    eyebrow: "Tocá para llamar",
    titulo: "Emergencias",
    publicos: [
      { numero: "911", nombre: "Emergencias" },
      { numero: "107", nombre: "Emergencias médicas" },
      { numero: "100", nombre: "Bomberos" },
      { numero: "101", nombre: "Policía" }
    ],
    internosTitulo: "Del hotel · las 24 h",
    internos: [
      { interno: "9", nombre: "Recepción", detalle: "Desde tu celular: +54 9 11 XXXX-XXXX", tel: "+5491100000000" },
      { interno: "8", nombre: "Guardia de seguridad", detalle: "Urgencias dentro del hotel: +54 9 11 XXXX-XXXX", tel: "+5491100000001" }
    ],
    btnRecepcion: "Llamar a recepción",
    btnWa: "Escribir por WhatsApp",
    msgWa: "Hola, necesito ayuda urgente.",
    hospitalTitulo: "Hospital más cercano",
    hospital: { nombre: "[Nombre del hospital]", detalle: "a [X] km. Guardia las 24 h.", consulta: "[Nombre del hospital] [Ciudad]" },
    btnHospital: "Cómo llegar",
    evacTitulo: "Si hay que evacuar",
    evacuacion: "Seguí los carteles verdes de salida y bajá por la escalera, nunca en ascensor. El plano está detrás de la puerta de tu habitación."
  },

  preguntas: {
    eyebrow: "Respuestas rápidas",
    titulo: "Preguntas frecuentes",
    items: [
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
    masTitulo: "¿No encontraste tu respuesta?",
    masTexto: "Escribinos: respondemos en minutos, las 24 h.",
    btn: "Escribinos por WhatsApp",
    msg: "Hola, tengo una consulta: "
  },

  checkout: {
    eyebrow: "Antes de irte",
    titulo: "Check-out",
    horaLead: "Dejá la habitación hasta las",
    lateTexto: "Late check-out hasta las 14:00, según disponibilidad",
    listaTitulo: "Antes de salir",
    lista: [
      "Revisá la caja fuerte, los cajones y los cargadores",
      "Avisanos si consumiste algo del minibar",
      "Pedí tu factura (o pedila antes por WhatsApp)",
      "Dejá la tarjeta-llave en recepción"
    ],
    datos: [
      ["valija", "Guarda-equipaje", "¿Tu vuelo sale tarde? Dejá las valijas en recepción, sin cargo."],
      ["auto", "Taxi o remís", "Pedilo con 30 minutos de anticipación y te avisamos cuando llega."]
    ],
    btnLate: "Pedir late check-out",
    msgLate: "Hola, quisiera pedir late check-out hasta las 14:00. Habitación: ",
    btnTaxi: "Pedir un taxi",
    msgTaxi: "Hola, necesito un taxi para las __:__.",
    graciasTitulo: "¡Gracias por elegirnos!",
    btnResena: "Dejanos tu reseña"
  },

  resena: {
    eyebrow: "Tu opinión",
    titulo: "¿Cómo fue tu estadía?",
    intro: "Tu reseña ayuda a otros viajeros a elegirnos y a nosotros a mejorar. Te lleva un minuto.",
    btnGoogle: "Dejar reseña en Google",
    google: "https://www.google.com/",
    btnBooking: "Opinar en Booking",
    booking: "https://www.booking.com/",
    btnTripadvisor: "Opinar en TripAdvisor",
    tripadvisor: "https://www.tripadvisor.com.ar/",
    mejorarTitulo: "¿Algo para mejorar?",
    mejorarTexto: "Contanos en privado: lo leemos todos los días y lo resolvemos.",
    btn: "Escribinos por WhatsApp",
    msg: "Hola, quiero contarles cómo fue mi estadía: ",
    cierre: "Gracias por hospedarte con nosotros. ¡Volvé cuando quieras!"
  }
};
