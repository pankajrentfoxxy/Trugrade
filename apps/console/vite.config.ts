/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { assertLinkTargetsNotLocal } from '@trugrade/config/link-targets';

/**
 * The console is authenticated-only with zero SEO value, so SSR is pure
 * overhead. DeviceSure's own admin app is already this exact stack, which means
 * the team has built it once — the decisive argument against fighting App Router
 * caching on an admin data grid under deadline.
 */
export default defineConfig(({ command, mode }) => {
  if (command === 'build') {
    // The wordmark on /login and /forgot-password links to VITE_STOREFRONT_URL,
    // which is baked in here. A public console built without it shipped a link to
    // http://localhost:3000. CONSOLE_URL comes from the repo-root .env the API
    // reads, so a production build knows it is one.
    const consoleEnv = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), '');
    const rootEnv = loadEnv(mode, fileURLToPath(new URL('../..', import.meta.url)), '');
    assertLinkTargetsNotLocal('The console', process.env.CONSOLE_URL ?? rootEnv.CONSOLE_URL, {
      VITE_STOREFRONT_URL: process.env.VITE_STOREFRONT_URL ?? consoleEnv.VITE_STOREFRONT_URL,
    });
  }
  return {
    plugins: [react()],
    server: {
      port: 5173,
      // The API is same-origin in production behind the edge; proxying in dev
      // keeps cookies first-party so the auth path is identical in both.
      proxy: {
        '/api': {
          target: 'http://localhost:4000',
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('x-trugrade-audience', 'console');
            });
          },
        },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./test/setup.ts'],
      include: ['src/**/*.spec.{ts,tsx}', 'test/**/*.spec.{ts,tsx}'],
    },
  };
});
