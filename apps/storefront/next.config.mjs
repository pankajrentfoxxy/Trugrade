import { assertLinkTargetsNotLocal } from '@trugrade/config/link-targets';

// Evaluated by `next build` and `next start` alike, so a public storefront can
// neither bake nor serve a supplier link to http://localhost:5173.
assertLinkTargetsNotLocal('The storefront', process.env.STOREFRONT_URL, {
  CONSOLE_URL: process.env.NEXT_PUBLIC_CONSOLE_URL ?? process.env.CONSOLE_URL,
});

/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  env: {
    // Client bundle reads NEXT_PUBLIC_* only. Map from CONSOLE_URL so production
    // builds pick up the seller origin without a second variable to forget.
    NEXT_PUBLIC_CONSOLE_URL:
      process.env.NEXT_PUBLIC_CONSOLE_URL ?? process.env.CONSOLE_URL ?? 'http://localhost:5173',
  },
  // The UI package ships TypeScript source rather than a build step, so Next has
  // to compile it. This is the whole reason it can be consumed unchanged by both
  // the Vite console and this app.
  transpilePackages: ['@trugrade/ui', '@trugrade/config', '@trugrade/contracts'],
  experimental: { typedRoutes: true },

  /**
   * Proxy `/api` to the API in development.
   *
   * Same-origin on purpose: the session cookies are `httpOnly` and first-party,
   * and a cross-origin fetch would either drop them or need CORS plus
   * `SameSite=None`, which is a materially weaker cookie for no benefit. In
   * production the edge does this and the rewrite is inert.
   */
  async rewrites() {
    const api = process.env.API_ORIGIN ?? 'http://localhost:4000';
    return [{ source: '/api/:path*', destination: `${api}/api/:path*` }];
  },

  /**
   * The customer portal moved from `/account/*` to the top level — `/home`,
   * `/orders`, `/team` and so on. Old links in emails and bookmarks still land.
   */
  async redirects() {
    return [
      { source: '/account', destination: '/home', permanent: true },
      { source: '/account/:path*', destination: '/:path*', permanent: true },
    ];
  },
};
