import * as React from 'react';

/**
 * Pins hub tokens to the vendor surface and lifts them on leave.
 *
 * Admin routes never mount this. The attribute is the whole safety property:
 * without it, globals.css changes nothing.
 */
export function VendorSurfaceSync(): null {
  React.useLayoutEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-surface', 'hub');
    root.setAttribute('data-density', 'default');
    return () => {
      root.removeAttribute('data-surface');
      root.removeAttribute('data-density');
    };
  }, []);

  return null;
}
