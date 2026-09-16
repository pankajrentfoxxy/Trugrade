'use client';

import * as React from 'react';
import type { TimelineEvent } from '@trugrade/ui';
import { CaseRecord, type CaseKind } from '../../cases/CaseRecord';
import { getReturn, RETURN_STATUS, type ReturnView } from '../api';

/**
 * One return, as a case. See `page.tsx` for the archetype and the rules.
 *
 * This file was 299 lines and shared roughly 140 of them, character for
 * character, with the warranty claim record. What is left is only what a return
 * is and a claim is not: its reason, the evidence it still owes, and the
 * take-back that is ours under Rule 7(4).
 */

const RETURN: CaseKind<ReturnView> = {
  noun: 'return',
  list: { href: '/returns', label: 'All your returns' },
  numberExample: 'TT-RET-2608-4F2A91C3',

  identity: (r) => ({
    title: r.reasonLabel,
    subtitle: r.title ?? 'Model no longer catalogued',
    number: r.returnNumber,
    serialNumber: r.serialNumber,
    orderNumber: r.orderNumber,
    raisedOn: r.raisedOn,
    passportPath: r.passportPath,
  }),

  status: (r) => RETURN_STATUS[r.status] ?? { label: r.status, tone: 'neutral' },

  description: (r) => r.description,

  facts: (r) => (
    <>
      <div>
        <dt>Reason</dt>
        <dd>{r.reasonLabel}</dd>
      </div>
      <div>
        <dt>Evidence</dt>
        <dd>
          {r.evidenceCount === 0 && r.evidenceRequired === 0 ? (
            <span className="notmeasured">None needed for this reason</span>
          ) : (
            <>
              <span className="mono">{r.evidenceCount}</span>{' '}
              <span className="denom">
                of {r.evidenceRequired || r.evidenceCount}{' '}
                {r.evidenceRequired === 1 ? 'photograph' : 'photographs'}
              </span>
              {r.evidenceStillNeeded > 0 && (
                // A shortfall is a shortfall and is never drawn as a complete
                // file. It says what is missing and who will ask for it, rather
                // than a red border on a control that does not exist yet.
                <span className="rrneed">
                  We still need <span className="mono">{r.evidenceStillNeeded}</span>. We will ask
                  you by email — there is no upload on this screen yet, and that is our gap rather
                  than something you have failed to do.
                </span>
              )}
            </>
          )}
        </dd>
      </div>
      <div>
        <dt>Outcome</dt>
        <dd>{r.resolution ?? <span className="notmeasured">Not decided yet</span>}</dd>
      </div>
    </>
  ),

  /**
   * ONE recorded step, because one instant is all the platform has.
   *
   * The second entry carries no date at all — it is what is happening, not a
   * stage that has been reached, and giving it a date would be inventing one.
   */
  events: (r) => {
    const status = RETURN_STATUS[r.status] ?? { label: r.status, tone: 'neutral' as const };
    const events: TimelineEvent[] = [
      {
        key: 'raised',
        action: 'Return raised',
        actor: 'Your organisation',
        at: r.raisedOn,
        dateTime: r.raisedOn,
        detail: r.reasonLabel,
      },
    ];
    if (r.open) {
      events.push({
        key: 'current',
        action: status.label,
        actor: 'Trugrade',
        at: 'In progress',
        detail: 'We will write to you here and by email as it moves. Nothing is waiting on you.',
        current: true,
      });
    } else {
      events.push({
        key: 'closed',
        action: status.label,
        actor: 'Trugrade',
        at: r.raisedOn,
        dateTime: r.raisedOn,
        detail: r.resolution ? `Outcome: ${r.resolution}` : undefined,
      });
    }
    return events;
  },

  historyNote:
    'Only steps we have actually recorded appear here. Collection, receipt and the inspection on return are not on this timeline because nothing on the platform writes them yet — we do not draw a stage that has not happened.',

  settled: (r) => !r.open,

  next: (r) => ({
    description: r.open
      ? 'We collect the machine at our cost, inspect it against the report it was sold under, and refund or replace it.'
      : 'This return is finished. If you disagree with the outcome, say so and it goes to a written decision.',
    footnote: (
      <>
        Take-back under Rule 7(4) is ours and cannot be passed on. We bought the machine, we sold it
        to you on our own invoice, and we settle this ourselves — there is nobody else for you to
        contact about it.
      </>
    ),
  }),
};

export function ReturnRecord({ returnNumber }: { returnNumber: string }): React.JSX.Element {
  return <CaseRecord caseNumber={returnNumber} kind={RETURN} load={getReturn} />;
}
