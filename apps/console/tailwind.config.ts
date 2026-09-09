import type { Config } from 'tailwindcss';
import preset from '@trugrade/config/tailwind';

export default {
  presets: [preset],
  // The UI package is scanned too, or its class names get purged out from under it.
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
    // Vendor registration reuses the storefront flow shell; scan it or the
    // regflow grid classes are purged and "Why we ask" stacks under the form.
    '../storefront/src/app/register/**/*.{ts,tsx}',
    '../storefront/src/app/sell/register/**/*.{ts,tsx}',
    '../storefront/src/lib/controls.tsx',
  ],
} satisfies Config;
