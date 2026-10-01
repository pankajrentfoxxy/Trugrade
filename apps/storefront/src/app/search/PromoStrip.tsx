import { OFFER } from '../../lib/offer';

/**
 * The offer line under the header on the search page. Its words live in
 * `lib/offer.ts`, shared with the product page. The code is set apart in a
 * chip because it is the one thing a buyer has to copy exactly.
 */
export function PromoStrip(): React.JSX.Element {
  return (
    <aside className="promo-strip" aria-label="Current offer">
      <p>
        <b>{OFFER.title}</b>
        <span> &middot; {OFFER.volume}</span>
        <span> &middot; {OFFER.firstOrder}</span>{' '}
        <code className="promo-code">{OFFER.code}</code> <span>&middot; {OFFER.ends}</span>
      </p>
    </aside>
  );
}
