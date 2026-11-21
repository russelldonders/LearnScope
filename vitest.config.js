import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'

const viteEnv = loadEnv('test', process.cwd(), 'VITE_')

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**', '**/.claude/worktrees/**'],
    // Child processes, not worker threads: under threads, files failed to
    // load now and then ("React.createContext is not a function", a
    // source-map-js export missing) as modules were loaded concurrently --
    // 5 in 20 runs of ExperienceDetail + Plans, 0 in 20 with forks, and a
    // full run is no slower.
    pool: 'forks',
    // Node 24's experimental global Web Storage shadows jsdom's per-window
    // implementation when no --localstorage-file is configured (as on CI).
    // Browser-facing tests must use jsdom's isolated storage instead.
    execArgv: ['--no-experimental-webstorage'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{js,jsx}', 'api/**/*.js'],
      exclude: [
        '**/*.{test,spec}.{js,jsx,ts,tsx}',
        'src/main.jsx',
        'src/test/**',
        'src/lib/i18n/**',
        'src/data/**',
      ],
      thresholds: {
        statements: 40,
        branches: 41,
        functions: 40,
        lines: 42,
      },
    },
    env: {
      VITE_SUPABASE_URL: viteEnv.VITE_SUPABASE_URL || 'http://127.0.0.1:54321',
      VITE_SUPABASE_ANON_KEY: viteEnv.VITE_SUPABASE_ANON_KEY || 'vitest-local-anon-key',
    },
  },
})
