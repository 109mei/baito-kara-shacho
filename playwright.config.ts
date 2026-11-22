import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:4173/baito-kara-shacho/',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    channel: 'chrome',
    launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox'] },
  },
  webServer: { command: 'npm run preview', url: 'http://localhost:4173/baito-kara-shacho/', reuseExistingServer: true, timeout: 60_000 },
});
