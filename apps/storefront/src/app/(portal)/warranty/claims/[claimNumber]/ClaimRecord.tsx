'use client';

import * as React from 'react';
import type { TimelineEvent } from '@trugrade/ui';
import { CaseRecord, type CaseKind } from '../../../cases/CaseRecord';
import {
  CLAIM_STATUS,
  FAULT_AREA_LABEL,
  getClaim,
  type ClaimView,
  type FaultArea,
} from '../../api';

/**
 * One warranty claim, as a case. See `page.tsx` for the archetype and the rules.
 *
 * This file was 317 lines and shared roughly 140 of them, character for
 * character, with the return record. What is left is only what a claim is and a
 * return is not: its fault area, the evidence attached to it, and the fact that
 * we are both the seller and the warrantor.
 *
 * **The timeline is built only from dates the server sent.** A claim carries
 * three: raised, last updated, closed. Where the platform has not recorded a
 * step, no step is drawn — an invented "acknowledged" row would be the timeline
 * equivalent of a missing measurement rendered as a tick. When triage (T40)
 * starts writing claim events, this reads them instead of deriving three.
 */

const isFaultArea = (v: string): v is FaultArea => v in FAULT_AREA_LABEL;

const faultOf = (c: ClaimView): { label: string; hint: string } =>
  isFaultArea(c.faultArea) ? FAULT_AREA_LABEL[c.faultArea] : { label: c.faultArea, hint: '' };

/** Statuses that mean nothing further will happen without the buyer. */
const TERMINAL = new Set(['CLOSED', 'REJECTED', 'REPLACEMENT_ISSUED', 'REFUND_ISSUED']);

const CLAIM: CaseKind<ClaimView> = {
  noun: 'claim',
  list: { href: '/warranty', label: 'Back to warranty' },
  numberExample: 'TT-WCL-2609-8B31D7A4',

  identity: (c) => ({
    title: faultOf(c).label,
    subtitle: c.title ?? 'Model no longer catalogued',
    number: c.claimNumber,
    serialNumber: c.serialNumber,
    orderNumber: c.orderNumber,
    raisedOn: c.raisedOn,
    passportPath: c.passportPath,
  }),

  status: (c) => CLAIM_STATUS[c.status] ?? { label: c.status, tone: 'neutral' },

  description: (c) => c.description,

  facts: (c) => {
    const fault = faultOf(c);
    return (
      <>
        <div>
          <dt>Fault area</dt>
          <dd>
            {fault.label}
            {fault.hint && <span className="denom"> — {fault.hint}</span>}
          </dd>
        </div>
        <div>
          <dt>Evidence attached</dt>
          <dd>
            {c.evidenceCount === 0 ? (
              // Zero files is a real answer, not a missing one. It is said as a
              // sentence rather than as "0", because "0" beside a heading reads
              // as a failure to upload.
              <span className="notmeasured">Nothing attached</span>
            ) : (
              <>
                <span className="mono">{c.evidenceCount}</span>{' '}
                <span className="denom">{c.evidenceCount === 1 ? 'file' : 'files'}</span>
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>Resolution</dt>
          <dd>{c.resolution ?? <span className="notmeasured">Not decided yet</span>}</dd>
        </div>
      </>
    );
  },

  events: (c) => {
    const status = CLAIM_STATUS[c.status] ?? { label: c.status, tone: 'neutral' as const };
    const events: TimelineEvent[] = [
      {
        key: 'raised',
        action: 'Claim raised',
        actor: 'Your organisation',
        at: c.raisedOn,
        dateTime: c.raisedOn,
        detail: faultOf(c).label,
      },
    ];
    // Only when it actually moved. Two identical dates would draw a step that
    // never happened.
    if (c.updatedOn !== c.raisedOn) {
      events.push({
        key: 'updated',
        action: status.label,
        actor: 'Trugrade',
        at: c.updatedOn,
        dateTime: c.updatedOn,
      });
    }
    if (c.closedOn) {
      events.push({
        key: 'closed',
        action: 'Closed',
        actor: 'Trugrade',
        at: c.closedOn,
        dateTime: c.closedOn,
        detail: c.resolution ? `Resolution: ${c.resolution}` : undefined,
      });
    } else {
      events.push({
        key: 'current',
        action: 'With our warranty team',
        actor: 'Trugrade',
        // No date, because nothing has happened yet and inventing one would
        // draw a step that has not occurred.
        at: 'In progress',
        detail: 'We will write to you here and by email as it moves.',
        current: true,
      });
    }
    return events;
  },

  historyNote:
    'Only steps we have actually recorded appear here. We do not draw a stage that has not happened.',

  settled: (c) => TERMINAL.has(c.status),

  next: (c) => ({
    description: TERMINAL.has(c.status)
      ? 'This claim is finished. If you disagree with the outcome, say so and it goes to a written decision.'
      : 'Our warranty team is working on this. You do not need to do anything until we ask.',
    footnote: (
      <>
        We are the seller and the warrantor. There is no supplier for you to contact about this
        machine, and we will never ask you to.
      </>
    ),
  }),
};

export function ClaimRecord({ claimNumber }: { claimNumber: string }): React.JSX.Element {
  return <CaseRecord caseNumber={claimNumber} kind={CLAIM} load={getClaim} />;
}
