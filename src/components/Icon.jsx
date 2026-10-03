import { PATHS } from './paths.js';

// Los trazos son constantes del proyecto (paths.js), no datos del usuario.
export default function Icon({ name, size = 22, sw = 1.6 }) {
  return (
    <svg className="svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: PATHS[name] || '' }} />
  );
}
