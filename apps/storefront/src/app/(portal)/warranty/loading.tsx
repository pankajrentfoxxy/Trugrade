import { Skeleton } from '@trugrade/ui';

/**
 * The route segment's loading state — heading, figure row, filter bar, table.
 *
 * The board's own first paint uses `DataBoard`'s `loading` prop instead, which
 * keeps the real column names on screen while the rows arrive. This is only what
 * shows before the segment itself has rendered.
 */
export default function Loading(): React.JSX.Element {
  return (
    <div className="body">
      <div className="wrap">
        <div className="wshead wthead">
          <Skeleton className="h-9 w-64 rounded" />
        </div>
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="mt-4 h-12 w-full rounded" />
        <Skeleton className="mt-3 h-96 w-full rounded-lg" />
      </div>
    </div>
  );
}
