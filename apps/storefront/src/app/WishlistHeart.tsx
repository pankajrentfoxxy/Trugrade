'use client';

import * as React from 'react';
import { toggleWishlist, useWishlisted, type WishlistGrade } from '../lib/wishlist';

/**
 * The heart on a product card: save the model at this grade, or unsave it.
 *
 * A button beside the card's link, never inside it — a control inside an
 * anchor is invalid markup, and a click on it would also follow the link. Its
 * name says what it will do and to what, so a screen reader hears "Save Dell
 * Latitude 5420 to wishlist", not "button".
 */
export function WishlistHeart({
  skuId,
  grade,
  name,
  className,
}: {
  skuId: string;
  grade: string;
  /** What the card is, for the button's name. */
  name: string;
  className: string;
}): React.JSX.Element | null {
  const valid = grade === 'A_PLUS' || grade === 'A' || grade === 'B';
  const saved = useWishlisted({ skuId, grade: (valid ? grade : 'A') as WishlistGrade });
  if (!valid) return null;
  return (
    <button
      type="button"
      className={saved ? `${className} on` : className}
      aria-pressed={saved}
      aria-label={saved ? `Remove ${name} from wishlist` : `Save ${name} to wishlist`}
      title={saved ? 'Remove from wishlist' : 'Save to wishlist'}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleWishlist({ skuId, grade: grade as WishlistGrade });
      }}
    >
      <HeartIcon filled={saved} />
    </button>
  );
}

export function HeartIcon({ filled = false }: { filled?: boolean }): React.JSX.Element {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20.3s-7.6-4.6-9.2-9.4C1.6 7.3 3.9 4 7.3 4c2 0 3.6 1.1 4.7 2.7C13.1 5.1 14.7 4 16.7 4c3.4 0 5.7 3.3 4.5 6.9-1.6 4.8-9.2 9.4-9.2 9.4Z" />
    </svg>
  );
}
