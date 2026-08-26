/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  // The UI package ships TypeScript source rather than a build step, so Next has
  // to compile it. This is the whole reason it can be consumed unchanged by both
  // the Vite console and this app.
  transpilePackages: ['@trugrade/ui', '@trugrade/config', '@trugrade/contracts'],
  experimental: { typedRoutes: true },
};
