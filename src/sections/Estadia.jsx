import Icon from '../components/Icon.jsx';
import { BtnWa, Box, Cabecera, ItemsIcono, Pasos } from '../components/ui.jsx';
import { D, estado, hora } from '../lib.js';

export function Habitacion() {
  return (
    <>
      <Cabecera num="03" eyebrow="Cómo funciona todo" titulo="Tu habitación" lead="Lo básico para que te sientas en casa desde el primer minuto." />
      <div style={{ marginTop: 10 }}><ItemsIcono lista={D.habitacion} /></div>
      <div className="btns"><BtnWa texto="Pedir algo para la habitación" msg="Hola, necesito en mi habitación: " /></div>
    </>
  );
}

export function Instalaciones() {
  const reserva = D.instalaciones.find((f) => f.reservar);
  return (
    <>
      <Cabecera num="04" eyebrow="Horarios y uso" titulo="Instalaciones" />
      {D.instalaciones.map((f) => {
        const e = estado(f);
        const horario = f.siempre ? `${f.lugar} · las 24 h` : `${f.lugar} · ${hora(f.abre)} a ${hora(f.cierra)}`;
        return (
          <article className="cardi" key={f.nombre}>
            <div className="cab">
              <span className="ico"><Icon name={f.icono} size={20} /></span>
              <h2>{f.nombre}</h2>
              <span className={`chip ${e.cls}`}>{e.txt}</span>
            </div>
            <p className="lugar">{horario}</p>
            <p>{f.nota}</p>
          </article>
        );
      })}
      {reserva && <div className="btns"><BtnWa texto="Reservar turno en el spa" msg={reserva.reservar} /></div>}
      <p className="aclaracion">{D.instalacionesNota}</p>
    </>
  );
}

export function Normas() {
  return (
    <>
      <Cabecera num="05" eyebrow="Para convivir bien" titulo="Normas del hotel" lead="Pocas, claras y pensadas para que todos descansen." />
      <div style={{ marginTop: 10 }}><Pasos lista={D.normas} /></div>
      <Box azul titulo="¿Algo no funciona?" texto="Avisanos y lo arreglamos rápido, a cualquier hora.">
        <BtnWa mini texto="Avisar a recepción" msg="Hola, quiero avisar que " cls="negro" />
      </Box>
    </>
  );
}

export function Preguntas() {
  return (
    <>
      <Cabecera num="10" eyebrow="Respuestas rápidas" titulo="Preguntas frecuentes" />
      <div className="faq">
        {D.preguntas.map(([pregunta, respuesta], i) => (
          <details key={pregunta} open={i === 0}>
            <summary>{pregunta}</summary>
            <p>{respuesta}</p>
          </details>
        ))}
      </div>
      <Box titulo="¿No encontraste tu respuesta?" texto="Escribinos: respondemos en minutos, las 24 h.">
        <BtnWa mini texto="Escribinos por WhatsApp" msg="Hola, tengo una consulta: " cls="negro" />
      </Box>
    </>
  );
}
