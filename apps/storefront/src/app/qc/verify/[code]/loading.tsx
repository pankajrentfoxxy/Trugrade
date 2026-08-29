import { Skeleton } from '@trugrade/ui';
import { AuthShell } from '../../../AuthShell';

/**
 * The loading state, in the shape of the answer it is loading.
 *
 * **No verdict word, no colour, no tick, no seal code.** A skeleton that draws a
 * green block where PASS is about to appear has answered the question before the
 * answer arrived, and somebody glancing at a phone in a warehouse would read it.
 * The block is neutral and says out loud that it is still reading.
 */
export default function Loading(): React.JSX.Element {
  return (
    <AuthShell
      wide
      title="Certificate check"
      lede="Scanned from the report that travels with the machine. This is what we hold against that code."
    >
      <div className="verify">
        <div className="vdict none" role="status">
          <span className="vkick">Checking</span>
          <strong className="vbig sentence">
            <span className="notmeasured">Reading our record of this code…</span>
          </strong>
        </div>
        <div className="vskel" aria-hidden="true">
          <Skeleton lines={8} />
        </div>
      </div>
    </AuthShell>
  );
}
