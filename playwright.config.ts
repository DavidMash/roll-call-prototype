import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  // Files use isolated browser contexts/localStorage, so two workers safely
  // overlap independent specs while preserving serial order within each file.
  workers: 2,
  timeout: 60000,
  reporter: 'list',
  globalSetup: './tests/setup.ts',
  use: {
    baseURL: 'http://127.0.0.1:5174',
    channel: 'chrome',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
