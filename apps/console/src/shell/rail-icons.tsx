import * as React from 'react';

/**
 * Rail glyphs, one per vendor route.
 *
 * A 96px rail has room for a tile and a word, not a word alone — the icon is
 * what makes the rail scannable at that width. They live here rather than in
 * `packages/ui` because they are keyed to console routes and mean nothing
 * outside this navigation.
 */

const SVG = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

function Glyph({ size = 20, children }: { size?: number; children: React.ReactNode }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...SVG}>
      {children}
    </svg>
  );
}

const GLYPHS: Record<string, React.JSX.Element> = {
  '/vendor': (
    <Glyph>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5.5 9.5V20h13V9.5" />
    </Glyph>
  ),
  '/vendor/listings': (
    <Glyph>
      <path d="M4 6h16M4 12h16M4 18h10" />
    </Glyph>
  ),
  '/vendor/listings/new': (
    <Glyph>
      <rect x="4" y="4" width="16" height="16" rx="2.5" />
      <path d="M12 8.5v7M8.5 12h7" />
    </Glyph>
  ),
  '/vendor/sku-request': (
    <Glyph>
      <path d="M3.5 12.8V4.5a1 1 0 0 1 1-1h8.3L21 11.7 12.2 20.5z" />
      <circle cx="7.8" cy="7.8" r="1.3" />
    </Glyph>
  ),
  '/vendor/qc/visits': (
    <Glyph>
      <path d="M12 3.2 19 6v5.4c0 4.2-2.9 7.9-7 9.2-4.1-1.3-7-5-7-9.2V6z" />
      <path d="m9.2 11.8 2 2 3.6-3.8" />
    </Glyph>
  ),
  '/vendor/corrections': (
    <Glyph>
      <path d="M12 4.2 21 20H3z" />
      <path d="M12 10.5v4M12 17.4h.01" />
    </Glyph>
  ),
  '/vendor/orders': (
    <Glyph>
      <path d="M6 3h7.5L18 7.5V21H6z" />
      <path d="M13.5 3v4.5H18" />
      <path d="M9 12.5h6M9 16h4" />
    </Glyph>
  ),
  '/vendor/dispatch': (
    <Glyph>
      <path d="M3 6.5h11v9.5H3z" />
      <path d="M14 10h3.6L21 13.2V16h-7z" />
      <circle cx="7.2" cy="18.2" r="1.8" />
      <circle cx="17" cy="18.2" r="1.8" />
    </Glyph>
  ),
  '/vendor/payables': (
    <Glyph>
      <path d="M3 8.2a2 2 0 0 1 2-2h12.5a2 2 0 0 1 2 2v9.6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M3 8.2 15.2 4.2v2" />
      <path d="M16.8 13h.01" />
    </Glyph>
  ),
  '/vendor/payouts': (
    <Glyph>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 7.4V12l3.1 2" />
    </Glyph>
  ),
  '/vendor/team': (
    <Glyph>
      <circle cx="9.4" cy="8.6" r="3.2" />
      <path d="M3.4 19.6c0-3.3 2.7-5.6 6-5.6s6 2.3 6 5.6" />
      <path d="M16.4 5.9a3 3 0 0 1 0 5.8" />
      <path d="M18 14.6c1.7.8 2.8 2.4 2.8 4.4" />
    </Glyph>
  ),
  '/vendor/facilities': (
    <Glyph>
      <path d="M4.5 20.5V6.8L12 3.5l7.5 3.3v13.7" />
      <path d="M4.5 20.5h15" />
      <path d="M9.4 20.5v-4.6h5.2v4.6" />
      <path d="M9.4 10.2h1.4M13.2 10.2h1.4" />
    </Glyph>
  ),
  '/vendor/documents': (
    <Glyph>
      <path d="M3.2 19V5.6a1 1 0 0 1 1-1h4.4l2 2.6h10.2V19a1 1 0 0 1-1 1H4.2a1 1 0 0 1-1-1z" />
    </Glyph>
  ),
  '/vendor/profile': (
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

export function LockIcon(): React.JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" {...SVG} strokeWidth={2}>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8.2 10.5V7.6a3.8 3.8 0 0 1 7.6 0v2.9" />
    </svg>
  );
}
