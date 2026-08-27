'use client';

import * as React from 'react';
import { OfferGrid, type SupplyPointOffer } from '@trugrade/ui';
import { MARGIN_ITC_LABEL, Money, type Grade } from '@trugrade/contracts';
import type { SupplyPointOfferRow } from '../../../lib/api';

/**
 * The supply-point comparison board — `OfferGrid` from `packages/ui`, fed.
 *
 * It is a client component for one reason: `OfferGrid` and `OfferRow` are, and
 * `Money` is a class. A server component cannot hand a class instance across
 * the boundary — React serialises props — so the decimal strings the API sends
 * are parsed back into `Money` HERE, on the client side of the seam, and never
 * touched as floats on the way.
 *
 * **Nothing is sorted here.** The order is `compareOffers()` applied on the
 * server, where the paise live: landed price, then dispatch speed, then a stable
 * hash of a unit id. A second sort in the browser would be a second definition
 * of an order that has to be provably uncorrelated with vendor identity.
 *
 * **Nothing is filtered here either.** The row type is an allow-list with no
 * field for a vendor's name, GSTIN or org id, so there is nothing to hide; if a
 * vendor identifier ever reached this component the fix is in the endpoint, not
 * in a `delete` here.
 */
export function Board({
  rows,
  caption,
  pool,
}: {
  rows: readonly SupplyPointOfferRow[];
  caption: string;
  /**
   * Which tax pool this grid is. MARGIN and REGULAR run as visually distinct
   * pools (PHASE_05 Task 5): the input credit differs, so the rupees are not
   * comparable line for line however similar they look.
   */
  pool: 'REGULAR' | 'MARGIN';
}): React.JSX.Element {
  const offers: SupplyPointOffer[] = rows.map((r) => ({
    supplyPointCode: r.supplyPointCode,
    city: r.city,
    landedPrice: Money.parse(r.landedPrice),
    priceLines: r.priceLines.map((line) => ({
      label: line.label,
      amount: Money.parse(line.amount),
    })),
    valuationMethod: r.valuationMethod,
    grade: r.grade as Grade,
    batteryHealthPct: r.batteryHealthPct,
    quality: r.quality,
    totalWarrantyMonths: r.totalWarrantyMonths,
    unitsAvailable: r.unitsAvailable,
    inspectedOn: r.inspectedOn ?? 'Not recorded',
    qcExpiresOn: r.qcExpiresOn ?? 'Not recorded',
    // A certificate with no expiry on it is not a fresh one. Sending a large
    // number would suppress the warning; sending 0 flags it, which is the safe
    // direction for a missing date.
    qcExpiresInDays: r.qcExpiresInDays ?? 0,
    dispatchCommitment: r.dispatchCommitment,
  }));

  return (
    <div className="obrd" data-pool={pool}>
      {pool === 'MARGIN' && (
        <p className="poolnote">
          <b>{MARGIN_ITC_LABEL}.</b> These units were bought from unregistered sellers, so GST is
          charged on our margin under Rule 32(5) and the credit you can claim is smaller than on the
          rows above. The price is real; the after-tax cost is not the same. These rows are ranked
          among themselves, so &ldquo;lowest landed&rdquo; below means lowest in this pool — the
          cheapest row on the page is in the table above.{' '}
          <a className="ulink" href="/gst#margin">
            What this means for your costs
          </a>
        </p>
      )}
      <OfferGrid
        offers={offers}
        caption={caption}
        itcExplainerHref="/gst#margin"
        onAdd={(offer, quantity) => {
          const row = rows.find(
            (r) => r.supplyPointCode === offer.supplyPointCode && r.city === offer.city,
          );
          if (!row) return;
          // The cart is T15. The route is the contract, so this goes where the
          // cart will be rather than to an invented substitute — the same call
          // T11 made when it linked here before this page existed.
          window.location.href = `/cart?listing=${row.listingId}&qty=${quantity}`;
        }}
      />
    </div>
  );
}
