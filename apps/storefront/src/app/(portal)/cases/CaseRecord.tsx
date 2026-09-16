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
import type { ApiResult } from '../../register/api';

/**
 * ARCHETYPE C — Record. One case: a return, or a warranty claim.
 *
 * **These were two files and one screen.** `ReturnRecord` and `ClaimRecord` ran
 * to 299 and 317 lines with the same class names (`crhead`, `crrec`, `crpanel`,
 * `crdesc`, `crfacts`, `crside`), the same three headings — *What you told us*,
 * *History*, *What happens next* — the same four-identifier header and the same
 * side-panel trio. Around 140 of those lines were identical apart from one
 * noun: the phase type, the refusal sentence, the fetch with its 401/404/422
 * branching, and all four states that are not the record.
 *
 * Two copies of a screen is one screen and one fossil, and they drift. What
 * genuinely differs between a return and a claim is **data** — the facts rows,
 * how a timeline is built from the dates the server actually sent, and what
 * happens next — so that is what a caller supplies and nothing else.
 *
 * Every rule the two files had is kept, and they are the reason this is a
 * description rather than a template: the timeline is built only from instants
 * the server recorded, a missing value says so rather than rendering as a
 * passing one, and "no such case" is deliberately the same screen whether the
 * case does not exist or belongs to another organisation.
 */

export type CaseTone = 'pass' | 'fail' | 'warn' | 'info' | 'neutral' | 'processing';

/**
 * Everything that differs between a return and a claim, and nothing that does not.
 *
 * Each function is handed the record. None of them may invent a value: a field
 * the server did not send comes back as the "not measured" treatment, never as
 * a default that reads like an answer.
 */
export interface CaseKind<T> {
  /** Lower case, mid-sentence: "this return", "this claim". */
  noun: string;
  /** The board this case belongs to. */
  list: { href: string; label: string };
  /** What one of our numbers looks like, so a typo can be recognised as one. */
  numberExample: string;
  identity: (record: T) => {
    title: string;
    subtitle: string;
    number: string;
    serialNumber: string;
    orderNumber: string;
    raisedOn: string;
    passportPath: string;
  };
  status: (record: T) => { label: string; tone: CaseTone };
  /** The buyer's own words, verbatim. Never summarised or rewritten. */
  description: (record: T) => string;
  /** The `<dl>` rows under the description. */
  facts: (record: T) => React.ReactNode;
  /** Built only from instants the server sent. A step we did not record is absent. */
  events: (record: T) => TimelineEvent[];
  /** Why this timeline is as short as it is. */
  historyNote: React.ReactNode;
  /** Nothing further will happen without the buyer. */
  settled: (record: T) => boolean;
  next: (record: T) => { description: string; footnote: React.ReactNode };
}

type Phase<T> =
  | { k: 'loading' }
  | { k: 'signed-out' }
  | { k: 'missing' }
  | { k: 'error'; message: string }
  | { k: 'ready'; record: T };

export function CaseRecord<T>({
  caseNumber,
  kind,
  load,
}: {
  caseNumber: string;
  kind: CaseKind<T>;
  load: (caseNumber: string) => Promise<ApiResult<T>>;
}): React.JSX.Element {
  const [phase, setPhase] = React.useState<Phase<T>>({ k: 'loading' });

  const noun = kind.noun;

  React.useEffect(() => {
    let live = true;
    void (async () => {
      const result = await load(caseNumber);
      if (!live) return;
      if (result.ok) {
        setPhase({ k: 'ready', record: result.data });
      } else if (result.status === 401) {
        setPhase({ k: 'signed-out' });
      } else if (result.status === 404 || result.status === 422) {
        setPhase({ k: 'missing' });
      } else {
        // `call`'s fallback for UNKNOWN and NETWORK describes a registration
        // form, and a refusal that describes the wrong screen is worse than a
        // plain one.
        setPhase({
          k: 'error',
          message:
            result.code === 'UNKNOWN' || result.code === 'NETWORK'
              ? `We could not reach this ${noun} just now. That is our problem, not yours — the ${noun} itself is unaffected.`
              : result.message,
        });
      }
    })();
    return () => {
      live = false;
    };
  }, [caseNumber, load, noun]);

  if (phase.k === 'loading') return <LoadingRecord />;
  if (phase.k === 'signed-out') return <SignedOut caseNumber={caseNumber} kind={kind} />;
  if (phase.k === 'missing') return <Missing caseNumber={caseNumber} kind={kind} />;
  if (phase.k === 'error') return <Failed message={phase.message} kind={kind} />;

  const record = phase.record;
  const id = kind.identity(record);
  const status = kind.status(record);
  const next = kind.next(record);

  return (
    <>
      <RecordHeader
        title={id.title}
        subtitle={id.subtitle}
        // The serial belongs among the identifiers rather than in the subtitle:
        // `RecordHeader` renders identifiers mono and tabular, which is what a
        // value somebody reads aloud off a case label needs to be.
        identifiers={[
          { label: 'Serial', value: id.serialNumber, href: id.passportPath || undefined },
          { label: kind.noun === 'return' ? 'Return' : 'Claim', value: id.number },
          {
            label: 'Order',
            value: id.orderNumber || '—',
            href: id.orderNumber ? `/orders/${encodeURIComponent(id.orderNumber)}` : undefined,
          },
          { label: 'Raised', value: id.raisedOn },
        ]}
        status={<StatusPill tone={status.tone} label={status.label} />}
        className="crhead"
      />

      <div className="rec crrec">
        <main className="evid">
          <section className="crpanel" aria-labelledby="case-what">
            <h2 id="case-what">What you told us</h2>
            {/* The buyer's own words, verbatim. Nothing is summarised or
                rewritten — this text is what the engineer reads first. */}
            <p className="crdesc">{kind.description(record)}</p>
            <dl className="crfacts">{kind.facts(record)}</dl>
          </section>

          <section className="crpanel" aria-labelledby="case-history">
            <h2 id="case-history">History</h2>
            <Timeline events={kind.events(record)} label={`${id.title} history`} />
            <p className="fnote off">{kind.historyNote}</p>
          </section>
        </main>

        <SidePanel
          title="What happens next"
          description={next.description}
          footnote={next.footnote}
          className="crside"
        >
          {/*
            No amber action here.

            Both screens used to make "Add something to this case" their one
            amber control, pointing at /legal/grievance — a policy page outside
            the portal frame. The words promised a comment box this product does
            not have. A settled case keeps its real escalation, as the secondary
            link it always should have been.
          */}
          {kind.settled(record) && (
            <a className="pill wire crside-a" href="/legal/grievance">
              Dispute this outcome
            </a>
          )}
          {id.passportPath && (
            <a className="pill wire crside-a" href={id.passportPath}>
              Open the machine&rsquo;s passport
            </a>
          )}
          <a className="pill wire crside-a" href={kind.list.href}>
            {kind.list.label}
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

function SignedOut<T>({
  caseNumber,
  kind,
}: {
  caseNumber: string;
  kind: CaseKind<T>;
}): React.JSX.Element {
  return (
    <div className="ostate">
      <EmptyState
        title={`Sign in to see this ${kind.noun}`}
        body={`A ${kind.noun} belongs to the organisation that raised it, so we need to know who is asking.`}
        action={
          <a
            className="pill acc"
            href={`/sign-in?next=${encodeURIComponent(`${kind.list.href}/${caseNumber}`)}`}
          >
            Sign in
          </a>
        }
      />
    </div>
  );
}

/**
 * No such case **on this account**.
 *
 * Deliberately the same screen for a case that does not exist and one that
 * belongs to another organisation — the API answers 404 for both. Our numbers
 * carry a month and a counter, so "you may not see that one" would confirm it
 * exists and turn this route into a volume oracle.
 */
function Missing<T>({
  caseNumber,
  kind,
}: {
  caseNumber: string;
  kind: CaseKind<T>;
}): React.JSX.Element {
  return (
    <div className="ostate">
      <EmptyState
        title={`We have no ${kind.noun} with that number on your account`}
        body={
          <>
            Nothing on your organisation&rsquo;s account is numbered{' '}
            <span className="mono">{caseNumber}</span>. Ours look like{' '}
            <span className="mono">{kind.numberExample}</span>.
          </>
        }
        action={
          <a className="pill acc" href={kind.list.href}>
            {kind.list.label}
          </a>
        }
      />
    </div>
  );
}

function Failed<T>({ message, kind }: { message: string; kind: CaseKind<T> }): React.JSX.Element {
  return (
    <div className="ostate">
      <div className="empty err" role="alert">
        <h3>We could not load this {kind.noun}</h3>
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
