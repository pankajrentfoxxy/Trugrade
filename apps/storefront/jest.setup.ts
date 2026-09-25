import '@testing-library/jest-dom';

/**
 * jsdom has no `ResizeObserver`, and the shared `Carousel` (reviews, related
 * products) creates one on mount to measure whether its track overflows. A
 * no-op stub is enough: these tests check what renders, not scroll geometry.
 */
if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

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
