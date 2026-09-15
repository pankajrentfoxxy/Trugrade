import { Skeleton } from '@trugrade/ui';

/**
 * The route segment's loading state — the rail's shape and eight table rows.
 *
 * The approval board's own first paint uses `DataBoard`'s `loading` prop instead, which
 * keeps the real header and the real column names on screen while the rows
 * arrive. This is only what shows before the segment itself has rendered.
 */
export default function Loading(): React.JSX.Element {
  return (
    <div className="body">
      <div className="wrap">
        <div className="wshead obhead">
          <Skeleton className="h-9 w-64 rounded" />
        </div>
        <div className="cols">
          <Skeleton className="skrail" />
          <div>
            <Skeleton className="h-12 w-full rounded" />
            <Skeleton className="mt-3 h-96 w-full rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  );
}
