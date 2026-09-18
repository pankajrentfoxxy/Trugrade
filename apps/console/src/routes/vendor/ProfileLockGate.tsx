import * as React from 'react';
import { useNavigate } from 'react-router';
import { Button, HubPageHeader, Skeleton } from '@trugrade/ui';
import type { ResumableOnboarding } from '@trugrade/contracts';
import { fetchOnboarding } from '../../lib/vendorOnboarding';
import type { OrgProfile } from './profile-api';
import { nextIncompleteSection, PROFILE_SECTIONS, sectionIsDone } from './profile/sections.config';
import { apiFetch } from '../../lib/auth';

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
  /** `undefined` while in flight, and for a seat that may not read onboarding. */
  onboarding: ResumableOnboarding | undefined;
  loadError: string | null;
  verified: boolean | undefined;
} {
  const [onboarding, setOnboarding] = React.useState<ResumableOnboarding | undefined>(undefined);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [verified, setVerified] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const state = await fetchOnboarding();
      if (cancelled) return;
      if (state.kind === 'ready') {
        setOnboarding(state.data);
        setVerified(state.data.status === 'VERIFIED');
        return;
      }
      if (state.kind === 'error') {
        setLoadError(state.message);
        return;
      }
      // 403: this seat cannot read onboarding (Ops, Finance, Viewer), but every
      // member can read the org's own status, and that is all the gate needs.
      try {
        const res = await apiFetch('/api/account/profile', { credentials: 'include' });
        if (!res.ok) throw new Error(`Profile unavailable (${res.status})`);
        const profile = (await res.json()) as OrgProfile;
        if (!cancelled) setVerified(profile.status === 'VERIFIED');
      } catch (e) {
        if (!cancelled) setLoadError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { onboarding, loadError, verified };
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
 * The same lock, for a seat that cannot complete the profile. Finishing KYC is
 * the owner's or an admin's to do, so this names who can unlock it rather than
 * offering a checklist this person cannot act on.
 */
export function AskOwnerGate({ section }: { section: string }): React.JSX.Element {
  return (
    <div className="mx-auto mt-8 flex max-w-[620px] flex-col items-center gap-4 rounded-lg border border-rule bg-sheet p-10 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-fail-wash">
        <LockGlyph />
      </span>
      <h2 className="text-h2 text-ink">{`${section.charAt(0).toUpperCase()}${section.slice(1)} open once your business is verified`}</h2>
      <p className="text-body-sm text-ink-3">
        Ask your account owner to finish the supplier profile and submit it for review.
      </p>
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
  if (!verified) {
    return {
      locked: (
        <div className="hub-page">
          <HubPageHeader title={title} />
          {onboarding ? (
            <ProfileLockGate onboarding={onboarding} section={section} />
          ) : (
            <AskOwnerGate section={section} />
          )}
        </div>
      ),
    };
  }
  return { locked: null };
}
