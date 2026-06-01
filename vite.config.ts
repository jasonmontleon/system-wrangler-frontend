// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    // The pre-commit hook runs the whole suite in parallel, and a
    // constrained machine can starve individual workers during the
    // PatternFly-heavy import phase. The assertions are correct (the
    // suite passes cleanly with --no-file-parallelism); they just need
    // a higher ceiling than the 5 s default so a slow-but-correct test
    // isn't reported as a failure under load.
    testTimeout: 20000,
    hookTimeout: 20000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      exclude: ['**/*.config.*', '**/test/**', 'dist/**'],
    },
  },
})
