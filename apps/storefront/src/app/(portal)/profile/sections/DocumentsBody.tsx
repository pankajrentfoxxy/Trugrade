'use client';

import * as React from 'react';
import { completeStep, saveStep } from '../../../register/api';
import { DocumentChecklist } from '../../../register/DocumentChecklist';
import { BUYER_DOCUMENTS } from '../../../register/picklists';
import type { StepBodyProps } from './step-body';

/**
 * The Documents card: the uploads, every one of them optional.
 *
 * The notification channels, the language and the "purchase order number on
 * every invoice" answer are not asked for here. They are written with the
 * step as their defaults — every channel on, English, and a PO number
 * required — so the account behaves the way nearly every buyer wants without
 * three controls in the way of the upload.
 */

const DEFAULTS = {
  channels: ['EMAIL', 'WHATSAPP', 'SMS'],
  language: 'EN',
  poRequired: true,
} as const;

export interface DocumentsBodyProps extends StepBodyProps {
  initial: Record<string, unknown>;
  blockingReason?: string | null;
}

const noop = (): void => undefined;

export function DocumentsBody({
  initial,
  blockingReason,
  registerSubmit,
  onBusy,
  onFrame,
  onSaved,
}: DocumentsBodyProps): React.JSX.Element {
  const [error, setError] = React.useState<string | undefined>();

  React.useEffect(() => {
    onFrame({ index: 1, count: 1, primaryLabel: 'Save' });
  }, [onFrame]);

  const save = async (): Promise<void> => {
    setError(undefined);
    onBusy(true);
    const answers = {
      channels: Array.isArray(initial.channels) && initial.channels.length > 0
        ? initial.channels
        : [...DEFAULTS.channels],
      language: typeof initial.language === 'string' && initial.language ? initial.language : DEFAULTS.language,
      poRequired: typeof initial.poRequired === 'boolean' ? initial.poRequired : DEFAULTS.poRequired,
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
        <p role="alert" className="rounded border border-fail bg-sheet-2 p-4 text-body-sm text-fail">
          {blockingReason}
        </p>
      ) : null}
      <DocumentChecklist
        wanted={BUYER_DOCUMENTS}
        title=""
        description=""
        errors={{}}
        onClearError={noop}
        onDocsChange={noop}
        onFieldFocus={noop}
        whyTerm="Documents"
        noHints
      />
      {error ? (
        <p role="alert" className="text-body-sm text-fail">
          {error}
        </p>
      ) : null}
    </div>
  );
}
