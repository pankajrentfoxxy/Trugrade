/**
 * "Delivery by Sat, 3 Oct", under a card's price. Renders nothing without a
 * date — see `lib/delivery-date.ts` for where the date comes from.
 */
export function DeliveryBy({
  date,
  className,
}: {
  date: string | null | undefined;
  className: string;
}): React.JSX.Element | null {
  if (!date) return null;
  return (
    <p className={className}>
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M2.5 6.5h11v9h-11zM13.5 9.5h4l3 3v3h-7" />
        <circle cx="7" cy="17.5" r="1.8" />
        <circle cx="17" cy="17.5" r="1.8" />
      </svg>
      <span>
        Delivery by <b>{date}</b>
      </span>
    </p>
  );
}
