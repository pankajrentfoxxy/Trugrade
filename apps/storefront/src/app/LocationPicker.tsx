'use client';

import * as React from 'react';
import {
  LOCATION_CHANGED,
  clearLocation,
  normalisePincode,
  readLocation,
  reverseGeocode,
  writeLocation,
  type SavedLocation,
} from '../lib/location';

/**
 * The header's location control: "Deliver to <city> <pincode>", and the panel
 * behind it.
 *
 * WHAT IT DOES
 * ------------
 * One button after the brand. The browser's position, with the visitor's
 * permission, is reverse geocoded to a pincode and a city name; failing that,
 * a pincode can be typed. Either way the result goes to `localStorage`
 * (`lib/location.ts`), and the product page reads it from there to fill its
 * pincode box (`DefaultPincode.tsx`).
 *
 * WHEN IT ASKS
 * ------------
 *   - **On landing, with nothing saved**, it asks the browser straight away —
 *     no click needed — and saves what comes back. Once per tab session
 *     (`sessionStorage`), so a visitor who dismissed the prompt is not asked
 *     again on every page. A refusal here is silent: the pill just keeps
 *     saying "Select location".
 *   - **A click on the pill with nothing saved** fetches the location again
 *     rather than opening anything. Only if that fails — the browser has
 *     blocked it, there is no fix, or the map gave no pincode — does the
 *     panel open, to say why and to take a typed pincode instead. A button
 *     that failed silently would leave no way to set one.
 *   - **A click with something saved** opens the panel: the saved place,
 *     "Use my current location", a "Change" box and "Clear".
 *
 * EVERY STATE IS DRAWN
 * --------------------
 *   - **Locating**: the pill itself says "Finding your location…".
 *   - **Refused**: the panel says the browser blocked it and how to unblock,
 *     and points at the typed route. A refusal is not an error of ours.
 *   - **No fix / no pincode / service down**: each says what happened and
 *     that typing works. `PROVIDER_ERROR` is not `FAIL`.
 *
 * Outside click and Escape close the panel. The pill is `aria-expanded` and
 * the panel is a labelled dialog; the input is labelled and its message is
 * live.
 *
 * The saved value is read after mount, not during render: the server draws
 * "Select location" for everyone, and a read during render would make the
 * client's first paint disagree with it.
 */
type Phase = { kind: 'idle' } | { kind: 'locating' } | { kind: 'error'; message: string };

const DENIED =
  "Location access is blocked for this site. Allow it in your browser's site settings and try again, or type your pincode below.";
const NO_FIX = 'We could not get a fix on your position. Type your pincode below instead.';
const NO_PINCODE =
  'We found your position but not an Indian pincode for it. Type your pincode below.';
const SERVICE_DOWN =
  'The map service did not answer. That is on our side, not yours — try again in a moment, or type your pincode below.';
const UNSUPPORTED = 'This browser cannot share a location. Type your pincode below.';
const NOT_A_PINCODE =
  'That is not a pincode. Six digits, and the first one is never 0 — for example 110001.';

/** Set once the landing prompt has been made in this tab. */
const ASKED_KEY = 'tg-location-asked';

export function LocationPicker(): React.JSX.Element {
  const [saved, setSaved] = React.useState<SavedLocation | null>(null);
  const [open, setOpen] = React.useState(false);
  const [phase, setPhase] = React.useState<Phase>({ kind: 'idle' });
  const [typed, setTyped] = React.useState('');
  const [typedError, setTypedError] = React.useState<string | null>(null);
  const box = React.useRef<HTMLDivElement>(null);
  const input = React.useRef<HTMLInputElement>(null);
  const abort = React.useRef<AbortController | null>(null);

  /**
   * Fetch the location. `quiet` is the landing ask: a failure leaves the pill
   * as it was. Loud (a click) opens the panel with the reason on failure.
   */
  const locate = React.useCallback(({ quiet }: { quiet: boolean }): void => {
    const fail = (message: string): void => {
      if (quiet) {
        setPhase({ kind: 'idle' });
        return;
      }
      setPhase({ kind: 'error', message });
      setOpen(true);
    };
    if (!('geolocation' in navigator)) {
      fail(UNSUPPORTED);
      return;
    }
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setPhase({ kind: 'locating' });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        void (async () => {
          try {
            const place = await reverseGeocode(
              pos.coords.latitude,
              pos.coords.longitude,
              controller.signal,
            );
            if (controller.signal.aborted) return;
            if (!place) {
              fail(NO_PINCODE);
              return;
            }
            writeLocation({ pincode: place.pincode, city: place.city, source: 'geo' });
            setPhase({ kind: 'idle' });
            setOpen(false);
          } catch (err) {
            if (controller.signal.aborted) return;
            if (err instanceof DOMException && err.name === 'AbortError') return;
            fail(SERVICE_DOWN);
          }
        })();
      },
      (err) => {
        if (controller.signal.aborted) return;
        fail(err.code === err.PERMISSION_DENIED ? DENIED : NO_FIX);
      },
      { enableHighAccuracy: false, timeout: 12_000, maximumAge: 5 * 60_000 },
    );
  }, []);

  React.useEffect(() => {
    const sync = (): void => setSaved(readLocation());
    sync();
    window.addEventListener(LOCATION_CHANGED, sync);
    return () => window.removeEventListener(LOCATION_CHANGED, sync);
  }, []);

  // The landing prompt. `sessionStorage` can throw like `localStorage`; a
  // browser that will not remember the ask is simply asked once per page.
  React.useEffect(() => {
    if (readLocation()) return;
    try {
      if (window.sessionStorage.getItem(ASKED_KEY)) return;
      window.sessionStorage.setItem(ASKED_KEY, '1');
    } catch {
      // Fall through and ask.
    }
    locate({ quiet: true });
  }, [locate]);

  // A lookup still running when the control unmounts is abandoned.
  React.useEffect(() => () => abort.current?.abort(), []);

  React.useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e: MouseEvent): void => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Closing the panel clears what it was saying. The lookup itself is left
  // running: with nothing saved it runs with the panel shut by design.
  React.useEffect(() => {
    if (open) return;
    setTypedError(null);
    setPhase((p) => (p.kind === 'error' ? { kind: 'idle' } : p));
  }, [open]);

  const submitTyped = (e: React.FormEvent): void => {
    e.preventDefault();
    const pincode = normalisePincode(typed);
    if (!pincode) {
      setTypedError(NOT_A_PINCODE);
      input.current?.focus();
      return;
    }
    writeLocation({ pincode, city: null, source: 'manual' });
    setTyped('');
    setTypedError(null);
    setOpen(false);
  };

  const locating = phase.kind === 'locating';

  return (
    <div className={open ? 'hloc open' : 'hloc'} ref={box}>
      <button
        type="button"
        className="hloc-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="hloc-panel"
        aria-busy={locating}
        onClick={() => {
          if (saved) setOpen((o) => !o);
          else if (!locating) locate({ quiet: false });
        }}
      >
        <PinIcon />
        <span className="hloc-text">
          <small>{saved ? 'Deliver to' : 'Delivery'}</small>
          <strong>
            {locating && !saved ? (
              'Finding your location…'
            ) : saved ? (
              <>
                {saved.city ? `${saved.city} ` : ''}
                <span className="mono">{saved.pincode}</span>
              </>
            ) : (
              'Select location'
            )}
          </strong>
        </span>
      </button>

      <div
        id="hloc-panel"
        className="hloc-pop"
        role="dialog"
        aria-label="Delivery location"
        hidden={!open}
      >
        <div className="hloc-panel">
          {saved ? (
            <p className="hloc-now">
              Delivering to{' '}
              <b>
                {saved.city ? `${saved.city} ` : ''}
                <span className="mono">{saved.pincode}</span>
              </b>
              . Prices on every product page are landed here.
            </p>
          ) : (
            <p className="hloc-now">
              Tell us where to deliver and every product page opens with its price landed to
              your pincode.
            </p>
          )}

          <button
            type="button"
            className="hloc-geo"
            onClick={() => locate({ quiet: false })}
            disabled={locating}
            aria-busy={locating}
          >
            <PinIcon />
            {locating ? 'Finding your location…' : saved ? 'Use my current location' : 'Use my location'}
          </button>

          {phase.kind === 'error' && (
            <p className="hloc-msg" role="alert">
              {phase.message}
            </p>
          )}

          <form className="hloc-form" onSubmit={submitTyped} noValidate>
            <label htmlFor="hloc-pin">Or type a pincode</label>
            <div className="hloc-row">
              <input
                id="hloc-pin"
                ref={input}
                className="mono"
                inputMode="numeric"
                autoComplete="postal-code"
                maxLength={7}
                placeholder="110001"
                value={typed}
                onChange={(e) => {
                  setTyped(e.target.value);
                  if (typedError) setTypedError(null);
                }}
                aria-invalid={typedError !== null}
                aria-describedby={typedError ? 'hloc-pin-err' : undefined}
              />
              <button type="submit">{saved ? 'Change' : 'Save'}</button>
            </div>
            {typedError && (
              <p className="hloc-msg" id="hloc-pin-err" role="alert">
                {typedError}
              </p>
            )}
          </form>

          {saved && (
            <button type="button" className="hloc-clear" onClick={() => clearLocation()}>
              Clear location
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function PinIcon(): React.JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
      <circle cx="12" cy="10" r="2.4" />
    </svg>
  );
}
