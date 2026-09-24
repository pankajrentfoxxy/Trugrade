import * as React from 'react';
import { persistInOrder } from '../persist';
import { SectionDialog, Uploader, type UploadedFile, type UploadStatus } from '@trugrade/ui';
import {
  completeStep,
  deleteDocument,
  getDocuments,
  getDocumentUrl,
  saveStep,
  uploadDocument,
  type DocumentStatus,
  type KycDocument,
} from '../../../../../../storefront/src/app/register/api';

/**
 * The three we ask for, none of them a gate. A supplier can save this card with
 * any of them missing: the reviewer sees exactly what arrived, and asks for the
 * rest through the review itself rather than a supplier being stopped here by a
 * cheque they do not have to hand.
 */
const DOC_TYPES = ['GST_CERTIFICATE', 'PAN_CARD', 'CANCELLED_CHEQUE'] as const;

const LABELS: Record<string, string> = {
  GST_CERTIFICATE: 'GST certificate',
  PAN_CARD: 'PAN card',
  CANCELLED_CHEQUE: 'Cancelled cheque',
};

/**
 * The server's status, in the pill's words. `UPLOADED` is "With our team", not
 * "Accepted": nobody has looked at it yet, and a tick would say they had.
 */
const STATUS: Record<DocumentStatus, UploadStatus> = {
  UPLOADED: 'pending-review',
  UNDER_REVIEW: 'pending-review',
  VERIFIED: 'accepted',
  REJECTED: 'rejected',
  EXPIRED: 'expired',
};

/**
 * `DocumentService.remove` refuses these with a 409. The button is withheld
 * rather than shown and failed, so the card never offers what the server will
 * not do.
 */
const SETTLED: ReadonlySet<DocumentStatus> = new Set(['VERIFIED', 'UNDER_REVIEW']);

const asUploaded = (doc: KycDocument): UploadedFile => ({
  id: doc.id,
  name: doc.originalFilename ?? doc.label,
  sizeBytes: doc.sizeBytes,
  status: STATUS[doc.status],
  viewable: true,
  // A reviewer's rejection is their own wording, never summarised here.
  ...(doc.rejectionReason ? { rejectionReason: doc.rejectionReason } : {}),
});

export interface DocumentsSectionProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  initial: Record<string, unknown>;
}

export function DocumentsSection({
  open,
  onClose,
  onSaved,
  initial,
}: DocumentsSectionProps): React.JSX.Element {
  const [docs, setDocs] = React.useState<KycDocument[]>([]);
  /** Files this browser is still sending, or that the server has just refused. */
  const [uploads, setUploads] = React.useState<Record<string, UploadedFile[]>>({});
  /** A view or remove refusal, against the document type it concerns. */
  const [rowError, setRowError] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>();

  React.useEffect(() => {
    if (!open) return;
    void getDocuments().then((result) => {
      if (result.ok) setDocs(result.data);
    });
    setError(undefined);
    setRowError({});
  }, [open]);

  const clearRowError = (docType: string): void =>
    setRowError(({ [docType]: _dropped, ...rest }) => rest);

  // A rejected document has to be sent again, so it does not count as held.
  const held = (docType: string): KycDocument | undefined =>
    docs.find((d) => d.docType === docType && d.status !== 'REJECTED');

  const save = async (): Promise<void> => {
    setBusy(true);
    // The hub's summary counts what was actually uploaded. Without the list it
    // could only say "three documents", which is a fabrication for a supplier
    // who saved with one.
    const uploadedDocTypes = DOC_TYPES.filter((t) => held(t) !== undefined);
    const failed = await persistInOrder([
      () =>
        saveStep('DOCUMENTS_BANK', { ...initial, documentsComplete: true, uploadedDocTypes }, 100),
      () => completeStep('DOCUMENTS_BANK'),
    ]);
    setBusy(false);
    if (failed) {
      setError(failed);
      return;
    }
    onSaved();
  };

  const handleUpload = (docType: string, files: File[]): void => {
    const file = files[0];
    if (!file) return;
    const id = `${docType}-${file.name}`;
    clearRowError(docType);
    setUploads((prev) => ({
      ...prev,
      [docType]: [
        {
          id,
          name: file.name,
          sizeBytes: file.size,
          status: 'uploading',
          progressPct: 0,
        },
      ],
    }));
    void uploadDocument({
      docType,
      file,
      onProgress: (pct) => {
        setUploads((prev) => ({
          ...prev,
          [docType]: (prev[docType] ?? []).map((row) =>
            row.id === id ? { ...row, progressPct: pct } : row,
          ),
        }));
      },
    }).then((result) => {
      if (!result.ok) {
        setUploads((prev) => ({
          ...prev,
          [docType]: (prev[docType] ?? []).map((row) =>
            row.id === id ? { ...row, status: 'rejected', rejectionReason: result.message } : row,
          ),
        }));
        return;
      }
      // The server's row replaces the local one: from here on the file is
      // viewed and removed by the id the server gave it.
      setDocs((d) => [...d.filter((x) => x.docType !== docType), result.data]);
      setUploads(({ [docType]: _sent, ...rest }) => rest);
    });
  };

  const view = async (docType: string, id: string): Promise<void> => {
    const result = await getDocumentUrl(id);
    if (!result.ok) {
      setRowError((e) => ({ ...e, [docType]: result.message }));
      return;
    }
    clearRowError(docType);
    window.open(result.data.url, '_blank', 'noopener,noreferrer');
  };

  const remove = async (docType: string, id: string): Promise<void> => {
    // A refused local file never reached the server; dropping the row is enough.
    if ((uploads[docType] ?? []).some((row) => row.id === id)) {
      setUploads(({ [docType]: _dropped, ...rest }) => rest);
      clearRowError(docType);
      return;
    }
    const result = await deleteDocument(id);
    if (!result.ok) {
      setRowError((e) => ({ ...e, [docType]: result.message }));
      return;
    }
    clearRowError(docType);
    setDocs((d) => d.filter((x) => x.id !== id));
  };

  return (
    <SectionDialog
      open={open}
      onClose={onClose}
      title="Documents"
      subtitle="All optional — add what you have now. Checked by contents, not filename. Max 5 MB each."
      stepIndex={1}
      stepCount={1}
      primaryLabel="Save"
      primaryLoading={busy}
      onPrimary={() => void save()}
    >
      <div className="flex flex-col gap-5">
        {DOC_TYPES.map((docType) => {
          const existing = docs.find((d) => d.docType === docType);
          const inFlight = uploads[docType] ?? [];
          const rows = existing ? [asUploaded(existing), ...inFlight] : inFlight;
          const settled = existing !== undefined && SETTLED.has(existing.status);
          const hint =
            existing?.status === 'VERIFIED'
              ? 'Verified by our team. Ask support to reopen it if the details have moved on.'
              : existing?.status === 'UNDER_REVIEW'
                ? 'A reviewer is looking at this document. You can change it once they have finished.'
                : undefined;
          return (
            <Uploader
              // Keyed on the held document so the native picker remounts, and
              // so clears its "pan.png" caption, when one arrives or is removed.
              key={`${docType}:${existing?.id ?? 'none'}`}
              label={LABELS[docType] ?? docType}
              hint={hint}
              accept=".pdf,.jpg,.jpeg,.png"
              maxSizeMb={5}
              files={rows}
              // One file per type: the input opens again once the held one is removed.
              disabled={held(docType) !== undefined || inFlight.some((r) => r.status === 'uploading')}
              onSelect={(files) => handleUpload(docType, files)}
              onView={(id) => void view(docType, id)}
              onRemove={settled ? undefined : (id) => void remove(docType, id)}
              error={rowError[docType]}
            />
          );
        })}
        {error ? (
          <p className="text-body-sm text-fail" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </SectionDialog>
  );
}
