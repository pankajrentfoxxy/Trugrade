'use client';

import * as React from 'react';
import { RepresentativeImage, RepresentativeImageDisclosure } from '@trugrade/ui';
import type { Grade } from '@trugrade/contracts';
import type { ConditionImage, ResolvedImages } from '../../../lib/api';

/**
 * The condition photographs for the selected grade, in the sticky panel.
 *
 * One frame at a time, with the others as a column of thumbnails down its
 * left edge. Pointing at a thumbnail opens it — no click, and no arrows on the
 * frame, by direction: the strip is the one way through the set.
 *
 * Every frame still goes through `RepresentativeImage`, which is what stops
 * any of them being presented as the machine the buyer will receive; the
 * disclosure for the set sits under the strip, once, and the frame and every
 * thumbnail point at it through `aria-describedby`.
 */

/** What a frame is of, in a word, from the catalogue's view code. */
const VIEW_LABEL: Record<string, string> = {
  LID_TOP: 'Lid',
  LID_CLOSED: 'Lid',
  KEYBOARD: 'Keyboard',
  PALMREST: 'Palmrest',
  SCREEN: 'Screen',
  SCREEN_ON: 'Screen',
  UNDERSIDE: 'Underside',
  BOTTOM: 'Underside',
  LEFT_SIDE: 'Left edge',
  RIGHT_SIDE: 'Right edge',
  PORTS_LEFT: 'Left ports',
  PORTS_RIGHT: 'Right ports',
  HINGE: 'Hinge',
  SERIAL_LABEL: 'Serial label',
};

function viewLabel(code: string): string {
  const known = VIEW_LABEL[code];
  if (known) return known;
  const words = code.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Primary frame first, then the catalogue's own order. */
function ordered(frames: readonly ConditionImage[]): ConditionImage[] {
  return [...frames].sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return a.sortOrder - b.sortOrder;
  });
}

export function PanelGallery({
  images,
  grade,
  gradeLabel,
  machine,
  passportHref,
}: {
  images: ResolvedImages | null;
  grade: Grade;
  /** "A+", not "A_PLUS" — the badge on the frame. */
  gradeLabel: string;
  /** "Dell Latitude 5420" — for the placeholder's alt text. */
  machine: string;
  /** Where the real unit's photographs are, when there are units to point at. */
  passportHref?: string;
}): React.JSX.Element {
  const frames = React.useMemo(() => ordered(images?.images ?? []), [images]);
  const match = images?.match ?? 'SKU';
  const [index, setIndex] = React.useState(0);

  // A grade change swaps the whole set under the component. Start it again
  // from the primary frame rather than at whatever index the last set was on.
  React.useEffect(() => {
    setIndex(0);
  }, [frames]);

  const disclosureId = 'pv-frames-disclosure';
  const count = frames.length;
  const current = frames[Math.min(index, Math.max(count - 1, 0))];

  // The keys wrap, so the set reads as a loop the buyer can keep turning through.
  const step = (by: number): void => {
    setIndex((i) => (count === 0 ? 0 : (i + by + count) % count));
  };

  // Up and down follow the strip's own direction; left and right still work.
  const onKey = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      step(-1);
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      step(1);
    }
  };

  if (!current) {
    // Nothing catalogued for this grade. The placeholder says so in words and
    // carries its own caption; the panel keeps its badge and seal so the
    // frame does not read as broken.
    return (
      <div className="pv-img" data-empty="true">
        <div className="ph-big">
          <RepresentativeImage
            grade={grade}
            match="PLACEHOLDER"
            alt={`No photograph of Grade ${gradeLabel} condition for the ${machine}`}
            passportHref={passportHref}
          />
          {images?.placeholderReason ? <p className="pv-disc">{images.placeholderReason}</p> : null}
        </div>
      </div>
    );
  }

  return (
    /*
      One group for the frame, the arrows and the strip, with the keyboard
      handler on it: the arrow keys step frames once anything inside has
      focus — an arrow button or a thumbnail — not only the frame itself.
    */
    <div
      className="pv-gal"
      role="group"
      aria-label={`Condition photographs, Grade ${gradeLabel}`}
      onKeyDown={onKey}
    >
      <div className="pv-img">
        <RepresentativeImage
          key={current.id}
          src={current.url}
          alt={current.altText}
          grade={grade}
          match={match}
          passportHref={passportHref}
          captionedBy={disclosureId}
          className="gal-photo"
        />
        {/* Which view this is and where it sits in the set. Mono: it is a count. */}
        <span className="gal-count" aria-live="polite">
          {viewLabel(current.viewCode)}
          {count > 1 ? (
            <>
              {' '}
              &middot;{' '}
              <span className="mono tnum">
                {index + 1}/{count}
              </span>
            </>
          ) : null}
        </span>
      </div>

      {count > 1 ? (
        <ul className="gal-thumbs" aria-label="Frames">
          {frames.map((frame, i) => {
            const on = i === index;
            return (
              <li key={frame.id}>
                <button
                  type="button"
                  className={on ? 'th on' : 'th'}
                  aria-label={`${viewLabel(frame.viewCode)}, frame ${i + 1} of ${count}`}
                  aria-current={on ? 'true' : undefined}
                  aria-describedby={disclosureId}
                  // Pointing at a frame is enough to open it; focus and tap
                  // do the same for a keyboard or a touch screen.
                  onMouseEnter={() => setIndex(i)}
                  onFocus={() => setIndex(i)}
                  onClick={() => setIndex(i)}
                >
                  {/*
                    A plain <img> for the selector, `alt=""`: the frame above
                    is the photograph and carries the alt text; the thumbnail
                    is the button to reach it, and the button has the label.
                    The set's disclosure covers it through aria-describedby.
                  */}
                  <img src={frame.url} alt="" loading="lazy" decoding="async" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {/*
        The set's disclosure, read by assistive tech through aria-describedby on
        the frame and every thumbnail, but not drawn: the panel is the buyer's
        first sight of the machine and the sentence was taken off it by
        direction. It stays in the document so the component contract holds.
      */}
      <RepresentativeImageDisclosure
        id={disclosureId}
        grade={grade}
        match={match}
        count={count}
        passportHref={passportHref}
        className="sr-only"
      />
    </div>
  );
}
