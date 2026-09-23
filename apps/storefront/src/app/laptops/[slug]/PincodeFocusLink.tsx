'use client';

import { scrollToPincode } from './pincode-demand';

/**
 * Scrolls to the pincode field and focuses it — the empty-board CTA should
 * land the reader in the input, not just at the section heading.
 */
export function PincodeFocusLink({
  children,
  className = 'ulink',
}: {
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={className}
      onClick={scrollToPincode}
    >
      {children}
    </button>
  );
}
