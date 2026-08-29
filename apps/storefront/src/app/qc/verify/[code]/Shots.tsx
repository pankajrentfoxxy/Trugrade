'use client';

import * as React from 'react';
import { RateLimitNotice, ViewfinderFrame } from '@trugrade/ui';
import type { UnitPassport } from '../../../../lib/api';

/**
 * The two interactive pieces of the verification screen.
 *
 * Both live in one client module because both are small and both exist for the
 * same reason: the page around them is a server component and neither a
 * `<dialog>` nor a ticking countdown can be one.
 */

const ANGLE_LABEL: Record<string, string> = {
  LID: 'Lid',
  PALMREST: 'Palmrest and keyboard',
  SCREEN_ON: 'Screen, powered on',
  BASE: 'Base',
  PORTS: 'Ports',
  WORST_DEFECT: 'Worst defect found',
};

type Photo = UnitPassport['photos'][number];

/**
 * The photographs, zoomable — because they are being compared to an object.
 *
 * The person reading this is holding the machine. A thumbnail is enough to know
 * a picture exists and useless for "is that scratch the scratch in the photo",
 * which is the only question they are actually asking of it. So a tap opens the
 * picture full-screen, and a second tap goes to 1:1 with the frame scrolling
 * under it.
 *
 * `<dialog>` rather than a hand-rolled overlay: the browser gives Escape, the
 * focus trap, the inert background and the backdrop for nothing. A modal built
 * out of a fixed `div` gives none of those and has to reimplement all four.
 *
 * No viewfinder brackets in the zoom. The brackets assert *this unit was
 * captured and identified* and they carry the serial to prove it; at full
 * screen the serial is printed under the picture in full instead, which is the
 * same claim said larger rather than the motif used twice.
 */
export function Shots({
  photos,
  serial,
}: {
  photos: Photo[];
  serial: string;
}): React.JSX.Element {
  const dialog = React.useRef<HTMLDialogElement>(null);
  const [shown, setShown] = React.useState<Photo | null>(null);
  const [zoomed, setZoomed] = React.useState(false);

  const open = (photo: Photo): void => {
    setShown(photo);
    setZoomed(false);
    dialog.current?.showModal();
  };

  return (
    <>
      <div className="vshots">
        {photos.map((photo) => (
          <button type="button" className="vshot" key={photo.angle} onClick={() => open(photo)}>
            <ViewfinderFrame serial={serial}>
              {/*
                A plain <img>, not next/image: the URL is an opaque signed token
                that expires in 900 seconds, and an optimiser would cache the
                picture behind a key that stops resolving. Same reasoning as the
                passport, which is where this constraint is documented at length.
              */}
              <img
                src={photo.url}
                alt={`${ANGLE_LABEL[photo.angle] ?? photo.angle} of unit ${serial}, photographed at inspection`}
                loading="lazy"
              />
            </ViewfinderFrame>
            <span className="ang">
              {ANGLE_LABEL[photo.angle] ?? photo.angle}
              <span className="denom"> tap to zoom</span>
            </span>
          </button>
        ))}
      </div>

      <dialog
        className="vzoom"
        ref={dialog}
        aria-label={shown ? `${ANGLE_LABEL[shown.angle] ?? shown.angle} of unit ${serial}` : ''}
        onClose={() => setShown(null)}
        // Clicking the backdrop is a click on the dialog element itself; a click
        // on anything inside it has that inner element as its target.
        onClick={(e) => {
          if (e.target === dialog.current) dialog.current?.close();
        }}
      >
        {shown && (
          <>
            <div className="vzoomhead">
              <span className="l">
                <b>{ANGLE_LABEL[shown.angle] ?? shown.angle}</b>
                <span className="mono">{serial}</span>
              </span>
              <button type="button" className="sel gh" onClick={() => dialog.current?.close()}>
                Close
              </button>
            </div>
            <div className={zoomed ? 'vzoombody z' : 'vzoombody'}>
              <img
                src={shown.url}
                alt={`${ANGLE_LABEL[shown.angle] ?? shown.angle} of unit ${serial}, photographed at inspection`}
                onClick={() => setZoomed((z) => !z)}
              />
            </div>
            <p className="fnote">
              {zoomed ? 'Tap the picture to fit it to the screen.' : 'Tap the picture for 1:1.'} On
              a phone you can pinch to zoom further.
            </p>
          </>
        )}
      </dialog>
    </>
  );
}

/**
 * The wait, ticking. `RateLimitNotice` is a client component and this screen is
 * not, so this is the seam — nothing else.
 */
export function Waiting({
  message,
  retryAfterSeconds,
}: {
  message: string;
  retryAfterSeconds: number | null;
}): React.JSX.Element {
  return <RateLimitNotice message={message} retryAfterSeconds={retryAfterSeconds} />;
}
