import { Skeleton } from '@trugrade/ui';
import { CategoryStrip } from '../../CategoryStrip';

/**
 * The loading state, in the shape of the record it is loading.
 *
 * No score, no grade, no tick, no bar at any width. A skeleton that draws a
 * filled progress bar has asserted a measurement before the measurement
 * arrived, and on this page that is the one thing the whole document exists to
 * prevent.
 */
export default function Loading(): React.JSX.Element {
  return (
    <>
      <CategoryStrip query="" />
      <div className="body">
        <div className="wrap passport">
          <div className="recskel" aria-hidden="true">
            <Skeleton lines={3} />
          </div>
          <div className="rec">
            <main className="evid">
              <div className="tbl" aria-hidden="true">
                <div className="tbh">
                  <b>Reading this machine&rsquo;s inspection…</b>
                </div>
                <div className="whybody">
                  <Skeleton lines={12} />
                </div>
              </div>
            </main>
            <div className="sidep" aria-hidden="true">
              <div className="tbl">
                <div className="tbh">
                  <b>Certificate</b>
                </div>
                <div className="whybody">
                  <Skeleton lines={6} />
                </div>
              </div>
            </div>
          </div>
          <p className="fnote" role="status">
            Reading the inspection this serial was sealed with…
          </p>
        </div>
      </div>
    </>
  );
}
