'use client';

import * as React from 'react';
import {
  Button,
  Checkbox,
  EmptyState,
  FormSection,
  Input,
  Skeleton,
  Uploader,
  formatFileSize,
  type UploadedFile,
  type UploadStatus,
  type WhyRailItem,
} from '@trugrade/ui';
import { Select } from '../../lib/controls';
import {
  deleteDocument,
  getDocuments,
  getDocumentTypes,
  uploadDocument,
  type DocumentStatus,
  type DocumentTypeRule,
  type KycDocument,
} from './api';
import { BUYER_DOCUMENTS, LANGUAGES, NOTIFICATION_CHANNELS } from './picklists';

/**
 * Step 5 — documents and preferences.
 *
 * **The checklist is data.** `GET /onboarding/documents/types` is
 * `kyc.document_type_rule`, so the label, the size cap, the accepted types, how
 * many of each we take and whether the document goes stale all come from the
 * server. Nothing here hard-codes "5 MB" or "GST certificate": a rule changed by
 * ops takes effect on the next load, and a document type withdrawn from the
 * table stops being asked for.
 *
 * **Nothing here decides whether a file is acceptable.** The server sniffs the
 * magic bytes, strips EXIF, refuses active content in a PDF and applies the age
 * rule — and its sentence is what the applicant reads, verbatim, against the
 * file that caused it. The only local checks are the two that save a doomed
 * 5 MB round trip, and they say the same thing the server would.
 *
 * **One request per file.** Each file therefore has its own progress and its own
 * refusal; "three of your five uploaded" is a shape nobody can act on.
 *
 * **Not one box on this screen starts ticked.** Notification channels and the
 * PO-required flag are exactly where a pre-ticked default ships, and CP e-Comm
 * Rule 4(9) forbids it.
 */

export const WHY_DOCUMENTS: readonly WhyRailItem[] = [
  {
    term: 'Documents',
    explanation: (
      <>
        <p>
          Every file is checked by its contents rather than its name, stripped of the location and
          device data a phone photo carries, and shown only to the reviewer handling your
          application.
        </p>
        <p className="mt-2">
          We keep them for as long as the tax rules require us to hold the invoice they support.
        </p>
      </>
    ),
  },
  {
    term: 'Purchase order',
    explanation:
      'If your finance team requires a PO number before an invoice can be paid, say so here and we will refuse to raise an invoice without one — rather than discovering it at the end of the month.',
  },
];

/* ==========================================================================
 * Draft shape
 * ======================================================================== */

export interface DocumentsValues {
  /** Channel codes. Empty is the honest starting state, and a valid one to leave. */
  channels: string[];
  language: string;
  poRequired: boolean;
}

const EMPTY: DocumentsValues = { channels: [], language: '', poRequired: false };

export function readDocumentsDraft(answers: Record<string, unknown>): DocumentsValues {
  return {
    channels: Array.isArray(answers.channels)
      ? (answers.channels as unknown[]).filter((c): c is string => typeof c === 'string')
      : EMPTY.channels,
    language: typeof answers.language === 'string' ? answers.language : EMPTY.language,
    poRequired: answers.poRequired === true,
  };
}

/* ==========================================================================
 * Server document → the shape `Uploader` renders
 * ======================================================================== */

const STATUS: Record<DocumentStatus, UploadStatus> = {
  UPLOADED: 'pending-review',
  UNDER_REVIEW: 'pending-review',
  VERIFIED: 'accepted',
  REJECTED: 'rejected',
  EXPIRED: 'expired',
};

/** A file this browser is still sending, or one the server has just refused. */
interface Pending {
  id: string;
  docType: string;
  name: string;
  sizeBytes: number;
  progressPct: number;
  /** The server's sentence, against the file it refused. */
  refusal?: string;
}

const asUploaded = (doc: KycDocument): UploadedFile => ({
  id: doc.id,
  name: doc.originalFilename ?? doc.label,
  sizeBytes: doc.sizeBytes,
  status: STATUS[doc.status],
  // A reviewer's rejection is their own wording, never summarised here.
  ...(doc.rejectionReason ? { rejectionReason: doc.rejectionReason } : {}),
});

const asPending = (p: Pending): UploadedFile => ({
  id: p.id,
  name: p.name,
  sizeBytes: p.sizeBytes,
  status: p.refusal ? 'rejected' : 'uploading',
  progressPct: p.progressPct,
  ...(p.refusal ? { rejectionReason: p.refusal } : {}),
});

/** A document that still counts: a rejected one has to be sent again. */
const usable = (doc: KycDocument): boolean => doc.status !== 'REJECTED';

/**
 * The two refusals worth making without a round trip.
 *
 * Deliberately not a re-implementation of the server's checks: it never looks at
 * the bytes, so a JPEG renamed `.pdf` goes to the server and is refused there —
 * which is where that decision belongs.
 */
function localRefusal(file: File, rule: DocumentTypeRule): string | undefined {
  if (file.size > rule.maxBytes)
    return `${file.name} is ${formatFileSize(file.size)}. The most we can take is ${formatFileSize(rule.maxBytes)} — try a lower-resolution scan.`;
  if (file.size === 0) return `${file.name} is empty.`;
  return undefined;
}

/** Distinguishes one in-flight file from another. Never shown. */
let sendSeq = 0;

/* ==========================================================================
 * The step
 * ======================================================================== */

export interface StepDocumentsProps {
  answers: Record<string, unknown>;
  onSaveDraft: (values: Record<string, unknown>, completionPct: number) => void;
  onContinue: (
    values: Record<string, unknown>,
    completionPct: number,
  ) => Promise<Record<string, string> | null>;
  busy: boolean;
  onFieldFocus: (term: string) => void;
  blockingReason?: string | null;
}

export function StepDocuments({
  answers,
  onSaveDraft,
  onContinue,
  busy,
  onFieldFocus,
  blockingReason,
}: StepDocumentsProps): React.JSX.Element {
  const [values, setValues] = React.useState<DocumentsValues>(() => readDocumentsDraft(answers));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [rules, setRules] = React.useState<DocumentTypeRule[] | null>(null);
  const [docs, setDocs] = React.useState<KycDocument[]>([]);
  const [pending, setPending] = React.useState<Pending[]>([]);
  const [loadFailure, setLoadFailure] = React.useState<string | null>(null);
  /**
   * The date printed on the document, per doc type — asked for **only** where
   * the rule table gives that type a `maxAgeDays`. Without it the server refuses
   * an age-limited upload with "tell us the date", which is a refusal the
   * applicant would have no field to answer.
   */
  const [dates, setDates] = React.useState<Record<string, string>>({});

  const load = React.useCallback(async (): Promise<void> => {
    const [types, existing] = await Promise.all([getDocumentTypes(), getDocuments()]);
    if (!types.ok) {
      setLoadFailure(types.message);
      return;
    }
    setLoadFailure(null);
    setRules(types.data);
    if (existing.ok) setDocs(existing.data);
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  /* ------------------------------------------------------------- uploading */

  const asked = React.useMemo(
    () =>
      // The client picks WHICH documents a buyer is asked for; every rule about
      // each of them is the server's. A code the table no longer carries is not
      // rendered, rather than rendered without its rules.
      BUYER_DOCUMENTS.map((wanted) => ({
        ...wanted,
        rule: rules?.find((r) => r.docType === wanted.docType),
      })).filter(
        (w): w is (typeof BUYER_DOCUMENTS)[number] & { rule: DocumentTypeRule } =>
          w.rule !== undefined,
      ),
    [rules],
  );

  const send = async (file: File, rule: DocumentTypeRule): Promise<void> => {
    // A counter, not a timestamp: two files chosen in one gesture would share a
    // millisecond, and two rows sharing a key is a row that never clears.
    sendSeq += 1;
    const id = `${rule.docType}-${sendSeq}`;
    const refusal = localRefusal(file, rule);
    if (refusal) {
      setPending((p) => [
        ...p,
        { id, docType: rule.docType, name: file.name, sizeBytes: file.size, progressPct: 0, refusal },
      ]);
      return;
    }

    setPending((p) => [
      ...p,
      { id, docType: rule.docType, name: file.name, sizeBytes: file.size, progressPct: 0 },
    ]);

    const documentDate = dates[rule.docType];
    const result = await uploadDocument({
      docType: rule.docType,
      file,
      ...(documentDate ? { documentDate } : {}),
      onProgress: (pct) =>
        setPending((p) => p.map((row) => (row.id === id ? { ...row, progressPct: pct } : row))),
    });

    if (result.ok) {
      setPending((p) => p.filter((row) => row.id !== id));
      setDocs((d) => [result.data, ...d]);
      setErrors(({ [rule.docType]: _dropped, ...rest }) => rest);
      return;
    }

    // The refusal names the file. `DocumentService` puts the filename in front
    // of the reason precisely so a list of six says which one failed.
    setPending((p) =>
      p.map((row) => (row.id === id ? { ...row, refusal: result.message } : row)),
    );
  };

  const remove = async (id: string, docType: string): Promise<void> => {
    if (pending.some((p) => p.id === id)) {
      setPending((p) => p.filter((row) => row.id !== id));
      return;
    }
    const result = await deleteDocument(id);
    if (!result.ok) {
      setErrors((e) => ({ ...e, [docType]: result.message }));
      return;
    }
    setDocs((d) => d.filter((doc) => doc.id !== id));
  };

  /* ----------------------------------------------------------- preferences */

  const save = (next: DocumentsValues): void => {
    setValues(next);
    onSaveDraft({ ...next }, completionOf(next, asked, docs));
  };

  const toggleChannel = (code: string, on: boolean): void => {
    setErrors(({ channels: _dropped, ...rest }) => rest);
    save({
      ...values,
      channels: on ? [...values.channels, code] : values.channels.filter((c) => c !== code),
    });
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const found: Record<string, string> = {};

    for (const wanted of asked) {
      if (!wanted.required) continue;
      const held = docs.filter((d) => d.docType === wanted.docType && usable(d));
      if (held.length === 0)
        found[wanted.docType] = `Upload the ${wanted.rule.label.toLowerCase()} before you continue.`;
    }
    if (values.channels.length === 0)
      found.channels =
        'Choose at least one way to reach you. We have to be able to send an order confirmation.';
    if (!values.language) found.language = 'Choose the language for messages we send you.';

    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    const refusal = await onContinue({ ...values }, 100);
    if (refusal) setErrors(refusal);
  };

  /* ----------------------------------------------------------------- view */

  if (loadFailure) {
    return (
      <EmptyState
        title="We could not load the document checklist"
        body={`${loadFailure} The list of documents we ask for is held on our side, and this step cannot ask for the right ones without it.`}
        action={
          <Button variant="primary" onClick={() => void load()}>
            Try again
          </Button>
        }
      />
    );
  }

  if (rules === null) {
    return (
      <div className="flex flex-col gap-4 rounded-lg border border-rule bg-sheet p-5">
        <Skeleton lines={6} />
        <p className="text-body-sm text-ink-3" role="status">
          Loading the documents this application needs…
        </p>
      </div>
    );
  }

  // Required only, in both halves of the fraction: counting an optional
  // document as "supplied" when nothing was sent is the missing value rendering
  // as a passing one.
  const mandatory = asked.filter((w) => w.required);
  const heldCount = mandatory.filter((w) =>
    docs.some((d) => d.docType === w.docType && usable(d)),
  ).length;

  return (
    <form className="flex flex-col gap-6" onSubmit={(e) => void submit(e)} noValidate>
      {blockingReason && (
        <p role="alert" className="rounded border border-fail bg-sheet-2 p-4 text-body-sm text-fail">
          {blockingReason}
        </p>
      )}

      <FormSection
        title="Documents"
        description="Clear photographs are fine — we do not need scans. Each file is checked by its contents, and anything we cannot read we will ask for again."
        status={
          <>
            <span className="tnum">{heldCount}</span> of{' '}
            <span className="tnum">{mandatory.length}</span> required documents
          </>
        }
      >
        {asked.map((wanted) => {
          const rule = wanted.rule;
          const held = docs.filter((d) => d.docType === rule.docType);
          const inFlight = pending.filter((p) => p.docType === rule.docType);
          const files: UploadedFile[] = [...inFlight.map(asPending), ...held.map(asUploaded)];
          const room = rule.maxFiles - held.filter(usable).length;

          return (
            <div
              key={rule.docType}
              className="flex flex-col gap-3"
              onFocus={() => onFieldFocus('Documents')}
            >
              {rule.maxAgeDays !== null && (
                <Input
                  label={`Date on the ${rule.label}`}
                  type="date"
                  mono
                  required
                  hint={`We can only accept one issued in the last ${rule.maxAgeDays} days, so we check the date before the file.`}
                  value={dates[rule.docType] ?? ''}
                  onChange={(e) =>
                    setDates((d) => ({ ...d, [rule.docType]: e.target.value }))
                  }
                />
              )}
              <Uploader
                label={`${rule.label}${wanted.required ? '' : ' — optional'}`}
                hint={
                  <>
                    {wanted.purpose}{' '}
                    <span className="text-ink-3">
                      {rule.acceptedMime
                        .map((m) => m.replace('image/', '').replace('application/', ''))
                        .join(', ')
                        .toUpperCase()}
                      , up to{' '}
                      <span className="font-mono tnum">{formatFileSize(rule.maxBytes)}</span>,{' '}
                      <span className="font-mono tnum">{rule.maxFiles}</span>{' '}
                      {rule.maxFiles === 1 ? 'file' : 'files'} at most.
                      {rule.maxAgeDays !== null && (
                        <>
                          {' '}
                          Issued in the last{' '}
                          <span className="font-mono tnum">{rule.maxAgeDays}</span> days.
                        </>
                      )}
                    </span>
                  </>
                }
                accept={rule.acceptedMime.join(',')}
                maxSizeMb={Math.floor(rule.maxBytes / (1024 * 1024))}
                multiple={rule.maxFiles > 1}
                files={files}
                disabled={room <= 0 || (rule.maxAgeDays !== null && !dates[rule.docType])}
                onSelect={(chosen) => {
                  for (const file of chosen.slice(0, Math.max(room, 0))) void send(file, rule);
                }}
                onRemove={(id) => void remove(id, rule.docType)}
                error={errors[rule.docType]}
              />

              {/* The per-file percentage, visibly.
                  `Uploader` takes `progressPct` and announces it to a screen
                  reader only — it renders an "Uploading" pill and no number — so
                  the bar is here rather than in the package. It belongs in
                  `Uploader`, and is reported as a gap. */}
              {inFlight
                .filter((p) => !p.refusal)
                .map((p) => (
                  <div key={`${p.id}-progress`} className="flex flex-col gap-2">
                    <p className="flex flex-wrap items-baseline gap-3 text-body-sm text-ink-2">
                      <span className="min-w-0 truncate">{p.name}</span>
                      <span className="ml-auto font-mono text-data tnum text-acc-ink">
                        {p.progressPct}% of {formatFileSize(p.sizeBytes)}
                      </span>
                    </p>
                    <div
                      role="progressbar"
                      aria-valuenow={p.progressPct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`Uploading ${p.name}`}
                      className="h-1 w-full overflow-hidden rounded bg-sheet-3"
                    >
                      <div className="h-1 bg-acc" style={{ width: `${p.progressPct}%` }} />
                    </div>
                  </div>
                ))}
              {room <= 0 && (
                <p className="mt-2 text-body-sm text-ink-3">
                  You have sent the most we take for this document. Remove one to add another.
                </p>
              )}
            </div>
          );
        })}
      </FormSection>

      {/* ------------------------------------------------------ preferences */}
      <FormSection
        title="How we reach you"
        description="Order confirmations, dispatch notices and invoices. Nothing here is marketing, and none of it is switched on until you switch it on."
      >
        <fieldset
          className="flex flex-col gap-3"
          onFocus={() => onFieldFocus('Documents and preferences')}
        >
          <legend className="mb-1 text-body-sm font-medium text-ink-2">
            Notification channels{' '}
            <span className="text-fail" aria-hidden="true">
              *
            </span>
          </legend>
          {NOTIFICATION_CHANNELS.map((channel) => (
            <Checkbox
              key={channel.code}
              label={channel.label}
              consequence={channel.consequence}
              checked={values.channels.includes(channel.code)}
              onChange={(on) => toggleChannel(channel.code, on)}
            />
          ))}
          {errors.channels && (
            <p role="alert" className="text-body-sm text-fail">
              {errors.channels}
            </p>
          )}
        </fieldset>

        <Select
          label="Language"
          hint="The language we write to you in. Invoices are in English regardless — that is a tax requirement."
          required
          options={LANGUAGES}
          value={values.language}
          onFocus={() => onFieldFocus('Documents and preferences')}
          onChange={(e) => {
            setErrors(({ language: _dropped, ...rest }) => rest);
            save({ ...values, language: e.target.value });
          }}
          error={errors.language}
        />
      </FormSection>

      <FormSection
        title="Purchase orders"
        description="Some finance teams will not settle an invoice that has no PO number against it."
      >
        <Checkbox
          label="We require a purchase order number on every invoice"
          consequence="We will not raise an invoice for this account without a PO number, and checkout will ask for one on every order."
          checked={values.poRequired}
          onChange={(poRequired) => save({ ...values, poRequired })}
        />
      </FormSection>

      <div className="flex flex-wrap items-center gap-4 border-t border-rule-2 pt-5">
        <Button type="submit" variant="primary" loading={busy}>
          Save and continue
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => onSaveDraft({ ...values }, completionOf(values, asked, docs))}
        >
          Save and finish later
        </Button>
      </div>
    </form>
  );
}

/** What `completion_pct` counts: every required document, plus the two answers. */
function completionOf(
  values: DocumentsValues,
  asked: ReadonlyArray<{ docType: string; required: boolean }>,
  docs: readonly KycDocument[],
): number {
  const checks = [
    ...asked
      .filter((a) => a.required)
      .map((a) => docs.some((d) => d.docType === a.docType && usable(d))),
    values.channels.length > 0,
    values.language.length > 0,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}
