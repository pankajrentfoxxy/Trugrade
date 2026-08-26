import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * The project's type scale, exactly as `packages/config/tailwind-preset.js`
 * defines it under `theme.extend.fontSize`.
 *
 * WHY THIS LIST HAS TO EXIST
 * --------------------------
 * `tailwind-merge` resolves conflicts from a built-in map of Tailwind's DEFAULT
 * classes. It has never seen this preset. Faced with `text-body-sm` it falls
 * back to the only other thing `text-*` can be — a colour — and then does its
 * job correctly and destructively: it drops the earlier colour as a conflict.
 *
 *   twMerge('bg-acc text-acc-on', 'text-body-sm')  ->  'bg-acc text-body-sm'
 *
 * `text-acc-on` is gone. Every amber primary action in the app was rendering
 * `--ink-2` on `--acc`: about 1.7:1, where 09_FRONTEND_LOCKED section 9 states
 * 11.2:1 and WCAG AA requires 4.5:1. The same bug stripped `text-white` from the
 * danger button, `text-acc-ink` from links, and the SIZES `text-label` and
 * `text-data` from StatusPill, GradeBadge and the DataBoard header — which is
 * why the console's type scale read a step too large beside the reference.
 *
 * It is worth naming why nothing caught it. `tokens.spec.ts` recomputes the
 * contrast pairs against globals.css and passes, because the TOKENS are right.
 * Nothing asserted that a component still carried the token by the time it
 * reached the DOM. The guard checked the definition, not the delivery — the
 * same shape as an append-only test that only asserts its function exists.
 *
 * Keep this in step with the preset. A size added there and not here is silently
 * a colour again, so `cn.spec.ts` reads the preset and fails if the two drift.
 */
const FONT_SIZES = [
  'display-1',
  'display-2',
  'h1',
  'h2',
  'h3',
  'body-lg',
  'body',
  'body-sm',
  'label',
  'data',
] as const;

const merge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: [...FONT_SIZES] }],
    },
  },
});

/** Merge class names, letting a later Tailwind class win over an earlier one. */
export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}

/** Exported for `cn.spec.ts`, which checks it against the Tailwind preset. */
export const TYPE_SCALE: readonly string[] = FONT_SIZES;
