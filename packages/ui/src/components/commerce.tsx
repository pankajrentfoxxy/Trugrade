'use client';

// Interactive: this module uses React state, refs or context, none of which
// exist in a server component. The storefront is a Next App Router app, so
// without this directive importing anything from the package barrel drags a
// client-only API into an RSC render and fails at request time rather than at
// build time.
import * as React from 'react';
import {
  Money,
  stateTaxLabel,
  supplyPointLabel,
  type Grade,
  type LandedPrice,
  type QualityHeadline,
} from '@trugrade/contracts';
import { cn } from '../lib/cn';
import { Evidence } from './Evidence';
import { Button, GradeBadge, ScoreRing, StatusPill } from './primitives';

/* ==========================================================================
 * PriceBreakup — the landed-price disclosure
 * ======================================================================== */

export interface PriceLine {
  label: string;
  amount: Money;
  /** A clarification that belongs to this line, not to the whole break-up. */
  note?: string;
}

export type ValuationMethod = 'REGULAR' | 'MARGIN';

/**
 * Rule 32(5) of the CGST Rules, 2017. The narration is mandated wording on a
 * margin-scheme supply and is quoted, not paraphrased.
 */
const MARGIN_NARRATION =
  'Value determined under Rule 32(5) of the CGST Rules, 2017. No input tax credit availed on purchase.';

export interface PriceBreakupProps {
  lines: readonly PriceLine[];
  valuationMethod: ValuationMethod;
  /** e.g. "Prices include GST and freight to 110020." */
  taxNote?: React.ReactNode;
  /** Where "limited input credit" is explained at length. */
  itcExplainerHref?: string;
  className?: string;
}

/**
 * There is deliberately **no `total` prop**.
 *
 * The total is the sum of the lines, computed here in `Money`, because the only
 * way a break-up can be wrong is for its total to disagree with what is above
 * it — and a component that accepts both numbers is a component that can be
 * handed two that do not match. Removing the prop removes the failure.
 *
 * Every line is on screen at once. Revealing a charge progressively is drip
 * pricing, which the CCPA Dark Patterns Guidelines 2023 name outright, so this
 * component has no "show more" and no collapsed rows: a caller may put the whole
 * break-up behind a disclosure, never part of it.
 */
export function PriceBreakup({
  lines,
  valuationMethod,
  taxNote,
  itcExplainerHref,
  className,
}: PriceBreakupProps): React.JSX.Element {
  const total = Money.sum(lines.map((line) => line.amount));

  return (
    <div className={cn('rounded border border-rule bg-sheet-2 p-4', className)}>
      <dl className="flex flex-col gap-2">
        {lines.map((line) => (
          <div key={line.label} className="flex items-baseline justify-between gap-4">
            <dt className="text-body-sm text-ink-2">
              {line.label}
              {line.note && <span className="block text-label text-ink-3">{line.note}</span>}
            </dt>
            <dd className="font-mono text-data tnum text-ink-2">{line.amount.format()}</dd>
          </div>
        ))}

        <div className="flex items-baseline justify-between gap-4 border-t border-rule pt-2">
          <dt className="text-body-sm font-medium text-ink">Landed price</dt>
          <dd className="font-mono text-h3 tnum text-ink" data-testid="price-breakup-total">
            {total.format()}
          </dd>
        </div>
      </dl>

      {taxNote && <p className="mt-3 text-body-sm text-ink-2">{taxNote}</p>}

      {valuationMethod === 'MARGIN' && (
        <div className="mt-3 flex flex-col gap-2 border-t border-rule pt-3">
          <StatusPill tone="warn" label="GST on margin" />
          <p className="text-body-sm text-ink-2">{MARGIN_NARRATION}</p>
          {/* A procurement head who discovers thinner ITC at invoice time does
              not buy again. It changes their real cost, so it is disclosed
              before the offer is added to a cart, not at checkout. */}
          <p className="text-body-sm text-ink">
            Input tax credit available to you: nil on this line.
            {itcExplainerHref && (
              <>
                {' '}
                <a href={itcExplainerHref} className="text-acc-ink underline underline-offset-2">
                  What this means for your costs
                </a>
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * A `LandedPrice` from `@trugrade/contracts` as the lines a buyer reads.
 *
 * Kept next to the component so the labels — and in particular UTGST rather than
 * SGST for a union territory — are decided in one place instead of at each of
 * the cart, checkout, offer-row and invoice call sites.
 */
export function landedPriceLines(
  landed: LandedPrice,
  options: { deliveryStateCode?: string } = {},
): PriceLine[] {
  const lines: PriceLine[] = [{ label: 'Unit price', amount: landed.sellingPrice }];
  if (!landed.freight.isZero()) lines.push({ label: 'Freight', amount: landed.freight });

  if (landed.isInterState) {
    lines.push({ label: 'IGST', amount: landed.igst });
  } else {
    lines.push({ label: 'CGST', amount: landed.cgst });
    lines.push({
      label: options.deliveryStateCode ? stateTaxLabel(options.deliveryStateCode) : 'SGST',
      amount: landed.sgst,
    });
  }
  return lines;
}

/* ==========================================================================
 * OfferRow / OfferGrid — the anonymity contract
 * ======================================================================== */

/**
 * One supply point offering one SKU at one grade.
 *
 * **This type is the anonymity control.** It is an allow-list, not a filtered
 * vendor: there is no field for a legal name, a trade name, a GSTIN, a PAN, an
 * address, a phone, an email or an `org_id`, so there is nothing for a caller to
 * forget to hide and nothing for the component to hide client-side. We are the
 * merchant of record; the vendor is not a party the buyer transacts with, and
 * their identity is not the buyer's information to have.
 *
 * Equally absent, and equally deliberate (03_UX_SPEC.md §2.2): any star rating,
 * tier, "Gold"/"Top seller"/"Trusted" badge, count of a supply point's other
 * listings, "seller since" date or response-time metric. Quality metrics are
 * performance and are shown; anything that accretes into a reputation a buyer
 * could follow off-platform is identity wearing a metric's clothes.
 */
export interface SupplyPointOffer {
  /** A single letter, `A`. Stable per vendor per city, not derived from any id. */
  supplyPointCode: string;
  /** The **dispatch** city, from the facility pincode. Never a registered office. */
  city: string;
  /** Our price + freight + GST. The vendor's ask is not an input to this component. */
  landedPrice: Money;
  priceLines: readonly PriceLine[];
  valuationMethod: ValuationMethod;
  grade: Grade;
  /** Measured, from the inspection. `null` when this grade has no battery test. */
  batteryHealthPct: { min: number; max: number } | null;
  /**
   * Already resolved by `qualityHeadline()` in `@trugrade/contracts`, so the
   * small-sample decision is made once, server-side, and cannot be re-litigated
   * into a 100% badge computed on two machines.
   */
  quality: QualityHeadline;
  /**
   * The **total** months the buyer gets. There is no field for the vendor's
   * share or ours: the split is a commercial arrangement between us and the
   * supply point, and putting it in a customer payload is a Phase 5 exit-criteria
   * failure.
   */
  totalWarrantyMonths: number;
  /** Sellable units only, per `listing.v_sellable_unit`. */
  unitsAvailable: number;
  /** Display strings, already formatted for `en-IN` by the caller. */
  inspectedOn: string;
  qcExpiresOn: string;
  /** Computed server-side: this package has no clock, and `Date.now()` is banned. */
  qcExpiresInDays: number;
  /** "ships in 24 h". Anonymised — never a named carrier account or facility. */
  dispatchCommitment: string;
}

const CODE_PATTERN = /^[A-Z]{1,2}$/;
/**
 * Letters, spaces, hyphens and apostrophes only, and short.
 *
 * Defence in depth behind the allow-list above. A GSTIN, PAN, pincode, phone
 * number, e-mail or address line all carry digits or punctuation this rejects,
 * and a corporate name ("Northwind Logistics Private Limited") does not fit in
 * the length of a city. It is not a substitute for the API's DTO whitelist — it
 * is what catches the day someone reaches for `city` as a spare string field.
 */
const CITY_PATTERN = /^[\p{L} '-]{2,28}$/u;

export function assertSupplyPointOnly(offer: {
  supplyPointCode: string;
  city: string;
}): void {
  if (!CODE_PATTERN.test(offer.supplyPointCode)) {
    throw new Error(
      'supplyPointCode must be the anonymised label (one or two capital letters). ' +
        'A buyer sees "Supply Point A · Gurugram" and nothing finer.',
    );
  }
  if (!CITY_PATTERN.test(offer.city)) {
    // The offending value is deliberately not echoed: an error message that
    // quotes it is itself a customer-facing leak (Phase 5 Task 1).
    throw new Error(
      'city must be a dispatch city name — letters only, at most 28 characters. ' +
        'A vendor legal name, address line or contact detail is not a city.',
    );
  }
}

function batteryRange(range: SupplyPointOffer['batteryHealthPct']): string {
  if (!range) return 'Not measured';
  return range.min === range.max ? `${range.min}%` : `${range.min}–${range.max}%`;
}

/** 14 days is the warning window from Phase 5 Task 4. */
const QC_EXPIRY_WARNING_DAYS = 14;

function QualityCell({ quality }: { quality: QualityHeadline }): React.JSX.Element {
  if (quality.kind === 'NEW_SUPPLIER') {
    return <span className="text-body-sm text-ink-2">{quality.label}</span>;
  }
  return (
    <span className="flex items-center gap-4">
      <ScoreRing value={quality.avgQcScore} size={40} />
      {/* minSample 0 because `qualityHeadline()` has already made that call, and
          two components deciding the same thing is how they come to disagree. */}
      <Evidence
        value={quality.gradeAccuracyPct}
        pct
        denominator={quality.unitsInspected}
        denominatorLabel="units"
        minSample={0}
      />
    </span>
  );
}

function QcExpiry({ offer }: { offer: SupplyPointOffer }): React.JSX.Element {
  return (
    <span className="flex flex-col gap-1">
      <span className="text-body-sm text-ink">{offer.inspectedOn}</span>
      {offer.qcExpiresInDays <= QC_EXPIRY_WARNING_DAYS ? (
        <StatusPill
          tone="warn"
          label={`Expires in ${offer.qcExpiresInDays} day${offer.qcExpiresInDays === 1 ? '' : 's'}`}
        />
      ) : (
        <span className="text-body-sm text-ink-2">Valid to {offer.qcExpiresOn}</span>
      )}
    </span>
  );
}

interface OfferActionProps {
  offer: SupplyPointOffer;
  onAdd?: (quantity: number) => void;
  idPrefix: string;
}

function OfferAction({ offer, onAdd, idPrefix }: OfferActionProps): React.JSX.Element {
  // Held as a string, like `CommissionReadout` holds a rupee amount: a field
  // that snaps back to 1 the moment it is cleared makes the next keystroke
  // append rather than replace, and the buyer adds thirteen laptops.
  const [quantity, setQuantity] = React.useState('1');
  const label = supplyPointLabel(offer.supplyPointCode, offer.city);
  const quantityId = `${idPrefix}-qty`;
  const resolved = Math.min(Math.max(1, Math.floor(Number(quantity)) || 1), offer.unitsAvailable);

  // A supply point with nothing sellable should never have reached this grid —
  // `listing.v_sellable_unit` is the one definition and the API applies it. But
  // an Add button that would put zero units in a cart is worse than a row that
  // says so, so the state exists rather than being assumed away.
  if (offer.unitsAvailable < 1) {
    return <span className="text-body-sm text-ink-2">No units available</span>;
  }

  return (
    <span className="flex flex-wrap items-end gap-3">
      <span className="flex flex-col gap-1">
        <label htmlFor={quantityId} className="font-mono text-label uppercase tracking-[0.13em] text-ink-2">
          Qty
        </label>
        <input
          id={quantityId}
          type="number"
          inputMode="numeric"
          min={1}
          max={offer.unitsAvailable}
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          onBlur={() => setQuantity(String(resolved))}
          className="h-11 w-20 rounded border border-rule bg-sheet px-3 text-body-sm tnum text-ink"
        />
      </span>
      <Button variant="primary" onClick={() => onAdd?.(resolved)} aria-label={`Add ${label} to cart`}>
        Add to cart
      </Button>
    </span>
  );
}

export interface OfferRowProps {
  offer: SupplyPointOffer;
  /** A neutral "Lowest landed" note. Not a scarcity badge, and not a countdown. */
  lowestLanded?: boolean;
  onAdd?: (quantity: number) => void;
  itcExplainerHref?: string;
}

function PriceCell({
  offer,
  lowestLanded,
  itcExplainerHref,
}: OfferRowProps): React.JSX.Element {
  return (
    <span className="flex flex-col gap-2">
      <span className="font-mono text-h3 tnum text-ink">{offer.landedPrice.format()}</span>
      {lowestLanded && <span className="text-body-sm text-ink-2">Lowest landed</span>}
      {/* A native disclosure: click-operated, keyboard-operable, and no hover
          tooltip carrying information the buyer needs before purchase (1.4.13).
          The whole break-up is behind it — never part of it. */}
      <details className="text-body-sm">
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-acc-ink underline underline-offset-4">
          Price break-up
        </summary>
        <PriceBreakup
          className="mt-2"
          lines={offer.priceLines}
          valuationMethod={offer.valuationMethod}
          itcExplainerHref={itcExplainerHref}
        />
      </details>
    </span>
  );
}

/**
 * The `≥md` rendering: a real `<tr>` inside `OfferGrid`'s `<table>`.
 *
 * No `...rest` spread and no `data-*` passthrough, on purpose. A component that
 * forwards unknown props to the DOM is a component through which a vendor id can
 * be smuggled into an attribute, and "we checked the visible fields" is exactly
 * the review that misses it.
 */
export function OfferRow({
  offer,
  lowestLanded,
  onAdd,
  itcExplainerHref,
}: OfferRowProps): React.JSX.Element {
  assertSupplyPointOnly(offer);
  const id = React.useId();

  return (
    <tr className="border-b border-rule-2 align-top last:border-b-0">
      <th scope="row" className="tg-cell text-left font-medium text-ink">
        {supplyPointLabel(offer.supplyPointCode, offer.city)}
      </th>
      <td className="tg-cell">
        <PriceCell offer={offer} lowestLanded={lowestLanded} itcExplainerHref={itcExplainerHref} />
      </td>
      <td className="tg-cell">
        <QualityCell quality={offer.quality} />
      </td>
      <td className="tg-cell">
        <GradeBadge grade={offer.grade} />
      </td>
      <td className="tg-cell tnum text-ink">{batteryRange(offer.batteryHealthPct)}</td>
      <td className="tg-cell tnum text-ink">{offer.totalWarrantyMonths} months</td>
      <td className="tg-cell tnum text-ink">{offer.unitsAvailable}</td>
      <td className="tg-cell">
        <QcExpiry offer={offer} />
      </td>
      <td className="tg-cell text-ink">{offer.dispatchCommitment}</td>
      <td className="tg-cell">
        <OfferAction offer={offer} onAdd={onAdd} idPrefix={id} />
      </td>
    </tr>
  );
}

/**
 * The `<md` rendering: an `<article>` with an `<h3>` and a `<dl>`.
 *
 * The table semantics are dropped rather than faked with `role` overrides
 * (§1.9.4). Only one of the two renderings is in the accessibility tree at any
 * viewport, because the other is `display:none`.
 */
export function OfferCard({
  offer,
  lowestLanded,
  onAdd,
  itcExplainerHref,
}: OfferRowProps): React.JSX.Element {
  assertSupplyPointOnly(offer);
  const id = React.useId();

  const facts: Array<[string, React.ReactNode]> = [
    ['Grade', <GradeBadge key="g" grade={offer.grade} />],
    ['Battery health', batteryRange(offer.batteryHealthPct)],
    ['Total warranty', `${offer.totalWarrantyMonths} months`],
    ['Units available', offer.unitsAvailable],
    ['Inspected', <QcExpiry key="q" offer={offer} />],
    ['Dispatch', offer.dispatchCommitment],
  ];

  return (
    <article className="tg-card flex flex-col gap-4 rounded-lg border border-rule bg-sheet">
      <h3 className="font-sans text-h3 text-ink">
        {supplyPointLabel(offer.supplyPointCode, offer.city)}
      </h3>
      <PriceCell offer={offer} lowestLanded={lowestLanded} itcExplainerHref={itcExplainerHref} />
      <QualityCell quality={offer.quality} />
      <dl className="flex flex-col gap-2">
        {facts.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-4">
            <dt className="text-body-sm text-ink-2">{label}</dt>
            <dd className="text-body-sm text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      <OfferAction offer={offer} onAdd={onAdd} idPrefix={id} />
    </article>
  );
}

const OFFER_COLUMNS = [
  'Supply point',
  'Landed price',
  'Quality, this model',
  'Grade',
  'Battery health',
  'Total warranty',
  'Units available',
  'Inspected',
  'Dispatch',
] as const;

export interface OfferGridProps {
  offers: readonly SupplyPointOffer[];
  /**
   * Names the SKU and states the order, e.g. "6 supply points offering Dell
   * Latitude 5420 · i5-1145G7 / 16 GB / 512 GB, sorted by landed price, lowest
   * first. Prices include GST and freight to 110020."
   */
  caption: string;
  onAdd?: (offer: SupplyPointOffer, quantity: number) => void;
  itcExplainerHref?: string;
  className?: string;
}

/**
 * The comparison grid. The most load-bearing screen in the product.
 *
 * It renders offers **in the order it is given** and does not sort. The
 * non-leaking order — landed price, then dispatch speed, then a stable hash of
 * the unit id — is `compareOffers()` in `@trugrade/contracts`, applied where the
 * paise live, on the server. A second sort here would be a second definition of
 * an order that has to be provably uncorrelated with vendor identity, and two
 * definitions of that is one too many.
 *
 * "Lowest landed" is computed from the prices rather than assumed of the first
 * row, so it stays true under any order the caller chose.
 */
export function OfferGrid({
  offers,
  caption,
  onAdd,
  itcExplainerHref,
  className,
}: OfferGridProps): React.JSX.Element {
  const lowest = offers.reduce<Money | null>(
    (best, offer) => (best === null || offer.landedPrice.lt(best) ? offer.landedPrice : best),
    null,
  );
  const isLowest = (offer: SupplyPointOffer) => lowest !== null && offer.landedPrice.eq(lowest);

  return (
    <div className={className}>
      <div role="status" aria-live="polite" className="sr-only">
        {caption}
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-body-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-rule">
              {OFFER_COLUMNS.map((column) => (
                <th
                  key={column}
                  scope="col"
                  className="tg-cell text-left font-mono text-label uppercase tracking-[0.13em] text-ink-2"
                >
                  {column}
                </th>
              ))}
              <th scope="col" className="tg-cell text-left">
                <span className="sr-only">Add to cart</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {offers.map((offer) => (
              <OfferRow
                key={`${offer.supplyPointCode}-${offer.city}-${offer.grade}`}
                offer={offer}
                lowestLanded={isLowest(offer)}
                onAdd={onAdd ? (quantity) => onAdd(offer, quantity) : undefined}
                itcExplainerHref={itcExplainerHref}
              />
            ))}
          </tbody>
        </table>
      </div>

      <ul className="flex flex-col gap-4 md:hidden">
        {offers.map((offer) => (
          <li key={`${offer.supplyPointCode}-${offer.city}-${offer.grade}`}>
            <OfferCard
              offer={offer}
              lowestLanded={isLowest(offer)}
              onAdd={onAdd ? (quantity) => onAdd(offer, quantity) : undefined}
              itcExplainerHref={itcExplainerHref}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
