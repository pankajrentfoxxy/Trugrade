'use client';

import * as React from 'react';
import { normalisePincode } from '@trugrade/contracts';
import { PINCODE_DEMAND_EVENT, PINCODE_DEMAND_MESSAGE, scrollToPincode } from './pincode-demand';

/**
 * The delivery pincode, checked before it leaves the page.
 *
 * The form is still a plain GET to the same route — the pincode lands in the
 * URL, so a buyer can send a colleague the link and the colleague sees the
 * same landed prices. What this adds is the refusal in place: a malformed
 * pincode used to round-trip to the server, be dropped, and come back as a
 * line of helper text. Now it is stopped here, said under the box in the
 * error ink, and the box is marked invalid for a screen reader.
 *
 * The one rule is `normalisePincode`, the same one the server applies, so the
 * two cannot disagree about what a pincode is.
 */
export function PincodeForm({
  action,
  hidden,
  initialPincode,
  initialError,
  buttonLabel,
  children,
}: {
  action: string;
  /** Grade and the selected supply point, carried through unchanged. */
  hidden: ReadonlyArray<{ name: string; value: string }>;
  initialPincode: string;
  /** The server's verdict on a pincode that arrived by URL, when it refused one. */
  initialError: string | null;
  buttonLabel: string;
  /** The helper line under the box when there is nothing wrong. */
  children: React.ReactNode;
}): React.JSX.Element {
  const [value, setValue] = React.useState(initialPincode);
  const [error, setError] = React.useState<string | null>(initialError);

  // The pincode can change under the form without a reload: a signed-in
  // buyer's default site is put in the URL after first paint, and the page
  // re-renders in place. The box must show what the board is now priced to.
  React.useEffect(() => {
    setValue(initialPincode);
  }, [initialPincode]);
  // True for the length of one shake. Re-armed on every demand, so a second
  // click on Buy now shakes again rather than being ignored.
  const [shaking, setShaking] = React.useState(false);

  React.useEffect(() => {
    const onDemand = (): void => {
      setError(PINCODE_DEMAND_MESSAGE);
      setShaking(false);
      // Next frame, so a shake already running restarts instead of continuing.
      requestAnimationFrame(() => setShaking(true));
      scrollToPincode();
    };
    window.addEventListener(PINCODE_DEMAND_EVENT, onDemand);
    return () => window.removeEventListener(PINCODE_DEMAND_EVENT, onDemand);
  }, []);

  const problem = (raw: string): string | null => {
    const trimmed = raw.trim();
    if (trimmed === '') return 'Enter a delivery pincode to see landed prices and add to cart.';
    if (normalisePincode(trimmed) === null) {
      return 'That is not a pincode. Six digits, and the first one is never 0 — for example 110001.';
    }
    return null;
  };

  return (
    <>
      <form
        className="pin-line"
        action={action}
        method="get"
        noValidate
        onSubmit={(event) => {
          const found = problem(value);
          if (found) {
            event.preventDefault();
            setError(found);
            (event.currentTarget.elements.namedItem('pin') as HTMLInputElement | null)?.focus();
          }
        }}
      >
        {hidden.map((h) => (
          <input key={h.name} type="hidden" name={h.name} value={h.value} />
        ))}
        <label className="sr-only" htmlFor="pin">
          Delivery pincode
        </label>
        <input
          id="pin"
          name="pin"
          className={shaking ? 'field mono shake' : 'field mono'}
          onAnimationEnd={() => setShaking(false)}
          inputMode="numeric"
          maxLength={7}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            // The message named what was in the box. Once the box changes it
            // is about text that is no longer there.
            if (error) setError(null);
          }}
          placeholder="Delivery pincode"
          aria-describedby="pinhelp"
          aria-invalid={error ? true : undefined}
        />
        <button type="submit" className="mini">
          {buttonLabel}
        </button>
      </form>

      {error ? (
        <p id="pinhelp" className="deliver err" role="alert">
          {error}
        </p>
      ) : (
        <p id="pinhelp" className="deliver">
          {children}
        </p>
      )}
    </>
  );
}
