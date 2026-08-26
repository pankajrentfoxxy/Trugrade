'use client';

// Interactive: this module uses React state, refs or context, none of which
// exist in a server component. The storefront is a Next App Router app, so
// without this directive importing anything from the package barrel drags a
// client-only API into an RSC render and fails at request time rather than at
// build time.
import * as React from 'react';
import { Money, priceFromNetPayout, type MarginRule, type Grade } from '@trugrade/contracts';
import { cn } from '../lib/cn';

export interface CommissionReadoutProps {
  /** Rupees, as typed. A partial number while someone is mid-keystroke is normal. */
  netPayoutRupees: string;
  grade: Grade;
  rule: MarginRule;
  vendorWarrantyMonths: number;
  className?: string;
}

/**
 * The live commission readout (PHASE_03 / retrofit change 5).
 *
 * The vendor types the amount they want to receive and this shows our charge as
 * a percentage of the selling price. That is the whole reconciliation: vendors
 * think in percentages, the contract is a fixed rupee amount, and refusing them
 * the vocabulary loses the conversation rather than winning it.
 *
 * Two things it will not do:
 *   - round the percentage into a friendlier number. A vendor who checks the
 *     arithmetic must land on what we showed them.
 *   - hide the components. The break-up is on screen, not one click away —
 *     progressive disclosure of a charge is drip pricing, and the CCPA Dark
 *     Patterns Guidelines 2023 name it.
 */
export function CommissionReadout({
  netPayoutRupees,
  grade,
  rule,
  vendorWarrantyMonths,
  className,
}: CommissionReadoutProps): React.JSX.Element | null {
  const breakdown = React.useMemo(() => {
    // Money.parse throws on anything that is not a clean decimal, which is the
    // correct behaviour for storage and the wrong behaviour for a keystroke.
    const trimmed = netPayoutRupees.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
    try {
      const payout = Money.parse(trimmed);
      if (payout.isZero()) return null;
      return priceFromNetPayout({
        vendorNetPayout: payout,
        grade,
        rule,
        vendorWarrantyMonths,
      });
    } catch {
      return null;
    }
  }, [netPayoutRupees, grade, rule, vendorWarrantyMonths]);

  if (!breakdown) {
    return (
      <p className={cn('text-body-sm text-ink-2', className)}>
        Enter the amount you want to receive and we will show our charge.
      </p>
    );
  }

  const rows: Array<[string, string]> = [
    ['You receive', breakdown.vendorNetPayout.format()],
    ['Our margin', breakdown.marginAmount.format()],
  ];
  if (!breakdown.warrantyReserve.isZero()) {
    rows.push([
      `Warranty reserve · ${breakdown.platformBackedMonths} months we fund`,
      breakdown.warrantyReserve.format(),
    ]);
  }

  return (
    <div className={cn('rounded border border-rule bg-sheet-2 p-5', className)}>
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-body text-ink">Our commission</span>
        <span className="font-mono text-h2 tnum text-acc-ink" data-testid="commission-pct">
          {breakdown.commissionPct}%
        </span>
      </div>

      <dl className="mt-4 flex flex-col gap-2 border-t border-rule-2 pt-4">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-4">
            <dt className="text-body-sm text-ink-2">{label}</dt>
            <dd className="font-mono text-data tnum text-ink-2">{value}</dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-4 border-t border-rule-2 pt-2">
          <dt className="text-body-sm text-ink">Listed at</dt>
          <dd className="font-mono text-data tnum text-ink" data-testid="selling-price">
            {breakdown.sellingPrice.format()}
          </dd>
        </div>
      </dl>

      <p className="mt-4 text-body-sm text-ink-2">
        Your {breakdown.vendorNetPayout.format()} does not change — not for freight, not for a
        discount, not if we correct the grade after inspection. It is fixed when the purchase order
        is raised.
      </p>
    </div>
  );
}
