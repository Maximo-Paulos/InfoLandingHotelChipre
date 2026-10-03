import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' para que funcione en cualquier hosting estático, también en una subcarpeta.
// En desarrollo, /api se redirige al servidor de la base de datos (npm run server).
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:3001' } }
});
