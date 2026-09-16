'use client';

import * as React from 'react';
import { HubPageHeader, WhyRail, type WhyRailItem } from '@trugrade/ui';
import type { ApiFailure } from '../../register/api';

/**
 * ARCHETYPE D — Flow. The shell both case forms share, and only that.
 *
 * **A deliberate half-merge, and the measurement behind it.** The two case
 * RECORDS were one screen: around 140 of their ~300 lines were identical apart
 * from one noun, and their layout was the same layout, so `CaseRecord` takes
 * the whole screen and the callers describe only what differs.
 *
 * The two FORMS are not one form. Counting substantive lines that appear in
 * both after normalising the noun: 76 shared against 278 unique. A return picks
 * several machines off one order with a checklist, inside an inspection window
 * that can refuse it; a claim picks one machine off everything the buyer owns,
 * with a fault area and no window at all. Parameterising that into one
 * component would mean passing the picker, the picklist, the field set, the
 * validation and the submit as props — the entire form as configuration, which
 * is the abstraction that is worse than the duplication it replaces.
 *
 * So what is genuinely shared is shared, and what is genuinely different is
 * left alone: the focus frame, the two-column flow with its "why we ask" rail,
 * and the refusal — which was character-identical in both files apart from the
 * noun, and is the piece most likely to drift, because a refusal is edited when
 * somebody complains about the wording.
 */

export interface CaseFormShellProps {
  title: string;
  subtitle: string;
  /** The `<form>`'s own class — `rnform` or `claimform`. */
  formClassName: string;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  /** The server's refusal, rendered verbatim. */
  refusal: ApiFailure | null;
  /** What this case is called mid-sentence: "return", "claim". */
  noun: string;
  /** The right rail's entries, and the term whose field has focus. */
  why: readonly WhyRailItem[];
  /** Undefined until a field takes focus, which is the rail's own resting state. */
  activeTerm: string | undefined;
  children: React.ReactNode;
}

export function CaseFormShell({
  title,
  subtitle,
  formClassName,
  onSubmit,
  refusal,
  noun,
  why,
  activeTerm,
  children,
}: CaseFormShellProps): React.JSX.Element {
  return (
    <>
      <HubPageHeader title={title} subtitle={subtitle} />

      <div className="flow2">
        <form className={formClassName} onSubmit={onSubmit} noValidate>
          {refusal && <Refusal failure={refusal} noun={noun} />}
          {children}
        </form>

        {/* The return form already reused the claim form's stylesheet class for
            this rail — `claimwhy` on both — which is how two screens tell you
            they are one. */}
        <WhyRail items={why} title="Why we ask" activeTerm={activeTerm} className="claimwhy" />
      </div>
    </>
  );
}

/**
 * The server's refusal, word for word.
 *
 * Never inspected and never rewritten: the API's sentence names what failed and
 * how to fix it, and a client that paraphrases it turns a specific instruction
 * into "something went wrong".
 */
export function Refusal({
  failure,
  noun,
}: {
  failure: ApiFailure;
  noun: string;
}): React.JSX.Element {
  return (
    <div className="cfrefusal" role="alert">
      <h2>We could not raise this {noun}</h2>
      <p>{failure.message}</p>
      {Object.entries(failure.fields).map(([field, message]) => (
        <p key={field} className="f">
          {message}
        </p>
      ))}
    </div>
  );
}
