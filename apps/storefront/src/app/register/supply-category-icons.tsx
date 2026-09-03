import * as React from 'react';

const iconProps = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export function BusinessLaptopIcon(): React.JSX.Element {
  return (
    <svg {...iconProps}>
      <rect x="3" y="7" width="14" height="10" rx="1.5" />
      <path d="M2 19h16" />
      <path d="M8 4h4v3H8z" />
      <path d="M10 4V2" />
    </svg>
  );
}

export function WorkstationIcon(): React.JSX.Element {
  return (
    <svg {...iconProps}>
      <rect x="3" y="6" width="18" height="12" rx="1.5" />
      <path d="M2 20h20" />
      <rect x="8" y="9" width="8" height="6" rx="1" />
      <path d="M10 12h4M10 14h2" />
    </svg>
  );
}

export function ConsumerLaptopIcon(): React.JSX.Element {
  return (
    <svg {...iconProps}>
      <rect x="4" y="6" width="16" height="11" rx="1.5" />
      <path d="M2 19h20" />
    </svg>
  );
}

export function MacBookIcon(): React.JSX.Element {
  return (
    <svg {...iconProps} fill="currentColor" stroke="none">
      <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  );
}

export function ChromebookIcon(): React.JSX.Element {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
    </svg>
  );
}

const ICONS: Record<string, () => React.JSX.Element> = {
  BUSINESS_LAPTOP: BusinessLaptopIcon,
  WORKSTATION: WorkstationIcon,
  CONSUMER: ConsumerLaptopIcon,
  MACBOOK: MacBookIcon,
  CHROMEBOOK: ChromebookIcon,
};

export function SupplyCategoryIcon({ code }: { code: string }): React.JSX.Element {
  const Icon = ICONS[code] ?? ConsumerLaptopIcon;
  return <Icon />;
}
