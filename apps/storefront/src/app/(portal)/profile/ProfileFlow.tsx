'use client';

import * as React from 'react';
import { SectionDialog } from '@trugrade/ui';
import { accountHolderFromSession } from '../../register/api';
import { usePortal } from '../shell/PortalContext';
import { AccountBody } from './sections/AccountBody';
import { CompanyBody } from './sections/CompanyBody';
import { ContactsBody } from './sections/ContactsBody';
import { DocumentsBody } from './sections/DocumentsBody';
import { StatutoryBody } from './sections/StatutoryBody';
import type { StepFrame } from './sections/step-body';
import { PROFILE_SECTIONS, type ProfileSectionId } from './sections.config';

/**
 * The profile cards, each opening a stepped dialog — the supplier hub's shape.
 *
 * Each card has steps of its own: Account has two, Contacts and delivery
 * five, the others one. The dialog draws the card's step strip and its one
 * primary button; the card's body says which step it is on and what the
 * button should read. Every step writes as it goes, so a card left half way
 * reopens where it was. When a card's last step saves, the flow moves to the
 * next card; after the last card it closes.
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

/** The GSTINs the statutory step verified, for the billing step. */
function savedGstins(answers: Record<string, Record<string, unknown>>): string[] {
  const rows = answers.STATUTORY?.gstins;
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => (row as { gstin?: unknown }).gstin)
    .filter((g): g is string => typeof g === 'string' && g.length === 15);
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
  const step = (code: string) => onboarding.progress.steps.find((s) => s.stepCode === code);

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
  const body = ((): React.ReactNode => {
    switch (section.id) {
      case 'account':
        return <AccountBody {...shared} session={session} onSession={setSession} />;
      case 'statutory':
        return (
          <StatutoryBody
            {...shared}
            initial={answers.STATUTORY ?? {}}
            blockingReason={step('STATUTORY')?.blockingReason}
          />
        );
      case 'company':
        return (
          <CompanyBody
            {...shared}
            initial={answers.BUSINESS_PROFILE ?? {}}
            statutory={answers.STATUTORY}
            blockingReason={step('BUSINESS_PROFILE')?.blockingReason}
          />
        );
      case 'contacts':
        return (
          <ContactsBody
            {...shared}
            initial={answers.CONTACTS_ADDRESSES ?? {}}
            gstins={savedGstins(answers)}
            statutory={answers.STATUTORY}
            accountHolder={accountHolderFromSession(session)}
            blockingReason={step('CONTACTS_ADDRESSES')?.blockingReason}
          />
        );
      case 'documents':
        return (
          <DocumentsBody
            {...shared}
            initial={answers.DOCUMENTS ?? {}}
            blockingReason={step('DOCUMENTS')?.blockingReason}
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
