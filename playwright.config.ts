import { defineConfig, devices } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnv } from 'vite';

// Playwright starts Vite as a child process. Resolve Vite's environment here
// so that fresh, isolated test servers receive configured public variables.
// loadEnv tolerates absent local env files in CI.
const viteEnv = loadEnv('development', process.cwd(), 'VITE_');
const localBaseURL = 'http://localhost:5176';
const authFile = 'playwright/.auth/learner.json';

// `env.test` is deliberately ignored while `env.test.example` is committed.
// Load only missing values so CI-provided variables always take precedence.
if (existsSync(resolve('env.test'))) {
  for (const line of readFileSync(resolve('env.test'), 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, '$2');
    process.env[match[1]] = value;
  }
}

const e2eBaseURL = process.env.E2E_BASE_URL?.replace(/\/$/, '');
const hasAuthenticatedLearner = process.env.E2E_AUTHENTICATED !== 'false' && Boolean(
  e2eBaseURL && process.env.E2E_LEARNER_EMAIL && process.env.E2E_LEARNER_PASSWORD,
);

if (hasAuthenticatedLearner && process.env.E2E_ALLOW_PRODUCTION !== 'true') {
  const hostname = new URL(e2eBaseURL).hostname;
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
  const isStaging = /(^|[.-])staging([.-]|$)/i.test(hostname);
  if (!isLocal && !isStaging) {
    throw new Error(
      `Refusing authenticated E2E tests against non-staging host "${hostname}". ` +
      'Set E2E_ALLOW_PRODUCTION=true only for an explicitly approved production run.',
    );
  }
}

const projects = [
  {
    name: 'chromium',
    testIgnore: [/authenticated\.spec\.ts/, /auth\.setup\.ts/],
    use: { ...devices['Desktop Chrome'] },
  },
];

if (hasAuthenticatedLearner) {
  projects.push(
    {
      name: 'auth-setup',
      testMatch: /auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'authenticated-chromium',
      testMatch: /authenticated\.spec\.ts/,
      dependencies: ['auth-setup'],
      use: { ...devices['Desktop Chrome'], storageState: authFile },
    },
  );
}

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
    baseURL: hasAuthenticatedLearner ? e2eBaseURL : localBaseURL,

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  /* Configure projects for major browsers. Chromium only by default. */
  projects,

  /* Run the local dev server before starting the tests */
  webServer: hasAuthenticatedLearner ? undefined : {
    command: 'npm run dev -- --port 5176',
    url: localBaseURL,
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
