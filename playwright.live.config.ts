import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests/browser', testMatch: '**/*.live.ts', workers: 1, timeout: 60_000, reporter: 'list' });
