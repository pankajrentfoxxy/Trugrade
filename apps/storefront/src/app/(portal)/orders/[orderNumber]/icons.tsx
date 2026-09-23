import * as React from 'react';

/** Stroke only, inherit colour, never carry meaning on their own. */
const svg = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true as const,
};

export function DownloadIcon(): React.JSX.Element {
  return (
    <svg {...svg}>
      <path d="M12 4v11" />
      <path d="M7 10l5 5 5-5" />
      <path d="M5 20h14" />
    </svg>
  );
}

export function TickIcon(): React.JSX.Element {
  return (
    <svg {...svg} width={14} height={14} strokeWidth={3}>
      <path d="M5 12l5 5 9-10" />
    </svg>
  );
}

export function InfoIcon(): React.JSX.Element {
  return (
    <svg {...svg} width={20} height={20} strokeWidth={1.8}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5" />
      <path d="M12 16.5v.01" />
    </svg>
  );
}

export function LaptopIcon(): React.JSX.Element {
  return (
    <svg {...svg} width={28} height={28} strokeWidth={1.6}>
      <rect x="4" y="5" width="16" height="11" rx="1.5" />
      <path d="M2 19h20" />
    </svg>
  );
}

export function PinIcon(): React.JSX.Element {
  return (
    <svg {...svg} strokeWidth={1.8}>
      <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </svg>
  );
}

export function FileIcon(): React.JSX.Element {
  return (
    <svg {...svg} width={18} height={18} strokeWidth={1.8}>
      <path d="M14 3H6v18h12V7z" />
      <path d="M14 3v4h4" />
    </svg>
  );
}

export function LinesIcon(): React.JSX.Element {
  return (
    <svg {...svg} width={18} height={18} strokeWidth={1.8}>
      <path d="M4 7h16M4 12h10M4 17h7" />
    </svg>
  );
}
