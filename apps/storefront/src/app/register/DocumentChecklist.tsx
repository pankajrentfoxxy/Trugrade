'use client';

import * as React from 'react';
import {
  Button,
  EmptyState,
  FormSection,
  Input,
  Skeleton,
  Uploader,
  formatFileSize,
  type UploadedFile,
  type UploadStatus,
} from '@trugrade/ui';
import {
  deleteDocument,
  getDocuments,
  getDocumentTypes,
  uploadDocument,
  type DocumentStatus,
  type DocumentTypeRule,
  type KycDocument,
} from './api';

/**
 * The document checklist, shared by the buyer's step 5 and the vendor's step 6.
 *
 * T6 built this against `POST /onboarding/documents`; the vendor step asks for
 * nine types where the buyer asks for four, and that difference is **data** —
 * a list of doc codes and why each one is wanted. Everything that makes the
 * upload correct is not: one request per file so each carries its own progress
 * and its own refusal, the server's sentence rendered verbatim against the file
 * that caused it, the date field that only appears for an age-limited type, and
 * the rules themselves coming from `GET /onboarding/documents/types` rather than
 * from a constant in the client.
 *
 * **Nothing here decides whether a file is acceptable.** The server sniffs the
 * magic bytes, strips EXIF, refuses active content in a PDF and applies the age
 * rule. The only local checks are the two that save a doomed 5 MB round trip,
 * and they say the same thing the server would.
 *
 * The parent owns the resulting list, because the parent is what validates the
 * step and what the review screen reads.
 */

/** One document this flow asks for, and why. The rules come from the server. */
export interface WantedDocument {
  docType: string;
  required: boolean;
  purpose: string;
}

const STATUS: Record<DocumentStatus, UploadStatus> = {
  UPLOADED: 'pending-review',
  UNDER_REVIEW: 'pending-review',
  VERIFIED: 'accepted',
  REJECTED: 'rejected',
  EXPIRED: 'expired',
};

/** A document that still counts: a rejected one has to be sent again. */
export const usable = (doc: KycDocument): boolean => doc.status !== 'REJECTED';

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

export interface DocumentChecklistProps {
  /** Which documents this flow asks for. A code the rule table no longer carries is skipped. */
  wanted: readonly WantedDocument[];
  title: string;
  description: string;
  /** Keyed by `docType`, from the parent's own submit validation. */
  errors: Record<string, string>;
  /** Cleared when a document of that type lands. */
  onClearError: (docType: string) => void;
  /** Called on load, upload and delete. The parent validates from this. */
  onDocsChange: (docs: KycDocument[]) => void;
  onFieldFocus: (term: string) => void;
  /** Which "why we ask" entry the right rail should open on. */
  whyTerm: string;
}

export function DocumentChecklist({
  wanted,
  title,
  description,
  errors,
  onClearError,
  onDocsChange,
  onFieldFocus,
  whyTerm,
}: DocumentChecklistProps): React.JSX.Element {
  const [rules, setRules] = React.useState<DocumentTypeRule[] | null>(null);
  const [docs, setDocs] = React.useState<KycDocument[]>([]);
  const [pending, setPending] = React.useState<Pending[]>([]);
  const [loadFailure, setLoadFailure] = React.useState<string | null>(null);
  const [removalFailure, setRemovalFailure] = React.useState<Record<string, string>>({});
  /**
   * The date printed on the document, per doc type — asked for **only** where
   * the rule table gives that type a `maxAgeDays`. Without it the server refuses
   * an age-limited upload with "tell us the date", which is a refusal the
   * applicant would have no field to answer.
   */
  const [dates, setDates] = React.useState<Record<string, string>>({});

  const publish = React.useCallback(
    (next: KycDocument[]): void => {
      setDocs(next);
      onDocsChange(next);
    },
    [onDocsChange],
  );

  const load = React.useCallback(async (): Promise<void> => {
    const [types, existing] = await Promise.all([getDocumentTypes(), getDocuments()]);
    if (!types.ok) {
      setLoadFailure(types.message);
      return;
    }
    setLoadFailure(null);
    setRules(types.data);
    if (existing.ok) publish(existing.data);
  }, [publish]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const asked = React.useMemo(
    () =>
      // The client picks WHICH documents this flow asks for; every rule about
      // each of them is the server's. A code the table no longer carries is not
      // rendered, rather than rendered without its rules.
      wanted
        .map((w) => ({ ...w, rule: rules?.find((r) => r.docType === w.docType) }))
        .filter((w): w is WantedDocument & { rule: DocumentTypeRule } => w.rule !== undefined),
    [wanted, rules],
  );

  const send = async (file: File, rule: DocumentTypeRule): Promise<void> => {
    // A counter, not a timestamp: two files chosen in one gesture would share a
    // millisecond, and two rows sharing a key is a row that never clears.
    sendSeq += 1;
    const id = `${rule.docType}-${sendSeq}`;
    const row: Pending = {
      id,
      docType: rule.docType,
      name: file.name,
      sizeBytes: file.size,
      progressPct: 0,
    };
    const refusal = localRefusal(file, rule);
    if (refusal) {
      setPending((p) => [...p, { ...row, refusal }]);
      return;
    }

    setPending((p) => [...p, row]);

    const documentDate = dates[rule.docType];
    const result = await uploadDocument({
      docType: rule.docType,
      file,
      ...(documentDate ? { documentDate } : {}),
      onProgress: (pct) =>
        setPending((p) => p.map((r) => (r.id === id ? { ...r, progressPct: pct } : r))),
    });

    if (result.ok) {
      setPending((p) => p.filter((r) => r.id !== id));
      publish([result.data, ...docs.filter((d) => d.id !== result.data.id)]);
      onClearError(rule.docType);
      return;
    }

    // The refusal names the file. `DocumentService` puts the filename in front
    // of the reason precisely so a list of six says which one failed.
    setPending((p) => p.map((r) => (r.id === id ? { ...r, refusal: result.message } : r)));
  };

  const remove = async (id: string, docType: string): Promise<void> => {
    if (pending.some((p) => p.id === id)) {
      setPending((p) => p.filter((r) => r.id !== id));
      return;
    }
    const result = await deleteDocument(id);
    if (!result.ok) {
      setRemovalFailure((e) => ({ ...e, [docType]: result.message }));
      return;
    }
    setRemovalFailure(({ [docType]: _dropped, ...rest }) => rest);
    publish(docs.filter((d) => d.id !== id));
  };

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
    <FormSection
      title={title}
      description={description}
      status={
        <>
          <span className="tnum">{heldCount}</span> of{' '}
          <span className="tnum">{mandatory.length}</span> required documents
        </>
      }
    >
      {asked.map((w) => {
        const rule = w.rule;
        const held = docs.filter((d) => d.docType === rule.docType);
        const inFlight = pending.filter((p) => p.docType === rule.docType);
        const files: UploadedFile[] = [...inFlight.map(asPending), ...held.map(asUploaded)];
        const room = rule.maxFiles - held.filter(usable).length;

        return (
          <div
            key={rule.docType}
            className="flex flex-col gap-3"
            onFocus={() => onFieldFocus(whyTerm)}
          >
            {rule.maxAgeDays !== null && (
              <Input
                label={`Date on the ${rule.label}`}
                type="date"
                mono
                required
                hint={`We can only accept one issued in the last ${rule.maxAgeDays} days, so we check the date before the file.`}
                value={dates[rule.docType] ?? ''}
                onChange={(e) => setDates((d) => ({ ...d, [rule.docType]: e.target.value }))}
              />
            )}
            <Uploader
              label={`${rule.label}${w.required ? '' : ' — optional'}`}
              hint={
                <>
                  {w.purpose}{' '}
                  <span className="text-ink-3">
                    {rule.acceptedMime
                      .map((m) => m.replace('image/', '').replace('application/', ''))
                      .join(', ')
                      .toUpperCase()}
                    , up to <span className="font-mono tnum">{formatFileSize(rule.maxBytes)}</span>,{' '}
                    <span className="font-mono tnum">{rule.maxFiles}</span>{' '}
                    {rule.maxFiles === 1 ? 'file' : 'files'} at most.
                    {rule.maxAgeDays !== null && (
                      <>
                        {' '}
                        Issued in the last{' '}
                        <span className="font-mono tnum">{rule.maxAgeDays}</span> days.
                      </>
                    )}
                    {/* `requires_expiry` is in the rule table and there is no
                        field on the upload route that carries an expiry date, so
                        the screen says who reads it rather than showing a box
                        that goes nowhere. Reported as an API gap. */}
                    {rule.requiresExpiry && (
                      <> A reviewer reads the validity date off the certificate itself.</>
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
              error={errors[rule.docType] ?? removalFailure[rule.docType]}
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
  );
}

/** Every required type this flow asks for that no usable file exists against. */
export function missingDocuments(
  wanted: readonly WantedDocument[],
  docs: readonly KycDocument[],
): WantedDocument[] {
  return wanted.filter(
    (w) => w.required && !docs.some((d) => d.docType === w.docType && usable(d)),
  );
}
