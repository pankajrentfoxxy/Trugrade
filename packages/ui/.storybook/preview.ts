import type { Preview } from '@storybook/react';
import '../src/globals.css';

/**
 * Every story renders in both themes. The `a11y` addon runs axe on each one, and
 * a violation fails CI — a component with an axe violation does not ship.
 */
const preview: Preview = {
  parameters: {
    controls: { expanded: true },
    backgrounds: { disable: true },
    a11y: {
      config: {
        rules: [
          // WCAG 2.2 AA. Contrast pairs are verified in 08_BRAND_SYSTEM.md §9;
          // this catches the ones a designer changes later.
          { id: 'color-contrast', enabled: true },
        ],
      },
    },
  },
  globalTypes: {
    theme: {
      description: 'Theme',
      defaultValue: 'light',
      toolbar: { icon: 'circlehollow', items: ['light', 'dark'], dynamicTitle: true },
    },
  },
  decorators: [
    (Story, context) => {
      document.documentElement.setAttribute('data-theme', context.globals.theme as string);
      return Story();
    },
  ],
};
export default preview;
