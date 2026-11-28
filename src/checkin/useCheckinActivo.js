import { useEffect, useState } from 'react';
import { estadoCheckin } from './checkinApi.js';

// ¿Está prendido el check-in digital? Lo prende el administrador. Mientras la respuesta no llega se muestra el botón (así no aparece de golpe y no corre los cuadraditos de lugar
// justo cuando el huésped va a tocar); se recuerda la última respuesta en el celular para las próximas veces. Si el administrador lo apagó, el botón se esconde.
// Si no se puede consultar (sin conexión), se deja a la vista: la pantalla de check-in avisa por sí sola si no está disponible.
const CLAVE = 'checkin-activo';
const recordado = () => { try { return localStorage.getItem(CLAVE) !== '0'; } catch { return true; } };
const recordar = (activo) => { try { localStorage.setItem(CLAVE, activo ? '1' : '0'); } catch { /* sin almacenamiento: no se recuerda */ } };

export function useCheckinActivo(consultar = true) {
  const [activo, setActivo] = useState(recordado);
  useEffect(() => {
    if (!consultar) return undefined;
    let vivo = true;
    estadoCheckin().then((e) => {
      if (!vivo || !e || typeof e.activo !== 'boolean') return;
      setActivo(e.activo);
      recordar(e.activo);
    }).catch(() => {});
    return () => { vivo = false; };
  }, [consultar]);
  return activo;
}
