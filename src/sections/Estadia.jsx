import Icon from '../components/Icon.jsx';
import { Btn, Cajas, Lista, T, V } from '../components/Editable.jsx';
import { Box, Cabecera, ItemsIcono, Pasos } from '../components/ui.jsx';
import { useDatos } from '../data/DataContext.jsx';
import { estado, hora } from '../lib.js';

export function Habitacion() {
  return (
    <>
      <Cabecera num="03" id="habitacion" />
      <div style={{ marginTop: 10 }}><ItemsIcono p="habitacion.items" /></div>
      <div className="btns"><Btn label="habitacion.btn" wa="habitacion.msg" icon="wa" /></div>
    </>
  );
}

export function Instalaciones() {
  const { D, editing } = useDatos();
  const I = D.instalaciones;
  const nuevo = { nombre: 'Nuevo servicio', icono: 'brillo', lugar: 'Lugar', abre: '09:00', cierra: '18:00', nota: 'Descripción' };
  return (
    <>
      <Cabecera num="04" id="instalaciones" />
      <Lista p="instalaciones.items" plantilla={nuevo} agregar="Agregar servicio" render={(f, _i, ruta, quitar) => {
        const e = estado(f, D.hotel.zonaHoraria);
        return (
          <article className="cardi">
            <div className="cab">
              <span className="ico"><Icon name={f.icono} size={20} /></span>
              <h2><V p={`${ruta}.nombre`} /></h2>
              <span className={`chip ${e.cls}`}>{e.txt}</span>
            </div>
            <p className="lugar">
              <V p={`${ruta}.lugar`} />{f.siempre ? ' · las 24 h' : <> · {hora(f.abre)} a {hora(f.cierra)}</>}
            </p>
            <p><V p={`${ruta}.nota`} /></p>
            <Cajas ps={[[`${ruta}.nombre`, 'Nombre'], [`${ruta}.lugar`, 'Dónde queda'], !f.siempre && [`${ruta}.abre`, 'Abre (ej. 07:00)'], !f.siempre && [`${ruta}.cierra`, 'Cierra (ej. 22:00)'], [`${ruta}.nota`, 'Aclaración']]} />
            {quitar}
          </article>
        );
      }} />
      {(I.items.some((f) => f.conTurno) || editing) && (
        <div className="btns"><Btn label="instalaciones.btnReservar" wa="instalaciones.msgReservar" icon="wa" /></div>
      )}
      <T as="p" className="aclaracion" p="instalaciones.nota" />
    </>
  );
}

export function Normas() {
  return (
    <>
      <Cabecera num="05" id="normas" />
      <div style={{ marginTop: 10 }}><Pasos p="normas.items" /></div>
      <Box azul titulo="normas.avisoTitulo" texto="normas.avisoTexto">
        <Btn mini label="normas.btn" wa="normas.msg" icon="wa" cls="negro" />
      </Box>
    </>
  );
}

export function Preguntas() {
  const { editing } = useDatos();
  return (
    <>
      <Cabecera num="10" id="preguntas" />
      <div className="faq">
        <Lista p="preguntas.items" plantilla={['Nueva pregunta', 'Respuesta']} agregar="Agregar pregunta" render={(_q, i, ruta, quitar) => (
          editing ? (
            <div className="faq-ed">
              <h3><V p={`${ruta}.0`} /></h3>
              <p><V p={`${ruta}.1`} /></p>
              <Cajas ps={[[`${ruta}.0`, 'Pregunta'], [`${ruta}.1`, 'Respuesta']]} />
              {quitar}
            </div>
          ) : (
            <details open={i === 0}>
              <summary><V p={`${ruta}.0`} /></summary>
              <p><V p={`${ruta}.1`} /></p>
            </details>
          )
        )} />
      </div>
      <Box titulo="preguntas.masTitulo" texto="preguntas.masTexto">
        <Btn mini label="preguntas.btn" wa="preguntas.msg" icon="wa" cls="negro" />
      </Box>
    </>
  );
}
