import * as React from 'react';

/**
 * Rail glyphs, one per portal route.
 *
 * A 96px rail has room for a tile and a word, not a word alone — the icon is
 * what makes the rail scannable at that width. Keyed to portal routes, so they
 * live beside the navigation rather than in `packages/ui`.
 */

const SVG = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

function Glyph({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden="true" {...SVG}>
      {children}
    </svg>
  );
}

const GLYPHS: Record<string, React.JSX.Element> = {
  '/home': (
    <Glyph>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5.5 9.5V20h13V9.5" />
    </Glyph>
  ),
  '/orders': (
    <Glyph>
      <path d="M6 3h7.5L18 7.5V21H6z" />
      <path d="M13.5 3v4.5H18" />
      <path d="M9 12.5h6M9 16h4" />
    </Glyph>
  ),
  '/approvals': (
    <Glyph>
      <path d="M12 3.2 19 6v5.4c0 4.2-2.9 7.9-7 9.2-4.1-1.3-7-5-7-9.2V6z" />
      <path d="m9.2 11.8 2 2 3.6-3.8" />
    </Glyph>
  ),
  '/returns': (
    <Glyph>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
    </Glyph>
  ),
  '/warranty': (
    <Glyph>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 7.4V12l3.1 2" />
    </Glyph>
  ),
  '/addresses': (
    <Glyph>
      <path d="M12 21s6.5-5.6 6.5-11a6.5 6.5 0 0 0-13 0c0 5.4 6.5 11 6.5 11z" />
      <circle cx="12" cy="10" r="2.3" />
    </Glyph>
  ),
  '/team': (
    <Glyph>
      <circle cx="9.4" cy="8.6" r="3.2" />
      <path d="M3.4 19.6c0-3.3 2.7-5.6 6-5.6s6 2.3 6 5.6" />
      <path d="M16.4 5.9a3 3 0 0 1 0 5.8" />
      <path d="M18 14.6c1.7.8 2.8 2.4 2.8 4.4" />
    </Glyph>
  ),
  '/profile': (
    <Glyph>
      <circle cx="12" cy="8.4" r="3.6" />
      <path d="M4.8 20.4c0-3.9 3.2-6.4 7.2-6.4s7.2 2.5 7.2 6.4" />
    </Glyph>
  ),
};

const FALLBACK = (
  <Glyph>
    <circle cx="12" cy="12" r="7.4" />
  </Glyph>
);

export function RailIcon({ to }: { to: string }): React.JSX.Element {
  return GLYPHS[to] ?? FALLBACK;
}

export function SearchIcon(): React.JSX.Element {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true" {...SVG}>
      <circle cx="10.8" cy="10.8" r="6.8" />
      <path d="m16 16 4 4" />
    </svg>
  );
}
