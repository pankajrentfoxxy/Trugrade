'use client';

import * as React from 'react';

/**
 * The carton being packed, beside the confirmation copy.
 *
 * Plays once on load: the laptop lowers into the open carton, the flaps fold,
 * tape rolls across the seam, the label with THIS order number stamps on, the
 * box seats with a small bounce, confetti bursts and a chip rises. Then a slow
 * idle bob. Click to replay — the rig is remounted, which restarts every
 * keyframe from zero without any timeline bookkeeping.
 *
 * **Everything printed on the box is a fact from the order.** The label
 * carries the order number and the site it ships to; the chip says how many
 * machines are on it. It does not say "dispatch in 48 h" — nothing has been
 * picked yet, and a promise drawn on a cartoon carton is still a promise.
 * Under reduced motion the finished state is drawn at once, with no confetti.
 */
export function PackedScene({
  orderNumber,
  shipTo,
  chip,
}: {
  orderNumber: string;
  /** "Your site" when the delivery address has no label. */
  shipTo: string;
  /** The rising chip: "1 MACHINE", or "HELD FOR APPROVAL". */
  chip: string;
}): React.JSX.Element {
  const [run, setRun] = React.useState(0);

  return (
    <div
      className="ck-scene"
      role="img"
      aria-label={`A carton being packed and labelled with order ${orderNumber}`}
    >
      <button
        type="button"
        className="ck-scene-replay"
        onClick={() => setRun((n) => n + 1)}
        aria-label="Replay the packing animation"
      >
        {/* `key` remounts the rig, so every CSS animation starts again. */}
        <div className="ck-rig" key={run} aria-hidden="true">
          <div className="ck-minilap">
            <div className="ck-minilap-scr">
              <i />
            </div>
            <div className="ck-minilap-base" />
          </div>

          <div className="ck-boxx">
            <div className="ck-bx-front" />
            <span className="ck-bx-inner" />
            <span className="ck-flap ck-flap-l" />
            <span className="ck-flap ck-flap-r" />
            <span className="ck-lid" />
            <span className="ck-tape" />
            <div className="ck-lbl">
              <small>SHIP TO · {shipTo.toUpperCase()}</small>
              <b className="tnum">{orderNumber}</b>
              <div className="ck-lbl-bars" />
            </div>
            <span className="ck-frg">HANDLE WITH CARE</span>
            <span className="ck-chip tnum">{chip}</span>
          </div>

          {Array.from({ length: 8 }, (_, i) => (
            <span key={i} className={`ck-conf ck-conf-${i + 1}`} />
          ))}
        </div>
        <span className="ck-replay-hint">Click to replay</span>
      </button>
    </div>
  );
}
