/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The console is authenticated-only with zero SEO value, so SSR is pure
 * overhead. DeviceSure's own admin app is already this exact stack, which means
 * the team has built it once — the decisive argument against fighting App Router
 * caching on an admin data grid under deadline.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The API is same-origin in production behind the edge; proxying in dev
    // keeps cookies first-party so the auth path is identical in both.
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: true } },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.spec.{ts,tsx}', 'test/**/*.spec.{ts,tsx}'],
  },
});
