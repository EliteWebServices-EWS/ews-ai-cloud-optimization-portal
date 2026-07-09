/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import path from 'path';

const isPagesDeploy = process.env.GITHUB_ACTIONS === 'true';

export default defineConfig({
  root: path.resolve(__dirname, 'dashboard'),
  base: isPagesDeploy ? '/dashboard/' : '/',
  build: {
    outDir: path.resolve(__dirname, 'dashboard-dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'dashboard/index.html'),
        reports: path.resolve(__dirname, 'dashboard/reports.html'),
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
    include: ['dashboard/src/**/*.test.ts'],
  },
});
