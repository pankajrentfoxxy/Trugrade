import { BRAND } from '@trugrade/config/brand';

/**
 * The dark brand panel beside every credential form — the `/sign-in` and
 * `/register` pages and the header's dialog draw the same one.
 *
 * The supplied design's left panel, as drawn: an amber pill, an uppercase
 * headline with its second line in the accent, three bullets with stroke
 * icons, and the product render floating off the bottom edge. The words are
 * the one thing changed, because the panel may only claim what the product
 * backs: the QC report exists on every unit, {@link BRAND.name} is the seller
 * on the invoice, and warranty claims come to us. The design's discount
 * figure and warranty term are not measured anywhere here, so they are not on
 * the panel.
 *
 * Dark and cream in both themes — the design is one surface's own language,
 * like the cart's, and it does not flip.
 *
 * The laptop render is one of the homepage's own hero renders, `aria-hidden`
 * because it decorates; the bullets are the content.
 */
export function AuthBrandPanel(): React.JSX.Element {
  return (
    <aside className="authpanel" data-testid="auth-brand-panel">
      <span className="authpanel-save">{BRAND.qcProduct} certified</span>
      <h2 className="authpanel-title">
        Refurbished laptops.
        <br />
        <span>Made simple.</span>
      </h2>
      <ul className="authpanel-list">
        <li>
          <ShieldIcon />
          <span>
            <b>Tested &amp; certified</b>
            {BRAND.qcProduct} QC report with every unit
          </span>
        </li>
        <li>
          <ClockIcon />
          <span>
            <b>Warranty included</b>
            Claims come to {BRAND.name}, not the supplier
          </span>
        </li>
        <li>
          <InvoiceIcon />
          <span>
            <b>One GST invoice</b>
            {BRAND.name} is the seller, serials listed
          </span>
        </li>
      </ul>
      <div className="authpanel-art" aria-hidden="true">
        <img src="/home/laptop-dell.png" alt="" width={900} height={678} loading="lazy" />
      </div>
    </aside>
  );
}

/* Stroke icons, sized by the panel's CSS. `currentColor` so they take the
   panel's accent and never carry a colour of their own. */

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

function ShieldIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" {...STROKE} aria-hidden="true">
      <path d="M12 3.2 5 5.8v5.1c0 4.4 3 8.1 7 9.9 4-1.8 7-5.5 7-9.9V5.8L12 3.2Z" />
      <path d="m9 11.6 2.1 2.1 4.2-4.2" />
    </svg>
  );
}

function ClockIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" {...STROKE} aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

function InvoiceIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" {...STROKE} aria-hidden="true">
      <rect x="4" y="3.5" width="16" height="17" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </svg>
  );
}
