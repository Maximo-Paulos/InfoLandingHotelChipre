import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' para que funcione en cualquier hosting estático, también en una subcarpeta.
export default defineConfig({ base: './', plugins: [react()] });
