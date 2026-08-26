import type { Preview } from '@storybook/react';
import '../src/globals.css';

/**
 * The `a11y` addon runs axe on every story, and a violation fails CI — a
 * component with an axe violation does not ship.
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
  /**
   * No theme toggle. The Workbench palette is deliberately single-theme — a B2B
   * storefront that flips to dark mode is solving a problem nobody has, and two
   * themes double the QA surface across ~135 routes. The dark band is
   * compositional, so a story that needs it wraps itself in `.tg-dark`.
   */
  decorators: [
    (Story) => {
      document.documentElement.removeAttribute('data-theme');
      return Story();
    },
  ],
};
export default preview;
