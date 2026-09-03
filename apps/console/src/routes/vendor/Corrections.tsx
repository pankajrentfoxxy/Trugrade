import * as React from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import {
  Breadcrumb,
  Button,
  DataBoard,
  EmptyState,
  GradeBadge,
  Input,
  RecordHeader,
  SidePanel,
  Skeleton,
  StatusPill,
  type Column,
} from '@trugrade/ui';
import type { Grade } from '@trugrade/contracts';
import { Board, Datum, NotMeasured, PageHeader, Section, Select, Textarea } from '../../lib/controls';
import { useResource } from '../../lib/useResource';
import {
  API,
  VENDOR_RESPONSES,
  gradeLabel,
  needsAnswer,
  onDate,
  postJson,
  rupees,
  type GradeCorrection,
  type VendorResponse,
} from './api';

/**
 * The vendor's grade corrections: the board, and the screen where one is answered.
 *
 * ARCHETYPE B (`/vendor/corrections`) and ARCHETYPE C (`/vendor/corrections/:id`).
 * DENSITY: default (vendor portal), set on the app root by the shell.
 *
 * **Until this screen existed a vendor could not answer a correction at all.**
 * The service behind it has always implemented all four answers; no controller
 * exposed it, so `listing.grade_correction.respond` guarded nothing and every
 * correction ran out its window and auto-applied. The vendor was told a machine
 * had been re-graded — which changes what they are paid for it — and given
 * nowhere to say anything back.
 *
 * ## Why the four answers are a radio list and not three buttons and a link
 *
 * A correction is money. **Disputing has to be exactly as easy as accepting**, or
 * the screen is an agreement funnel with a complaints department behind it. So
 * the four sit in one group, in the order the domain lists them, at the same
 * weight, and one primary action sends whichever is chosen. Nothing is
 * pre-selected: accepting re-grades a machine, and the auto-apply job already
 * exists to make that decision when nobody makes it deliberately.
 *
 * ## An elapsed window is not a failure
 *
 * `--fail` is reserved for FAIL, and nothing here failed — the machine passed
 * inspection at a different grade, and the vendor ran out of time to answer.
 * Red on that row would read as a verdict on the machine. It is `warn`, and it
 * says what is actually true: the window has closed, the correction has not
 * auto-applied yet, and it can still be answered until it does. That is not a
 * hypothetical — every seeded correction in the dev database is past its window,
 * because the auto-apply job has never run there.
 */

/** Grade corrections are neutral chips everywhere. Position on a scale, not a verdict. */
const RESPONSE_LABEL: Readonly<Record<VendorResponse, string>> = Object.freeze({
  ACCEPT_NEW_GRADE: 'You accepted the new grade',
  ACCEPT_AND_REPRICE: 'You accepted it at a new price',
  WITHDRAW_UNIT: 'You withdrew the machine',
  DISPUTE: 'You disputed it',
});

/** What each answer actually does, in the vendor's own terms. Shown beside the choice. */
const RESPONSE_CONSEQUENCE: Readonly<Record<VendorResponse, string>> = Object.freeze({
  ACCEPT_NEW_GRADE:
    'The machine sells at the corrected grade, at the price band that grade carries. What you asked for it does not change.',
  ACCEPT_AND_REPRICE:
    'The machine sells at the corrected grade and you name a new amount for it. Machines already committed to a purchase order keep what they were bought at.',
  WITHDRAW_UNIT:
    'The machine comes off sale and goes back to you. The serial is released, so it can be listed again after a fresh inspection.',
  DISPUTE:
    'A QC manager reviews it and we re-scan the machine in full. If you are right, the correction stops counting against your grade accuracy.',
});

/* ==========================================================================
 * Shared bits
 * ======================================================================== */

/**
 * Where this correction is in its window.
 *
 * `hoursUntilAutoApply` is the SERVER's arithmetic. A browser clock must not be
 * able to move a deadline that reprices a machine, and two people looking at the
 * same row must see the same number. `null` means the window could not be read
 * from configuration — which is not the same as no time left, and does not
 * render as it.
 */
function Window({ c }: { c: GradeCorrection }): React.JSX.Element {
  if (c.autoAppliedAt) {
    return <StatusPill tone="neutral" label={`Applied on its own ${onDate(c.autoAppliedAt)}`} />;
  }
  if (c.vendorResponse) {
    return <StatusPill tone="neutral" label={RESPONSE_LABEL[c.vendorResponse]} />;
  }
  if (c.hoursUntilAutoApply === null) {
    return (
      <NotMeasured
        why="The response window is not configured, so we cannot tell you how long you have"
        label="Window not measured"
      />
    );
  }
  if (c.hoursUntilAutoApply <= 0) {
    // Warn, never fail. Nothing about the machine failed and the row is still
    // answerable — the corrected grade applies when the job next runs, not now.
    return <StatusPill tone="warn" label="Window closed — you can still answer" />;
  }
  const hours = Math.floor(c.hoursUntilAutoApply);
  return (
    <StatusPill
      tone={c.hoursUntilAutoApply <= 12 ? 'warn' : 'neutral'}
      label={`${hours} ${hours === 1 ? 'hour' : 'hours'} left`}
    />
  );
}

/** The SKU code, or the fact that we could not resolve one. Never a guess. */
function Machine({ c }: { c: GradeCorrection }): React.JSX.Element {
  return (
    <>
      <code className="font-mono text-data tnum text-ink">{c.serialNumber}</code>
      <span className="block text-body-sm text-ink-3">
        {c.skuCode || (
          <NotMeasured why="The catalog entry for this machine could not be read" label="No SKU" />
        )}
      </span>
    </>
  );
}

/** Plain-language deadline for the header and KPI row. */
function respondByLabel(c: GradeCorrection): React.ReactNode {
  if (c.respondByAt === null) {
    return (
      <NotMeasured
        why="The response window is not configured, so there is no date to show"
        label="Not measured"
      />
    );
  }
  return <span className="font-mono tnum">{onDate(c.respondByAt)}</span>;
}

/** One sentence on what happens if they do nothing — shown before the form. */
function IfYouDoNothing({ c }: { c: GradeCorrection }): React.JSX.Element {
  if (!needsAnswer(c)) return <></>;
  return (
    <div className="correction-callout">
      <p className="text-body-sm font-medium text-ink">If you do not answer</p>
      <p className="mt-2 text-body-sm text-ink-2">
        The machine is re-listed at Grade {gradeLabel(c.gradeCorrected)} and priced for that
        grade. Your declared Grade {gradeLabel(c.gradeDeclared)} no longer applies.
        {c.countsAgainstAccuracy
          ? ' This correction counts against your grade-accuracy score until you dispute it and we uphold your side.'
          : null}
      </p>
    </div>
  );
}

/**
 * The two grades side by side — the whole point of the screen in one glance.
 *
 * "We are prepared to claim" was accurate legally and opaque to a vendor reading
 * it at 9pm. "We measured" is what happened.
 */
function GradeComparison({ c }: { c: GradeCorrection }): React.JSX.Element {
  return (
    <div className="correction-grade-compare">
      <div className="correction-grade-card">
        <p className="correction-grade-label">You declared</p>
        <GradeBadge grade={c.gradeDeclared as Grade} variant="declared" />
        <p className="mt-3 text-body-sm text-ink-2">What you told us before inspection.</p>
      </div>
      <div className="correction-grade-arrow" aria-hidden="true">
        →
      </div>
      <div className="correction-grade-card correction-grade-card-measured">
        <p className="correction-grade-label">We measured</p>
        <GradeBadge
          grade={c.gradeCorrected as Grade}
          variant="corrected"
          previousGrade={c.gradeDeclared as Grade}
        />
        <p className="mt-3 text-body-sm text-ink-2">What the technician recorded on site.</p>
      </div>
    </div>
  );
}

/* ==========================================================================
 * ARCHETYPE B — the board
 * ======================================================================== */

const SHOWS = [
  { value: 'open', label: 'Waiting on you' },
  { value: 'answered', label: 'Already settled' },
  { value: '', label: 'All corrections' },
] as const;

export function VendorCorrectionsRoute(): React.JSX.Element {
  const [params, setParams] = useSearchParams();
  // Board state in the URL: a vendor must be able to send a colleague the
  // filtered board they are looking at, and the dashboard queue links straight
  // to the default.
  const show = params.get('show') ?? 'open';

  const { data, error } = useResource<GradeCorrection[]>(
    API.corrections,
    'Your grade corrections are unavailable',
  );

  const all = data ?? [];
  const open = all.filter(needsAnswer);
  const rows = show === 'open' ? open : show === 'answered' ? all.filter((c) => !needsAnswer(c)) : all;

  const columns = React.useMemo<ReadonlyArray<Column<GradeCorrection>>>(
    () => [
      { key: 'machine', header: 'Machine', cell: (c) => <Machine c={c} /> },
      {
        key: 'grade',
        header: 'Grade',
        cell: (c) => (
          <GradeBadge
            grade={c.gradeCorrected as Grade}
            variant="corrected"
            previousGrade={c.gradeDeclared as Grade}
          />
        ),
      },
      {
        key: 'ask',
        header: 'Your ask',
        cell: (c) =>
          c.askBefore === null ? (
            <NotMeasured
              why="No amount was recorded against this machine when the correction was raised"
              label="No amount"
            />
          ) : (
            <span className="font-mono text-data tnum text-ink">{rupees(c.askBefore)}</span>
          ),
      },
      {
        key: 'reason',
        header: 'What we found',
        cell: (c) => <span className="block max-w-sm">{c.reason}</span>,
      },
      {
        key: 'window',
        header: 'Window',
        cell: (c) => (
          <>
            <Window c={c} />
            <span className="mt-1 block text-body-sm text-ink-3">
              Told you {onDate(c.vendorNotifiedAt)}
            </span>
          </>
        ),
      },
      {
        key: 'action',
        header: '',
        // `--ink`, not `--acc-ink`. Fifty rows of amber links beside the one
        // amber control that means something is how amber stops meaning anything.
        cell: (c) => (
          <Link className="text-ink underline underline-offset-4" to={`/vendor/corrections/${c.id}`}>
            {needsAnswer(c) ? 'Answer' : 'Open'}
          </Link>
        ),
      },
    ],
    [],
  );

  if (error) {
    return (
      <EmptyState
        title="Your grade corrections did not load"
        body={`${error}. Nothing has been changed — reload to try again.`}
        action={
          <Link className="text-acc-ink underline underline-offset-4" to="/vendor">
            Back to today
          </Link>
        }
      />
    );
  }
  if (!data) {
    return (
      <div className="tg-stack">
        <PageHeader title="Grade corrections">Loading what is waiting on you.</PageHeader>
        <Skeleton lines={8} />
      </div>
    );
  }

  return (
    <div className="tg-stack">
      <PageHeader title="Grade corrections">
        A correction says an inspection found a machine is not the grade it was declared as. If you
        do not answer inside the window, the corrected grade applies on its own and reprices the
        listing.
      </PageHeader>

      <Board
        toolbar={
          <>
            <Select
              label="Show"
              className="min-w-[220px]"
              options={SHOWS}
              value={show === 'open' ? 'open' : show === 'answered' ? 'answered' : ''}
              onChange={(e) => {
                const next = new URLSearchParams(params);
                if (e.target.value) next.set('show', e.target.value);
                else next.delete('show');
                setParams(next, { replace: true });
              }}
            />
            <p className="ml-auto text-body-sm text-ink-2">
              {/* The denominator, always. `open.length` is the same predicate the
                  dashboard queue counts, so the two numbers cannot disagree. */}
              <span className="font-mono tnum text-ink">{open.length}</span> of{' '}
              <span className="font-mono tnum">{all.length}</span>{' '}
              {all.length === 1 ? 'correction' : 'corrections'} still waiting on you
            </p>
          </>
        }
      >
        {rows.length === 0 ? (
          <div className="p-2">
            <EmptyState
              title={
                show === 'open' && all.length > 0
                  ? 'Nothing is waiting on you'
                  : show === 'answered'
                    ? 'Nothing settled yet'
                    : 'No grade corrections'
              }
              body={
                show === 'open' && all.length > 0 ? (
                  <>
                    Every correction on your account has been settled.{' '}
                    <Link
                      className="text-acc-ink underline underline-offset-4"
                      to="/vendor/corrections?show="
                    >
                      See all {all.length}
                    </Link>
                    .
                  </>
                ) : show === 'answered' ? (
                  'None of your corrections has been answered or applied yet.'
                ) : (
                  'One appears here the moment an inspection finds a machine is not the grade it was declared as. Nothing is waiting on you.'
                )
              }
            />
          </div>
        ) : (
          <DataBoard
            caption={`${rows.length} of ${all.length} ${all.length === 1 ? 'correction' : 'corrections'}, soonest deadline first.`}
            columns={columns}
            rows={rows}
            rowKey={(c) => c.id}
          />
        )}
      </Board>
    </div>
  );
}

/* ==========================================================================
 * ARCHETYPE C — answering one
 * ======================================================================== */

/**
 * One answer, as a radio row.
 *
 * A native `<input type="radio">` inside a `<label>`: the keyboard behaviour,
 * the arrow-key roving focus and the grouping are the platform's already, and a
 * hand-rolled listbox here would be an accessibility project with nothing to
 * show for it. The consequence sits under the label because a vendor should not
 * have to click one to find out what it does.
 */
function Answer({
  value,
  label,
  checked,
  onSelect,
  children,
}: {
  value: VendorResponse;
  label: string;
  checked: boolean;
  onSelect: (v: VendorResponse) => void;
  children?: React.ReactNode;
}): React.JSX.Element {
  const id = React.useId();
  return (
    <div
      className={`flex flex-col gap-2 rounded border p-3 transition-colors ${
        // The amber wash is rule 1's third meaning — an active state. It is the
        // only colour on the four, and it is identical for all of them: nothing
        // on this screen makes agreeing look like the safe choice.
        checked ? 'border-acc bg-acc-wash' : 'border-rule bg-sheet-2'
      }`}
    >
      {/* The label wraps only the radio and its words. The reprice field is a
          second form control and nesting it inside the same <label> would be
          invalid HTML and would steal the click. */}
      <label htmlFor={id} className="flex cursor-pointer items-start gap-3">
        <input
          id={id}
          type="radio"
          name="correction-response"
          className="mt-1 accent-[var(--acc)]"
          value={value}
          checked={checked}
          onChange={() => onSelect(value)}
        />
        <span className="flex flex-col gap-1">
          <span className="text-body-sm font-medium text-ink">{label}</span>
          <span className="text-body-sm text-ink-2">{RESPONSE_CONSEQUENCE[value]}</span>
        </span>
      </label>
      {checked && children}
    </div>
  );
}

const ANSWER_LABEL: Readonly<Record<VendorResponse, string>> = Object.freeze({
  ACCEPT_NEW_GRADE: 'Accept the corrected grade',
  ACCEPT_AND_REPRICE: 'Accept it, at a new price',
  WITHDRAW_UNIT: 'Take the machine back',
  DISPUTE: 'Dispute the correction',
});

export function VendorCorrectionDetailRoute(): React.JSX.Element {
  const { id } = useParams();
  const { data, error } = useResource<GradeCorrection>(
    id ? API.correction(id) : '',
    'This grade correction did not load',
  );

  /** The server's answer after a successful POST, which replaces what was fetched. */
  const [settled, setSettled] = React.useState<GradeCorrection | null>(null);
  const [choice, setChoice] = React.useState<VendorResponse | null>(null);
  const [amount, setAmount] = React.useState('');
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  if (error) {
    return (
      <EmptyState
        title="This grade correction did not load"
        body={`${error}. It may not be on your account. Nothing has been changed.`}
        action={
          <Link className="text-acc-ink underline underline-offset-4" to="/vendor/corrections">
            Back to your corrections
          </Link>
        }
      />
    );
  }
  if (!data) return <Skeleton lines={10} />;

  const c = settled ?? data;
  const answerable = needsAnswer(c);
  const cleanAmount = /^\d+(\.\d{1,2})?$/.test(amount.trim()) && Number(amount) > 0;

  async function send(): Promise<void> {
    if (!id || !choice) return;
    setBusy(true);
    setFailure(null);
    try {
      const updated = await postJson<GradeCorrection>(API.respondToCorrection(id), {
        response: choice,
        ...(choice === 'ACCEPT_AND_REPRICE' ? { vendorAskPrice: amount.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      // Stay on the record and show what was recorded. A redirect to the board
      // makes the vendor go looking for confirmation that a money decision landed.
      setSettled(updated);
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** What stops the button, said as the thing to do rather than the rule broken. */
  const blocker = !choice
    ? 'Choose one of the four answers.'
    : choice === 'ACCEPT_AND_REPRICE' && !cleanAmount
      ? 'Enter the amount you want for this machine, in rupees.'
      : '';

  return (
    <div className="tg-stack correction-record">
      <Breadcrumb
        items={[
          { label: 'Grade corrections', href: '/vendor/corrections' },
          { label: c.serialNumber },
        ]}
      />

      <RecordHeader
        title={c.serialNumber}
        subtitle={
          c.skuCode ? (
            <>
              {c.skuCode} — you declared Grade {gradeLabel(c.gradeDeclared)}; inspection found Grade{' '}
              {gradeLabel(c.gradeCorrected)}.
            </>
          ) : (
            <>
              You declared Grade {gradeLabel(c.gradeDeclared)}; inspection found Grade{' '}
              {gradeLabel(c.gradeCorrected)}.{' '}
              <NotMeasured
                why="The catalog entry for this machine could not be read"
                label="No SKU on record"
              />
            </>
          )
        }
        status={<Window c={c} />}
        secondaryActions={
          <GradeBadge
            grade={c.gradeCorrected as Grade}
            variant="corrected"
            previousGrade={c.gradeDeclared as Grade}
          />
        }
      />

      <div className="unit-kpi-grid">
        <div className="unit-kpi-tile">
          <p className="unit-kpi-label">You declared</p>
          <p className="unit-kpi-value">Grade {gradeLabel(c.gradeDeclared)}</p>
        </div>
        <div className="unit-kpi-tile">
          <p className="unit-kpi-label">We measured</p>
          <p className="unit-kpi-value">Grade {gradeLabel(c.gradeCorrected)}</p>
        </div>
        <div className="unit-kpi-tile">
          <p className="unit-kpi-label">Your ask</p>
          <p className="unit-kpi-value font-mono tnum">
            {c.askBefore === null ? (
              <span className="font-sans text-ink-4">No amount recorded</span>
            ) : (
              rupees(c.askBefore)
            )}
          </p>
        </div>
        <div className="unit-kpi-tile">
          <p className="unit-kpi-label">Grade accuracy</p>
          <p className="unit-kpi-value text-body-sm font-normal">
            {c.countsAgainstAccuracy
              ? 'Counts until you dispute and we uphold you'
              : 'Does not count — dispute upheld'}
          </p>
        </div>
      </div>

      <div className="grid [&>*]:min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-5">
          <Section
            title="What changed"
            subtitle="The grade you declared and the grade we measured after opening the machine."
            className="!mt-0"
          >
            <GradeComparison c={c} />
          </Section>

          <Section
            title="What the inspection found"
            subtitle="The technician's own words — why the measured grade is lower than you declared."
            className="!mt-0"
          >
            <div className="correction-reason">{c.reason}</div>
          </Section>

          <Section title="What happens next" subtitle="Deadlines and consequences." className="!mt-0">
            <IfYouDoNothing c={c} />
            <div className="mt-4 grid gap-x-6 md:grid-cols-2">
              <Datum label="We told you">{onDate(c.vendorNotifiedAt)}</Datum>
              <Datum label="Respond by">{respondByLabel(c)}</Datum>
              <Datum label="Time left">
                <Window c={c} />
              </Datum>
              <Datum label="Grade accuracy">
                {c.countsAgainstAccuracy ? (
                  <>
                    Counts against your score on the supply-point comparison buyers see. Dispute and
                    win — we clear it.
                  </>
                ) : (
                  <>Does not count. A QC manager upheld your dispute.</>
                )}
              </Datum>
              {c.vendorRespondedAt ? (
                <Datum label="You answered">
                  {onDate(c.vendorRespondedAt)}
                  {c.vendorResponse ? ` — ${RESPONSE_LABEL[c.vendorResponse]}` : ''}
                </Datum>
              ) : null}
              {c.autoAppliedAt ? (
                <Datum label="Applied without an answer">{onDate(c.autoAppliedAt)}</Datum>
              ) : null}
            </div>
          </Section>
        </div>

        <SidePanel
          title={answerable ? 'Your answer' : 'This one is settled'}
          description={
            answerable
              ? 'Pick one of four equal options below, then send. Nothing is pre-selected.'
              : undefined
          }
          footnote={
            answerable ? (
              c.hoursUntilAutoApply !== null && c.hoursUntilAutoApply <= 0 ? (
                <>
                  Your window has already closed. The corrected grade applies by itself the next
                  time the job runs — until then, an answer here still counts.
                </>
              ) : (
                <>
                  No answer inside the window and the corrected grade applies by itself, at the
                  price band that grade carries.
                </>
              )
            ) : undefined
          }
        >
          {!answerable ? (
            <div className="flex flex-col gap-3">
              <Window c={c} />
              <p className="text-body-sm text-ink-2">
                {c.autoAppliedAt
                  ? 'Nobody answered inside the window, so the corrected grade was applied automatically.'
                  : 'Recorded. There is nothing further to do here.'}
              </p>
              {c.vendorResponse === 'DISPUTE' && (
                <p className="text-body-sm text-ink-2">
                  A QC manager reviews it and the machine is re-scanned in full. You will hear from
                  us; there is no deadline on you.
                </p>
              )}
              <Link className="text-body-sm text-ink underline underline-offset-4" to="/vendor/corrections">
                Back to your corrections
              </Link>
            </div>
          ) : (
            <>
              <fieldset className="flex flex-col gap-2 border-0 p-0">
                <legend className="sr-only">How do you want to answer this correction?</legend>
                {VENDOR_RESPONSES.map((r) => (
                  <Answer
                    key={r}
                    value={r}
                    label={ANSWER_LABEL[r]}
                    checked={choice === r}
                    onSelect={setChoice}
                  >
                    {r === 'ACCEPT_AND_REPRICE' && (
                      <Input
                        label="What you want for this machine"
                        mono
                        inputMode="decimal"
                        placeholder="38000"
                        hint={
                          c.askBefore === null
                            ? 'No amount is recorded against it today.'
                            : `You asked ${rupees(c.askBefore)} before the correction.`
                        }
                        error={
                          amount.trim() !== '' && !cleanAmount
                            ? 'Rupees, with at most two decimal places — for example 38000 or 38000.50.'
                            : undefined
                        }
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                      />
                    )}
                  </Answer>
                ))}
              </fieldset>

              <Textarea
                label={choice === 'DISPUTE' ? 'What did we get wrong?' : 'Anything to add?'}
                rows={3}
                hint={
                  choice === 'DISPUTE'
                    ? 'A QC manager reads this before the re-scan. Optional, but it is what they have to go on.'
                    : 'Optional. Kept with the record.'
                }
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />

              {failure && (
                <p className="text-body-sm text-fail" role="alert">
                  {failure}
                </p>
              )}

              <Button
                variant="primary"
                block
                loading={busy}
                disabledReason={blocker}
                onClick={() => void send()}
              >
                Send your answer
              </Button>
            </>
          )}
        </SidePanel>
      </div>
    </div>
  );
}
