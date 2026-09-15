'use client';

import * as React from 'react';
import { getOnboarding, getSession } from '../register/api';
import { profileCompletionPct } from '../(portal)/profile/sections.config';

/**
 * The cart's way into checkout, with the profile checked first.
 *
 * Checkout needs an organisation we can invoice: a GSTIN, a legal name, a
 * delivery site, the documents. A buyer who signed up with a mobile number
 * alone has none of those yet, and the honest moment to say so is before the
 * twenty-minute stock hold starts, not on the confirm screen after it. So the
 * button reads the profile's completion and sends an unfinished one to
 * `/profile`, where every missing card is a "Fill now".
 *
 * Only a completeness check. Whether the organisation is *verified* is the
 * server's decision at checkout, and a seat that may not read onboarding at
 * all (a buyer or approver on a finished account) is let through to it.
 */
export function CheckoutGate({
  cartId,
  navigate = (url) => window.location.assign(url),
}: {
  cartId: string;
  /** Where the gate sends the browser. A test hands in a spy; jsdom cannot navigate. */
  navigate?: (url: string) => void;
}): React.JSX.Element {
  const [checking, setChecking] = React.useState(false);
  const href = `/checkout?cart=${cartId}`;

  const proceed = async (): Promise<void> => {
    setChecking(true);
    const session = await getSession();
    // No session: checkout's own door handles that, as it always has.
    if (!session.ok) {
      navigate(href);
      return;
    }
    const onboarding = await getOnboarding();
    // A seat refused the read cannot be judged here; the server judges it.
    if (!onboarding.ok) {
      navigate(href);
      return;
    }
    if (profileCompletionPct(onboarding.data, session.data) < 100) {
      navigate('/profile?reason=checkout');
      return;
    }
    navigate(href);
  };

  return (
    <a
      className="pill acc cartgo"
      href={href}
      aria-busy={checking || undefined}
      onClick={(event) => {
        event.preventDefault();
        if (checking) return;
        void proceed();
      }}
    >
      {checking ? 'Checking your profile…' : 'Continue to checkout'}
    </a>
  );
}
