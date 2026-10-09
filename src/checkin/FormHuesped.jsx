import { useEffect, useId, useState } from 'react';
import { TIPOS_DOC, listaPaises } from './campos.js';
import { cargarTelefono, codigoDe } from './telefono.js';

export const ETIQUETAS = {
  nombre: 'Nombre', apellido: 'Apellido', email: 'Email', telefono: 'Teléfono', nacionalidad: 'Nacionalidad',
  localidad: 'Localidad', domicilio: 'Domicilio', docTipo: 'Tipo de documento', docNumero: 'Número de documento', habitacion: 'Habitación'
};

// Los campos del huésped. Lo usan el formulario del huésped, la edición de recepción y la del admin.
// `sugerencias` = false: el navegador no ofrece autocompletar (en la edición de recepción y admin se cargan datos de OTRA persona,
// y el navegador de quien edita no tiene que meterle su propio domicilio o email).
export default function FormHuesped({ valores, errores = {}, onCambio, etiquetas = ETIQUETAS, conHabitacion = false, deshabilitado = false, sugerencias = true }) {
  const id = useId();
  const [lib, setLib] = useState(null);
  useEffect(() => {
    let vivo = true;
    cargarTelefono().then((l) => { if (vivo) setLib(l); }).catch(() => {});
    return () => { vivo = false; };
  }, []);
  const paises = listaPaises();
  const cambia = (clave) => (e) => onCambio(clave, e.target.value);
  const campo = (clave, etiqueta, control, ayuda) => (
    <div className={`campo${errores[clave] ? ' error' : ''}`}>
      <label htmlFor={`${id}-${clave}`}>{etiqueta}</label>
      {control}
      {ayuda && !errores[clave] && <p className="ayuda">{ayuda}</p>}
      {errores[clave] && <p className="msg" id={`${id}-${clave}-msg`} role="alert">{errores[clave]}</p>}
    </div>
  );
  const props = (clave, extra = {}) => ({
    id: `${id}-${clave}`, name: clave, value: valores[clave] ?? '', onChange: cambia(clave), disabled: deshabilitado,
    'aria-invalid': errores[clave] ? 'true' : undefined, 'aria-describedby': errores[clave] ? `${id}-${clave}-msg` : undefined, ...extra,
    ...(sugerencias ? {} : { autoComplete: 'off' })
  });
  const esDNI = valores.doc_tipo === 'DNI';

  return (
    <>
      {/* Lo primero que hace recepción es cargar la habitación: si está vacía, el cursor ya queda ahí y la tecla del celular dice "Listo". */}
      {conHabitacion && campo('habitacion', etiquetas.habitacion, <input {...props('habitacion', { maxLength: 12, autoComplete: 'off', placeholder: 'Ej. 204', autoFocus: !valores.habitacion, enterKeyHint: 'done' })} />, 'La carga solo recepción.')}
      {campo('nombre', etiquetas.nombre, <input {...props('nombre', { maxLength: 60, autoComplete: 'given-name' })} />)}
      {campo('apellido', etiquetas.apellido, <input {...props('apellido', { maxLength: 60, autoComplete: 'family-name' })} />)}
      {campo('email', etiquetas.email, <input {...props('email', { type: 'email', inputMode: 'email', maxLength: 120, autoComplete: 'email', autoCapitalize: 'none' })} />)}
      {campo('telefono', etiquetas.telefono, (
        <div className="tel-grupo">
          <select {...props('telefonoPais', { id: `${id}-telefonoPais`, 'aria-label': 'País del teléfono', autoComplete: 'off' })}>
            {paises.map((p) => {
              const cod = lib ? codigoDe(lib, p.iso) : null;
              return <option key={p.iso} value={p.iso}>{cod ? `+${cod} · ${p.nombre}` : p.nombre}</option>;
            })}
          </select>
          <input {...props('telefonoNumero', { id: `${id}-telefono`, type: 'tel', inputMode: 'tel', maxLength: 30, autoComplete: 'tel-national', placeholder: 'Ej. 11 5555 1234' })} />
        </div>
      ), 'Escribilo completo, con código de área.')}
      {campo('nacionalidad', etiquetas.nacionalidad, (
        <select {...props('nacionalidad', { autoComplete: 'off' })}>
          <option value="">Elegí una…</option>
          {paises.map((p) => <option key={p.iso} value={p.nombre}>{p.nombre}</option>)}
        </select>
      ))}
      {campo('localidad', etiquetas.localidad, <input {...props('localidad', { maxLength: 80, autoComplete: 'address-level2' })} />, 'Por ejemplo: Buenos Aires, Capital Federal.')}
      {campo('domicilio', etiquetas.domicilio, <input {...props('domicilio', { maxLength: 120, autoComplete: 'street-address' })} />, 'Calle y número; si es departamento, piso y letra.')}
      {campo('doc_tipo', etiquetas.docTipo, (
        <select {...props('doc_tipo', { autoComplete: 'off' })}>
          {TIPOS_DOC.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      ))}
      {campo('doc_numero', etiquetas.docNumero, (
        <input {...props('doc_numero', {
          maxLength: 20, autoComplete: 'off', inputMode: esDNI ? 'numeric' : 'text', autoCapitalize: esDNI ? 'none' : 'characters',
          placeholder: esDNI ? 'Ej. 30123456' : 'Ej. AA123456'
        })} />
      ), esDNI ? 'Solo los números, sin puntos.' : 'Letras y números, tal como figura en el pasaporte.')}
    </>
  );
}
