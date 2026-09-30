'use client';

import * as React from 'react';
import { checkoutDestination } from './checkout-entry';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

/**
 * The cart's way into checkout, with the server asked first.
 *
 * Checkout needs an organisation we can invoice and deliver to: a verified
 * GSTIN, a billing address, somewhere to send the machines. The honest moment
 * to say so is before the twenty-minute stock hold starts, not on the confirm
 * screen after it.
 *
 * **It asks the server rather than deciding for itself.** This used to add up
 * the profile cards' weights with `profileCompletionPct` and refuse anything
 * under 100 — a second copy of a server rule, written in a second language,
 * and answering a different question. Completeness is about the profile form;
 * readiness is about whether an invoice can be raised. A buyer could be told
 * "100% complete" here and refused by the API on the next screen, because the
 * API asked for `VERIFIED` and only a human could grant it.
 *
 * The rule itself lives in `checkoutDestination`, which the product page's
 * Buy now shares, so the two doors into checkout cannot disagree.
 */
export function CheckoutGate({
  cartId,
  navigate,
}: {
  cartId: string;
  /** Where the gate sends the browser. A test hands in a spy; jsdom cannot navigate. */
  navigate?: (url: string) => void;
}): React.JSX.Element {
  const router = useRouter();
  const [checking, setChecking] = React.useState(false);
  const href = `/checkout?cart=${cartId}`;
  const go = navigate ?? ((url: string): void => router.push(url as Route));

  const proceed = async (): Promise<void> => {
    setChecking(true);
    go(await checkoutDestination(cartId));
  };

  return (
    <Link
      className="pill acc cartgo"
      href={href as Route}
      aria-busy={checking || undefined}
      onClick={(event) => {
        event.preventDefault();
        if (checking) return;
        void proceed();
      }}
    >
      {checking ? 'Checking your account…' : 'Continue to checkout'}
    </Link>
  );
}
