import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({ publicDir: false, build: { emptyOutDir: false, lib: { entry: fileURLToPath(new URL('./src/automation/assist.ts', import.meta.url)), name: 'IdeaClipLocalAssist', formats: ['iife'], fileName: () => 'assist.js' } } });
