'use client';

import * as React from 'react';
import {
  EmptyState,
  RecordHeader,
  SidePanel,
  Skeleton,
  StatusPill,
  Timeline,
  type TimelineEvent,
} from '@trugrade/ui';
import type { ApiFailure } from '../../../../register/api';
import { CLAIM_STATUS, FAULT_AREA_LABEL, getClaim, type ClaimView, type FaultArea } from '../../api';

/**
 * One claim. See `page.tsx` for the archetype and the rules.
 *
 * **The timeline is built only from dates the server sent.** A claim carries
 * three: raised, last updated, closed. Where the platform has not recorded a
 * step, no step is drawn — an invented "acknowledged" row would be the timeline
 * equivalent of a missing measurement rendered as a tick. When triage (T40)
 * starts writing claim events, this reads them instead of deriving three.
 */

type Phase =
  | { k: 'loading' }
  | { k: 'signed-out' }
  | { k: 'missing' }
  | { k: 'error'; message: string }
  | { k: 'ready'; claim: ClaimView };

const problem = (failure: ApiFailure): string =>
  failure.code === 'UNKNOWN' || failure.code === 'NETWORK'
    ? 'We could not reach this claim just now. That is our problem, not yours — the claim itself is unaffected.'
    : failure.message;

const isFaultArea = (v: string): v is FaultArea => v in FAULT_AREA_LABEL;

/** Statuses that mean nothing further will happen without the buyer. */
const TERMINAL = new Set(['CLOSED', 'REJECTED', 'REPLACEMENT_ISSUED', 'REFUND_ISSUED']);

export function ClaimRecord({ claimNumber }: { claimNumber: string }): React.JSX.Element {
  const [phase, setPhase] = React.useState<Phase>({ k: 'loading' });

  React.useEffect(() => {
    let live = true;
    void (async () => {
      const result = await getClaim(claimNumber);
      if (!live) return;
      if (result.ok) setPhase({ k: 'ready', claim: result.data });
      else if (result.status === 401) setPhase({ k: 'signed-out' });
      else if (result.status === 404 || result.status === 422) setPhase({ k: 'missing' });
      else setPhase({ k: 'error', message: problem(result) });
    })();
    return () => {
      live = false;
    };
  }, [claimNumber]);

  if (phase.k === 'loading') return <LoadingRecord />;
  if (phase.k === 'signed-out') return <SignedOut claimNumber={claimNumber} />;
  if (phase.k === 'missing') return <Missing claimNumber={claimNumber} />;
  if (phase.k === 'error') return <Failed message={phase.message} />;

  const c = phase.claim;
  const status = CLAIM_STATUS[c.status] ?? { label: c.status, tone: 'neutral' as const };
  const fault = isFaultArea(c.faultArea)
    ? FAULT_AREA_LABEL[c.faultArea]
    : { label: c.faultArea, hint: '' };

  const events: TimelineEvent[] = [
    {
      key: 'raised',
      action: 'Claim raised',
      actor: 'Your organisation',
      at: c.raisedOn,
      dateTime: c.raisedOn,
      detail: fault.label,
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
      // No date, because nothing has happened yet and inventing one would draw
      // a step that has not occurred.
      at: 'In progress',
      detail: 'We will write to you here and by email as it moves.',
      current: true,
    });
  }

  return (
    <>
      <RecordHeader
        title={fault.label}
        subtitle={c.title ?? 'Model no longer catalogued'}
        // The serial belongs among the identifiers rather than in the subtitle:
        // `RecordHeader` renders identifiers mono and tabular, which is what a
        // value somebody reads aloud off a case label needs to be.
        identifiers={[
          {
            label: 'Serial',
            value: c.serialNumber,
            href: c.passportPath || undefined,
          },
          { label: 'Claim', value: c.claimNumber },
          {
            label: 'Order',
            value: c.orderNumber || '—',
            href: c.orderNumber ? `/account/orders/${encodeURIComponent(c.orderNumber)}` : undefined,
          },
          { label: 'Raised', value: c.raisedOn },
        ]}
        status={<StatusPill tone={status.tone} label={status.label} />}
        className="crhead"
      />

      <div className="rec crrec">
        <main className="evid">
          <section className="crpanel" aria-labelledby="crfault">
            <h2 id="crfault">What you told us</h2>
            {/* The buyer's own words, verbatim. Nothing is summarised or
                rewritten — this text is what an engineer reads first. */}
            <p className="crdesc">{c.description}</p>
            <dl className="crfacts">
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
                    // Zero files is a real answer, not a missing one. It is said
                    // as a sentence rather than as "0", because "0" beside a
                    // heading reads as a failure to upload.
                    <span className="notmeasured">Nothing attached</span>
                  ) : (
                    <>
                      <span className="mono">{c.evidenceCount}</span>{' '}
                      <span className="denom">
                        {c.evidenceCount === 1 ? 'file' : 'files'}
                      </span>
                    </>
                  )}
                </dd>
              </div>
              <div>
                <dt>Resolution</dt>
                <dd>
                  {c.resolution ?? <span className="notmeasured">Not decided yet</span>}
                </dd>
              </div>
            </dl>
          </section>

          <section className="crpanel" aria-labelledby="crhist">
            <h2 id="crhist">History</h2>
            <Timeline events={events} label="Claim history" />
            <p className="fnote off">
              Only steps we have actually recorded appear here. We do not draw a stage that has not
              happened.
            </p>
          </section>
        </main>

        <SidePanel
          title="What happens next"
          description={
            TERMINAL.has(c.status)
              ? 'This claim is finished. If you disagree with the outcome, say so and it goes to a written decision.'
              : 'Our warranty team is working on this. You do not need to do anything until we ask.'
          }
          footnote={
            <>
              We are the seller and the warrantor. There is no supplier for you to contact about
              this machine, and we will never ask you to.
            </>
          }
          className="crside"
        >
          <a className="pill acc crside-a" href="/account/support">
            {TERMINAL.has(c.status) ? 'Dispute this outcome' : 'Add something to this claim'}
          </a>
          {c.passportPath && (
            <a className="pill wire crside-a" href={c.passportPath}>
              Open the machine&rsquo;s passport
            </a>
          )}
          <a className="pill wire crside-a" href="/account/warranty">
            Back to warranty
          </a>
        </SidePanel>
      </div>
    </>
  );
}

/* ==========================================================================
 * States that are not the record
 * ======================================================================== */

function LoadingRecord(): React.JSX.Element {
  return (
    <>
      <Skeleton className="h-24 w-full rounded-lg" />
      <div className="rec crrec">
        <main className="evid">
          <Skeleton className="h-48 w-full rounded-lg" />
          <Skeleton className="mt-4 h-56 w-full rounded-lg" />
        </main>
        <Skeleton className="h-56 w-full rounded-lg" />
      </div>
    </>
  );
}

function SignedOut({ claimNumber }: { claimNumber: string }): React.JSX.Element {
  return (
    <div className="ostate">
      <EmptyState
        title="Sign in to see this claim"
        body="A claim belongs to the organisation that raised it, so we need to know who is asking."
        action={
          <a
            className="pill acc"
            href={`/sign-in?next=${encodeURIComponent(`/account/warranty/claims/${claimNumber}`)}`}
          >
            Sign in
          </a>
        }
      />
    </div>
  );
}

/**
 * No such claim **on this account**.
 *
 * Deliberately the same screen for a claim that does not exist and one that
 * belongs to another organisation — the API answers 404 for both, because claim
 * numbers carry a month and a counter and distinguishing the two would let
 * anyone with an account count our claims.
 */
function Missing({ claimNumber }: { claimNumber: string }): React.JSX.Element {
  return (
    <div className="ostate">
      <EmptyState
        title="We have no claim with that number on your account"
        body={
          <>
            Nothing on your organisation&rsquo;s account is numbered{' '}
            <span className="mono">{claimNumber}</span>. Ours look like{' '}
            <span className="mono">TT-CLM-2608-4F2A91C3</span>. Check it against the email we sent,
            or open your warranty register to find it.
          </>
        }
        action={
          <a className="pill acc" href="/account/warranty">
            Your warranty register
          </a>
        }
      />
    </div>
  );
}

function Failed({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="ostate">
      <div className="empty err" role="alert">
        <h3>We could not read this claim</h3>
        <p>{message}</p>
        <p>The claim is unaffected — this is a screen that could not load, not a record that changed.</p>
        <p className="retry">
          <button type="button" className="pill acc" onClick={() => window.location.reload()}>
            Try again
          </button>
        </p>
      </div>
    </div>
  );
}
