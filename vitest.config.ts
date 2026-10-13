import { defineConfig } from 'vitest/config'

// Kept separate from vite.config.ts so tests do not start the API plugin (which probes the claude CLI).
export default defineConfig({
  test: { include: ['src/**/*.test.ts', 'server/**/*.test.ts'] },
})
