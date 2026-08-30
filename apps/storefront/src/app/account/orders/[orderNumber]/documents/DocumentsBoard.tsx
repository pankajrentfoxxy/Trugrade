'use client';

import * as React from 'react';
import { BRAND, LEGAL_DISCLOSURE } from '@trugrade/config';
import { Money } from '@trugrade/contracts';
import { DataBoard, EmptyState, StatusPill, type Column } from '@trugrade/ui';
import type { ApiFailure } from '../../../../register/api';
import { getOrderDocuments, type OrderDocument, type OrderDocuments } from './api';

/**
 * The documents board. See `page.tsx` for the archetype and the rules.
 *
 * A client component because the call is authenticated and can come back 401 or
 * 403 — a signed-out visitor and a colleague without the finance permission are
 * both states this screen renders, not crashes.
 *
 * There is no board state in the URL and nothing to put there: no filter, no
 * sort, no page. Every document on the order is on the screen at once, so the
 * route itself is already the link a buyer sends a colleague.
 */

/* ==========================================================================
 * How a status reads
 * ======================================================================== */

/**
 * **Neutral, all of it.** A document's existence is not a verdict: green and red
 * are PASS and FAIL on this platform and nowhere else, and an issued invoice is
 * neither. The chip carries the word as well as the styling, so the meaning
 * survives without colour at all.
 */
const STATUS_LABEL: Record<OrderDocument['status'], string> = {
  ISSUED: 'Issued',
  AWAITED: 'Not issued yet',
  ELSEWHERE: 'Per machine',
  NOT_APPLICABLE: 'None',
};

/**
 * The one amber action on the screen.
 *
 * Amber means a primary action, a measured value or an active state, and one
 * primary action per screen. What a finance team comes here for is the tax
 * invoice, so the first issued one takes it; before dispatch there is no tax
 * invoice and the proforma — the document they raise the payment against — takes
 * it instead. When nothing is issued, nothing is amber, which is correct: there
 * is no primary action on an order with no documents yet.
 */
function primaryActionId(documents: readonly OrderDocument[]): string | null {
  const issued = documents.filter((d) => d.status === 'ISSUED' && d.downloadPath !== null);
  return (
    issued.find((d) => d.kind === 'TAX_INVOICE')?.id ??
    issued.find((d) => d.kind === 'PROFORMA')?.id ??
    null
  );
}

type Phase =
  | { k: 'loading' }
  /** No session. Not a failure: a path exists and it comes back here. */
  | { k: 'signed-out' }
  /** Signed in, but this account may not read the organisation's tax documents. */
  | { k: 'no-permission'; message: string }
  /** No such order on this account. Deliberately the same screen either way. */
  | { k: 'missing' }
  | { k: 'error'; message: string }
  | { k: 'ready'; data: OrderDocuments };

const problem = (failure: ApiFailure): string =>
  failure.code === 'UNKNOWN' || failure.code === 'NETWORK'
    ? 'We could not reach the documents on this order just now. That is our problem, not yours — the documents themselves are unaffected.'
    : failure.message;

/* ==========================================================================
 * The screen
 * ======================================================================== */

export function DocumentsBoard({ orderNumber }: { orderNumber: string }): React.JSX.Element {
  const [phase, setPhase] = React.useState<Phase>({ k: 'loading' });

  React.useEffect(() => {
    let live = true;
    void (async () => {
      const result = await getOrderDocuments(orderNumber);
      if (!live) return;
      if (result.ok) setPhase({ k: 'ready', data: result.data });
      else if (result.status === 401) setPhase({ k: 'signed-out' });
      else if (result.status === 403) setPhase({ k: 'no-permission', message: result.message });
      else if (result.status === 404 || result.status === 422) setPhase({ k: 'missing' });
      else setPhase({ k: 'error', message: problem(result) });
    })();
    return () => {
      live = false;
    };
  }, [orderNumber]);

  if (phase.k === 'signed-out') return <SignedOut orderNumber={orderNumber} />;
  if (phase.k === 'no-permission') return <NoPermission message={phase.message} />;
  if (phase.k === 'missing') return <Missing orderNumber={orderNumber} />;
  if (phase.k === 'error') return <Failed message={phase.message} />;

  const data = phase.k === 'ready' ? phase.data : null;
  const rows = data?.documents ?? [];
  const primary = primaryActionId(rows);
  const awaited = rows.filter((d) => d.status === 'AWAITED').length;

  return (
    <>
      <div className="wshead dochead">
        <h1>
          Documents on order <span className="mono">{orderNumber}</span>
        </h1>
        <p>
          {BRAND.legalEntity} is the seller on this order, so the invoice is ours and there is one
          per delivery. Everything below is either here or says which moment brings it into
          existence — nothing on this page is waiting on paperwork from anybody else.
        </p>
      </div>

      <Summary
        issued={data?.issuedCount ?? 0}
        total={data?.documentCount ?? 0}
        awaited={awaited}
        loading={data === null}
      />

      <div className="tbl doctable">
        <DataBoard
          caption={
            data === null
              ? 'Reading the documents on this order.'
              : `${data.issuedCount} of ${data.documentCount} documents on order ${orderNumber} exist so far; the rest say when they will.`
          }
          columns={columns(primary)}
          rows={rows}
          rowKey={(d) => d.id}
          loading={data === null}
          skeletonRows={6}
          // Unreachable by design and kept honest anyway: every order has the
          // same document list, and one that does not exist yet is a ROW with a
          // reason rather than an absence. If this ever renders, the API stopped
          // answering the question rather than the order having no documents.
          empty={
            <EmptyState
              title="We could not list the documents on this order"
              body="Every order has the same set of documents, so an empty list here is a fault on our side rather than a fact about your order. Try again, or raise a ticket and we will look."
            />
          }
        />
      </div>

      <p className="fnote off docfoot">
        A tax invoice is raised when machines leave the supply point — that is what s.31(1) of the
        CGST Act requires of us, and it is why nothing is billed on an order still being picked.
        Documents open in a new tab through a link that expires in a few minutes, and every one you
        open is recorded against your account. Questions about a figure go to{' '}
        <a href={`mailto:${LEGAL_DISCLOSURE.customerCare.email}`}>
          {LEGAL_DISCLOSURE.customerCare.email}
        </a>
        .
      </p>
    </>
  );
}

/* ==========================================================================
 * The columns
 * ======================================================================== */

function columns(primaryId: string | null): readonly Column<OrderDocument>[] {
  return [
    {
      key: 'document',
      header: 'Document',
      cell: (d) => (
        <div className="docid">
          <span className="doctitle">{d.title}</span>
          <span className="docdesc">{d.description}</span>
          {/* The sentence this screen exists for. It appears exactly when the
              document does not, and it is prose rather than a dash because a
              dash beside "E-way bill" reads as a document with no number. */}
          {d.whenItWillExist !== null && (
            <span className="docwhen">{d.whenItWillExist}</span>
          )}
        </div>
      ),
    },
    {
      key: 'number',
      header: 'Number',
      cell: (d) =>
        // A dash, not "Not numbered yet". Half these rows will never carry a
        // number at all — a QC report belongs to a serial and a credit note to
        // an event that has not happened — and "not numbered YET" would promise
        // one. Where a number IS coming, the row's own prose says when.
        d.documentNumber === null ? (
          <span className="notmeasured">—</span>
        ) : (
          <span className="mono docnum">{d.documentNumber}</span>
        ),
    },
    {
      key: 'issued',
      header: 'Issued',
      numeric: true,
      cell: (d) =>
        d.issuedOn === null ? (
          <span className="notmeasured">—</span>
        ) : (
          <span className="mono">{d.issuedOn}</span>
        ),
    },
    {
      key: 'amount',
      header: 'Amount',
      numeric: true,
      cell: (d) => (
        <div className="docamt">
          {d.amount === null ? (
            <span className="notmeasured">—</span>
          ) : (
            // Parsed as Money, never as a float: an invoice total is a
            // NUMERIC(14,2) and `Number()` on one is the bug this codebase keeps
            // nearly shipping.
            <span className="mono docsum">{Money.parse(d.amount).format()}</span>
          )}
          {/* Rule 32(5). The buyer's finance team must not claim full input
              credit on a margin-scheme invoice, and the invoice itself carries
              the narration — this is the same warning one screen earlier. */}
          {d.valuationMethod === 'MARGIN' && (
            <span className="docmargin">GST on margin · limited input credit</span>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (d) => <StatusPill tone="neutral" label={STATUS_LABEL[d.status]} />,
    },
    {
      key: 'action',
      header: 'Open',
      headerHidden: true,
      cell: (d) => <Action document={d} primary={d.id === primaryId} />,
    },
  ];
}

/**
 * The row's action, or the honest absence of one.
 *
 * A document that has not been issued gets NOTHING here — not a disabled button,
 * not a greyed link. A disabled control says a file exists and you are not
 * allowed to have it; the truth is that it does not exist, and the row already
 * says when it will.
 *
 * `target="_blank"` and a plain link rather than a `fetch`: the API mints the
 * signed URL on this request and redirects to it, so the "signed URL expired →
 * auto-refetch once" case §3A.3 anticipates cannot arise — the URL is seconds
 * old by the time the browser follows it. What the API does on the way is write
 * the `audit_log` row, which is why this points at our route rather than at the
 * object URL directly.
 */
function Action({
  document,
  primary,
}: {
  document: OrderDocument;
  primary: boolean;
}): React.JSX.Element | null {
  if (document.downloadPath !== null) {
    return (
      <a
        className={primary ? 'pill acc docopen' : 'pill wire docopen'}
        href={document.downloadPath}
        target="_blank"
        rel="noopener noreferrer"
      >
        Open
        <span className="sr-only"> {document.title}</span>
      </a>
    );
  }
  if (document.elsewherePath !== null) {
    return (
      <a className="docelsewhere" href={document.elsewherePath}>
        On each machine
        <span className="sr-only"> — open the machines on this order</span>
      </a>
    );
  }
  return null;
}

/* ==========================================================================
 * The figures above the table — every one with its denominator
 * ======================================================================== */

function Summary({
  issued,
  total,
  awaited,
  loading,
}: {
  issued: number;
  total: number;
  awaited: number;
  loading: boolean;
}): React.JSX.Element {
  return (
    <dl className="dockpi">
      <Figure
        label="Issued"
        value={loading ? null : String(issued)}
        // Never a bare count and never a bare percentage. "2 of 7" is a
        // different statement from "2", and the denominator is half the claim.
        denominator={loading ? '' : `of ${total} documents`}
      />
      <Figure
        label="Still to come"
        value={loading ? null : String(awaited)}
        denominator={loading ? '' : `of ${total} documents`}
      />
    </dl>
  );
}

function Figure({
  label,
  value,
  denominator,
}: {
  label: string;
  value: string | null;
  denominator: string;
}): React.JSX.Element {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {value === null ? (
          <span className="notmeasured">—</span>
        ) : (
          <span className="mono docfig">{value}</span>
        )}
        {denominator && value !== null && <span className="denom"> {denominator}</span>}
      </dd>
    </div>
  );
}

/* ==========================================================================
 * States that are not the board
 * ======================================================================== */

function SignedOut({ orderNumber }: { orderNumber: string }): React.JSX.Element {
  return (
    <div className="ostate">
      <EmptyState
        title="Sign in to see these documents"
        body="An order's tax documents belong to the organisation that placed it, so we need to know who is asking. Signing in brings you straight back to this list."
        action={
          <a
            className="pill acc"
            href={`/sign-in?next=${encodeURIComponent(`/account/orders/${orderNumber}/documents`)}`}
          >
            Sign in
          </a>
        }
      />
    </div>
  );
}

/**
 * Signed in, and not permitted.
 *
 * A real state rather than a redirect, and it names a way forward. Reading an
 * order and reading what it was billed at are different permissions on purpose
 * — a tax invoice is a finance document — so somebody who can place orders may
 * legitimately land here. Telling them "forbidden" and nothing else makes them
 * raise a ticket; telling them who in their own organisation can open it does
 * not.
 */
function NoPermission({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="ostate">
      <EmptyState
        title="Your account cannot open this organisation's tax documents"
        body={
          <>
            <span className="docperm">{message}</span> Tax invoices are finance documents, so they
            are open to the account owner, an administrator and anyone with the finance role. Ask
            one of them to open it, or to add the role to your account — an administrator can do it
            from <a href="/account/team">your team settings</a>.
          </>
        }
        action={
          <a className="pill wire" href="/account/orders">
            Your orders
          </a>
        }
      />
    </div>
  );
}

/**
 * No such order **on this account**.
 *
 * Deliberately the same screen for an order that does not exist and one that
 * belongs to another organisation — the API answers 404 for both. Order numbers
 * are sequential, so a screen that distinguished them would let anyone with an
 * account count our orders.
 */
function Missing({ orderNumber }: { orderNumber: string }): React.JSX.Element {
  return (
    <div className="ostate">
      <EmptyState
        title="We have no order with that number on your account"
        body={
          <>
            Nothing on your organisation&rsquo;s account is numbered{' '}
            <span className="mono">{orderNumber}</span>. Check it against your confirmation — ours
            look like <span className="mono">TT-26-00004</span> — or ask whoever placed it to share
            it from their account.
          </>
        }
        action={
          <a className="pill acc" href="/account/orders">
            Your orders
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
        <h3>We could not read the documents on this order</h3>
        <p>{message}</p>
        <p>
          Nothing has changed about your order or its invoices — this is a screen that could not
          load, not a document that went missing.
        </p>
        <p className="retry">
          <button type="button" className="pill acc" onClick={() => window.location.reload()}>
            Try again
          </button>
        </p>
      </div>
    </div>
  );
}
