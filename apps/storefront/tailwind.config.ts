import type { Config } from 'tailwindcss';
import preset from '@trugrade/config/tailwind';

export default {
  presets: [preset],
  content: ['./src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
} satisfies Config;
