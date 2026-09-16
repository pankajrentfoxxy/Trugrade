'use client';

import * as React from 'react';
import { SectionDialog } from '@trugrade/ui';
import { accountHolderFromSession } from '../../register/api';
import { usePortal } from '../shell/PortalContext';
import { AccountBody } from './sections/AccountBody';
import { DeliveryBody } from './sections/DeliveryBody';
import { PreferencesBody } from './sections/PreferencesBody';
import { TaxBody } from './sections/TaxBody';
import type { StepFrame } from './sections/step-body';
import { PROFILE_SECTIONS, sectionBlockingReason, type ProfileSectionId } from './sections.config';

/**
 * The profile cards, each opening a stepped dialog — the supplier hub's shape.
 *
 * Account has two steps, Tax and billing two, the rest one. The dialog draws
 * the card's step strip and its one primary button; the card's body says which
 * step it is on and what the button should read. Every step writes as it goes,
 * so a card left half way reopens where it was. When a card's last step saves,
 * the flow moves to the next card; after the last card it closes.
 *
 * **No card depends on another being opened first.** The Company card used to
 * refuse to save until the GSTIN was verified elsewhere, while the hub rendered
 * the cards as an unordered grid — a reachable dead end with a message in it.
 * The company details now arrive with the GSTIN on the Tax card, so the
 * dependency is gone rather than disabled.
 */

export interface ProfileFlowProps {
  /** The card to open, or null for closed. */
  start: ProfileSectionId | null;
  onClose: () => void;
  /** A card was saved and completed; the caller re-reads progress. */
  onStepSaved: (id: ProfileSectionId) => void;
  /** The last card was saved. */
  onFinished: () => void;
}

export function ProfileFlow({
  start,
  onClose,
  onStepSaved,
  onFinished,
}: ProfileFlowProps): React.JSX.Element | null {
  const { session, onboarding, setSession } = usePortal();
  const [current, setCurrent] = React.useState<ProfileSectionId | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [frame, setFrame] = React.useState<StepFrame>({ index: 1, count: 1, primaryLabel: 'Save' });
  const submitRef = React.useRef<() => void>(() => undefined);

  React.useEffect(() => {
    setCurrent(start);
    setBusy(false);
  }, [start]);

  const registerSubmit = React.useCallback((submit: () => void): void => {
    submitRef.current = submit;
  }, []);
  const onFrame = React.useCallback((next: StepFrame): void => setFrame(next), []);

  const index = PROFILE_SECTIONS.findIndex((s) => s.id === current);
  if (!current || index < 0 || !onboarding) return null;

  const section = PROFILE_SECTIONS[index]!;
  const lastCard = index === PROFILE_SECTIONS.length - 1;
  const answers = onboarding.answers;

  const saved = (): void => {
    onStepSaved(section.id);
    setBusy(false);
    if (lastCard) {
      onFinished();
      return;
    }
    setCurrent(PROFILE_SECTIONS[index + 1]!.id);
  };

  const shared = { registerSubmit, onBusy: setBusy, onFrame, onSaved: saved };
  const sentBack = sectionBlockingReason(section, onboarding);
  const body = ((): React.ReactNode => {
    switch (section.id) {
      case 'account':
        return <AccountBody {...shared} session={session} onSession={setSession} />;
      case 'tax':
        return (
          <TaxBody
            {...shared}
            initial={answers.STATUTORY ?? {}}
            contacts={answers.CONTACTS_ADDRESSES ?? {}}
            accountHolder={accountHolderFromSession(session)}
            blockingReason={sentBack}
          />
        );
      case 'delivery':
        return (
          <DeliveryBody
            {...shared}
            initial={answers.CONTACTS_ADDRESSES ?? {}}
            accountHolder={accountHolderFromSession(session)}
            blockingReason={sentBack}
          />
        );
      case 'preferences':
        return (
          <PreferencesBody
            {...shared}
            initial={answers.DOCUMENTS ?? {}}
            blockingReason={sentBack}
          />
        );
      default:
        return null;
    }
  })();

  return (
    <SectionDialog
      open
      onClose={onClose}
      title={section.title}
      stepIndex={frame.index}
      stepCount={frame.count}
      primaryLabel={frame.primaryLabel}
      primaryLoading={busy}
      onPrimary={() => submitRef.current()}
      onBack={frame.back}
      backDisabled={busy}
      className="profile-flow"
    >
      {/* Keyed by card so each body mounts fresh with that card's saved answers. */}
      <div key={section.id}>{body}</div>
    </SectionDialog>
  );
}
