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
  /**
   * Whether clicking the backdrop closes this modal. Off by default.
   *
   * Opt-in rather than automatic, because most modals in this product hold a
   * half-finished form — the invite dialog, a bank change, a return — and a
   * stray click beside one of those must not throw the typing away. A modal
   * that asks for nothing, or asks for something the visitor can start again
   * in one click, is the case this is for.
   */
  dismissOnBackdrop?: boolean;
  /**
   * Draw the heading for screen readers only.
   *
   * The heading is never dropped, only taken off the screen: it is what
   * `aria-labelledby` points at, so a dialog without one announces itself as
   * "dialog" and nothing more. For a modal whose own content already says what
   * it is — a sign-in form, with a Send code button in it — the visible
   * repetition is what goes.
   */
  titleHidden?: boolean;
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
  dismissOnBackdrop = false,
  titleHidden = false,
}: ModalProps): React.JSX.Element {
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  // Two modals can be mounted at once (a confirm over a form). Fixed ids would
  // make `aria-labelledby` resolve to whichever mounted first.
  const id = React.useId();
  /**
   * Where the press that began this click landed.
   *
   * A click is only a backdrop click when it *started* on the backdrop.
   * Selecting the text of a label and releasing the mouse past the card's edge
   * is one press and one release, and without this it would close the dialog
   * mid-sentence.
   */
  const pressedOutside = React.useRef(false);

  /**
   * Whether a pointer position is outside the card.
   *
   * Measured against the dialog's own box rather than by comparing targets: a
   * native `<dialog>` reports a click on its ::backdrop as a click on the
   * dialog element itself, and so does a click on any padding of its own, which
   * is inside the card as far as the person clicking is concerned.
   */
  const isOutside = (event: { clientX: number; clientY: number }): boolean => {
    const dialog = dialogRef.current;
    if (!dialog) return false;
    const box = dialog.getBoundingClientRect();
    // A keyboard-triggered click reports 0,0 and no box; never treat that as
    // a click on the backdrop.
    if (box.width === 0 || box.height === 0) return false;
    if (event.clientX === 0 && event.clientY === 0) return false;
    return (
      event.clientX < box.left ||
      event.clientX > box.right ||
      event.clientY < box.top ||
      event.clientY > box.bottom
    );
  };

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
      onMouseDown={(event) => {
        if (dismissOnBackdrop) pressedOutside.current = isOutside(event);
      }}
      onClick={(event) => {
        if (!dismissOnBackdrop) return;
        if (pressedOutside.current && isOutside(event)) onClose();
        pressedOutside.current = false;
      }}
      className={cn(
        'w-[calc(100vw-32px)] rounded-lg border border-rule bg-sheet p-0 text-ink shadow-3',
        MODAL_WIDTH[size],
        className,
      )}
    >
      <div className="tg-card flex flex-col gap-4">
        <div className={cn('flex items-start gap-4', titleHidden ? 'justify-end' : 'justify-between')}>
          <h2
            id={`${id}-title`}
            ref={headingRef}
            tabIndex={-1}
            className={titleHidden ? 'sr-only' : 'font-sans text-h2 text-ink'}
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
 * Drawer
 * ======================================================================== */

const DRAWER_WIDTH = {
  md: 'sm:max-w-[520px]',
  lg: 'sm:max-w-[680px]',
  xl: 'sm:max-w-[840px]',
} as const;

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** The record's identity. Mono where it is an identifier — the caller decides. */
  title: React.ReactNode;
  /** One line under the title: status, owner, age. Never a paragraph. */
  subtitle?: React.ReactNode;
  size?: keyof typeof DRAWER_WIDTH;
  /** The actions. Pinned to the bottom so a long record never buries them. */
  footer?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

/**
 * A record, opened beside the board rather than on top of it.
 *
 * **Why a drawer and not a modal.** A queue is a queue: an operator works down
 * it, and a modal throws away the board's scroll position on every open and
 * close, so row 40 costs forty scrolls instead of one. The drawer leaves the
 * board mounted and where it was.
 *
 * A modal is still right for a decision with no record behind it — assign a
 * rider, create a run, preview a document — and `Modal` above is that.
 *
 * It is the same `<dialog showModal()>` underneath, for the same reason: focus
 * entry, the tab cycle, inert background, Esc and focus restoration are all
 * behaviours the platform implements correctly and a hand-rolled trap gets
 * subtly wrong. Only the geometry differs — full height, pinned right, and full
 * width on a phone, where a 520px panel beside nothing is just a bad modal.
 */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  size = 'lg',
  footer,
  children,
  className,
}: DrawerProps): React.JSX.Element {
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const headingRef = React.useRef<HTMLHeadingElement>(null);
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
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
      className={cn(
        // `mr-0` with `ml-auto` is what pins a <dialog> to the right edge; the
        // element is centred by the UA stylesheet otherwise.
        'ml-auto mr-0 h-dvh max-h-dvh w-full border-l border-rule bg-sheet p-0 text-ink shadow-3',
        DRAWER_WIDTH[size],
        className,
      )}
    >
      <div className="flex h-full flex-col">
        <header className="flex items-start justify-between gap-4 border-b border-rule px-5 py-4">
          <div className="flex min-w-0 flex-col gap-1">
            <h2
              id={`${id}-title`}
              ref={headingRef}
              tabIndex={-1}
              className="truncate font-sans text-h2 text-ink"
            >
              {title}
            </h2>
            {subtitle && <div className="text-body-sm text-ink-2">{subtitle}</div>}
          </div>
          <Button variant="ghost" onClick={onClose} aria-label="Close record">
            <span aria-hidden="true">✕</span>
          </Button>
        </header>

        {/* The only scrolling region: the header and the actions stay put. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && (
          <footer className="flex flex-wrap items-center gap-3 border-t border-rule bg-sheet-2 px-5 py-3">
            {footer}
          </footer>
        )}
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
