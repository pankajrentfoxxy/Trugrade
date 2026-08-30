import * as React from 'react';
import {
  Button,
  DataBoard,
  EmptyState,
  Modal,
  Skeleton,
  StatusPill,
  type Column,
  type StatusPillProps,
} from '@trugrade/ui';
import { Board, Section, Select, Textarea } from '../lib/controls';

/**
 * The evidence half of the onboarding record (archetype C): what our providers
 * said, and what the applicant sent us.
 *
 * Split out of `VendorReview.tsx` because the rule below is the one this pair of
 * screens gets wrong more than any other, and a rule worth a unit test is worth
 * a module boundary.
 */

// ===========================================================================
// Automated verification
// ===========================================================================

export interface VerificationCheck {
  id: string;
  checkType: string;
  /** PASS · FAIL · MISMATCH · PROVIDER_ERROR · TIMEOUT. */
  outcome: string;
  maskedInput: string;
  provider: string;
  matchScore: number | null;
  failureReason: string | null;
  attemptNo: number;
  checkedAt: string;
}

/**
 * What one outcome means, and — the load-bearing field — **whose problem it is.**
 *
 * `PROVIDER_ERROR` is not `FAIL`. CLAUDE.md states it, `verification.service.ts`
 * exists to preserve it, and this is the screen where it is either honoured or
 * quietly thrown away: the GST portal times out, a reviewer sees a red chip
 * against a business name, and an application that had nothing wrong with it
 * gets sent back for documents that were never the problem.
 *
 * So a provider failure is **neutral**, says in words that it is ours, and is
 * never counted as an outcome anywhere below. A `MISMATCH` is `warn` and not
 * `fail` for a narrower reason: the provider answered and the answer differs
 * from what was typed, which is a judgement for a person — a legal name with
 * "Private Limited" spelled out is a mismatch and not a fraud.
 */
export interface OutcomeMeaning {
  tone: StatusPillProps['tone'];
  label: string;
  /** True when the failure is ours, not the applicant's. */
  ours: boolean;
  /** What the reviewer should take from it, in a sentence. */
  sentence: string;
}

export const OUTCOMES: Record<string, OutcomeMeaning> = {
  PASS: {
    tone: 'pass',
    label: 'Pass',
    ours: false,
    sentence: 'The provider confirmed this against the source register.',
  },
  FAIL: {
    tone: 'fail',
    label: 'Failed',
    ours: false,
    sentence: 'The provider answered, and the answer is a refusal.',
  },
  MISMATCH: {
    tone: 'warn',
    label: 'Does not match',
    ours: false,
    sentence:
      'The provider answered and the answer differs from what was submitted. Not a failure — a difference for you to judge.',
  },
  PROVIDER_ERROR: {
    tone: 'neutral',
    label: 'No answer',
    ours: true,
    sentence:
      'Our verification provider did not answer. This is ours, not theirs: it retries automatically and consumes none of the applicant’s attempts.',
  },
  TIMEOUT: {
    tone: 'neutral',
    label: 'No answer',
    ours: true,
    sentence:
      'Our verification provider timed out. This is ours, not theirs: it retries automatically and consumes none of the applicant’s attempts.',
  },
};

/** An outcome the API has learned and this build has not. Never a tick. */
const UNKNOWN_OUTCOME: OutcomeMeaning = {
  tone: 'neutral',
  label: 'Unrecognised',
  ours: true,
  sentence:
    'This console does not recognise that outcome, so it is showing you the raw value rather than guessing what it means.',
};

export const meaningOf = (outcome: string): OutcomeMeaning =>
  OUTCOMES[outcome] ?? UNKNOWN_OUTCOME;

/** The three checks this product actually runs. A fourth appears if it has a row. */
const RUN_BY_THIS_PRODUCT = ['GSTIN', 'PAN', 'BANK_PENNY_DROP'] as const;

export const labelForCheck = (checkType: string): string =>
  CHECK_LABEL[checkType] ?? checkType;

const CHECK_LABEL: Record<string, string> = {
  GSTIN: 'GST registration',
  PAN: 'PAN',
  PAN_GSTIN_LINK: 'PAN ↔ GSTIN linkage',
  BANK_PENNY_DROP: 'Bank account (penny drop)',
  IFSC: 'IFSC',
  UDYAM: 'Udyam registration',
  CIN: 'CIN / LLPIN',
  AADHAAR_ESIGN: 'Aadhaar e-sign',
  BLACKLIST: 'Blacklist screen',
};

export interface CheckGroup {
  checkType: string;
  label: string;
  /**
   * The latest check that actually said something about the applicant.
   *
   * **Provider failures are excluded from this on purpose.** A penny-drop that
   * passed and then hit a 503 on a re-run has not become unverified, and a
   * penny-drop whose only rows are 503s has not failed — it has not been
   * answered. Null means exactly the second thing, and the screen says so.
   */
  verdict: VerificationCheck | null;
  /** Provider failures, newest first. Shown as ours, counted as nothing. */
  providerFailures: VerificationCheck[];
  /** Attempts that consumed one of the applicant's five per day. */
  consumingAttempts: number;
}

/**
 * Group the history into one row per check type.
 *
 * Exported and pure because this is the part with a wrong answer available:
 * folding a `PROVIDER_ERROR` into the verdict, or counting it as an attempt, are
 * both one line away and both wrong.
 */
export function groupChecks(checks: readonly VerificationCheck[]): CheckGroup[] {
  const types = [
    ...RUN_BY_THIS_PRODUCT,
    ...checks.map((c) => c.checkType).filter((t) => !RUN_BY_THIS_PRODUCT.includes(t as never)),
  ].filter((t, i, a) => a.indexOf(t) === i);

  return types.map((checkType) => {
    const mine = checks
      .filter((c) => c.checkType === checkType)
      .sort((a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt));
    const answers = mine.filter((c) => !meaningOf(c.outcome).ours);
    return {
      checkType,
      label: labelForCheck(checkType),
      verdict: answers[0] ?? null,
      providerFailures: mine.filter((c) => meaningOf(c.outcome).ours),
      consumingAttempts: answers.length,
    };
  });
}

function CheckRow({ group }: { group: CheckGroup }): React.JSX.Element {
  const meaning = group.verdict ? meaningOf(group.verdict.outcome) : null;

  return (
    <div className="border-b border-rule-2 py-4 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <span className="font-mono text-label uppercase tracking-[0.13em] text-ink-2">
          {group.label}
        </span>
        {meaning ? (
          <StatusPill tone={meaning.tone} label={meaning.label} />
        ) : group.providerFailures.length > 0 ? (
          // Not "FAIL", and not a blank. The applicant is not the reason this
          // has no answer, and a blank cell beside a name reads as one.
          <StatusPill tone="neutral" label="No answer yet" />
        ) : (
          <span className="text-body-sm text-ink-4">Not run</span>
        )}
      </div>

      {group.verdict ? (
        <div className="mt-2 flex flex-col gap-1">
          <p className="text-body-sm text-ink-2">{meaningOf(group.verdict.outcome).sentence}</p>
          {group.verdict.failureReason && (
            <p className="text-body-sm text-ink">{group.verdict.failureReason}</p>
          )}
          <p className="text-body-sm text-ink-3">
            <span className="font-mono tnum tracking-[0.08em] text-ink-2">
              {group.verdict.maskedInput}
            </span>
            <span aria-hidden="true" className="px-2 text-ink-4">
              ·
            </span>
            {group.verdict.provider}
            <span aria-hidden="true" className="px-2 text-ink-4">
              ·
            </span>
            attempt <span className="font-mono tnum">{group.verdict.attemptNo}</span>
            {group.verdict.matchScore !== null && (
              <>
                <span aria-hidden="true" className="px-2 text-ink-4">
                  ·
                </span>
                match <span className="font-mono tnum">
                  {Math.round(group.verdict.matchScore * 100)}%
                </span>{' '}
                <span className="text-ink-4">of a perfect name match</span>
              </>
            )}
          </p>
        </div>
      ) : group.providerFailures.length === 0 ? (
        <p className="mt-2 text-body-sm text-ink-4">
          This check has never been run for this applicant.
        </p>
      ) : null}

      {group.providerFailures.length > 0 && (
        // Stated even when a later attempt passed: a reviewer looking at a
        // penny-drop that took three goes is entitled to know the first two were
        // our provider and not the applicant.
        <p className="mt-2 text-body-sm text-ink-3">
          <span className="font-mono tnum text-ink-2">{group.providerFailures.length}</span> of the
          runs on this check got no answer from our provider. Those are ours — they retried
          automatically and consumed none of the applicant’s{' '}
          <span className="font-mono tnum">5</span> attempts a day.
          {group.providerFailures[0]?.failureReason && (
            <> Latest: {group.providerFailures[0].failureReason}</>
          )}
        </p>
      )}
    </div>
  );
}

export function VerificationPanel({
  checks,
}: {
  checks: readonly VerificationCheck[];
}): React.JSX.Element {
  const groups = React.useMemo(() => groupChecks(checks), [checks]);

  return (
    <Section
      title="Automated verification"
      subtitle="What our providers said. A provider that did not answer is our problem, and is never a verdict on the applicant."
    >
      {groups.map((g) => (
        <CheckRow key={g.checkType} group={g} />
      ))}
    </Section>
  );
}

// ===========================================================================
// Documents
// ===========================================================================

export interface KycDocument {
  id: string;
  docType: string;
  label: string;
  originalFilename: string | null;
  sizeBytes: number;
  status: string;
  documentDate: string | null;
  exifStrippedAt: string | null;
  avVerdict: string | null;
  rejectionReason: string | null;
  expiresOn: string | null;
  uploadedAt: string;
}

export interface RejectionReason {
  code: string;
  sentence: string;
}

/**
 * A document status is a fact about a file, not a verdict on a person.
 *
 * Only `REJECTED` is `fail`, because a refused document is a genuine refusal the
 * applicant has to act on and `--fail` is what that colour is for. `UPLOADED` is
 * neutral — it is the normal state of a file nobody has looked at yet, and
 * colouring it would put a caution on every row of every new application.
 */
const DOC_TONE: Record<string, StatusPillProps['tone']> = {
  UPLOADED: 'neutral',
  UNDER_REVIEW: 'info',
  VERIFIED: 'pass',
  REJECTED: 'fail',
  EXPIRED: 'warn',
};

const shortDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

export interface DocumentsPanelProps {
  documents: KycDocument[] | null;
  /** A refusal from the API, already turned into a sentence. */
  error: string | null;
  reasons: readonly RejectionReason[];
  /** Absent when the signed-in reviewer may read documents but not settle them. */
  onReview?: (
    documentId: string,
    body: { decision: 'VERIFIED' | 'REJECTED'; reasonCode?: string; specific?: string },
  ) => Promise<void>;
}

export function DocumentsPanel({
  documents,
  error,
  reasons,
  onReview,
}: DocumentsPanelProps): React.JSX.Element {
  const [rejecting, setRejecting] = React.useState<KycDocument | null>(null);
  const [reasonCode, setReasonCode] = React.useState('');
  const [specific, setSpecific] = React.useState('');
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);

  async function settle(
    doc: KycDocument,
    body: { decision: 'VERIFIED' | 'REJECTED'; reasonCode?: string; specific?: string },
  ): Promise<void> {
    if (!onReview) return;
    setBusyId(doc.id);
    setFailure(null);
    try {
      await onReview(doc.id, body);
      setRejecting(null);
      setReasonCode('');
      setSpecific('');
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  const columns: ReadonlyArray<Column<KycDocument>> = [
    {
      key: 'label',
      header: 'Document',
      cell: (d) => (
        <span className="flex flex-col gap-1">
          <span className="text-ink">{d.label}</span>
          {d.originalFilename && (
            <span className="font-mono text-label text-ink-3">{d.originalFilename}</span>
          )}
        </span>
      ),
    },
    {
      key: 'documentDate',
      header: 'Dated',
      cell: (d) =>
        d.documentDate ? (
          <span className="font-mono tnum text-ink-2">{shortDate(d.documentDate)}</span>
        ) : (
          // A document with no date is not a document dated today.
          <span className="text-ink-4">Not dated</span>
        ),
    },
    {
      key: 'av',
      header: 'Virus scan',
      cell: (d) =>
        d.avVerdict === null ? (
          // The scanner has never run. This is the exact shape of "a missing
          // value must never render as a passing one" — a tick here would tell a
          // reviewer a file was checked when nothing looked at it.
          <span className="text-ink-4">Not scanned</span>
        ) : (
          <span className="text-ink-2">{d.avVerdict.toLowerCase()}</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (d) => (
        <span className="flex flex-col gap-1">
          <StatusPill tone={DOC_TONE[d.status] ?? 'neutral'} label={d.status.replace(/_/g, ' ')} />
          {d.rejectionReason && (
            // Verbatim: this is the sentence the applicant reads, and a reviewer
            // has to be able to see exactly what was sent.
            <span className="max-w-prose text-body-sm text-ink-2">{d.rejectionReason}</span>
          )}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Decision',
      headerHidden: true,
      cell: (d) =>
        !onReview ? (
          <span className="text-body-sm text-ink-4">Read only</span>
        ) : d.status === 'VERIFIED' || d.status === 'REJECTED' ? (
          <span className="text-body-sm text-ink-4">Settled</span>
        ) : (
          <span className="flex gap-2">
            <Button
              variant="secondary"
              loading={busyId === d.id}
              onClick={() => void settle(d, { decision: 'VERIFIED' })}
            >
              Accept
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setRejecting(d);
                setFailure(null);
              }}
            >
              Reject
            </Button>
          </span>
        ),
    },
  ];

  return (
    <Section
      title="Documents"
      subtitle="What they sent us. Rejecting one sends your sentence straight to their screen."
    >
      {error !== null ? (
        <EmptyState
          title="You are not cleared for this applicant’s documents"
          body={`${error} Reading a business’s identity documents needs the document permission, which is held separately from the queue. Ask an administrator if you need it — nothing here is missing, you are just not being shown it.`}
        />
      ) : documents === null ? (
        <Skeleton lines={5} />
      ) : documents.length === 0 ? (
        <EmptyState
          title="No documents yet"
          body="This applicant has not uploaded anything. They cannot be approved until they do — the checklist is on their own onboarding screen."
        />
      ) : (
        <Board tableMinWidth={700}>
          <DataBoard
            caption={`${documents.length} documents on this application.`}
            columns={columns}
            rows={documents}
            rowKey={(d) => d.id}
          />
        </Board>
      )}

      {failure !== null && (
        <p role="alert" className="mt-3 text-body-sm text-fail">
          {failure} Nothing has been changed.
        </p>
      )}

      <Modal
        open={rejecting !== null}
        onClose={() => setRejecting(null)}
        title={`Reject ${rejecting?.label ?? 'this document'}`}
        description="The applicant reads the reason and your sentence, word for word, on their own screen. Say what you saw and what you need instead."
        footer={
          <div className="flex flex-wrap gap-3">
            <Button
              variant="danger"
              loading={busyId === rejecting?.id}
              disabledReason={
                !reasonCode
                  ? 'Choose a reason first.'
                  : specific.trim().length < 10
                    ? 'Write the sentence the applicant will read.'
                    : ''
              }
              onClick={() => {
                if (rejecting && reasonCode && specific.trim().length >= 10) {
                  void settle(rejecting, {
                    decision: 'REJECTED',
                    reasonCode,
                    specific: specific.trim(),
                  });
                }
              }}
            >
              Reject this document
            </Button>
            <Button variant="ghost" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <Select
            label="Reason"
            value={reasonCode}
            onChange={(e) => setReasonCode(e.target.value)}
            options={[
              { value: '', label: 'Choose a reason…' },
              ...reasons.map((r) => ({ value: r.code, label: r.sentence })),
            ]}
          />
          <Textarea
            label="What is wrong with this particular file?"
            hint="For example: “dated January 2026; we need one issued in the last three months.”"
            rows={4}
            value={specific}
            onChange={(e) => setSpecific(e.target.value)}
          />
          {reasonCode && specific.trim().length >= 10 && (
            <div className="rounded border border-rule bg-sheet-2 p-4">
              <p className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">
                What they will read
              </p>
              <p className="mt-2 text-body-sm text-ink">
                {reasons.find((r) => r.code === reasonCode)?.sentence} {specific.trim()}
              </p>
            </div>
          )}
        </div>
      </Modal>
    </Section>
  );
}
