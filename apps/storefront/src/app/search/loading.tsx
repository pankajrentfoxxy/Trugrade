import { Skeleton } from '@trugrade/ui';
import { CategoryStrip } from '../CategoryStrip';

/**
 * The loading state, in the shape of the thing that is loading.
 *
 * Next renders this while the server component above it fetches, so it is the
 * real loading state of the real route rather than a spinner bolted on. It
 * holds the rail and grid geometry so the page does not jump when the results
 * land — a board that reflows on arrival makes the reader lose the row they had
 * their eye on.
 *
 * No counts, no placeholder numbers. A skeleton that shows "1,204" while
 * loading has fabricated a number, and the reader has already read it.
 */
export default function Loading(): React.JSX.Element {
  return (
    <>
      <CategoryStrip />
      <div className="body">
      <div className="wrap">
        <div className="cols">
          <aside className="filters" aria-hidden="true">
            <div className="fhead">
              <b>Filters</b>
            </div>
            <div className="fbody skrail">
              <Skeleton lines={14} />
            </div>
          </aside>
          <main>
            <div className="rbar">
              <span className="cnt" role="status">
                Searching sealed stock…
              </span>
            </div>
            <div className="pgrid" aria-hidden="true">
              {Array.from({ length: 8 }, (_, i) => (
                <div className="pc" key={i}>
                  <div className="im" />
                  <div className="bd">
                    <Skeleton lines={4} />
                  </div>
                </div>
              ))}
            </div>
          </main>
        </div>
        </div>
      </div>
    </>
  );
}
