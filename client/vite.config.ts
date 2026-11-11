import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.EARTHNOW_API ?? 'http://127.0.0.1:8787';
const proxy = {
  '/api': apiTarget,
  '/share': apiTarget,
  '/ws': { target: apiTarget.replace(/^http/, 'ws'), ws: true },
};

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  preview: { port: 5173, proxy },
  build: { target: 'es2022', chunkSizeWarningLimit: 2500 },
});
