import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests/browser', testMatch: '**/*.live.ts', outputDir: './test-results-live', workers: 1, timeout: 60_000, reporter: 'list' });
