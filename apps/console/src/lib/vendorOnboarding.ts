import * as React from 'react';
import type { ResumableOnboarding } from '@trugrade/contracts';
import { apiFetch } from './auth';

/**
 * `GET /api/onboarding/steps`, read the way every vendor screen needs it.
 *
 * The route is `@RequireRoles` OWNER/ADMIN on purpose — finishing KYC is a legal
 * declaration, not an operational task — so a VENDOR_OPS, VENDOR_FINANCE or
 * VENDOR_VIEWER seat gets 403 every time. That refusal is an answer, not a
 * failure: onboarding is not this seat's business. Treating it as "still loading"
 * is how Home became a skeleton that never resolved for three of five roles.
 */
export type OnboardingState =
  | { kind: 'loading' }
  | { kind: 'ready'; data: ResumableOnboarding }
  | { kind: 'not-yours' }
  | { kind: 'error'; message: string };

export async function fetchOnboarding(): Promise<OnboardingState> {
  try {
    const res = await apiFetch('/api/onboarding/steps');
    if (res.status === 403) return { kind: 'not-yours' };
    if (!res.ok) return { kind: 'error', message: `Profile progress did not load (${res.status})` };
    return { kind: 'ready', data: (await res.json()) as ResumableOnboarding };
  } catch {
    return { kind: 'error', message: 'Profile progress did not load. Check your connection.' };
  }
}

/** `reloadToken`: bump it to fetch again, e.g. after a submit. */
export function useVendorOnboarding(reloadToken = 0): OnboardingState {
  const [state, setState] = React.useState<OnboardingState>({ kind: 'loading' });

  React.useEffect(() => {
    let cancelled = false;
    void fetchOnboarding().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  return state;
}

/**
 * Lets a page tell the shell that onboarding changed — a submit on Profile has to
 * update the banner in the chrome too. Defaults to a no-op so a screen rendered
 * outside `VendorShell` (a test harness) still works.
 */
export const OnboardingReloadContext = React.createContext<{
  token: number;
  reload: () => void;
}>({ token: 0, reload: () => undefined });

export const useOnboardingReload = (): { token: number; reload: () => void } =>
  React.useContext(OnboardingReloadContext);
