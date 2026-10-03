import Icon from './components/Icon.jsx';
import { BtnWa } from './components/ui.jsx';
import { H, hora } from './lib.js';

export default function Menu({ secciones }) {
  return (
    <div className="menu">
      <header style={{ position: 'relative' }}>
        <div className="tag" aria-hidden="true"><i>{H.sigla}</i></div>
        <p className="eyebrow" style={{ padding: '6px 0 0 60px', minHeight: 22 }}>{H.nombre}</p>
        <h1>¿Qué necesitás?</h1>
        <p className="lead">Tocá una opción para ir directo.</p>
      </header>
      <nav className="grid" aria-label="Secciones de la guía">
        {secciones.map((s) => (
          <a key={s.id} className={`tile${s.hot ? ' hot' : ''}`} href={`#/${s.id}`}>
            <Icon name={s.icono} size={24} sw={s.hot ? 1.7 : 1.6} />
            <span>{s.titulo}</span>
          </a>
        ))}
      </nav>
      <p className="note">
        <strong>¿Con apuro?</strong> Check-out hasta las {hora(H.horarios.checkout)} · Wi-Fi: {H.wifi.red} · Recepción: marcá 9 desde tu habitación.
      </p>
      <div className="btns">
        <BtnWa texto="Escribinos por WhatsApp" msg="Hola, necesito ayuda con mi estadía." cls="negro" />
      </div>
    </div>
  );
}
