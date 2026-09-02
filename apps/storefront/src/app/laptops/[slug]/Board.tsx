'use client';

import * as React from 'react';
import { OfferGrid, type SupplyPointOffer } from '@trugrade/ui';
import { MARGIN_ITC_LABEL, Money, type Grade } from '@trugrade/contracts';
import type { SupplyPointOfferRow } from '../../../lib/api';
import { useProductCart } from '../../../lib/use-product-cart';

/**
 * The supply-point comparison board — `OfferGrid` from `packages/ui`, fed.
 *
 * Adds to the active cart in place so the buyer can line up several supply
 * points on one model without leaving the comparison.
 */
export function Board({
  rows,
  caption,
  pool,
  layout = 'cards',
}: {
  rows: readonly SupplyPointOfferRow[];
  caption: string;
  pool: 'REGULAR' | 'MARGIN';
  layout?: 'responsive' | 'cards' | 'table';
}): React.JSX.Element {
  const { qtyFor, busyListingId, addListing, updateListingQty } = useProductCart();

  const listingByOffer = React.useMemo(() => {
    const map = new Map<string, SupplyPointOfferRow>();
    for (const row of rows) {
      map.set(`${row.supplyPointCode}-${row.city}`, row);
    }
    return map;
  }, [rows]);

  const resolveRow = (offer: SupplyPointOffer): SupplyPointOfferRow | undefined =>
    listingByOffer.get(`${offer.supplyPointCode}-${offer.city}`);

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
        layout={layout}
        offers={offers}
        caption={caption}
        itcExplainerHref="/gst#margin"
        cartQtyFor={(offer) => {
          const row = resolveRow(offer);
          return row ? qtyFor(row.listingId) : null;
        }}
        cartBusyFor={(offer) => {
          const row = resolveRow(offer);
          return row ? busyListingId === row.listingId : false;
        }}
        onAdd={(offer, quantity) => {
          const row = resolveRow(offer);
          if (!row) return;
          void addListing(row.listingId, quantity);
        }}
        onCartQtyChange={(offer, quantity) => {
          const row = resolveRow(offer);
          if (!row) return;
          void updateListingQty(row.listingId, quantity);
        }}
      />
    </div>
  );
}
