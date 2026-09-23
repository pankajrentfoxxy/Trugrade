import { Skeleton } from '@trugrade/ui';

/**
 * The route segment's loading state — the heading, the figure row and the table.
 *
 * The board's own first paint uses `DataBoard`'s `loading` prop instead, which
 * keeps the real column names on screen while the rows arrive. This is only what
 * shows before the segment itself has rendered.
 */
export default function Loading(): React.JSX.Element {
  return (
    <div className="hub-page" aria-busy="true">
      <Skeleton className="h-28 w-full rounded-xl" />
      <Skeleton className="h-96 w-full rounded-xl" />
    </div>
  );
}
