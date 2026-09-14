'use client';

import * as React from 'react';
import { cn } from '../lib/cn';
import { Button } from './primitives';

export interface SectionDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  stepIndex: number;
  stepCount: number;
  /** Primary action label — "Continue" or "Save". */
  primaryLabel: string;
  onPrimary: () => void;
  primaryLoading?: boolean;
  primaryDisabledReason?: string;
  onBack?: () => void;
  backDisabled?: boolean;
  children: React.ReactNode;
  className?: string;
}

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Progressive profile section shell — 620px, segment strip, trapped focus.
 *
 * Focus lands on the first editable field on open, not the heading, so a
 * mistyped value from the previous screen cannot confirm the next one.
 */
export function SectionDialog({
  open,
  onClose,
  title,
  subtitle,
  stepIndex,
  stepCount,
  primaryLabel,
  onPrimary,
  primaryLoading = false,
  primaryDisabledReason,
  onBack,
  backDisabled = false,
  children,
  className,
}: SectionDialogProps): React.JSX.Element | null {
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const id = React.useId();

  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (typeof dialog.showModal === 'function') {
        if (!dialog.open) dialog.showModal();
      } else {
        dialog.setAttribute('open', '');
      }
      requestAnimationFrame(() => {
        const root = bodyRef.current;
        if (!root) return;
        const first = root.querySelector<HTMLElement>(FOCUSABLE);
        first?.focus();
      });
    } else if (dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
  }, [open]);

  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return;
      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !el.closest('[hidden]'),
      );
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener('keydown', onKeyDown);
    return () => dialog.removeEventListener('keydown', onKeyDown);
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={`${id}-title`}
      aria-describedby={subtitle ? `${id}-sub` : undefined}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
      className={cn(
        'w-[calc(100vw-32px)] max-w-[620px] rounded-lg border border-rule bg-sheet p-0 text-ink shadow-3 backdrop:bg-ink/40',
        className,
      )}
    >
      <div className="flex max-h-[min(90vh,760px)] flex-col">
        <div className="border-b border-rule px-6 pb-4 pt-5">
          <div className="mb-4 grid grid-cols-4 gap-2" aria-hidden="true">
            {Array.from({ length: stepCount }, (_, i) => (
              <span
                key={i}
                className={cn(
                  'h-[3px] rounded-full',
                  i < stepIndex ? 'bg-acc' : 'bg-rule-2',
                )}
              />
            ))}
          </div>
          <h2 id={`${id}-title`} className="text-h2 text-ink">
            {title}
          </h2>
          {subtitle ? (
            <p id={`${id}-sub`} className="mt-1 text-body-sm text-ink-3">
              {subtitle}
            </p>
          ) : null}
        </div>

        <div ref={bodyRef} className="flex-1 overflow-y-auto px-6 py-5">
          {children}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule px-6 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Later
            </Button>
            {onBack ? (
              <Button
                type="button"
                variant="secondary"
                disabled={backDisabled}
                onClick={onBack}
              >
                Back
              </Button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-label uppercase tracking-[0.12em] text-ink-3 tnum">
              Step {stepIndex} of {stepCount}
            </span>
            <Button
              type="button"
              variant="primary"
              loading={primaryLoading}
              disabledReason={primaryDisabledReason}
              onClick={onPrimary}
            >
              {primaryLabel}
            </Button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
