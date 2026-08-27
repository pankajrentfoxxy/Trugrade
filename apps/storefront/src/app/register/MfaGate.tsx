'use client';

import * as React from 'react';
import { MfaChallenge } from '@trugrade/ui';
import { requestMfaCode, verifyMfa } from './api';

/**
 * The second factor, in the middle of registration.
 *
 * **A supplier account cannot do anything without this.** `MFA_REQUIRED_ROLES`
 * covers VENDOR_OWNER — the roles that can move money or change where it goes —
 * and `AuthGuard` refuses every non-public route on a session that has not
 * satisfied it. So the moment `POST /auth/register` creates a vendor, the very
 * next call (`POST /onboarding/start`) is a 403 until a code lands. Without this
 * panel a vendor registers successfully and then cannot save one field, which is
 * exactly the state the flow was in before this existed.
 *
 * It is driven by the server's own `mfaRequired`, not by `orgType`: a buyer
 * account whose owner is later given a money-moving role meets the same guard,
 * and a flag the server sets is the honest condition to branch on.
 *
 * The exchange itself — the six boxes, the cooldown, the resend — is
 * `MfaChallenge` in `packages/ui`, because the console meets the same challenge
 * on every supplier-owner sign-in and two copies of a cooldown is one copy too
 * many. This file is the half that is registration-specific: the two API calls
 * and the promise that the step's answers survive.
 */

export interface MfaGateProps {
  /** Masked by the server. Never re-derived. See `MfaChallenge`. */
  sentTo: string;
  /** Called with a rotated, MFA-satisfied session in place. */
  onVerified: () => Promise<void>;
}

export function MfaGate({ sentTo, onVerified }: MfaGateProps): React.JSX.Element {
  return (
    <MfaChallenge
      sentTo={sentTo}
      onVerify={async (code) => {
        const result = await verifyMfa(code);
        if (!result.ok) return result.message || result.fields.code;
        await onVerified();
        return undefined;
      }}
      onResend={async () => {
        const sent = await requestMfaCode();
        return sent.ok ? { sentTo: sent.data.sentTo } : { error: sent.message };
      }}
      footNote="Nothing you typed on this step has been lost — it is saved the moment this code is accepted."
    />
  );
}
