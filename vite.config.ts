import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    rollupOptions: {
      input: { ...Object.fromEntries(['popup', 'notes', 'settings', 'capture', 'collection', 'note', 'analysis'].map(name => [name, fileURLToPath(new URL(`./${name}.html`, import.meta.url))])), background: fileURLToPath(new URL('./src/capture/background.ts', import.meta.url)) },
      output: { entryFileNames: chunk => chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js' },
    },
  },
});
