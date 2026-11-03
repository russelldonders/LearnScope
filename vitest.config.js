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
    pool: 'threads',
    env: {
      VITE_SUPABASE_URL: viteEnv.VITE_SUPABASE_URL || 'http://127.0.0.1:54321',
      VITE_SUPABASE_ANON_KEY: viteEnv.VITE_SUPABASE_ANON_KEY || 'vitest-local-anon-key',
    },
  },
})
