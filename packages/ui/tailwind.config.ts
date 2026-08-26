import type { Config } from 'tailwindcss';
import preset from '@trugrade/config/tailwind';

/**
 * The design system's own Tailwind config, used by Storybook.
 * Both apps extend the same preset, so a token can only be defined once.
 */
export default {
  presets: [preset],
  content: ['./src/**/*.{ts,tsx}', './.storybook/**/*.{ts,tsx}'],
} satisfies Config;
