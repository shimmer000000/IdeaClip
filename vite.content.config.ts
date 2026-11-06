import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  publicDir: false,
  build: {
    emptyOutDir: false,
    lib: { entry: fileURLToPath(new URL('./src/collection/content.ts', import.meta.url)), name: 'IdeaClipCollector', formats: ['iife'], fileName: () => 'collect.js' },
  },
});
