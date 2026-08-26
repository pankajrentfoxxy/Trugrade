'use client';

// Interactive: this module uses React state, refs or context, none of which
// exist in a server component. The storefront is a Next App Router app, so
// without this directive importing anything from the package barrel drags a
// client-only API into an RSC render and fails at request time rather than at
// build time.
import * as React from 'react';
import { cn } from '../lib/cn';
import { Button } from './primitives';

/* ==========================================================================
 * Modal
 * ======================================================================== */

const MODAL_WIDTH = {
  sm: 'max-w-[440px]',
  md: 'max-w-[600px]',
  lg: 'max-w-[800px]',
} as const;

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  size?: keyof typeof MODAL_WIDTH;
  footer?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

/**
 * A real `<dialog>` opened with `showModal()`.
 *
 * Every hard part of §1.9.3 — focus moves in, `Tab` cycles inside, the
 * background goes inert, `Esc` closes, focus returns to the invoker — is
 * behaviour the platform already implements correctly. A hand-rolled focus trap
 * is fifty lines that gets `Shift+Tab` past the first element wrong, and it is
 * the kind of wrong nobody notices until an audit.
 *
 * Focus lands on the **heading**, not on the first control, so a destructive
 * confirm cannot be triggered by a keystroke that was already in flight.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  size = 'md',
  footer,
  children,
  className,
}: ModalProps): React.JSX.Element {
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  // Two modals can be mounted at once (a confirm over a form). Fixed ids would
  // make `aria-labelledby` resolve to whichever mounted first.
  const id = React.useId();

  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      // jsdom implements `<dialog>` markup but not `showModal()`, so the
      // attribute fallback keeps the component testable rather than making the
      // tests mock the thing under test.
      if (typeof dialog.showModal === 'function') {
        if (!dialog.open) dialog.showModal();
      } else {
        dialog.setAttribute('open', '');
      }
      headingRef.current?.focus();
    } else if (dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={`${id}-title`}
      aria-describedby={description ? `${id}-description` : undefined}
      // Esc fires `cancel`; preventing the default close keeps the DOM in step
      // with the `open` prop rather than letting the two disagree.
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
      className={cn(
        'w-[calc(100vw-32px)] rounded-lg border border-rule bg-sheet p-0 text-ink shadow-3',
        MODAL_WIDTH[size],
        className,
      )}
    >
      <div className="tg-card flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <h2
            id={`${id}-title`}
            ref={headingRef}
            tabIndex={-1}
            className="font-sans text-h2 text-ink"
          >
            {title}
          </h2>
          <Button variant="ghost" onClick={onClose} aria-label={`Close: ${title}`}>
            <span aria-hidden="true">✕</span>
          </Button>
        </div>

        {description && (
          <p id={`${id}-description`} className="text-body-sm text-ink-2">
            {description}
          </p>
        )}

        {children}

        {/* An error inside a modal renders inline at the top of the body, never
            as a toast behind it — a toast that appears under an inert backdrop
            is an error the user never reads. */}
        {footer && <div className="flex flex-wrap justify-end gap-3 pt-2">{footer}</div>}
      </div>
    </dialog>
  );
}

/* ==========================================================================
 * Toast
 * ======================================================================== */

export type ToastTone = 'success' | 'error' | 'info' | 'warn';

export interface ToastInput {
  tone: ToastTone;
  title: string;
  body?: string;
  /** The undo affordance. Seven seconds is the spec's window (§2.1 #22). */
  action?: { label: string; onClick: () => void };
  /** 0 keeps it until dismissed. Errors are persistent whatever this says. */
  durationMs?: number;
}

interface ToastRecord extends ToastInput {
  id: number;
}

const TONE_CLASS: Record<ToastTone, string> = {
  success: 'border-pass bg-sheet-2 text-pass',
  error: 'border-fail bg-sheet-2 text-fail',
  info: 'border-rule bg-sheet text-ink',
  // Rule 4: WARN is outlined, never filled.
  warn: 'border-warn bg-sheet text-warn',
};

const ToastContext = React.createContext<((toast: ToastInput) => void) | null>(null);

/**
 * Confirmations and background-job results.
 *
 * Two rules the API enforces rather than documents:
 *   - an **error toast never auto-dismisses**. A message that disappears on a
 *     timer is one a slow reader never read, and a form error must be adjacent
 *     to its field in text anyway (§1.9.5) — a toast is the wrong place for it
 *   - at most `max` are on screen; the oldest is dropped rather than stacking a
 *     column that covers the page it is reporting on
 */
export function ToastProvider({
  children,
  max = 3,
  defaultDurationMs = 6000,
}: {
  children: React.ReactNode;
  max?: number;
  defaultDurationMs?: number;
}): React.JSX.Element {
  const [toasts, setToasts] = React.useState<readonly ToastRecord[]>([]);
  const nextId = React.useRef(0);

  const dismiss = React.useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const push = React.useCallback(
    (input: ToastInput) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { ...input, id }].slice(-max));
      const duration = input.tone === 'error' ? 0 : (input.durationMs ?? defaultDurationMs);
      if (duration > 0) setTimeout(() => dismiss(id), duration);
    },
    [dismiss, max, defaultDurationMs],
  );

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        // A region, so a keyboard user can reach the stack deliberately; the
        // individual toasts carry the live semantics.
        role="region"
        aria-label="Notifications"
        className="pointer-events-none fixed bottom-5 right-5 z-50 flex w-[min(380px,calc(100vw-32px))] flex-col gap-3"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.tone === 'error' ? 'alert' : 'status'}
            className={cn(
              'pointer-events-auto flex animate-toast-in flex-col gap-2 rounded border p-4 shadow-2',
              TONE_CLASS[toast.tone],
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-body-sm font-medium">{toast.title}</p>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label={`Dismiss: ${toast.title}`}
                className="-m-2 min-h-11 min-w-11 text-current"
              >
                <span aria-hidden="true">✕</span>
              </button>
            </div>
            {toast.body && <p className="text-body-sm text-ink-2">{toast.body}</p>}
            {toast.action && (
              <Button
                variant="link"
                size="sm"
                className="self-start px-0"
                onClick={() => {
                  toast.action?.onClick();
                  dismiss(toast.id);
                }}
              >
                {toast.action.label}
              </Button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): (toast: ToastInput) => void {
  const push = React.useContext(ToastContext);
  if (!push) {
    throw new Error('useToast() needs a <ToastProvider> above it in the tree.');
  }
  return push;
}
