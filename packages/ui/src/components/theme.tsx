'use client';

// Interactive: this module uses React state, refs or context, none of which
// exist in a server component. The storefront is a Next App Router app, so
// without this directive importing anything from the package barrel drags a
// client-only API into an RSC render and fails at request time rather than at
// build time.
import * as React from 'react';
import { cn } from '../lib/cn';

/**
 * The theme, as `09_FRONTEND_LOCKED.md` §8 locks it.
 *
 * Dark is the brand default and light is a deliberate opt-out, so
 * `prefers-color-scheme` is **not** followed. That is a decision, not an
 * oversight: a B2B tool that silently flips because a laptop is in light mode
 * is a tool whose screenshots never match between two people looking at the
 * same order.
 */
export type Theme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'tg-theme';

/**
 * The pre-paint read, inlined into `<head>` before any stylesheet.
 *
 * It has to be a blocking inline script and it has to run before first paint,
 * or a light-theme user gets a dark flash on every navigation. A `useEffect`
 * cannot do this — by the time React hydrates, the wrong theme has already been
 * painted. Exported as a string so the storefront and the console inline the
 * same one and cannot drift.
 *
 * The try/catch is not defensive dressing: `localStorage` throws outright in a
 * private window and in some embedded webviews, and an exception here would
 * abort the rest of the document head.
 */
export const THEME_PREPAINT_SCRIPT =
  `try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');` +
  `if(t)document.documentElement.setAttribute('data-t',t)}catch(e){}`;

export function readTheme(): Theme {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.getAttribute('data-t') === 'light' ? 'light' : 'dark';
}

export function applyTheme(next: Theme): void {
  document.documentElement.setAttribute('data-t', next);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // A private window forgets the choice on reload. That is worse than
    // remembering it and better than throwing on click.
  }
}

/**
 * Moon in dark, sun in light — the icon shows what you are *in*, not what you
 * would switch to. Both readings are defensible; this one matches the reference
 * implementation, and consistency with it is worth more than the argument.
 */
export interface ThemeToggleProps {
  className?: string;
}

/**
 * RENDERS THE SAME MARKUP ON THE SERVER AND ON THE CLIENT, ALWAYS.
 *
 * It used to seed its state from the DOM — `useState(() => readTheme())` — which
 * looks like the careful thing to do and is the opposite. On the server
 * `readTheme()` has no document and answers 'dark'. On the client the pre-paint
 * script in <head> has *already* set data-t="light", so the very first client
 * render answers 'light'. Different icon, different aria-label, different text:
 * a hydration mismatch, and React's response to one is to throw away the server
 * tree and re-render the whole document. Every light-theme page load was paying
 * that, and the visible symptom was somewhere else entirely.
 *
 * So neither the icon nor the label is decided in JavaScript any more. Both
 * states are always in the DOM and CSS shows exactly one, keyed off the same
 * `data-t` attribute the pre-paint script sets. That means:
 *   - the markup is byte-identical on both sides, so there is nothing to mismatch
 *   - the correct icon is painted on the first frame, with no deferred mount and
 *     no flash — the toggle can render inside a server component
 *   - the button's accessible name comes from its visible-to-AT content rather
 *     than an attribute, so the hidden half is hidden from a screen reader too
 *     (`display:none`, not `sr-only`, which would announce both).
 *
 * The click handler reads the live DOM instead of state, because the DOM is the
 * only thing that was ever the source of truth here.
 */
export function ThemeToggle({ className }: ThemeToggleProps): React.JSX.Element {
  const toggle = (): void => {
    applyTheme(readTheme() === 'light' ? 'dark' : 'light');
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-sm',
        'border border-chrome-line text-on-chrome-2',
        'transition-colors hover:text-on-chrome hover:border-chrome-line-2',
        className,
      )}
    >
      {/* The label says what the button DOES, not what the state is — a screen
          reader user needs the action; the state is already on <html>. */}
      <span className="tg-in-dark">
        <MoonIcon />
        <span className="sr-only">Switch to light theme</span>
      </span>
      <span className="tg-in-light">
        <SunIcon />
        <span className="sr-only">Switch to dark theme</span>
      </span>
    </button>
  );
}

function MoonIcon(): React.JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SunIcon(): React.JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M12 2.4v2.2M12 19.4v2.2M4.2 12H2M22 12h-2.2M5.6 5.6 4 4M20 20l-1.6-1.6M18.4 5.6 20 4M4 20l1.6-1.6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}
