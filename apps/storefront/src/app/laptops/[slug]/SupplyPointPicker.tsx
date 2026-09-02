'use client';

import * as React from 'react';
import type { Route } from 'next';
import { useRouter, useSearchParams } from 'next/navigation';
import type { SupplyPointOfferRow } from '../../../lib/api';
import { UnitList } from './UnitList';

type Search = Record<string, string | string[] | undefined>;

function offerKey(o: Pick<SupplyPointOfferRow, 'supplyPointCode' | 'city'>): string {
  return `${o.supplyPointCode}-${o.city}`;
}

function buildHref(
  slug: string,
  query: Search,
  offer: Pick<SupplyPointOfferRow, 'supplyPointCode' | 'city'> | null,
): string {
  const next: Search = { ...query };
  if (offer) {
    next.sp = offer.supplyPointCode;
    next.city = offer.city;
  } else {
    delete next.sp;
    delete next.city;
  }
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(next)) {
    const v = Array.isArray(value) ? value[0] : value;
    if (v !== undefined && v !== '') qs.append(key, v);
  }
  const s = qs.toString();
  return `/laptops/${encodeURIComponent(slug)}${s ? `?${s}` : ''}`;
}

/**
 * Supply-point chips with an accordion serial list directly beneath them.
 *
 * One click opens the serials for that source and writes `sp` + `city` into the
 * URL so a colleague sees the same row. A second click on the same chip closes
 * the panel and drops those params — the comparison board stays put.
 */
export function SupplyPointPicker({
  offers,
  initialSelected,
  slug,
  query,
}: {
  offers: readonly SupplyPointOfferRow[];
  initialSelected: SupplyPointOfferRow | null;
  slug: string;
  query: Search;
}): React.JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [openKey, setOpenKey] = React.useState<string | null>(
    initialSelected ? offerKey(initialSelected) : null,
  );
  /** Kept mounted through the close animation so the panel can collapse smoothly. */
  const [shownOffer, setShownOffer] = React.useState<SupplyPointOfferRow | null>(
    initialSelected,
  );

  React.useEffect(() => {
    const sp = searchParams.get('sp');
    const city = searchParams.get('city');
    const key = sp && city ? `${sp}-${city}` : null;
    setOpenKey(key);
    if (key) {
      const offer = offers.find((o) => offerKey(o) === key) ?? null;
      setShownOffer(offer);
    }
  }, [searchParams, offers]);

  function toggle(offer: SupplyPointOfferRow): void {
    const key = offerKey(offer);
    if (openKey === key) {
      setOpenKey(null);
      router.replace(buildHref(slug, query, null) as Route, { scroll: false });
      return;
    }
    setOpenKey(key);
    setShownOffer(offer);
    router.replace(buildHref(slug, query, offer) as Route, { scroll: false });
  }

  function onAccordionTransitionEnd(event: React.TransitionEvent<HTMLDivElement>): void {
    if (event.propertyName !== 'grid-template-rows' || openKey !== null) return;
    setShownOffer(null);
  }

  const panelId = 'supply-point-serials';
  const expanded = openKey !== null;

  return (
    <>
      <div className="gsel" role="group" aria-label="Supply point">
        {offers.map((o) => {
          const on = openKey === offerKey(o);
          return (
            <button
              key={offerKey(o)}
              type="button"
              className={on ? 'chipf on' : 'chipf'}
              aria-expanded={on}
              aria-controls={panelId}
              onClick={() => toggle(o)}
            >
              {o.label}
              <span className="c mono">
                {o.unitsAvailable} unit{o.unitsAvailable === 1 ? '' : 's'}
              </span>
            </button>
          );
        })}
      </div>

      <div
        id="units"
        className={expanded ? 'sp-acc open' : 'sp-acc'}
        aria-hidden={expanded ? undefined : true}
        onTransitionEnd={onAccordionTransitionEnd}
      >
        <div className="sp-acc-inner">
          {shownOffer && (
            <div id={panelId} className="sp-acc-panel">
              <UnitList units={shownOffer.units} label={shownOffer.label} />
            </div>
          )}
        </div>
      </div>
    </>
  );
}
