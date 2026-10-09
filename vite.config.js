import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' para que funcione en cualquier hosting estático, también en una subcarpeta.
// En desarrollo, /api se redirige al servidor de la base de datos (npm run server).
export default defineConfig({
  base: './',
  plugins: [react()],
  // El módulo de teléfonos se carga recién al abrir un formulario; así se prepara de entrada y el modo desarrollo no recarga la página la primera vez.
  optimizeDeps: { include: ['libphonenumber-js/max'] },
  server: { proxy: { '/api': 'http://localhost:3001' } }
});
