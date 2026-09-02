import { BRAND } from '@trugrade/config/brand';

/**
 * **ARCHETYPE F — Focus.** The frame every credential screen sits in.
 *
 * One task, centred, and no navigation: there is no header, no search and no
 * category strip, because every one of them is an invitation to leave a screen
 * somebody arrived at deliberately. The Rule 4(2) legal footer is still there —
 * it is on every page by law, and it comes from the root layout rather than
 * from here.
 *
 * The right-hand panel is `--chrome` in both themes, the same dark brand ground
 * as the header and footer, so the page reads as Trugrade before a single word
 * is read. Under 900px it is dropped rather than stacked: on a phone it would
 * push the actual task below the fold.
 */
export function AuthShell({
  title,
  lede,
  wide,
  children,
}: {
  title: string;
  lede: string;
  /**
   * One wider column and no side panel, for the screens that report a state
   * rather than ask for a credential. An application status squeezed into a
   * 460px form column wraps its step rows and prints a date one word per line;
   * the claim beside it is also the least useful thing on the page to somebody
   * who has just been told their account was refused.
   */
  wide?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className={wide ? 'authwrap solo' : 'authwrap'}>
      {/* T45: a <main>, not a <div> — these three routes had no main landmark. */}
      <main className="authcard">
        <a className="brand" href="/">
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
