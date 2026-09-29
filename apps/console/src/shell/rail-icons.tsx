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

/**
 * Ops rail glyphs, one shape per concept rather than one per tab — a queue is a
 * queue whether it holds KYC applications or grade corrections, and drawing 33
 * unrelated pictograms would make the rail noisier than the 2-letter badges it
 * replaced. Concepts genuinely distinct (money, a shipment, a calendar, a
 * person) get their own shape; every board/queue screen shares one.
 */
const QUEUE = (
  <Glyph>
    <path d="M4 6h16M4 12h16M4 18h10" />
  </Glyph>
);
const SHIELD_CHECK = (
  <Glyph>
    <path d="M12 3.2 19 6v5.4c0 4.2-2.9 7.9-7 9.2-4.1-1.3-7-5-7-9.2V6z" />
    <path d="m9.2 11.8 2 2 3.6-3.8" />
  </Glyph>
);
const GRID = (
  <Glyph>
    <rect x="4" y="4" width="7" height="7" rx="1.4" />
    <rect x="13" y="4" width="7" height="7" rx="1.4" />
    <rect x="4" y="13" width="7" height="7" rx="1.4" />
    <rect x="13" y="13" width="7" height="7" rx="1.4" />
  </Glyph>
);
const IMAGE = (
  <Glyph>
    <rect x="3.5" y="5" width="17" height="14" rx="1.8" />
    <circle cx="9" cy="10.4" r="1.7" />
    <path d="m5 17 4.8-5 3.6 3.8 2.4-2.6 3.2 3.8" />
  </Glyph>
);
const TAG = (
  <Glyph>
    <path d="M11.3 3.5h5.2a2 2 0 0 1 2 2v5.2a2 2 0 0 1-.6 1.4l-8 8a2 2 0 0 1-2.8 0l-4.7-4.7a2 2 0 0 1 0-2.8l8-8a2 2 0 0 1 .9-.1z" />
    <circle cx="15.2" cy="8.8" r="1.3" />
  </Glyph>
);
const DOCUMENT = (
  <Glyph>
    <path d="M6 3h7.5L18 7.5V21H6z" />
    <path d="M13.5 3v4.5H18" />
    <path d="M9 12.5h6M9 16h4" />
  </Glyph>
);
const WALLET = (
  <Glyph>
    <path d="M3 8.2a2 2 0 0 1 2-2h12.5a2 2 0 0 1 2 2v9.6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <path d="M3 8.2 15.2 4.2v2" />
    <path d="M16.8 13h.01" />
  </Glyph>
);
const TRUCK = (
  <Glyph>
    <path d="M3 6.5h11v9.5H3z" />
    <path d="M14 10h3.6L21 13.2V16h-7z" />
    <circle cx="7.2" cy="18.2" r="1.8" />
    <circle cx="17" cy="18.2" r="1.8" />
  </Glyph>
);
const BOX_UP = (
  <Glyph>
    <path d="M4 9.5 12 5l8 4.5V17l-8 4.5L4 17z" />
    <path d="M12 12v6M9 14.4l3-2.4 3 2.4" />
  </Glyph>
);
const RIDER = (
  <Glyph>
    <circle cx="6.6" cy="17.4" r="2.6" />
    <circle cx="17.4" cy="17.4" r="2.6" />
    <path d="M6.6 17.4 10 9.6h4.4l3 7.8M10 9.6l-2.4-3" />
  </Glyph>
);
const WAREHOUSE = (
  <Glyph>
    <path d="M4.5 20.5V6.8L12 3.5l7.5 3.3v13.7" />
    <path d="M4.5 20.5h15" />
    <path d="M9.4 20.5v-4.6h5.2v4.6" />
  </Glyph>
);
const ALERT = (
  <Glyph>
    <path d="M12 4.2 21 20H3z" />
    <path d="M12 10.5v4M12 17.4h.01" />
  </Glyph>
);
const CALENDAR = (
  <Glyph>
    <rect x="3.5" y="5" width="17" height="15" rx="1.8" />
    <path d="M3.5 9.5h17M8 3v4M16 3v4" />
  </Glyph>
);
const PIN = (
  <Glyph>
    <path d="M12 21s-6.5-6.1-6.5-11A6.5 6.5 0 0 1 18.5 10c0 4.9-6.5 11-6.5 11z" />
    <circle cx="12" cy="10" r="2.3" />
  </Glyph>
);
const PENCIL = (
  <Glyph>
    <path d="M4 20l1-4.4L15.6 5l3.4 3.4L8.4 19z" />
    <path d="m13.6 6.6 3.8 3.8" />
  </Glyph>
);
const FUNNEL = (
  <Glyph>
    <path d="M4 4.5h16l-6 7.5v6l-4 2v-8z" />
  </Glyph>
);
const WRENCH = (
  <Glyph>
    <path d="M14.7 9.3a4 4 0 0 1-5.3 5.3L4 20l-1.4-1.4 5.4-5.4a4 4 0 0 1 5.3-5.3l-2.6 2.6 1.4 1.4z" />
  </Glyph>
);
const RELOOP = (
  <Glyph>
    <path d="M4.5 12a7.5 7.5 0 0 1 12.6-5.5M19.5 12a7.5 7.5 0 0 1-12.6 5.5" />
    <path d="M17.1 4.8v3.7h-3.7M6.9 19.2v-3.7h3.7" />
  </Glyph>
);
const BARCHART = (
  <Glyph>
    <path d="M4 20V10M12 20V4M20 20v-7" />
  </Glyph>
);
const PAYOUT = (
  <Glyph>
    <circle cx="12" cy="12" r="8.4" />
    <path d="M12 7.4V12l3.1 2" />
  </Glyph>
);
const LOCK_COIN = (
  <Glyph>
    <circle cx="12" cy="10.4" r="6" />
    <path d="M12 7.6v5.6M9.4 9.2h4.2M9.4 11.6h3.4" />
    <path d="M6.4 20.5h11.2" />
  </Glyph>
);
const DOWNLOAD = (
  <Glyph>
    <path d="M12 4v11M8 11.5l4 4 4-4" />
    <path d="M4.5 18.5h15" />
  </Glyph>
);
const GEAR = (
  <Glyph>
    <circle cx="12" cy="12" r="3.1" />
    <path d="M12 3.6v2.3M12 18.1v2.3M20.4 12h-2.3M5.9 12H3.6M17.7 6.3l-1.6 1.6M7.9 16.1l-1.6 1.6M17.7 17.7l-1.6-1.6M7.9 7.9 6.3 6.3" />
  </Glyph>
);
const PEOPLE = (
  <Glyph>
    <circle cx="9.4" cy="8.6" r="3.2" />
    <path d="M3.4 19.6c0-3.3 2.7-5.6 6-5.6s6 2.3 6 5.6" />
    <path d="M16.4 5.9a3 3 0 0 1 0 5.8" />
    <path d="M18 14.6c1.7.8 2.8 2.4 2.8 4.4" />
  </Glyph>
);
const SLIDERS = (
  <Glyph>
    <path d="M5 5v6M5 15v4M12 5v2M12 11v8M19 5v10M19 19v0" />
    <circle cx="5" cy="12.5" r="1.8" />
    <circle cx="12" cy="9.5" r="1.8" />
    <circle cx="19" cy="17" r="1.8" />
  </Glyph>
);
const FLAG = (
  <Glyph>
    <path d="M5 3.5v17" />
    <path d="M5 4.5h13l-3 4 3 4H5" />
  </Glyph>
);
const AUDIT = (
  <Glyph>
    <path d="M4 6h16M4 12h16M4 18h10" />
    <circle cx="18" cy="18" r="2.6" />
  </Glyph>
);

const OPS_GLYPHS: Record<string, React.JSX.Element> = {
  '/kyc': SHIELD_CHECK,
  '/catalog': GRID,
  '/catalog/condition-images': IMAGE,
  '/catalog/sku-requests': QUEUE,
  '/pricing/rules': TAG,
  '/orders': DOCUMENT,
  '/demand/credit': WALLET,
  '/procurement/pos': DOCUMENT,
  '/fulfilment/shipments': TRUCK,
  '/fulfilment/pickups': BOX_UP,
  '/fulfilment/riders': RIDER,
  '/fulfilment/carriers': WAREHOUSE,
  '/fulfilment/ndr': ALERT,
  '/listings/approvals': SHIELD_CHECK,
  '/qc/orders': QUEUE,
  '/supply/inspections': QUEUE,
  '/qc/visits': PIN,
  '/qc/schedule': CALENDAR,
  '/qc/grade-corrections': PENCIL,
  '/qc/sampling-rules': FUNNEL,
  '/qc/tool-providers': WRENCH,
  '/qc/audit-recheck': RELOOP,
  '/finance': BARCHART,
  '/finance/payables': WALLET,
  '/finance/payouts': PAYOUT,
  '/finance/escrow': LOCK_COIN,
  '/finance/exports': DOWNLOAD,
  '/platform/approvals': SHIELD_CHECK,
  '/platform/automation': GEAR,
  '/platform/users': PEOPLE,
  '/platform/config': SLIDERS,
  '/platform/flags': FLAG,
  '/platform/audit-log': AUDIT,
};

Object.assign(GLYPHS, OPS_GLYPHS);

const FALLBACK = (
  <Glyph>
    <circle cx="12" cy="12" r="7.4" />
  </Glyph>
);

export function RailIcon({ to }: { to: string }): React.JSX.Element {
  return GLYPHS[to] ?? FALLBACK;
}

const MAGNIFIER = (
  <Glyph>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m15.5 15.5 5 5" />
  </Glyph>
);

/** One glyph per ops domain, for the rail row that stands for all of its tabs. */
const OPS_DOMAIN_GLYPHS: Record<string, React.JSX.Element> = {
  onboarding: SHIELD_CHECK,
  catalog: GRID,
  demand: DOCUMENT,
  fulfilment: TRUCK,
  quality: MAGNIFIER,
  finance: BARCHART,
  platform: GEAR,
};

export function DomainIcon({ domainKey }: { domainKey: string }): React.JSX.Element {
  return OPS_DOMAIN_GLYPHS[domainKey] ?? FALLBACK;
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
