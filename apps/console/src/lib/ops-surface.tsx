import * as React from 'react';

/**
 * Pins hub tokens to the ops surface and lifts them on leave.
 *
 * The internal console used to run its own near-black, plum-accented
 * `data-surface='ops'` palette in `globals.css` specifically so admin work was
 * unmistakable from a vendor or buyer screen on a screen-share. That tradeoff
 * was reversed on purpose: the ops shell now composes onto the same
 * `data-surface='hub'` tokens `VendorSurfaceSync` sets for the vendor portal,
 * so the two read as one product. `globals.css`'s `[data-surface='ops']` block
 * is left in place but nothing activates it any more.
 */
export function OpsSurfaceSync(): null {
  React.useLayoutEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-surface', 'hub');
    root.setAttribute('data-density', 'compact');
    return () => {
      root.removeAttribute('data-surface');
      root.removeAttribute('data-density');
    };
  }, []);

  return null;
}
