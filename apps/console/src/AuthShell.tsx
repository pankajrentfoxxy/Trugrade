import { BRAND } from '@trugrade/config/brand';

/**
 * **ARCHETYPE F — Focus.** The frame every credential screen sits in.
 *
 * Same two-column shape as the storefront sign-in and forgot-password routes:
 * the task on the left, a dark brand panel on the right. Under 900px the panel
 * is dropped so the form stays above the fold on a phone.
 */
export function AuthShell({
  title,
  lede,
  wide,
  brandHref,
  children,
}: {
  title: string;
  lede: string;
  wide?: boolean;
  /** Where the wordmark links. The console has no public home of its own. */
  brandHref?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const home = brandHref ?? '/';
  return (
    <div className={wide ? 'authwrap solo' : 'authwrap'}>
      <main className="authcard">
        <a className="brand" href={home}>
          <span className="wm">
            tru<span className="g">grade</span>
          </span>
        </a>
        <h1>{title}</h1>
        <p className="authlede">{lede}</p>
        {children}
      </main>
      {!wide && (
        <aside className="authside grid-bg">
          <h2>Every machine measured, not described.</h2>
          <p>
            Opened at the supplier&rsquo;s warehouse, graded on measurements, sealed until it
            reaches your dock. {BRAND.name} is the seller on the invoice, so one order is one
            counterparty however many warehouses it came from.
          </p>
        </aside>
      )}
    </div>
  );
}
