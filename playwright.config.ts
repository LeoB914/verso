import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  retries: 0,
  // Electron windows compete for OS focus: parallel instances make hover
  // tooltips and autosave timing flaky. One worker keeps the suite honest and
  // deterministic (the whole suite still runs in under two minutes).
  workers: 1,
  use: {
    trace: 'on-first-retry',
  },
  // Electron E2E: no browsers needed, launches Electron directly.
  projects: [{ name: 'electron', use: {} }],
})
