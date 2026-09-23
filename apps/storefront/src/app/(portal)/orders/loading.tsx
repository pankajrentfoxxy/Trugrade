import { Skeleton } from '@trugrade/ui';

/**
 * The route segment's loading state — the board's shape: title, four status
 * tabs, the toolbar and eight table rows.
 *
 * The board's own first paint uses `DataBoard`'s `loading` prop instead, which
 * keeps the real header and the real column names on screen while the rows
 * arrive. This is only what shows before the segment itself has rendered.
 */
export default function Loading(): React.JSX.Element {
  return (
    <div className="hub-page">
      <div className="ol" aria-busy="true">
        <div>
          <Skeleton className="h-9 w-40 rounded" />
          <Skeleton className="mt-2 h-4 w-64 rounded" />
        </div>
        <div className="ol-tabs">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-11 w-full rounded-lg" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    </div>
  );
}
