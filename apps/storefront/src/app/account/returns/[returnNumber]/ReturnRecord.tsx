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
import type { ApiFailure } from '../../../register/api';
import { getReturn, RETURN_STATUS, type ReturnView } from '../api';

/**
 * One return. See `page.tsx` for the archetype and the rules.
 *
 * A client component because the call is authenticated and can come back 401,
 * and because a return that is not this organisation's comes back 404 — which is
 * a screen, not a crash.
 */

type Phase =
  | { k: 'loading' }
  | { k: 'signed-out' }
  | { k: 'missing' }
  | { k: 'error'; message: string }
  | { k: 'ready'; record: ReturnView };

const problem = (failure: ApiFailure): string =>
  failure.code === 'UNKNOWN' || failure.code === 'NETWORK'
    ? 'We could not reach this return just now. That is our problem, not yours — the return itself is unaffected.'
    : failure.message;

export function ReturnRecord({ returnNumber }: { returnNumber: string }): React.JSX.Element {
  const [phase, setPhase] = React.useState<Phase>({ k: 'loading' });

  React.useEffect(() => {
    let live = true;
    void (async () => {
      const result = await getReturn(returnNumber);
      if (!live) return;
      if (result.ok) setPhase({ k: 'ready', record: result.data });
      else if (result.status === 401) setPhase({ k: 'signed-out' });
      else if (result.status === 404 || result.status === 422) setPhase({ k: 'missing' });
      else setPhase({ k: 'error', message: problem(result) });
    })();
    return () => {
      live = false;
    };
  }, [returnNumber]);

  if (phase.k === 'loading') return <LoadingRecord />;
  if (phase.k === 'signed-out') return <SignedOut returnNumber={returnNumber} />;
  if (phase.k === 'missing') return <Missing returnNumber={returnNumber} />;
  if (phase.k === 'error') return <Failed message={phase.message} />;

  const r = phase.record;
  const status = RETURN_STATUS[r.status] ?? { label: r.status, tone: 'neutral' as const };

  // ONE step, because one instant is all the platform has recorded. The second
  // entry carries no date at all — it is what is happening, not a stage that has
  // been reached, and giving it a date would be inventing one.
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

  return (
    <>
      <RecordHeader
        title={r.reasonLabel}
        subtitle={r.title ?? 'Model no longer catalogued'}
        identifiers={[
          { label: 'Serial', value: r.serialNumber, href: r.passportPath || undefined },
          { label: 'Return', value: r.returnNumber },
          {
            label: 'Order',
            value: r.orderNumber || '—',
            href: r.orderNumber ? `/account/orders/${encodeURIComponent(r.orderNumber)}` : undefined,
          },
          { label: 'Raised', value: r.raisedOn },
        ]}
        status={<StatusPill tone={status.tone} label={status.label} />}
        className="crhead"
      />

      <div className="rec crrec">
        <main className="evid">
          <section className="crpanel" aria-labelledby="rrwhat">
            <h2 id="rrwhat">What you told us</h2>
            {/* The buyer's own words, verbatim. Nothing is summarised or
                rewritten — this text is what the engineer inspecting the machine
                on its way back reads first. */}
            <p className="crdesc">{r.description}</p>
            <dl className="crfacts">
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
                        // A shortfall is a shortfall and is never drawn as a
                        // complete file. It says what is missing and who will
                        // ask for it, rather than a red border on a control that
                        // does not exist yet.
                        <span className="rrneed">
                          We still need <span className="mono">{r.evidenceStillNeeded}</span>. We
                          will ask you by email — there is no upload on this screen yet, and that is
                          our gap rather than something you have failed to do.
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
            </dl>
          </section>

          <section className="crpanel" aria-labelledby="rrhist">
            <h2 id="rrhist">History</h2>
            <Timeline events={events} label="Return history" />
            <p className="fnote off">
              Only steps we have actually recorded appear here. Collection, receipt and the
              inspection on return are not on this timeline because nothing on the platform writes
              them yet — we do not draw a stage that has not happened.
            </p>
          </section>
        </main>

        <SidePanel
          title="What happens next"
          description={
            r.open
              ? 'We collect the machine at our cost, inspect it against the report it was sold under, and refund or replace it.'
              : 'This return is finished. If you disagree with the outcome, say so and it goes to a written decision.'
          }
          footnote={
            <>
              Take-back under Rule 7(4) is ours and cannot be passed on. We bought the machine, we
              sold it to you on our own invoice, and we settle this ourselves — there is nobody else
              for you to contact about it.
            </>
          }
          className="crside"
        >
          <a className="pill acc crside-a" href="/account/support">
            {r.open ? 'Add something to this return' : 'Dispute this outcome'}
          </a>
          {r.passportPath && (
            <a className="pill wire crside-a" href={r.passportPath}>
              Open the machine&rsquo;s passport
            </a>
          )}
          <a className="pill wire crside-a" href="/account/returns">
            All your returns
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

function SignedOut({ returnNumber }: { returnNumber: string }): React.JSX.Element {
  return (
    <div className="ostate">
      <EmptyState
        title="Sign in to see this return"
        body="A return belongs to the organisation that raised it, so we need to know who is asking."
        action={
          <a
            className="pill acc"
            href={`/sign-in?next=${encodeURIComponent(`/account/returns/${returnNumber}`)}`}
          >
            Sign in
          </a>
        }
      />
    </div>
  );
}

/**
 * No such return **on this account**.
 *
 * Deliberately the same screen for a return that does not exist and one that
 * belongs to another organisation — the API answers 404 for both. A return
 * number carries a month and a counter, so "you may not see that one" would
 * confirm it exists and turn this route into a volume oracle.
 */
function Missing({ returnNumber }: { returnNumber: string }): React.JSX.Element {
  return (
    <div className="ostate">
      <EmptyState
        title="We have no return with that number on your account"
        body={
          <>
            Nothing on your organisation&rsquo;s account is numbered{' '}
            <span className="mono">{returnNumber}</span>. Ours look like{' '}
            <span className="mono">TT-RET-2608-4F2A91C3</span>.
          </>
        }
        action={
          <a className="pill acc" href="/account/returns">
            Your returns
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
        <h3>We could not load this return</h3>
        <p>{message}</p>
        <p className="retry">
          <button type="button" className="pill acc" onClick={() => window.location.reload()}>
            Try again
          </button>
        </p>
      </div>
    </div>
  );
}
