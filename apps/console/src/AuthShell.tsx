import * as React from 'react';
import { LEGAL_DISCLOSURE } from '@trugrade/config/brand';
import { cn } from '@trugrade/ui';
import { VendorSurfaceSync } from './lib/vendor-surface';
import './routes/sell/supplier-signup.css';

/**
 * **ARCHETYPE F — Focus.** The frame every console credential screen sits in.
 *
 * The same card, brand panel and type as `/sell/register`, on the supplier hub
 * surface. Sign-in and password reset used to wear the storefront's dark split
 * frame and buyer accent, so a supplier crossed two brands between creating an
 * account and signing back into it. Under 980px the panel is dropped so the form
 * stays above the fold on a phone.
 */

const CLAIMS = [
  'We inspect, grade and seal every machine before it goes live',
  'Your name is never shown to buyers',
  'Payment on a fixed cycle, every deduction itemised',
  'No listing fee, no monthly fee',
] as const;

/** The left-hand panel of every supplier credential screen, signup included. */
export function SupplierBrandPanel(): React.JSX.Element {
  return (
    <aside className="sup-signup-brand" aria-hidden="true">
      <div>
        <p className="sup-signup-wm">
          tru<span className="g">grade</span>
        </p>
        <p className="sup-signup-claim">Sell refurbished laptops to Indian businesses.</p>
        <ul className="sup-signup-ticks">
          {CLAIMS.map((line) => (
            <li key={line}>
              <span className="sup-signup-tick-icon" aria-hidden="true">
                ✓
              </span>
              {line}
            </li>
          ))}
        </ul>
      </div>
      <p className="sup-signup-legal">{LEGAL_DISCLOSURE.legalName}</p>
    </aside>
  );
}

export function AuthShell({
  title,
  lede,
  wide,
  brandHref,
  children,
}: {
  title: string;
  lede: string;
  /** A panel that needs the full card width, e.g. a reviewer's decision. */
  wide?: boolean;
  /** Where the wordmark links. The console has no public home of its own. */
  brandHref?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="sup-signup-page">
      <VendorSurfaceSync />
      <div className={cn('sup-signup-card', wide && 'sup-signup-card--solo')}>
        {wide ? null : <SupplierBrandPanel />}
        <main className="sup-signup-main">
          <a className="sup-signup-home" href={brandHref ?? '/'}>
            tru<span className="g">grade</span>
          </a>
          <div className="sup-signup-head">
            <h1 className="sup-signup-step-title">{title}</h1>
            <p className="sup-signup-step-sub">{lede}</p>
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
