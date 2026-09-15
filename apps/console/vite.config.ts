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
  // The wordmark on /login and /forgot-password links to the storefront, and that
  // URL is baked in at build time. The storefront derives its console link from
  // the repo-root CONSOLE_URL the API reads; this is the mirror image, so the one
  // root .env a server already has configures both halves. A deploy that set
  // CONSOLE_URL and STOREFRONT_URL there and nothing else failed this build.
  // VITE_STOREFRONT_URL still wins when set, for a console built against a
  // storefront the root .env does not describe.
  const consoleEnv = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), '');
  const rootEnv = loadEnv(mode, fileURLToPath(new URL('../..', import.meta.url)), '');
  const storefrontUrl =
    process.env.VITE_STOREFRONT_URL ?? consoleEnv.VITE_STOREFRONT_URL ?? rootEnv.STOREFRONT_URL;
  if (command === 'build') {
    // A public console built without a storefront URL shipped a link to
    // http://localhost:3000. CONSOLE_URL is how a production build knows it is one.
    assertLinkTargetsNotLocal('The console', process.env.CONSOLE_URL ?? rootEnv.CONSOLE_URL, {
      STOREFRONT_URL: storefrontUrl,
    });
  }
  return {
    plugins: [react()],
    // Only defined once known, so a bare dev checkout keeps the source fallback.
    define: storefrontUrl
      ? { 'import.meta.env.VITE_STOREFRONT_URL': JSON.stringify(storefrontUrl) }
      : {},
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
