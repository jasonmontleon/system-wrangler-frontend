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
  build: {
    // Vite 8 defaults CSS minification to Lightning CSS, whose native
    // binary has no ppc64le/s390x build — the bundle is built on those
    // arches, so route CSS minification through esbuild (a direct
    // devDependency) instead, which rolldown-vite already bundles.
    cssMinify: 'esbuild',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    // The app imports react-router primitives under two specifiers:
    // App.tsx / main.tsx use 'react-router-dom', while the dashboard
    // subtree (LeaderboardCard, SystemHealthWidget) uses 'react-router'.
    // The production bundle dedupes both to one module, so they share a
    // single Router context. Under Vitest they resolve to separate
    // context objects, so a 'react-router' hook mounted inside a
    // 'react-router-dom' <MemoryRouter> (e.g. a dashboard widget rendered
    // by App.test) throws "useNavigate may be used only in the context of
    // a Router". Aliasing dom -> core gives tests the same single context
    // they get in production. Safe because every symbol the app imports
    // from 'react-router-dom' is also exported by 'react-router' v7.
    alias: { 'react-router-dom': 'react-router' },
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
