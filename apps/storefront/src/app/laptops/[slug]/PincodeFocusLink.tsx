'use client';

/**
 * Scrolls to the deliver panel and focuses the pincode field — the empty-board
 * CTA should land the reader in the input, not just at the section heading.
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
      onClick={() => {
        document.getElementById('deliver')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        document.getElementById('pin')?.focus({ preventScroll: true });
      }}
    >
      {children}
    </button>
  );
}
