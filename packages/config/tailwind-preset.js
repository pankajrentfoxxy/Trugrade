'use strict';

/**
 * Trugrade design system — the "Workbench" palette.
 * 08_BRAND_SYSTEM.md §4–§5, revised 26 Aug 2026. Replaces the cobalt "Anodised"
 * set entirely.
 *
 * Every colour is a CSS custom property, so the single light theme lives in one
 * place (packages/ui/src/globals.css) and Tailwind never hard-codes a hex.
 *
 * Two rules the token names themselves enforce:
 *   - `acc` is the ONLY accent, and it means "primary action, measured value or
 *     active state". There is no second brand colour to reach for.
 *   - `warn` has no `-wash`. WARN renders outlined, never filled (rule 4), so a
 *     background token for it would be a footgun.
 */

const v = (name) => `var(--${name})`;

module.exports = {
  // Single theme by design. `dark:` is not wired to a media query — the dark
  // band is compositional, via `.tg-dark` and the `dark` / `on-dark` tokens.
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        paper: v('paper'),
        sheet: { DEFAULT: v('sheet'), 2: v('sheet-2') },
        ink: { DEFAULT: v('ink'), 2: v('ink-2'), 3: v('ink-3'), 4: v('ink-4') },
        rule: { DEFAULT: v('rule'), 2: v('rule-2'), 3: v('rule-3') },
        dark: { DEFAULT: v('dark'), 2: v('dark-2') },
        'on-dark': { DEFAULT: v('on-dark'), 2: v('on-dark-2'), 3: v('on-dark-3') },
        acc: { DEFAULT: v('acc'), hi: v('acc-hi'), lit: v('acc-lit'), wash: v('acc-wash') },
        pass: { DEFAULT: v('pass'), wash: v('pass-wash') },
        warn: v('warn'),
        fail: { DEFAULT: v('fail'), wash: v('fail-wash') },
      },
      fontFamily: {
        display: ['var(--font-display)', 'Instrument Sans', 'system-ui', 'sans-serif'],
        sans: [
          'var(--font-body)',
          'IBM Plex Sans',
          // Hindi stays inside the same family rather than bolting on an
          // unrelated face — the decisive reason for choosing Plex.
          'IBM Plex Sans Devanagari',
          'system-ui',
          'sans-serif',
        ],
        mono: ['var(--font-mono)', 'IBM Plex Mono', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        'display-1': [
          'clamp(36px,5.6vw,60px)',
          { lineHeight: '1.02', fontWeight: '700', letterSpacing: '-0.02em' },
        ],
        'display-2': [
          'clamp(28px,4vw,42px)',
          { lineHeight: '1.08', fontWeight: '700', letterSpacing: '-0.018em' },
        ],
        h1: [
          'clamp(23px,3vw,31px)',
          { lineHeight: '1.18', fontWeight: '600', letterSpacing: '-0.012em' },
        ],
        h2: ['21px', { lineHeight: '1.25', fontWeight: '600', letterSpacing: '-0.008em' }],
        h3: ['17px', { lineHeight: '1.35', fontWeight: '600' }],
        'body-lg': ['18px', { lineHeight: '1.6', fontWeight: '400' }],
        body: ['16px', { lineHeight: '1.62', fontWeight: '400' }],
        'body-sm': ['14.5px', { lineHeight: '1.55', fontWeight: '400' }],
        label: ['10.5px', { lineHeight: '1.3', fontWeight: '500', letterSpacing: '0.13em' }],
        data: ['13px', { lineHeight: '1.4', fontWeight: '500' }],
      },
      spacing: {
        // The scale that did not exist anywhere in the old prototypes.
        1: '4px',
        2: '8px',
        3: '12px',
        4: '16px',
        5: '24px',
        6: '32px',
        7: '48px',
        8: '64px',
        9: '88px',
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
        'toast-in': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'none' },
        },
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
    function ({ addUtilities }) {
      addUtilities({
        '.tnum': { fontVariantNumeric: 'tabular-nums' },
        '.focus-ring': { outline: '2px solid var(--acc)', outlineOffset: '3px' },
      });
    },
  ],
};
