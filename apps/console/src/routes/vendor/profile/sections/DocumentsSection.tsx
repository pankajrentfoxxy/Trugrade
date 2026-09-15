import * as React from 'react';
import { persistInOrder } from '../persist';
import { SectionDialog, StatusPill, Uploader, type UploadedFile } from '@trugrade/ui';
import {
  completeStep,
  getDocuments,
  saveStep,
  uploadDocument,
  type KycDocument,
} from '../../../../../../storefront/src/app/register/api';

/**
 * The three we ask for, none of them a gate. A supplier can save this card with
 * any of them missing: the reviewer sees exactly what arrived, and asks for the
 * rest through the review itself rather than a supplier being stopped here by a
 * cheque they do not have to hand.
 */
const DOC_TYPES = ['GST_CERTIFICATE', 'PAN_CARD', 'CANCELLED_CHEQUE'] as const;

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
  const [uploads, setUploads] = React.useState<Record<string, UploadedFile[]>>({});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>();

  React.useEffect(() => {
    if (!open) return;
    void getDocuments().then((result) => {
      if (result.ok) setDocs(result.data);
    });
    setError(undefined);
  }, [open]);

  const uploadedTypes = new Set([
    ...docs.map((d) => d.docType),
    ...Object.entries(uploads)
      .filter(([, rows]) => rows.some((r) => r.status === 'accepted'))
      .map(([type]) => type),
  ]);

  const save = async (): Promise<void> => {
    setBusy(true);
    // The hub's summary counts what was actually uploaded. Without the list it
    // could only say "three documents", which is a fabrication for a supplier
    // who saved with one.
    const uploadedDocTypes = DOC_TYPES.filter((t) => uploadedTypes.has(t));
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
      setDocs((d) => [...d.filter((x) => x.docType !== docType), result.data]);
      setUploads((prev) => ({
        ...prev,
        [docType]: [
          {
            id: result.data.id,
            name: result.data.originalFilename ?? file.name,
            sizeBytes: result.data.sizeBytes,
            status: 'accepted',
            viewable: true,
          },
        ],
      }));
    });
  };

  const labels: Record<string, string> = {
    GST_CERTIFICATE: 'GST certificate',
    PAN_CARD: 'PAN card',
    CANCELLED_CHEQUE: 'Cancelled cheque',
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
          if (existing) {
            return (
              <div
                key={docType}
                className="flex items-center justify-between gap-3 rounded border border-rule bg-sheet-2 px-4 py-3"
              >
                <div>
                  <p className="text-body-sm font-medium text-ink">{labels[docType]}</p>
                  <p className="font-mono text-label tnum text-ink-3">
                    {existing.originalFilename} · {Math.round(existing.sizeBytes / 1024)} KB
                  </p>
                </div>
                <StatusPill tone="pass" label="Uploaded" />
              </div>
            );
          }
          return (
            <Uploader
              key={docType}
              label={labels[docType] ?? docType}
              accept=".pdf,.jpg,.jpeg,.png"
              maxSizeMb={5}
              files={uploads[docType] ?? []}
              onSelect={(files) => handleUpload(docType, files)}
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
