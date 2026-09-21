import { AuthBrandPanel } from './auth/AuthBrandPanel';

/**
 * **ARCHETYPE F — Focus.** The frame every credential screen sits in.
 *
 * One task, centred, and no navigation: there is no header, no search and no
 * category strip, because every one of them is an invitation to leave a screen
 * somebody arrived at deliberately. What there is instead is one card on the
 * ground — the brand panel on the left, the form on the right — so the page
 * reads as Trugrade before a single word of the form is read, and a way back to
 * the shop that is a link, not a nav.
 *
 * Sign-in omits the site footer so the card fills the viewport; other auth
 * routes still carry the Rule 4(2) disclosure from the root layout.
 *
 * Under 760px the two columns stack, with the panel shortened to its heading:
 * on a phone the bullets and the render would push the actual task below the
 * fold, and the heading alone still says whose form this is.
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
   * One wider column and no brand panel, for the screens that report a state
   * rather than ask for a credential. An application status squeezed into a
   * form column wraps its step rows and prints a date one word per line; the
   * claim beside it is also the least useful thing on the page to somebody
   * who has just been told their account was refused.
   */
  wide?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className={wide ? 'authwrap solo' : 'authwrap'}>
      <div className="authcard auth-ui">
        {!wide && <AuthBrandPanel />}
        {/* A <main>, not a <div> — these routes have no other main landmark. */}
        <main className="authmain">
          <div className="authtop">
            <a className="brand" href="/">
              <span className="wm">
                tru<span className="g">grade</span>
              </span>
            </a>
            <a className="authback" href="/">
              &larr; Back to the shop
            </a>
          </div>
          <h1>{title}</h1>
          <p className="authlede">{lede}</p>
          {children}
        </main>
      </div>
    </div>
  );
}
