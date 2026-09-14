import * as React from 'react';
import { useNavigate } from 'react-router';
import { Button, HubPageHeader, Skeleton } from '@trugrade/ui';
import type { ResumableOnboarding } from '../../../../storefront/src/app/register/api';
import { nextIncompleteSection, PROFILE_SECTIONS, sectionIsDone } from './profile/sections.config';

/**
 * The card a locked section shows instead of its board.
 *
 * Every screen behind this checks the same thing Home does —
 * `onboarding.status === 'VERIFIED'` — because listing, and everything
 * downstream of a listing (inspection, a grade, a purchase order, a payable),
 * genuinely cannot exist before that. This is not a second opinion about
 * whether the section is ready; it is the one true statement of it, so a
 * fresh account cannot see five different "you're not ready yet" screens that
 * quietly disagree with each other.
 */

/** Where each gated route sends a vendor to keep working. */
export function useProfileGate(): {
  /** `undefined` while in flight — never render the gate on a guess. */
  onboarding: ResumableOnboarding | undefined;
  loadError: string | null;
  verified: boolean | undefined;
} {
  const [onboarding, setOnboarding] = React.useState<ResumableOnboarding | undefined>(undefined);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/onboarding/steps', { credentials: 'include' });
        if (!res.ok) throw new Error(`Profile unavailable (${res.status})`);
        const data = (await res.json()) as ResumableOnboarding;
        if (!cancelled) setOnboarding(data);
      } catch (e) {
        if (!cancelled) setLoadError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    onboarding,
    loadError,
    verified: onboarding ? onboarding.status === 'VERIFIED' : undefined,
  };
}

function LockGlyph(): React.JSX.Element {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" stroke="#be3423" strokeWidth="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="#be3423" strokeWidth="2" />
    </svg>
  );
}

export function ProfileLockGate({
  onboarding,
  /** Lower-case, matching the label a vendor already reads on the rail. */
  section,
}: {
  onboarding: ResumableOnboarding;
  section: string;
}): React.JSX.Element {
  const navigate = useNavigate();
  const required = PROFILE_SECTIONS.filter((s) => s.required);
  const next = nextIncompleteSection(null, onboarding);

  function openProfile(): void {
    void navigate('/vendor/profile', next ? { state: { openSection: next.id } } : undefined);
  }

  return (
    <div className="mx-auto mt-8 flex max-w-[620px] flex-col items-center gap-4 rounded-lg border border-rule bg-sheet p-10 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-fail-wash">
        <LockGlyph />
      </span>
      <h2 className="text-h2 text-ink">Finish your profile to unlock {section}</h2>
      <p className="text-body-sm text-ink-3">
        We verify every supplier before machines go on sale.
      </p>
      <ul className="flex list-none flex-col gap-3 p-0 text-left">
        {required.map((s) => {
          const done = sectionIsDone(s, onboarding);
          return (
            <li key={s.id} className="flex items-center gap-3 text-body text-ink-2">
              <span
                className={
                  done
                    ? 'flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-pass-wash text-pass'
                    : 'flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-fail-wash text-fail'
                }
                aria-hidden="true"
              >
                <span className="text-label font-bold">{done ? '✓' : '!'}</span>
              </span>
              {s.title}
            </li>
          );
        })}
      </ul>
      <Button variant="primary" onClick={openProfile}>
        {next ? `Continue — ${next.title}` : 'Open profile'}
      </Button>
    </div>
  );
}

/**
 * The two branches every gated route needs before its own loading/error
 * checks: unknown yet (skeleton) and known-and-locked (the gate card). A
 * profile that failed to load is not evidence of an unverified one — that
 * case falls through to the caller's own fetch and its own error state,
 * rather than adding a second failure a vendor cannot act on.
 *
 *   const gate = useProfileGate();
 *   if (gate.locked) return gate.locked;
 *   // ...the route's own data fetch, loading and error branches, unchanged.
 */
export function useProfileGateOrRender(
  /** Lower-case noun for the gate's heading — "listings", "inspections". */
  section: string,
  /** Shown above the skeleton and the gate, matching the route's own title. */
  title: string,
): { locked: React.JSX.Element | null } {
  const { onboarding, loadError, verified } = useProfileGate();

  if (loadError) return { locked: null };
  if (verified === undefined) {
    return {
      locked: (
        <div className="hub-page">
          <HubPageHeader title={title} />
          <Skeleton lines={8} />
        </div>
      ),
    };
  }
  if (!verified && onboarding) {
    return {
      locked: (
        <div className="hub-page">
          <HubPageHeader title={title} />
          <ProfileLockGate onboarding={onboarding} section={section} />
        </div>
      ),
    };
  }
  return { locked: null };
}
