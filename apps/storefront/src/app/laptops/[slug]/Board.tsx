'use client';

import * as React from 'react';
import { OfferGrid, type SupplyPointOffer } from '@trugrade/ui';
import { MARGIN_ITC_LABEL, Money, supplyPointLabel, type Grade } from '@trugrade/contracts';
import type { SupplyPointOfferRow } from '../../../lib/api';
import { useProductCart } from '../../../lib/use-product-cart';
import { demandPincode } from './pincode-demand';

/**
 * The supply-point comparison board — `OfferGrid` from `packages/ui`, fed.
 *
 * Adds to the active cart in place so the buyer can line up several supply
 * points on one model without leaving the comparison. Before a pincode a
 * row's Add sends the buyer to the pincode box instead, as the panel's
 * buttons do: the line that goes in the cart is the landed one.
 */
export function Board({
  rows,
  caption,
  pool,
  pincode,
  sku,
  spec,
  layout = 'cards',
}: {
  rows: readonly SupplyPointOfferRow[];
  caption: string;
  pool: 'REGULAR' | 'MARGIN';
  /** The delivery pincode the rows are landed to, or null before one is given. */
  pincode: string | null;
  /** "Dell Latitude 5420" — what a signed-out basket calls this line. */
  sku: string;
  /** "i5-1135G7 · 16 GB · 512 GB NVMe SSD · 14"" */
  spec: string;
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
    unitPrice: Money.parse(r.unitPrice),
    // The product page compares on the unit price only. The pincode decides
    // whether we deliver, not what this board shows: GST and freight are
    // added at checkout against the buyer's real site, and a landed figure
    // here beside a unit figure there was two prices for one machine.
    landedPrice: null,
    priceLines: [],
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
          if (!pincode) {
            demandPincode();
            return;
          }
          const row = resolveRow(offer);
          if (!row) return;
          // The snapshot is only read when the visitor is signed out. It is
          // what `/cart` renders from, because no endpoint that could name a
          // listing for them is reachable without a session.
          void addListing(row.listingId, quantity, {
            listingId: row.listingId,
            title: sku,
            specSummary: spec,
            grade: row.grade,
            // Our unit price, as the board shows it; checkout lands it
            // against the real site.
            unitPrice: row.unitPrice,
            supplyPoint: supplyPointLabel(row.supplyPointCode, row.city),
            dispatch: row.dispatchCommitment,
          });
        }}
        onCartQtyChange={(offer, quantity) => {
          const row = resolveRow(offer);
          if (!row) return;
          void updateListingQty(row.listingId, quantity);
        }}
      />
      {/* Under the rows, as a footnote: the table is the evidence, and the
          scheme note explains the column rather than introducing it. */}
      {pool === 'MARGIN' && (
        <p className="poolnote">
          <b>{MARGIN_ITC_LABEL}.</b> These units were bought from unregistered sellers, so GST is
          charged on our margin under Rule 32(5) and the credit you can claim is smaller than on the
          rows above. The price is real; the after-tax cost is not the same. These rows are ranked
          among themselves, so &ldquo;lowest landed&rdquo; above means lowest in this pool — the
          cheapest row on the page is in the table above.{' '}
          <a className="ulink" href="/gst#margin">
            What this means for your costs
          </a>
        </p>
      )}
    </div>
  );
}
