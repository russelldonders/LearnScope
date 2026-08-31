import { defineConfig, devices } from '@playwright/test';
import { loadEnv } from 'vite';

// Playwright starts Vite as a child process. Resolve Vite's environment here
// so that fresh, isolated test servers receive configured public variables.
// loadEnv tolerates absent local env files in CI.
const viteEnv = loadEnv('development', process.cwd(), 'VITE_');

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './e2e',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: 'http://localhost:5176',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  /* Configure projects for major browsers. Chromium only by default. */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Run the local dev server before starting the tests */
  webServer: {
    command: 'npm run dev -- --port 5176',
    url: 'http://localhost:5176',
    env: {
      // Public-route smoke tests do not call Supabase. Local placeholders
      // keep the client constructible when a developer has no project
      // credentials, while real configured values still take precedence.
      VITE_SUPABASE_URL: viteEnv.VITE_SUPABASE_URL || 'http://127.0.0.1:54321',
      VITE_SUPABASE_ANON_KEY: viteEnv.VITE_SUPABASE_ANON_KEY || 'playwright-local-anon-key',
    },
    // A different worktree can legitimately have Vite on its default port.
    // Reusing it makes tests exercise the wrong source tree while appearing
    // healthy, so this suite always owns its server.
    reuseExistingServer: false,
  },
});
