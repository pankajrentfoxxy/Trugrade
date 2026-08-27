import { ThemeToggle } from '@trugrade/ui';
import { BRAND } from '@trugrade/config/brand';

import { SearchBar } from './SearchBar';

/**
 * Blocks 1 and 2 of `09_FRONTEND_LOCKED.md` §7 — the utility bar and the
 * header — lifted out of the homepage so every other page carries the same
 * chrome rather than a near-copy of it.
 *
 * Both are `--chrome` in both themes. That is the brand: only the working
 * surfaces below flip.
 */
export function SiteHeader({
  inspected,
}: {
  /** The live tested count. `null` when the API did not answer — see below. */
  inspected: number | null;
}): React.JSX.Element {
  return (
    <>
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
            <a href="/delivery" className="hide-sm">
              Pan-India delivery
            </a>
            <a href="/gst" className="hide-sm">
              GST invoice on every order
            </a>
          </div>
          <div className="r">
            <a href="/verify">Verify a certificate</a>
            <a href="/track">Track order</a>
            <a href="/help">Help</a>
            <a href="/sell/register" style={{ color: 'var(--acc)', fontWeight: 600 }}>
              Sell on {BRAND.name} &rarr;
            </a>
          </div>
        </div>
      </div>

      <div className="head">
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
            <ThemeToggle className="h-9 w-9 border-chrome-line-2" />
            <a className="hbtn hide-sm" href="/bulk">
              <span>
                <small>Bulk order</small>
                <strong>Requirement</strong>
              </span>
            </a>
            <a className="hbtn" href="/sign-in">
              <span>
                <small>Returning?</small>
                <strong>Sign in</strong>
              </span>
            </a>
            <a className="hbtn solid" href="/register">
              Create account
            </a>
          </div>
        </div>
      </div>
    </>
  );
}
