import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Scratch-only config for the dual-role QA session — never touch the shared
// vite.config.ts proxy target while a real dev server might be running on it.
export default defineConfig({
  plugins: [react(), VitePWA({ registerType: 'autoUpdate', strategies: 'injectManifest', srcDir: 'src', filename: 'sw.ts' })],
  server: {
    port: 18172,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:18092',
        changeOrigin: true,
      },
    },
  },
});
