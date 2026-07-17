/// <reference types="vitest/config" />

import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  root: path.resolve(__dirname, 'dashboard'),
  base: '/dashboard/',

  build: {
    outDir: path.resolve(__dirname, 'dashboard-dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(
          __dirname,
          'dashboard/index.html'
        ),
        reports: path.resolve(
          __dirname,
          'dashboard/reports.html'
        ),
        authCallback: path.resolve(
          __dirname,
          'dashboard/auth/callback.html'
        ),
      },
    },
  },

  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },

  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
  },
});
