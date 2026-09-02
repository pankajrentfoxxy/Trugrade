import { cookies } from 'next/headers';
import Link from 'next/link';
import { ThemeToggle } from '@trugrade/ui';
import { BRAND } from '@trugrade/config/brand';

/**
 * Who, if anyone, is signed in — read on the server from the request's own
 * cookie.
 *
 * The header used to render "Sign in / Create account" unconditionally, and
 * that is worse than cosmetic. A buyer who HAS signed in is invited to sign in
 * again on every page, with no way to reach their account and nothing to show
 * they are recognised — and reviewing a screenshot of the cart or checkout, the
 * only reasonable conclusion is that the flow ran unauthenticated. It does not:
 * every /api/buyer route answers 401 without a session. The header was simply
 * never told.
 *
 * Server-side rather than a client fetch, because a header that renders
 * signed-out and then corrects itself is a flash of the wrong answer on every
 * navigation — and this is the one component on the page whose job is to say
 * who you are.
 *
 * A failure returns null and the signed-out chrome. We cannot prove a session,
 * so we do not claim one.
 */
async function currentUser(): Promise<{ orgType: string; fullName?: string } | null> {
  const jar = await cookies();
  const header = jar
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  if (!header) return null;

  try {
    const res = await fetch(`${process.env.API_URL ?? 'http://localhost:4000/api'}/auth/session`, {
      headers: { cookie: header },
      cache: 'no-store',
    });
    return res.ok
      ? ((await res.json()) as { orgType: string; fullName?: string })
      : null;
  } catch {
    return null;
  }
}

import { SearchBar } from './SearchBar';
import { AccountMenu } from './AccountMenu';
import { CartNavLink } from './CartNavLink';

/**
 * Blocks 1 and 2 of `09_FRONTEND_LOCKED.md` §7 — the utility bar and the
 * header — lifted out of the homepage so every other page carries the same
 * chrome rather than a near-copy of it.
 *
 * Both are `--chrome` in both themes. That is the brand: only the working
 * surfaces below flip.
 *
 * T45 — WHY THESE ARE ELEMENTS AND NOT DIVS
 * -----------------------------------------
 * The reference implementation draws both bars as `<div>`s, and while that
 * settles every question of chrome, spacing, type and colour, it leaves a
 * screen reader with no landmarks at all: axe reported twenty-one nodes of
 * content outside any landmark on the homepage, and the same on thirty-eight
 * other routes, because the container they sit in has no role. `<header>` and
 * `<nav>` change not one pixel — every rule in `storefront.css` selects on
 * `.util` and `.head` — and they give a keyboard user the one thing the mock
 * could not: a way to jump past this chrome, which is thirty tab stops deep
 * before the first product on `/search`.
 *
 * The skip link is the other half of that. It is the first tab stop on every
 * page, invisible until focused, and it targets `#content` — which every route
 * that renders a `<main>` provides. Bypass blocks (WCAG 2.4.1) is not optional
 * on a page whose header alone holds ten links.
 */
export async function SiteHeader({
  inspected,
}: {
  /** The live tested count. `null` when the API did not answer — see below. */
  inspected: number | null;
}): Promise<React.JSX.Element> {
  const user = await currentUser();
  return (
    <header>
      <a className="skiplink" href="#content">
        Skip to the main content
      </a>
      <div className="util">
        <div className="wrap">
          <div className="l">
            {/*
              A missing counter is not a zero. When the API did not answer, the
              claim is dropped rather than rendered as "0 laptops opened &
              tested", which would be a fabricated number and a worse one.
            */}
            {inspected === null ? (
              <span style={{ color: 'var(--on-chrome-3)' }}>Inspection count unavailable</span>
            ) : (
              <span>
                <i className="blip" />
                <b className="mono">{inspected.toLocaleString('en-IN')}</b> laptops opened &amp;
                tested
              </span>
            )}
            {/*
              T43: these five addresses were `/delivery`, `/gst`, `/verify`,
              `/track` and `/help`, and every one of them was a 404 — on every
              page of the storefront, which is where the utility bar renders.
              Each now points at the document or board that actually answers the
              claim beside it, rather than at a route nobody built.
            */}
            <a href="/legal/shipping" className="hide-sm">
              Pan-India delivery
            </a>
            <a href="/legal/pricing-and-taxes" className="hide-sm">
              GST invoice on every order
            </a>
          </div>
          <div className="r">
            <a href="/qc/verify">Verify a certificate</a>
            <a href="/account/orders">Track order</a>
            <a href="/legal/grievance">Help</a>
            <a href="/sell/register" className="util-promo">
              Sell on {BRAND.name} &rarr;
            </a>
          </div>
        </div>
      </div>

      <nav className="head" aria-label="Trugrade">
        <div className="wrap">
          <a className="brand" href="/">
            <svg className="mk" width="28" height="28" viewBox="0 0 46 46" aria-label={BRAND.name}>
              <line className="b" x1="6" y1="23" x2="40" y2="23" />
              <line className="b" x1="6" y1="15" x2="6" y2="31" />
              <line className="b" x1="40" y1="15" x2="40" y2="31" />
              <line className="d" x1="18" y1="17" x2="18" y2="29" />
              <circle className="f" cx="30" cy="23" r="5.5" />
            </svg>
            <span className="wm">
              tru<span className="g">grade</span>
            </span>
          </a>

          <a className="catbtn" href="/search">
            <i aria-hidden="true">
              <b />
              <b />
              <b />
            </i>{' '}
            Browse laptops
          </a>

          <SearchBar />

          <div className="hact">
            <ThemeToggle suppressed className="h-9 min-w-9 border-chrome-line-2" />
            {/* `Link`, not `a`: this is an internal route, and a plain anchor
                makes every visit a full document load — which also means
                `/bulk`'s own loading state can never render. */}
            <Link className="hbtn hide-sm" href="/bulk">
              <span>
                <small>Bulk order</small>
                <strong>Requirement</strong>
              </span>
            </Link>
            {user ? (
              <>
                <CartNavLink />
                <AccountMenu fullName={user.fullName} />
              </>
            ) : (
              <>
                <a className="hbtn" href="/sign-in">
                  <span>
                    <small>Returning?</small>
                    <strong>Sign in</strong>
                  </span>
                </a>
                <a className="hbtn solid" href="/register">
                  Create account
                </a>
              </>
            )}
          </div>
        </div>
      </nav>
    </header>
  );
}
