'use strict';

/**
 * Trugrade design system — the "Darkroom" scheme. LOCKED 26 August 2026.
 *
 * Regenerated from `docs/09_FRONTEND_LOCKED.md` §2 and the token block in
 * `packages/ui/src/globals.css`. `docs/reference/homepage.html` is the
 * reference implementation; where a description and that file disagree, the
 * file wins.
 *
 * Every colour is a CSS custom property, so BOTH themes live in one place and
 * Tailwind never hard-codes a hex. `data-t` on the root swaps the variables
 * underneath these names, which is why there is no `dark:` variant here — a
 * component styles once and the theme resolves beneath it.
 *
 * Three rules the token names themselves enforce:
 *   - `acc` is the ONLY accent, and it means "primary action, measured value or
 *     active state". There is no second brand colour to reach for.
 *   - `chrome` / `on-chrome` are theme-invariant. Header and footer never change.
 *   - `acc-ink` is the amber to use for TEXT. Raw `acc` as a text colour fails
 *     contrast on a light surface, so the two are deliberately separate names.
 */

const v = (name) => `var(--${name})`;

module.exports = {
  // Themes are driven by `data-t` on <html>, read via CSS variables, so no
  // Tailwind dark variant is wired. `prefers-color-scheme` is deliberately NOT
  // followed: dark is the brand default and light is an explicit opt-out.
  darkMode: ['selector', '[data-t="dark"]'],
  theme: {
    extend: {
      colors: {
        // Working surfaces — these flip with the theme.
        ground: v('ground'),
        sheet: { DEFAULT: v('sheet'), 2: v('sheet-2'), 3: v('sheet-3') },
        ink: { DEFAULT: v('ink'), 2: v('ink-2'), 3: v('ink-3'), 4: v('ink-4') },
        rule: { DEFAULT: v('rule'), 2: v('rule-2') },

        // The brand chrome — identical in both themes.
        chrome: { DEFAULT: v('chrome'), 2: v('chrome-2'), 3: v('chrome-3') },
        'on-chrome': { DEFAULT: v('on-chrome'), 2: v('on-chrome-2'), 3: v('on-chrome-3') },
        'chrome-line': { DEFAULT: v('chrome-line'), 2: v('chrome-line-2') },

        acc: {
          DEFAULT: v('acc'),
          dk: v('acc-dk'),
          on: v('acc-on'),
          ink: v('acc-ink'),
          wash: v('acc-wash'),
          glow: v('acc-glow'),
        },
        scan: v('scan'),

        // Semantic — test outcomes ONLY. Never a grade.
        pass: v('pass'),
        warn: v('warn'),
        fail: v('fail'),
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'Inter', 'system-ui', 'sans-serif'],
        // Hindi keeps its own family; Inter has no Devanagari coverage.
        deva: ['var(--font-deva)', 'IBM Plex Sans Devanagari', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'IBM Plex Mono', 'ui-monospace', 'monospace'],
      },
      /**
       * Sized against a 14px base, not 16px. `body` is the base; `body-lg` is
       * the 14.5px that marketing prose may opt up to, and nothing else does.
       */
      fontSize: {
        'display-1': [
          'clamp(32px,5.2vw,54px)',
          { lineHeight: '1.04', fontWeight: '700', letterSpacing: '-0.022em' },
        ],
        'display-2': [
          'clamp(25px,3.8vw,38px)',
          { lineHeight: '1.08', fontWeight: '700', letterSpacing: '-0.022em' },
        ],
        h1: [
          'clamp(21px,2.8vw,28px)',
          { lineHeight: '1.18', fontWeight: '700', letterSpacing: '-0.022em' },
        ],
        h2: ['19px', { lineHeight: '1.25', fontWeight: '700', letterSpacing: '-0.022em' }],
        h3: ['15.5px', { lineHeight: '1.35', fontWeight: '600', letterSpacing: '-0.014em' }],
        'body-lg': ['14.5px', { lineHeight: '1.62', fontWeight: '400' }],
        body: ['14px', { lineHeight: '1.6', fontWeight: '400' }],
        'body-sm': ['13px', { lineHeight: '1.55', fontWeight: '400' }],
        label: ['10.5px', { lineHeight: '1.3', fontWeight: '500', letterSpacing: '0.13em' }],
        data: ['13px', { lineHeight: '1.4', fontWeight: '500' }],
      },
      spacing: {
        1: '4px',
        2: '8px',
        3: '12px',
        4: '16px',
        5: '20px',
        6: '28px',
        7: '40px',
        8: '56px',
      },
      borderRadius: {
        xs: 'var(--r-xs)',
        sm: 'var(--r-sm)',
        DEFAULT: 'var(--r)',
        md: 'var(--r)',
        lg: 'var(--r-lg)',
        xl: 'var(--r-xl)',
      },
      boxShadow: { 1: 'var(--shadow)', 2: 'var(--shadow)' },
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
        // Mono AND tabular together: every numeric value takes both, so a single
        // utility is the whole rule rather than two that can be applied apart.
        '.tnum': { fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' },
        '.focus-ring': { outline: '2px solid var(--acc)', outlineOffset: '2px' },
      });
    },
  ],
};
