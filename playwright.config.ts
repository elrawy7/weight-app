import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

const localChrome = '/usr/bin/google-chrome';
const useLocalChrome = !process.env.CI && existsSync(localChrome);
const chromium = useLocalChrome ? { launchOptions: { executablePath: localChrome } } : {};
const iphone = { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: devices['iPhone 15'].userAgent };

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://localhost:4180/weight-app/', trace: 'retain-on-failure', serviceWorkers: 'allow', timezoneId: 'Etc/GMT-3', locale: 'en-GB' },
  webServer: { command: 'node scripts/serve.mjs', url: 'http://localhost:4180/weight-app/', reuseExistingServer: true, timeout: 20_000 },
  projects: [
    { name: 'chromium-iphone', use: { ...devices['Desktop Chrome'], ...iphone, ...chromium } },
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 }, ...chromium }, grep: /@desktop/ },
    // WebKit = Safari engine. Runs in CI (GitHub Actions); the build sandbox cannot download it.
    ...(process.env.CI || process.env.WEBKIT ? [{ name: 'webkit-iphone', use: { ...devices['iPhone 15'] } }] : []),
  ],
});
