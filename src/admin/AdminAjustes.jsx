import { useEffect, useState } from 'react';
import BarraPersonal from '../BarraPersonal.jsx';
import { adminAuditoria, adminCatalogos, adminMediosPago, textoCodigo } from '../checkin/checkinApi.js';
import { fechaHora } from '../checkin/util.js';
import { useNoIndexar } from '../personal.js';
import Dispositivos from './Dispositivos.jsx';
import { ConectarDrive, ConfigCheckin, useConfigCheckin } from './PanelCheckin.jsx';
import PanelAvisos from './PanelAvisos.jsx';
import PanelCatalogo from './PanelCatalogo.jsx';
import PanelMediosPago from './PanelMediosPago.jsx';
import { LoginAdmin, useSesionAdmin } from './sesionAdmin.jsx';

// Ajustes: lo que se toca de vez en cuando (el check-in, los medios de pago, la conexión con Drive, los celulares con sesión y el historial).
// Antes estaba al final de la lista de huéspedes; ahora tiene su propia pantalla, dentro de «Más».
export default function AdminAjustes() {
  useNoIndexar('Ajustes');
  const sesion = useSesionAdmin();
  if (sesion.fase !== 'ok') return <LoginAdmin sesion={sesion} />;
  return <Contenido clave={sesion.clave} salir={sesion.salir} />;
}

function Contenido({ clave, salir }) {
  const { config, error, recargar } = useConfigCheckin(clave);
  const [medios, setMedios] = useState(null); // todos los medios de pago (también los quitados); null = todavía no cargaron
  const [categorias, setCategorias] = useState(null); // categorías de habitación y canales de venta (también lo quitado)
  const [canales, setCanales] = useState(null);
  useEffect(() => {
    let vivo = true;
    adminMediosPago(clave).then((r) => { if (vivo && r?.ok) setMedios(r.medios); }).catch(() => {});
    adminCatalogos(clave).then((r) => { if (vivo && r?.ok) { setCategorias(r.categorias); setCanales(r.canales); } }).catch(() => {});
    return () => { vivo = false; };
  }, [clave]);

  return (
    <div className="page personal">
      <BarraPersonal titulo="Ajustes" actual="ajustes" salir={salir} />
      <main className="card">
        <header>
          <h1>Ajustes</h1>
          <p className="lead">Lo que se toca de vez en cuando: el check-in, los pagos, las fotos y el historial.</p>
        </header>
        {error && <p className="ed-error" role="alert">{error}</p>}
        <ConfigCheckin clave={clave} config={config} recargar={recargar} />
        <PanelAvisos clave={clave} />
        <PanelMediosPago clave={clave} medios={medios} alGuardar={setMedios} />
        <PanelCatalogo clave={clave} tipo="categoria" titulo="Categorías de habitación" singular="una categoría" plural="categoría" ejemplo="Ej. Suite" items={categorias} alGuardar={setCategorias}
          ayuda="Single, Doble, Triple… Recepción elige una al abrir cada reserva. Sirve para ver qué categorías se buscan más y a qué tarifa se vende cada una. Podés cambiar nombres, agregar y quitar: nunca se borra nada." />
        <PanelCatalogo clave={clave} tipo="canal" titulo="Canales de venta" singular="un canal" plural="canal" ejemplo="Ej. Empresa" items={canales} alGuardar={setCanales} conCobro
          ayuda="Por dónde llegó la reserva (directo, agencia, online, obra social…). Un canal marcado «sin cobro», como la obra social, no lleva monto porque se factura aparte: cuenta en habitaciones, noches, edades y países, pero no en cobros ni en la tarifa promedio." />
        <ConectarDrive clave={clave} config={config} recargar={recargar} />
        <Historial clave={clave} />
        <Dispositivos clave={clave} />
      </main>
    </div>
  );
}

const ACCIONES = { reserva_nueva: 'abrió una reserva', anotada_guardar: 'anotó o corrigió una reserva por adelantado', anotada_cancelar: 'canceló una reserva anotada', anotada_restaurar: 'restauró una reserva anotada', llegada_iniciar: 'hizo el check-in de una reserva anotada', reserva_abrir: 'le dio código a una reserva abierta', reserva_anular: 'eliminó una reserva', reserva_restaurar: 'restauró una reserva eliminada', huesped_quitar: 'eliminó a un huésped', huesped_restaurar: 'restauró a un huésped', estadia_editar: 'corrigió una reserva', huesped_estadia: 'movió un huésped a otra reserva', editar: 'editó a un huésped', config: 'cambió la configuración', clave_recepcion: 'cambió la clave de recepción', codigo_nuevo: 'generó un código nuevo', usuario_creado: 'agregó a una persona al equipo', usuario_editado: 'cambió a una persona del equipo', medios_pago: 'cambió los medios de pago', catalogo: 'cambió las categorías o los canales de venta', foto_agregada: 'agregó una foto', sesion_abierta: 'abrió sesión en un dispositivo', foto_quitada: 'quitó una foto', foto_repuesta: 'volvió a poner una foto', checkin_manual: 'cargó un check-in a mano', checkin_manual_editar: 'completó los datos de un check-in cargado a mano', reservas_unificar: 'unificó dos reservas repetidas', repetida_descartar: 'marcó que dos reservas no son la misma', reserva_cerrar: 'cerró una reserva', reserva_reabrir: 'reabrió una reserva cerrada' };
const CAMPOS = { nombre: 'nombre', apellido: 'apellido', email: 'email', telefono: 'teléfono', nacionalidad: 'nacionalidad', localidad: 'localidad', domicilio: 'domicilio', doc_tipo: 'tipo de documento', doc_numero: 'número de documento', habitacion: 'habitación', medio_pago: 'medio de pago', anio_nac: 'año de nacimiento', monto: 'monto', moneda: 'moneda', fecha_cobro: 'fecha del cobro', pago_hotel: 'pago en el hotel', fecha_sena: 'fecha de la seña', noches: 'noches', canal: 'canal de venta', categoria: 'categoría' };

// Quién cambió qué y cuándo (no guarda los valores, solo los nombres de los campos).
function Historial({ clave }) {
  const [registros, setRegistros] = useState(null);
  const [error, setError] = useState('');
  const abrir = async (e) => {
    if (!e.currentTarget.open || registros) return;
    try {
      const r = await adminAuditoria(clave, 40);
      if (r.ok) setRegistros(r.registros); else setError(textoCodigo(r.error));
    } catch {
      setError('No se pudo conectar. Revisá tu conexión.');
    }
  };
  return (
    <details className="panel" onToggle={abrir}>
      <summary>Historial de cambios</summary>
      {error && <p className="ed-error">{error}</p>}
      {registros && !registros.length && <p className="ayuda">Todavía no hay cambios registrados.</p>}
      {registros?.length > 0 && (
        <ul className="historial">
          {registros.map((r) => (
            <li key={r.id}>
              <b>{fechaHora(r.en)}</b> · {r.detalle?.alias && r.accion !== 'usuario_creado' && r.accion !== 'usuario_editado' ? `${r.detalle.alias} (${r.quien === 'admin' ? 'dueño' : 'recepción'})` : r.quien === 'admin' ? 'Dueño' : 'Recepción'} {ACCIONES[r.accion] ?? r.accion}
              {r.checkin_id ? ` (huésped n.º ${r.checkin_id})` : ''}
              {r.detalle?.alias && (r.accion === 'usuario_creado' || r.accion === 'usuario_editado') ? `: ${r.detalle.antes && r.detalle.antes !== r.detalle.alias ? `${r.detalle.antes} → ` : ''}${r.detalle.alias}` : ''}
              {r.detalle?.campos?.length && (r.accion === 'editar' || r.accion === 'estadia_editar' || r.accion === 'checkin_manual_editar') ? `: ${r.detalle.campos.map((c) => CAMPOS[c] ?? c).join(', ')}` : ''}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
