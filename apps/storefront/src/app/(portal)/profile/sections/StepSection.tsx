'use client';

import * as React from 'react';
import { Modal } from '@trugrade/ui';
import { completeStep, saveStep } from '../../../register/api';

/**
 * One onboarding step, in a dialog, on the profile page.
 *
 * The step forms under `app/register` were built for the wizard and already
 * know how to draft on blur, validate, and hand back a server refusal against
 * the field that caused it. Nothing about that changes when the same form
 * opens from a card: this wrapper gives it the two callbacks it needs, and
 * decides the card is done from the responses, never from the fact that the
 * form's submit handler ran.
 */

export interface StepSectionProps {
  open: boolean;
  onClose: () => void;
  /** Called once the step is saved AND completed. A refusal keeps the dialog open. */
  onSaved: () => void;
  title: string;
  description: string;
  stepCode: string;
  children: (ctx: StepFormContext) => React.ReactNode;
}

export interface StepFormContext {
  busy: boolean;
  onSaveDraft: (values: Record<string, unknown>, completionPct: number) => void;
  onContinue: (
    values: Record<string, unknown>,
    completionPct: number,
  ) => Promise<Record<string, string> | null>;
  /** The step forms name a term for the wizard's "why we ask" rail. There is none here. */
  onFieldFocus: (term: string) => void;
}

/** A refusal's message, against the field it names where it names one. */
const refusalFields = (result: {
  message: string;
  fields: Record<string, string>;
}): Record<string, string> =>
  Object.keys(result.fields).length > 0 ? result.fields : { form: result.message };

export function StepSection({
  open,
  onClose,
  onSaved,
  title,
  description,
  stepCode,
  children,
}: StepSectionProps): React.JSX.Element {
  const [busy, setBusy] = React.useState(false);
  const [saveFailure, setSaveFailure] = React.useState<string | null>(null);

  const onSaveDraft = React.useCallback(
    (values: Record<string, unknown>, completionPct: number): void => {
      void saveStep(stepCode, values, completionPct).then((result) => {
        setSaveFailure(result.ok ? null : result.message);
      });
    },
    [stepCode],
  );

  const onContinue = React.useCallback(
    async (
      values: Record<string, unknown>,
      completionPct: number,
    ): Promise<Record<string, string> | null> => {
      setBusy(true);
      setSaveFailure(null);
      const saved = await saveStep(stepCode, values, completionPct);
      if (!saved.ok) {
        setBusy(false);
        return refusalFields(saved);
      }
      const completed = await completeStep(stepCode);
      setBusy(false);
      if (!completed.ok) return refusalFields(completed);
      onSaved();
      return null;
    },
    [stepCode, onSaved],
  );

  const ctx = React.useMemo<StepFormContext>(
    () => ({ busy, onSaveDraft, onContinue, onFieldFocus: () => undefined }),
    [busy, onSaveDraft, onContinue],
  );

  return (
    <Modal open={open} onClose={onClose} title={title} description={description} size="lg">
      {saveFailure ? (
        <p role="alert" className="mb-4 text-body-sm text-fail">
          {saveFailure} Nothing you typed has been lost.
        </p>
      ) : null}
      {open ? children(ctx) : null}
    </Modal>
  );
}
