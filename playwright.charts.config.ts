import { defineConfig } from '@playwright/test'
import path from 'node:path'

const outputRoot = path.resolve(__dirname, process.env.CHART_OUTPUT_DIR ?? './output/chart-verification')

export default defineConfig({
  testDir: './tests/chart-verification',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 45_000,
  expect: {
    timeout: 15_000,
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      threshold: 0.1,
      maxDiffPixels: 0,
    },
  },
  outputDir: path.join(outputRoot, 'test-results'),
  snapshotPathTemplate: '{testDir}/baseline-candidates/software-v1/{platform}/{projectName}/{testFilePath}/{arg}{ext}',
  updateSnapshots: process.env.CHART_CREATE_CANDIDATES === '1' ? 'missing' : 'none',
  globalSetup: './tests/chart-verification/baseline-policy.ts',
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: path.join(outputRoot, 'report') }],
    ['./tests/chart-verification/baseline-reporter.ts'],
  ],
  use: {
    baseURL: 'http://127.0.0.1:18474',
    browserName: 'chromium',
    channel: 'chrome',
    // Keep screenshot text rasterization independent of LCD compositing.
    launchOptions: { args: ['--disable-lcd-text', '--font-render-hinting=none', '--force-color-profile=srgb'] },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    deviceScaleFactor: 1,
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  projects: [
    { name: 'chrome-1920', use: { viewport: { width: 1920, height: 1080 } } },
    { name: 'chrome-1440', use: { viewport: { width: 1440, height: 1024 } } },
  ],
})
