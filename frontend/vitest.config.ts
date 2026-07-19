import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Separate from vite.config.ts (not merged via `test:` there) so the PWA
// plugin — which injects manifest/service-worker build steps — never runs
// during a test collection pass; it has no reason to and has caused import-
// time surprises in scratch configs before (see STATUS.md's operational
// lessons on isolated Vite configs).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
});
