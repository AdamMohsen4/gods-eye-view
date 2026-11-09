import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { resolve } from 'node:path';

const cesiumBuild = 'node_modules/cesium/Build/Cesium';
const apiTarget = process.env.EARTHNOW_API ?? 'http://127.0.0.1:8787';

export default defineConfig({
  define: { CESIUM_BASE_URL: JSON.stringify('/cesium') },
  plugins: [
    viteStaticCopy({
      targets: ['Assets', 'ThirdParty', 'Workers', 'Widgets'].map((d) => ({
        src: `${cesiumBuild}/${d}`,
        dest: 'cesium',
      })),
    }),
  ],
  server: {
    port: 5173,
    proxy: { '/api': apiTarget, '/share': apiTarget },
  },
  preview: {
    port: 5173,
    proxy: { '/api': apiTarget, '/share': apiTarget },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 6000,
    rollupOptions: {
      input: { main: resolve(__dirname, 'index.html'), admin: resolve(__dirname, 'admin.html') },
    },
  },
});
