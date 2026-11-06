import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests/native', outputDir: 'test-results-native', workers: 1, timeout: 900000, expect: { timeout: 300000 }, reporter: 'list', use: { trace: 'retain-on-failure' } });
