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
          // WCAG 2.2 AA. Contrast pairs are verified in 09_FRONTEND_LOCKED.md §9
          // and recomputed in `tokens.spec.ts`; this catches the ones a designer
          // changes later.
          { id: 'color-contrast', enabled: true },
        ],
      },
    },
  },

  /**
   * Two toolbars, both writing an attribute on `<html>`, because that is
   * exactly how the real apps do it — `data-t` from `packages/ui`'s theme
   * module, `data-density` from the app root. Neither is a decorator that wraps
   * the story in a themed `<div>`: the tokens are defined on `:root[data-t=…]`,
   * so a wrapper would get the default theme and every story would lie.
   *
   * `?globals=theme:light` sets it from a URL, which is how the screenshot pass
   * captures both locked themes without clicking anything. Slate, olive and
   * sand are preview palettes for comparison, not the locked pair.
   */
  globalTypes: {
    theme: {
      description: 'Darkroom theme. Dark is the default; light is an opt-out.',
      toolbar: {
        title: 'Theme',
        icon: 'circlehollow',
        items: [
          { value: 'dark', title: 'Dark' },
          { value: 'slate', title: 'Slate' },
          { value: 'olive', title: 'Olive' },
          { value: 'sand', title: 'Sand' },
          { value: 'light', title: 'Light' },
        ],
        dynamicTitle: true,
      },
    },
    density: {
      description: 'Storefront 60px rows · vendor 46px · admin 34px.',
      toolbar: {
        title: 'Density',
        icon: 'component',
        items: [
          { value: 'comfortable', title: 'Comfortable — storefront' },
          { value: 'default', title: 'Default — vendor' },
          { value: 'compact', title: 'Compact — admin' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: 'dark', density: 'default' },

  decorators: [
    (Story, context) => {
      const root = document.documentElement;
      const theme = String(context.globals.theme);
      root.setAttribute(
        'data-t',
        theme === 'light' || theme === 'slate' || theme === 'olive' || theme === 'sand'
          ? theme
          : 'dark',
      );
      // "default" is the absence of the attribute, same as an app that never
      // sets one — so the default path is the one that gets exercised.
      if (context.globals.density === 'default') root.removeAttribute('data-density');
      else root.setAttribute('data-density', String(context.globals.density));
      return Story();
    },
  ],
};
export default preview;
