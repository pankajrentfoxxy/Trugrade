import type { Config } from 'tailwindcss';
import preset from '@trugrade/config/tailwind';

export default {
  presets: [preset],
  // The UI package is scanned too, or its class names get purged out from under it.
  content: ['./index.html', './src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
} satisfies Config;
