/**
 * The line icons of the product record's right column: the offer tag, the
 * delivery truck and the three promises. Stroke only, in `currentColor`, so
 * each takes the ink of the line it sits on.
 */
function Icon({ children, size = 18 }: { children: React.ReactNode; size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function TagIcon(): React.JSX.Element {
  return (
    <Icon size={15}>
      <path d="M3 12V4h8l9.3 9.3a1 1 0 0 1 0 1.4l-6.6 6.6a1 1 0 0 1-1.4 0z" />
      <circle cx="7.5" cy="8.5" r="1.3" />
    </Icon>
  );
}

export function TruckIcon(): React.JSX.Element {
  return (
    <Icon size={16}>
      <path d="M2.5 6.5h11v9h-11zM13.5 9.5h4l3 3v3h-7" />
      <circle cx="7" cy="17.5" r="1.8" />
      <circle cx="17" cy="17.5" r="1.8" />
    </Icon>
  );
}

export function ShieldIcon(): React.JSX.Element {
  return (
    <Icon size={20}>
      <path d="M12 3 5 6v5c0 4.4 3 8.3 7 10 4-1.7 7-5.6 7-10V6z" />
      <path d="m9 12 2 2 4-4" />
    </Icon>
  );
}

export function ClockIcon(): React.JSX.Element {
  return (
    <Icon size={20}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Icon>
  );
}

export function ReturnIcon(): React.JSX.Element {
  return (
    <Icon size={20}>
      <path d="M3 12a9 9 0 1 0 2.6-6.4" />
      <path d="M3 4v5h5" />
    </Icon>
  );
}
