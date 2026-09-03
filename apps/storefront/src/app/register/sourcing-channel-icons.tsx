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

export function CorporateBuybackIcon(): React.JSX.Element {
  return (
    <svg {...iconProps}>
      <path d="M3 21h18" />
      <path d="M5 21V7l7-4 7 4v14" />
      <path d="M9 11h6M9 15h6" />
      <path d="M12 3v4" />
    </svg>
  );
}

export function ItadContractIcon(): React.JSX.Element {
  return (
    <svg {...iconProps}>
      <path d="M7 4h10v16H7z" />
      <path d="M9 8h6M9 12h6M9 16h4" />
      <path d="M12 2v2M16 6l2-2M8 6L6 4" />
    </svg>
  );
}

export function LeaseReturnIcon(): React.JSX.Element {
  return (
    <svg {...iconProps}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
      <path d="M9 15l-2 2 2 2M15 15l2 2-2 2" />
    </svg>
  );
}

export function AuctionIcon(): React.JSX.Element {
  return (
    <svg {...iconProps}>
      <path d="M14 4l6 6-8 8H6v-6z" />
      <path d="M12 6l2 2M8 14l2 2" />
      <path d="M4 20h16" />
    </svg>
  );
}

export function ImportIcon(): React.JSX.Element {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="9" />
      <path d="M2 12h20M12 3a15 15 0 0 1 4 9 15 15 0 0 1-4 9 15 15 0 0 1-4-9 15 15 0 0 1 4-9z" />
      <path d="M16 16l4 3M4 19l4-3" />
    </svg>
  );
}

export function OemRefurbIcon(): React.JSX.Element {
  return (
    <svg {...iconProps}>
      <path d="M3 10h18v10H3z" />
      <path d="M7 10V6h10v4" />
      <path d="M12 14v4M9 16h6" />
      <path d="M18 4l2 2-2 2" />
    </svg>
  );
}

export function RetailReturnIcon(): React.JSX.Element {
  return (
    <svg {...iconProps}>
      <path d="M6 8h15l-1.5 9H7.5z" />
      <path d="M6 8L5 4H2" />
      <path d="M10 13l-2 2 2 2M14 13l2 2-2 2" />
    </svg>
  );
}

export function TradeInIcon(): React.JSX.Element {
  return (
    <svg {...iconProps}>
      <rect x="4" y="8" width="16" height="10" rx="1.5" />
      <path d="M2 20h20" />
      <path d="M9 12h6M12 12v4" />
      <path d="M16 5l2-2 2 2M18 3v4" />
    </svg>
  );
}

const ICONS: Record<string, () => React.JSX.Element> = {
  CORPORATE_BUYBACK: CorporateBuybackIcon,
  ITAD_CONTRACT: ItadContractIcon,
  LEASE_RETURN: LeaseReturnIcon,
  AUCTION: AuctionIcon,
  IMPORT: ImportIcon,
  OEM_REFURB: OemRefurbIcon,
  RETAIL_RETURN: RetailReturnIcon,
  TRADE_IN: TradeInIcon,
};

export function SourcingChannelIcon({ code }: { code: string }): React.JSX.Element {
  const Icon = ICONS[code] ?? CorporateBuybackIcon;
  return <Icon />;
}
