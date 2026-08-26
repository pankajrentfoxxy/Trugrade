'use strict';

/**
 * Trugrade design system — the "Anodised" palette.
 * 08_BRAND_SYSTEM.md §4–§5. Supersedes the "New_plan" navy/cyan/orange tokens in
 * _CONTEXT.md and Part 1 of 03_UX_SPEC.md.
 *
 * Every colour is a CSS custom property so the light/dark/system triple lives in
 * one place (packages/ui/src/globals.css) and Tailwind never hard-codes a hex.
 * Rule: signal blue means "measured". It is never decoration.
 */

/** `<alpha-value>` support without duplicating every token as an rgb triple. */
const v = (name) => `var(--${name})`;

module.exports = {
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: v('ink'), 2: v('ink-2'), 3: v('ink-3'), 4: v('ink-4') },
        ground: v('ground'),
        surface: { DEFAULT: v('surface'), 2: v('surface-2') },
        rule: { DEFAULT: v('rule'), 2: v('rule-2') },
        band: v('band'),
        signal: {
          DEFAULT: v('signal'),
          hi: v('signal-hi'),
          wash: v('signal-wash'),
          ink: v('signal-ink'),
        },
        pass: { DEFAULT: v('pass'), wash: v('pass-wash') },
        warn: { DEFAULT: v('warn'), wash: v('warn-wash') },
        fail: { DEFAULT: v('fail'), wash: v('fail-wash') },
      },
      fontFamily: {
        display: ['var(--font-display)', 'Instrument Sans', 'system-ui', 'sans-serif'],
        sans: ['var(--font-body)', 'IBM Plex Sans', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'IBM Plex Mono', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        // 08_BRAND_SYSTEM.md §5 type scale. [size, {lineHeight, weight, letterSpacing}]
        'display-1': ['clamp(36px,5.6vw,60px)', { lineHeight: '1.02', fontWeight: '700', letterSpacing: '-0.02em' }],
        'display-2': ['clamp(28px,4vw,42px)', { lineHeight: '1.08', fontWeight: '700', letterSpacing: '-0.018em' }],
        h1: ['clamp(23px,3vw,31px)', { lineHeight: '1.18', fontWeight: '600', letterSpacing: '-0.012em' }],
        h2: ['21px', { lineHeight: '1.25', fontWeight: '600', letterSpacing: '-0.008em' }],
        h3: ['17px', { lineHeight: '1.35', fontWeight: '600' }],
        'body-lg': ['18px', { lineHeight: '1.6', fontWeight: '400' }],
        body: ['16px', { lineHeight: '1.62', fontWeight: '400' }],
        'body-sm': ['14.5px', { lineHeight: '1.55', fontWeight: '400' }],
        label: ['10.5px', { lineHeight: '1.3', fontWeight: '500', letterSpacing: '0.13em' }],
        data: ['13px', { lineHeight: '1.4', fontWeight: '500' }],
      },
      spacing: {
        // The scale that did not exist anywhere in the prototypes.
        1: '2px', 2: '4px', 3: '8px', 4: '12px', 5: '16px', 6: '20px',
        7: '24px', 8: '32px', 9: '40px', 10: '48px', 11: '64px', 12: '80px',
      },
      borderRadius: {
        xs: 'var(--r-xs)',
        sm: 'var(--r-sm)',
        DEFAULT: 'var(--r)',
        md: 'var(--r)',
        lg: 'var(--r-lg)',
        xl: 'var(--r-xl)',
      },
      boxShadow: { 1: 'var(--sh-1)', 2: 'var(--sh-2)', 3: 'var(--sh-3)' },
      maxWidth: { container: 'var(--maxw)' },
      transitionTimingFunction: { standard: 'cubic-bezier(.2,0,0,1)' },
      keyframes: {
        'toast-in': { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'none' } },
        shake: {
          '0%,100%': { transform: 'translateX(0)' },
          '20%,60%': { transform: 'translateX(-4px)' },
          '40%,80%': { transform: 'translateX(4px)' },
        },
        pulse2: { '0%,100%': { opacity: '1' }, '50%': { opacity: '.45' } },
      },
      animation: {
        'toast-in': 'toast-in 160ms cubic-bezier(.2,0,0,1)',
        shake: 'shake 320ms cubic-bezier(.2,0,0,1)',
        skeleton: 'pulse2 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [
    /** `tabular-nums` is mandatory anywhere digits stack. Make it one class. */
    function ({ addUtilities }) {
      addUtilities({
        '.tnum': { fontVariantNumeric: 'tabular-nums' },
        '.focus-ring': {
          outline: '2px solid var(--signal)',
          outlineOffset: '3px',
        },
      });
    },
  ],
};
