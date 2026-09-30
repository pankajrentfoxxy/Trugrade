import '@testing-library/jest-dom';
import type * as NextNavigation from 'next/navigation';

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

/**
 * The App Router, for every screen that navigates through it.
 *
 * Screens push, replace and refresh through `useRouter` rather than
 * assigning `window.location`, so that a navigation in the browser keeps the
 * page alive. jsdom mounts no router, and a call to `useRouter` outside one
 * throws — so a spy router is mounted here for every spec. A spec that needs
 * to assert on a push mocks `next/navigation` itself, and its mock wins.
 */
jest.mock('next/navigation', () => ({
  ...jest.requireActual<typeof NextNavigation>('next/navigation'),
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    refresh: jest.fn(),
    prefetch: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
  }),
}));
