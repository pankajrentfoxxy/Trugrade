import '@testing-library/jest-dom';

/**
 * jsdom has no `matchMedia`, and the registration shell asks it whether the
 * viewport is wide enough for the step rail. Defaulting to "wide" renders the
 * desktop layout, which is what these tests are about.
 */
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
