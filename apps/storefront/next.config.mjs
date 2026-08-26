/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
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
};
