/**
 * The preset is plain CommonJS so Tailwind's own loader can read it without a
 * build step. That leaves TypeScript inferring `darkMode: 'class'` as `string`,
 * which is not assignable to `Partial<Config>` — so the type is declared here
 * once rather than cast at each of the three call sites.
 *
 * Deliberately NOT `import type { Config } from 'tailwindcss'`: this package has
 * no tailwindcss dependency of its own, so that import resolves to a different
 * copy than the consuming app's and the two `Config` types stop being
 * interchangeable. A structural record is assignable into every `presets` array
 * regardless of which copy the app resolved.
 */
declare const preset: Record<string, unknown>;
export = preset;
