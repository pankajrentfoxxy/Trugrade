'use client';

import * as React from 'react';
import {
  Button,
  DataBoard,
  EmptyState,
  GradeBadge,
  StepRail,
  Uploader,
  WhyRail,
  type Column,
  type Step,
  type UploadedFile,
  type WhyRailItem,
} from '@trugrade/ui';
import { BRAND } from '@trugrade/config/brand';
import type { ApiFailure } from '../register/api';
import {
  REQUIREMENT_COLUMNS,
  readRequirementFile,
  submitCsv,
  submitRows,
  type MatchedRequirement,
  type RejectedRow,
  type RequirementIntakeResult,
  type UnmatchedRequirement,
} from './api';
import {
  ManualRows,
  emptyDraft,
  toRequirementRow,
  validateDraft,
  type Draft,
  type RowErrors,
} from './ManualRows';

/**
 * Bulk requirement intake. See `page.tsx` for the archetype and the rules.
 *
 * A client component because the call is authenticated, because it can come back
 * 401 — a signed-out visitor is a state this screen renders, not a crash — and
 * because the file is read in the browser before a byte of it is sent.
 */

/* ==========================================================================
 * Copy that has to be exactly right
 * ======================================================================== */

/**
 * The sentence that keeps this screen inside the merchant-of-record model.
 *
 * It appears in the rail before anything is uploaded and again beside the lead
 * reference, because those are the two moments a procurement head would
 * otherwise assume this is a tender: the moment they hand over the list, and the
 * moment they are told it has gone somewhere. Nothing on this path reaches a
 * supplier, no supplier is invited to quote, and there is no arm of the endpoint
 * that could make one.
 */
const NO_VENDOR_SEES_THIS =
  `No supplier is shown your list and none is asked to quote on it. ${BRAND.legalEntity} buys the machines and sells them to you on our own invoice, so finding them is our job, not a bidding round.`;

const TEMPLATE_ROWS = [
  REQUIREMENT_COLUMNS.join(','),
  'Dell Latitude 5420 i5 16GB 512GB,40,A,42000,122001,2026-10-15',
  'Lenovo ThinkPad E14 Gen 3,15,B,31000,122001,',
].join('\n');

/** The blank file, offered rather than described. Columns come from one place. */
const TEMPLATE_HREF = `data:text/csv;charset=utf-8,${encodeURIComponent(`${TEMPLATE_ROWS}\n`)}`;

/* ==========================================================================
 * State
 * ======================================================================== */

type Phase =
  | { k: 'form' }
  /** In flight. The file row says "Checking" and the form button says so too. */
  | { k: 'checking' }
  /** No session. Not a failure: a path exists and it comes back here. */
  | { k: 'signed-out' }
  | { k: 'error'; message: string }
  | { k: 'result'; result: RequirementIntakeResult };

/**
 * What went wrong, in the server's words where it had any.
 *
 * `call`'s fallback for `UNKNOWN` and `NETWORK` describes a registration form,
 * and a refusal that describes the wrong screen is worse than a plain one.
 */
const problem = (failure: ApiFailure): string =>
  failure.code === 'UNKNOWN' || failure.code === 'NETWORK'
    ? 'We could not reach our catalogue just now. That is our problem, not your list — nothing has been recorded, so send it again in a moment.'
    : failure.message;

const lines = (n: number): string => `${n} line${n === 1 ? '' : 's'}`;

/* ==========================================================================
 * The screen
 * ======================================================================== */

export function BulkIntake({
  initialModel,
  initialPincode,
}: {
  /** From the homepage strip, which posts `?q=`. Prefills nothing else. */
  initialModel: string | null;
  /** From the comparison board, which links here with the pincode already known. */
  initialPincode: string | null;
}): React.JSX.Element {
  const [phase, setPhase] = React.useState<Phase>({ k: 'form' });
  const [file, setFile] = React.useState<UploadedFile | null>(null);
  const [drafts, setDrafts] = React.useState<readonly Draft[]>([
    { ...emptyDraft(), model: initialModel ?? '', deliveryPincode: initialPincode ?? '' },
  ]);
  const [rowErrors, setRowErrors] = React.useState<readonly RowErrors[]>([{}]);
  const [formError, setFormError] = React.useState<string | null>(null);

  const busy = phase.k === 'checking';

  /* ------------------------------------------------------------- the file */

  /**
   * One list at a time. A second file would be a second intake and a second
   * lead, and two leads for one requirement is two people phoning one buyer.
   *
   * Files past the first are named rather than dropped: the drop target accepts
   * whatever the browser hands it, and a file that silently vanished between the
   * mouse and the screen is the failure this whole task is written against.
   */
  const onSelect = async (picked: File[]): Promise<void> => {
    const [first, ...rest] = picked;
    if (!first) return;

    setFormError(
      rest.length === 0
        ? null
        : `We read ${first.name} only. ${rest.map((f) => f.name).join(', ')} ${rest.length === 1 ? 'was' : 'were'} not opened — upload one list at a time.`,
    );

    const entry: UploadedFile = {
      id: `${first.name}-${first.size}`,
      name: first.name,
      sizeBytes: first.size,
      status: 'uploading',
      progressPct: 0,
    };
    setFile(entry);

    const read = await readRequirementFile(first, (pct) =>
      setFile((f) => (f && f.id === entry.id ? { ...f, progressPct: pct } : f)),
    );

    if (!read.ok) {
      setFile({ ...entry, status: 'rejected', progressPct: undefined, rejectionReason: read.reason });
      return;
    }

    setFile({ ...entry, status: 'scanning', progressPct: undefined });
    setPhase({ k: 'checking' });

    const result = await submitCsv(read.text);

    if (result.ok) {
      setFile({ ...entry, status: 'accepted', progressPct: undefined });
      setPhase({ k: 'result', result: result.data });
      return;
    }

    if (result.status === 401) {
      setFile(null);
      setPhase({ k: 'signed-out' });
      return;
    }

    // A refusal about the file itself — a missing column, a header with nothing
    // under it — belongs on the file, in the server's own words. It names the
    // expected header, which is the only thing that gets the next upload right.
    if (result.status === 422 || result.status === 400) {
      setFile({ ...entry, status: 'rejected', progressPct: undefined, rejectionReason: result.message });
      setPhase({ k: 'form' });
      return;
    }

    setFile(null);
    setPhase({ k: 'error', message: problem(result) });
  };

  /* ------------------------------------------------------------- the form */

  const patch = (index: number, change: Partial<Draft>): void => {
    setDrafts((rows) => rows.map((r, i) => (i === index ? { ...r, ...change } : r)));
    setRowErrors((errs) => errs.map((e, i) => (i === index ? {} : e)));
  };

  const onSubmitRows = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setFormError(null);

    const found = drafts.map(validateDraft);
    setRowErrors(found);
    if (found.some((e) => Object.keys(e).length > 0)) {
      const bad = found.reduce((n, e) => n + (Object.keys(e).length > 0 ? 1 : 0), 0);
      setFormError(
        `${lines(bad)} still ${bad === 1 ? 'needs' : 'need'} something. Nothing has been sent — the problem is named under each field.`,
      );
      return;
    }

    setPhase({ k: 'checking' });
    const result = await submitRows(drafts.map(toRequirementRow));

    if (result.ok) {
      setPhase({ k: 'result', result: result.data });
      return;
    }
    if (result.status === 401) {
      setPhase({ k: 'signed-out' });
      return;
    }

    setPhase({ k: 'form' });

    // `rows.0.deliveryPincode` — the row index and the field, which is what puts
    // the server's own sentence back under the input that caused it.
    const mapped = drafts.map((): RowErrors => ({}));
    let placed = 0;
    for (const [key, message] of Object.entries(result.fields)) {
      const parts = key.split('.');
      const index = Number(parts[1]);
      const field = parts[2] as keyof Draft | undefined;
      if (parts[0] === 'rows' && Number.isInteger(index) && mapped[index] && field) {
        mapped[index][field] = message;
        placed++;
      }
    }
    setRowErrors(mapped);
    setFormError(placed > 0 ? null : problem(result));
  };

  /* ------------------------------------------------------------ the shell */

  const rail: Step[] = [
    {
      key: 'list',
      label: 'Your requirement list',
      status: phase.k === 'result' ? 'complete' : 'current',
      summary:
        phase.k === 'result'
          ? `${lines(
              phase.result.matched.length +
                phase.result.unmatched.length +
                phase.result.rejected.length,
            )} read`
          : undefined,
    },
    {
      key: 'answer',
      label: 'What we can fill now',
      status: phase.k === 'result' ? 'current' : 'upcoming',
    },
  ];

  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_300px]">
      <div className="flex flex-col gap-3 max-lg:hidden">
        <StepRail steps={rail} label="Requirement list" className="nodraft" />
        {/* The rail's own save state is registration's, and this flow saves no
            draft: a requirement list exists once it has been sent. */}
        <p className="text-body-sm text-ink-3">Nothing is stored until you send the list.</p>
      </div>

      <main className="flex flex-col gap-5 lg:max-w-[86ch]">
        {phase.k === 'signed-out' ? (
          <SignedOut />
        ) : phase.k === 'error' ? (
          <Failed message={phase.message} onRetry={() => setPhase({ k: 'form' })} />
        ) : phase.k === 'result' ? (
          <Answer result={phase.result} />
        ) : (
          <Intake
            file={file}
            busy={busy}
            drafts={drafts}
            rowErrors={rowErrors}
            formError={formError}
            onSelect={onSelect}
            onRemoveFile={() => {
              setFile(null);
              setFormError(null);
            }}
            onPatch={patch}
            onAdd={() => {
              setDrafts((r) => [...r, emptyDraft()]);
              setRowErrors((e) => [...e, {}]);
            }}
            onRemoveRow={(i) => {
              setDrafts((r) => r.filter((_, n) => n !== i));
              setRowErrors((e) => e.filter((_, n) => n !== i));
            }}
            onSubmit={onSubmitRows}
          />
        )}
      </main>

      <aside className="flex flex-col gap-4 max-xl:static lg:col-span-2 xl:col-span-1">
        <WhyRail items={WHY} title="Why we ask" className="static max-h-none" />
      </aside>
    </div>
  );
}

const WHY: readonly WhyRailItem[] = [
  {
    term: 'Who sees this list',
    explanation: NO_VENDOR_SEES_THIS,
  },
  {
    term: 'Delivery pincode',
    explanation:
      'Where the machines are going. It decides the freight and whether the tax is IGST or CGST plus SGST, which is why a landed price cannot be quoted without it.',
  },
  {
    term: 'Grade',
    explanation:
      'A+, A and B are all sellable and all inspected. Leave it blank and we will show you what we hold across all three.',
  },
  {
    term: 'Target price',
    explanation:
      'Your number, kept beside the requirement. It is never compared against a supplier in anything you are shown here.',
  },
  {
    term: 'Needed by',
    explanation:
      'A requirement stays open for a fortnight, or until this date if it is further out — whichever gives us longer to find the machines.',
  },
  {
    term: 'A line we cannot read',
    explanation:
      'It is reported back with the row number from your own file and what was expected. We never guess at a row, and we never quietly skip one.',
  },
];

/* ==========================================================================
 * Step 1 — the list
 * ======================================================================== */

function Intake({
  file,
  busy,
  drafts,
  rowErrors,
  formError,
  onSelect,
  onRemoveFile,
  onPatch,
  onAdd,
  onRemoveRow,
  onSubmit,
}: {
  file: UploadedFile | null;
  busy: boolean;
  drafts: readonly Draft[];
  rowErrors: readonly RowErrors[];
  formError: string | null;
  onSelect: (files: File[]) => void;
  onRemoveFile: () => void;
  onPatch: (index: number, patch: Partial<Draft>) => void;
  onAdd: () => void;
  onRemoveRow: (index: number) => void;
  onSubmit: (event: React.FormEvent) => void;
}): React.JSX.Element {
  return (
    <>
      <header className="flex flex-col gap-3">
        <span className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">
          Step <span className="tnum">1</span> of <span className="tnum">2</span>
        </span>
        <h1 className="text-h1 text-ink">Send us your requirement list</h1>
        <p className="max-w-[70ch] text-body-sm text-ink-2">
          Upload the spreadsheet you already keep, or type the lines below. We match every line
          against machines we hold right now, tell you what we can fill today and what we cannot,
          and put the rest in front of our own sourcing desk.
        </p>
        <p className="max-w-[70ch] text-body-sm text-ink-3">{NO_VENDOR_SEES_THIS}</p>
      </header>

      {formError && (
        <p role="alert" className="rounded border border-fail bg-sheet-2 p-4 text-body-sm text-fail">
          {formError}
        </p>
      )}

      <section aria-labelledby="upload" className="flex flex-col gap-4">
        <div className="sh">
          <h2 id="upload" className="text-h2 text-ink">
            Upload the list
          </h2>
        </div>

        <Uploader
          label="Requirement list"
          accept=".csv,text/csv"
          maxSizeMb={2}
          files={file ? [file] : []}
          onSelect={onSelect}
          onRemove={onRemoveFile}
          disabled={busy}
          hint={
            <>
              A CSV with these columns, in any order:{' '}
              <span className="tnum text-ink">{REQUIREMENT_COLUMNS.join(', ')}</span>. Only{' '}
              <span className="tnum text-ink">model</span>,{' '}
              <span className="tnum text-ink">quantity</span> and{' '}
              <span className="tnum text-ink">delivery_pincode</span> are required.{' '}
              <a
                className="text-acc-ink underline underline-offset-4"
                href={TEMPLATE_HREF}
                download="trugrade-requirement-list.csv"
              >
                Download the template
              </a>
              . An Excel workbook is not a CSV — in Excel choose File, Save As, CSV UTF-8. We check
              what a file actually is by reading its first bytes, not by trusting its name.
            </>
          }
        />
      </section>

      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <section aria-labelledby="typed" className="flex flex-col gap-4">
          <div className="sh">
            <h2 id="typed" className="text-h2 text-ink">
              Or type the lines
            </h2>
            <p className="mt-2 max-w-[70ch] text-body-sm text-ink-2">
              Same six columns, same treatment. Use this for a handful of machines rather than
              building a file for them.
            </p>
          </div>

          <ManualRows
            rows={drafts}
            errors={rowErrors}
            onChange={onPatch}
            onAdd={onAdd}
            onRemove={onRemoveRow}
            disabled={busy}
          />
        </section>

        <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-5">
          <Button type="submit" variant="primary" size="lg" loading={busy}>
            Check these lines
          </Button>
          <p className="text-body-sm text-ink-3">
            Nothing is ordered and nothing is charged. This tells you what we hold.
          </p>
        </div>
      </form>
    </>
  );
}

/* ==========================================================================
 * Step 2 — the answer
 * ======================================================================== */

const gradeLabel = (grade: string | null): React.ReactNode =>
  grade === null ? (
    <span className="text-body-sm text-ink-4">No preference</span>
  ) : (
    <GradeBadge grade={grade === 'A_PLUS' ? 'A_PLUS' : grade === 'A' ? 'A' : 'B'} />
  );

function Answer({ result }: { result: RequirementIntakeResult }): React.JSX.Element {
  const { matched, unmatched, rejected, salesLeadReference } = result;
  const total = matched.length + unmatched.length + rejected.length;
  const fillable = matched.filter((m) => m.unitsAvailableNow >= m.qtyRequested).length;

  return (
    <>
      <header className="flex flex-col gap-3">
        <span className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">
          Step <span className="tnum">2</span> of <span className="tnum">2</span>
        </span>
        <h1 className="text-h1 text-ink">What we can fill now</h1>
        <p className="max-w-[70ch] text-body-sm text-ink-2">
          We read <span className="tnum text-ink">{total}</span>{' '}
          {total === 1 ? 'line' : 'lines'}. <span className="tnum text-ink">{matched.length}</span>{' '}
          of <span className="tnum">{total}</span> matched a machine in our catalogue,{' '}
          <span className="tnum text-ink">{unmatched.length}</span> of{' '}
          <span className="tnum">{total}</span> did not, and{' '}
          <span className="tnum text-ink">{rejected.length}</span> of{' '}
          <span className="tnum">{total}</span> could not be read at all.
        </p>
      </header>

      <MatchedPanel matched={matched} fillable={fillable} />
      <UnmatchedPanel unmatched={unmatched} reference={salesLeadReference} />
      <RejectedPanel rejected={rejected} />

      <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-5">
        <a className="sel gh" href="/bulk">
          Send another list
        </a>
        <a className="sel gh" href="/search">
          Browse what is in stock
        </a>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- matched */

const MATCHED_COLUMNS: ReadonlyArray<Column<MatchedRequirement>> = [
  {
    key: 'line',
    header: 'Line',
    cell: (r) => <span className="tnum text-ink-2">{r.line}</span>,
    numeric: true,
  },
  {
    key: 'machine',
    header: 'Machine we matched it to',
    cell: (r) => (
      <span className="flex flex-col gap-1">
        <a
          className="text-body-sm text-ink underline decoration-rule underline-offset-4 hover:decoration-acc"
          href={`/laptops/${encodeURIComponent(r.skuId)}${r.grade ? `?grade=${r.grade}` : ''}`}
        >
          {r.title}
        </a>
        <span className="tnum text-body-sm text-ink-4">{r.specSummary}</span>
        {/* The reference belongs to this line, so it sits with it rather than
            in a column of its own — it is what the sourcing desk quotes back. */}
        <span className="tnum text-body-sm text-ink-3">{r.reference}</span>
      </span>
    ),
  },
  { key: 'grade', header: 'Grade asked for', cell: (r) => gradeLabel(r.grade) },
  {
    key: 'qty',
    header: 'You asked for',
    numeric: true,
    cell: (r) => (
      <span className="flex flex-col items-end gap-1">
        <span className="tnum text-ink">{r.qtyRequested}</span>
        <span className="text-body-sm text-ink-4">
          {r.neededBy === null ? 'No date given' : <>by <span className="tnum">{r.neededBy}</span></>}
        </span>
      </span>
    ),
  },
  {
    key: 'available',
    header: 'Sellable now',
    numeric: true,
    cell: (r) => (
      <span className="flex flex-col items-end gap-1">
        <span className={r.unitsAvailableNow < r.qtyRequested ? 'tnum text-warn' : 'tnum text-ink'}>
          {r.unitsAvailableNow}
        </span>
        <span className="tnum text-body-sm text-ink-4">of {r.qtyRequested} asked</span>
      </span>
    ),
  },
];

function MatchedPanel({
  matched,
  fillable,
}: {
  matched: readonly MatchedRequirement[];
  fillable: number;
}): React.JSX.Element {
  return (
    <section aria-labelledby="matched" className="flex flex-col gap-3">
      <div className="sh">
        <div className="shrow">
          <h2 id="matched" className="text-h2 text-ink">
            In our catalogue
          </h2>
          {matched.length > 0 && (
            <span className="sub text-body-sm text-ink-3">
              <span className="tnum">{fillable}</span> of{' '}
              <span className="tnum">{matched.length}</span> can be filled in full today
            </span>
          )}
        </div>
      </div>

      <div className="tbl scroll bulktbl">
        <DataBoard
          caption={`${matched.length} of your lines match a machine we carry, in the order they appear in your list.`}
          columns={MATCHED_COLUMNS}
          rows={matched}
          rowKey={(r) => r.rfqId}
          empty={
            <EmptyState
              title="Nothing on this list is in our catalogue yet"
              body="Every line went to our sourcing desk instead. That is not a refusal — it is the half of the answer that takes a person."
            />
          }
        />
      </div>

      {matched.length > 0 && (
        <p className="fnote">
          Sellable now counts machines that have passed inspection and are unsold, across every
          dispatch point and across A+, A and B — a grade is a fact about a machine, not about a
          model, so the figure does not narrow to the grade you asked for. The line number is the
          row in the list you sent. Open a machine to see the price landed to your pincode.
        </p>
      )}
    </section>
  );
}

/* -------------------------------------------------------------- unmatched */

const UNMATCHED_COLUMNS: ReadonlyArray<Column<UnmatchedRequirement>> = [
  {
    key: 'line',
    header: 'Line',
    numeric: true,
    cell: (r) => <span className="tnum text-ink-2">{r.line}</span>,
  },
  {
    key: 'asked',
    header: 'What you asked for',
    cell: (r) => (
      <span className="flex flex-col gap-1">
        <span className="text-body-sm text-ink">{r.model}</span>
        <span className="text-body-sm text-ink-4">
          to <span className="tnum">{r.deliveryPincode}</span>
          {r.neededBy === null ? ' · no date given' : <> · by <span className="tnum">{r.neededBy}</span></>}
        </span>
      </span>
    ),
  },
  { key: 'grade', header: 'Grade', cell: (r) => gradeLabel(r.grade) },
  {
    key: 'qty',
    header: 'Quantity',
    numeric: true,
    cell: (r) => <span className="tnum text-ink">{r.quantity}</span>,
  },
  {
    key: 'reason',
    header: 'Why it is not above',
    cell: (r) => <span className="text-body-sm text-ink-2">{r.reason}</span>,
  },
];

function UnmatchedPanel({
  unmatched,
  reference,
}: {
  unmatched: readonly UnmatchedRequirement[];
  reference: string | null;
}): React.JSX.Element {
  if (unmatched.length === 0)
    return (
      <section aria-labelledby="unmatched" className="flex flex-col gap-3">
        <div className="sh">
          <h2 id="unmatched" className="text-h2 text-ink">
            Not in our catalogue
          </h2>
        </div>
        <EmptyState
          title="Every line matched"
          body="There was nothing left over, so nothing has been raised with our sourcing desk."
        />
      </section>
    );

  return (
    <section aria-labelledby="unmatched" className="flex flex-col gap-3">
      <div className="sh">
        <div className="shrow">
          <h2 id="unmatched" className="text-h2 text-ink">
            Not in our catalogue
          </h2>
          <span className="sub text-body-sm text-ink-3">
            <span className="tnum">{unmatched.length}</span>{' '}
            {unmatched.length === 1 ? 'line' : 'lines'}, with our sourcing desk
          </span>
        </div>
      </div>

      <div className="tbl scroll bulktbl">
        <DataBoard
          caption={`${unmatched.length} of your lines have no machine in our catalogue and are now with our sourcing desk.`}
          columns={UNMATCHED_COLUMNS}
          rows={unmatched}
          rowKey={(r) => String(r.line)}
        />
      </div>

      <div className="rounded-lg border border-rule bg-sheet p-4">
        <div className="sh">
          <h3 className="text-h3 text-ink">Raised with our sourcing desk</h3>
        </div>
        <dl className="facts">
          <div>
            <dt>Reference</dt>
            <dd>
              {reference ?? <span className="text-body-sm text-ink-4">Not issued</span>}
            </dd>
          </div>
          <div>
            <dt>Lines attached</dt>
            <dd>{unmatched.length}</dd>
          </div>
        </dl>
        <p className="fnote">
          {reference
            ? `Quote ${reference} when you talk to us and the whole list is already on the screen in front of whoever answers.`
            : 'No reference came back with this answer, so treat the list as not yet raised and tell us about it — a reference we did not receive must not be drawn as one we did.'}
        </p>
        <p className="fnote">{NO_VENDOR_SEES_THIS}</p>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- rejected */

/**
 * The row schema's field name, in the column name the buyer's own file uses.
 *
 * The server validates a camelCase object, so a refusal comes back keyed
 * `deliveryPincode` — a name that appears nowhere in the CSV the person is
 * looking at. Pointing them at a column they cannot find is not a report.
 */
const CSV_COLUMN: Readonly<Record<string, string>> = {
  model: 'model',
  quantity: 'quantity',
  grade: 'grade',
  targetPrice: 'target_price',
  deliveryPincode: 'delivery_pincode',
  neededBy: 'needed_by',
};

const REJECTED_COLUMNS: ReadonlyArray<Column<RejectedRow>> = [
  {
    key: 'line',
    header: 'Line',
    numeric: true,
    cell: (r) => <span className="tnum text-ink-2">{r.line}</span>,
  },
  {
    key: 'errors',
    header: 'What we needed on that row',
    cell: (r) => (
      <ul className="flex flex-col gap-1">
        {Object.entries(r.errors).map(([field, message]) => (
          <li key={field} className="text-body-sm text-ink-2">
            <span className="tnum text-ink">{CSV_COLUMN[field] ?? field}</span> — {message}
          </li>
        ))}
      </ul>
    ),
  },
];

function RejectedPanel({ rejected }: { rejected: readonly RejectedRow[] }): React.JSX.Element {
  if (rejected.length === 0) return <></>;

  return (
    <section aria-labelledby="rejected" className="flex flex-col gap-3">
      <div className="sh">
        <div className="shrow">
          <h2 id="rejected" className="text-h2 text-ink">
            Lines we could not read
          </h2>
          <span className="sub text-body-sm text-ink-3">
            <span className="tnum">{rejected.length}</span>{' '}
            {rejected.length === 1 ? 'line' : 'lines'}
          </span>
        </div>
      </div>

      <div className="tbl scroll bulktbl">
        <DataBoard
          caption={`${rejected.length} of your lines did not validate and were neither matched nor raised.`}
          columns={REJECTED_COLUMNS}
          rows={rejected}
          rowKey={(r) => String(r.line)}
        />
      </div>

      <p className="fnote">
        These are reported rather than guessed at, so they are in neither list above and nothing has
        been raised for them. Fix them in your own file and send it again — a row we quietly dropped
        is a row you would find missing at the wrong moment.
      </p>
      <p className="fnote">
        What each column takes: <span className="tnum text-ink-3">model</span> is free text;{' '}
        <span className="tnum text-ink-3">quantity</span> is a whole number from{' '}
        <span className="tnum">1</span> to <span className="tnum">10,000</span>;{' '}
        <span className="tnum text-ink-3">grade</span> is{' '}
        <span className="tnum text-ink-3">A_PLUS</span>,{' '}
        <span className="tnum text-ink-3">A</span> or <span className="tnum text-ink-3">B</span>, or
        blank for no preference; <span className="tnum text-ink-3">target_price</span> is rupees;{' '}
        <span className="tnum text-ink-3">delivery_pincode</span> is six digits; and{' '}
        <span className="tnum text-ink-3">needed_by</span> is{' '}
        <span className="tnum text-ink-3">YYYY-MM-DD</span>. Everything but{' '}
        <span className="tnum text-ink-3">model</span>,{' '}
        <span className="tnum text-ink-3">quantity</span> and{' '}
        <span className="tnum text-ink-3">delivery_pincode</span> may be left empty.
      </p>
    </section>
  );
}

/* ==========================================================================
 * The states that are not the flow
 * ======================================================================== */

function SignedOut(): React.JSX.Element {
  return (
    <div className="mx-auto mt-6 max-w-[74ch]">
      <EmptyState
        title="Sign in to send a requirement list"
        body="A requirement list belongs to the organisation that sent it, and the answer is priced and delivered to that account. Signing in brings you straight back here."
        action={
          <a className="pill acc" href="/sign-in?next=%2Fbulk">
            Sign in
          </a>
        }
      />
    </div>
  );
}

function Failed({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <div className="mx-auto mt-6 max-w-[74ch]">
      <EmptyState
        title="We could not read your list just now"
        body={message}
        action={
          <Button type="button" variant="secondary" onClick={onRetry}>
            Back to your list
          </Button>
        }
      />
    </div>
  );
}

/** The route segment's loading state, and the shape the screen settles into. */
export function BulkSkeleton(): React.JSX.Element {
  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_300px]">
      <div className="recskel max-lg:hidden" aria-hidden="true">
        <div className="h-40 animate-skeleton rounded-lg bg-rule-2" />
      </div>
      <div className="flex flex-col gap-5" aria-busy="true">
        <p className="sr-only">Loading the requirement list form.</p>
        <div className="h-8 w-2/3 animate-skeleton rounded bg-rule-2" aria-hidden="true" />
        <div className="h-24 animate-skeleton rounded-lg bg-rule-2" aria-hidden="true" />
        <div className="h-64 animate-skeleton rounded-lg bg-rule-2" aria-hidden="true" />
      </div>
      <div className="recskel max-xl:hidden" aria-hidden="true">
        <div className="h-64 animate-skeleton rounded-lg bg-rule-2" />
      </div>
    </div>
  );
}
