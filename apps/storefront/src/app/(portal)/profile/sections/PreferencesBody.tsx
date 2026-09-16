'use client';

import * as React from 'react';
import { Checkbox } from '@trugrade/ui';
import { completeStep, saveStep } from '../../../register/api';
import { DocumentChecklist } from '../../../register/DocumentChecklist';
import { BUYER_DOCUMENTS } from '../../../register/picklists';
import type { StepBodyProps } from './step-body';

/**
 * Preferences: documents, purchase orders, and how we reach you.
 *
 * **Weight 0. Nothing on this card blocks an order.** Every entry in
 * `BUYER_DOCUMENTS` is `required: false`, so the old Documents card was a fifth
 * of the completion score measuring one button press.
 *
 * The purchase-order answer is the reason this card is a real question now. It
 * used to be written as `poRequired: true` in a `DEFAULTS` block the buyer
 * never saw, and `CheckoutFlow` enforces it on every order: a buyer who pressed
 * Save on a card that asked them nothing had made a PO number mandatory for
 * their whole organisation, for ever. Most SMEs do not raise POs, so the
 * default is now false and the question is asked with its consequence beside
 * it.
 *
 * The notification channels stay defaulted-on and unasked: every channel
 * carries order news the buyer has already said they want by buying, and three
 * more controls in front of an optional upload is the clutter this card was
 * built to avoid.
 */

const DEFAULT_CHANNELS = ['EMAIL', 'WHATSAPP', 'SMS'] as const;
const DEFAULT_LANGUAGE = 'EN';

export interface PreferencesBodyProps extends StepBodyProps {
  initial: Record<string, unknown>;
  blockingReason?: string | null;
}

const noop = (): void => undefined;

export function PreferencesBody({
  initial,
  blockingReason,
  registerSubmit,
  onBusy,
  onFrame,
  onSaved,
}: PreferencesBodyProps): React.JSX.Element {
  const [poRequired, setPoRequired] = React.useState(() => initial.poRequired === true);
  const [error, setError] = React.useState<string | undefined>();

  React.useEffect(() => {
    onFrame({ index: 1, count: 1, primaryLabel: 'Save' });
  }, [onFrame]);

  const save = async (): Promise<void> => {
    setError(undefined);
    onBusy(true);
    const answers = {
      channels:
        Array.isArray(initial.channels) && initial.channels.length > 0
          ? initial.channels
          : [...DEFAULT_CHANNELS],
      language:
        typeof initial.language === 'string' && initial.language
          ? initial.language
          : DEFAULT_LANGUAGE,
      poRequired,
    };
    const saved = await saveStep('DOCUMENTS', answers, 100);
    if (!saved.ok) {
      onBusy(false);
      setError(saved.message);
      return;
    }
    const completed = await completeStep('DOCUMENTS');
    onBusy(false);
    if (!completed.ok) {
      setError(completed.message);
      return;
    }
    onSaved();
  };

  const saveRef = React.useRef(save);
  saveRef.current = save;
  React.useEffect(() => {
    registerSubmit(() => void saveRef.current());
  }, [registerSubmit]);

  return (
    <div className="flex flex-col gap-5">
      {blockingReason ? (
        <p
          role="alert"
          className="rounded border border-fail bg-sheet-2 p-4 text-body-sm text-fail"
        >
          {blockingReason}
        </p>
      ) : null}

      <DocumentChecklist
        wanted={BUYER_DOCUMENTS}
        title=""
        description="All optional — add what you have now."
        errors={{}}
        onClearError={noop}
        onDocsChange={noop}
        onFieldFocus={noop}
        whyTerm="Documents"
        noHints
      />

      <div className="border-t border-rule-2 pt-5">
        <Checkbox
          label="Our orders need a purchase order number"
          checked={poRequired}
          onChange={setPoRequired}
        />
        {/* The consequence in the same breath as the question. */}
        <p className="mt-2 text-body-sm text-ink-3">
          {poRequired
            ? 'Checkout will ask for a PO number on every order and refuse without one.'
            : 'Checkout will not ask for a PO number. You can still give one on any order.'}
        </p>
      </div>

      {error ? (
        <p role="alert" className="text-body-sm text-fail">
          {error}
        </p>
      ) : null}
    </div>
  );
}
