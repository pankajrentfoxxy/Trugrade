import * as React from 'react';
import type { ResumableOnboarding } from '@trugrade/contracts';
import { Modal } from '@trugrade/ui';
import {
  getDocumentUrl,
  getDocuments,
  type KycDocument,
} from '../../../../../storefront/src/app/register/api';
import { stateName, stateNameForGstin } from '../../../../../storefront/src/app/register/picklists';
import type { ProfileSectionDef } from './sections.config';

/**
 * A supplier profile card, read.
 *
 * The buyer portal's profile has had this since its cards started locking
 * (`storefront/.../profile/SectionView.tsx`); the supplier hub did not. Once a
 * reviewer verifies a supplier — or while the application is with them — the
 * cards lose their button, and the one-line summary was the whole of what a
 * supplier could see of their own GSTIN, pickup address or payout account.
 * "Locked" and "hidden" are different things. This is the same saved answers
 * the edit dialogs load, laid out as facts rather than fields, with nothing on
 * it that writes.
 *
 * **A missing value says so, in `--ink-4`.** Never a blank row, and never left
 * out — a card that shows six facts when it has six and four when it has four
 * is a card nobody can tell is incomplete. "Not given" for an answer, "Not
 * uploaded" for a document: a missing value never renders as a present one.
 *
 * **The payout account stays masked.** The API sends the last four digits and
 * nothing more, and that is all this prints; a read-only view is not a reason
 * to show a number the edit dialog does not.
 *
 * **The Documents card can open its files.** It is the one card whose answer
 * is not a value but a thing — "Uploaded" says a file exists and nothing about
 * which — so each uploaded document has a View control that opens the file
 * itself, through the same short-lived link the edit card uses. It is still
 * read-only: it opens, it does not replace or remove. This is also where a
 * supplier now finds their documents; the separate Documents screen that only
 * listed them is gone.
 */

export interface Fact {
  label: string;
  /** Null when nothing was saved. Rendered as `missing`, never as a blank. */
  value: string | null;
  /** Numbers, codes and identifiers set in mono with tabular figures. */
  mono?: boolean;
  /** What a null value reads as. Defaults to "Not given". */
  missing?: string;
}

/** The account the session knows, for when the ACCOUNT step saved nothing. */
export interface AccountFallback {
  fullName?: string | null;
  email?: string | null;
  mobile?: string | null;
  legalName?: string | null;
}

const str = (row: Record<string, unknown> | undefined, key: string): string | null => {
  const v = row?.[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
};

const first = (rows: unknown): Record<string, unknown> | undefined =>
  Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined;

const record = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;

const CONSTITUTION: Readonly<Record<string, string>> = {
  PROPRIETORSHIP: 'Proprietorship',
  PARTNERSHIP: 'Partnership',
  LLP: 'LLP',
  PVT_LTD: 'Private Limited',
};

const VOLUME: Readonly<Record<string, string>> = {
  '1-10': 'Up to 10 / month',
  '11-50': '11–50 / month',
  '51-200': '51–200 / month',
  '201-500': '201–500 / month',
  '500+': '500+ / month',
};

const GRADE: Readonly<Record<string, string>> = { A_PLUS: 'A+', A: 'A', B: 'B' };

const BANK_STATUS: Readonly<Record<string, string>> = {
  SUCCESS: 'Verified',
  PENDING: 'Verification pending',
  NAME_MISMATCH: 'Name on the account does not match your business',
  FAILED: 'Verification failed',
};

/** The three uploads the Documents card takes, in the order it asks for them. */
const DOCUMENTS: ReadonlyArray<readonly [string, string]> = [
  ['GST_CERTIFICATE', 'GST certificate'],
  ['PAN_CARD', 'PAN card'],
  ['CANCELLED_CHEQUE', 'Cancelled cheque'],
];

/**
 * The collection window, in words.
 *
 * The card saves a row per weekday (0 is Sunday); this reads those rows back
 * rather than a label the card never stored, so it says what was actually
 * saved even if the list of windows on offer changes later.
 */
function collectionWindow(hours: unknown): string | null {
  const days = record(hours);
  if (!days) return null;
  const open: number[] = [];
  let times: string | null = null;
  for (let d = 0; d <= 6; d += 1) {
    const day = record(days[String(d)]);
    if (!day || day.closed === true) continue;
    open.push(d);
    const from = str(day, 'opensAt');
    const to = str(day, 'closesAt');
    if (!times && from && to) times = `${from}–${to}`;
  }
  if (open.length === 0) return null;
  const is = (...want: number[]): boolean =>
    open.length === want.length && want.every((d) => open.includes(d));
  const span = is(1, 2, 3, 4, 5)
    ? 'Mon–Fri'
    : is(1, 2, 3, 4, 5, 6)
      ? 'Mon–Sat'
      : open.length === 7
        ? 'All days'
        : `${open.length} days a week`;
  return times ? `${span} ${times}` : span;
}

function day(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? iso
    : at.toLocaleDateString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
}

/**
 * What each card holds, in the order the card asks for it.
 *
 * Read from the same places the edit dialogs read — `onboarding.answers`, the
 * payout account the API reports, and the session's own account for the
 * contact — so the view cannot disagree with the form that wrote it.
 */
export function sectionFacts(
  section: ProfileSectionDef,
  onboarding: ResumableOnboarding,
  account: AccountFallback | null,
): Fact[] {
  const answers = onboarding.answers;
  switch (section.id) {
    case 'account': {
      const a = answers.ACCOUNT;
      return [
        { label: 'Name', value: str(a, 'fullName') ?? account?.fullName?.trim() ?? null },
        { label: 'Work email', value: str(a, 'email') ?? account?.email?.trim() ?? null },
        { label: 'Mobile', value: str(a, 'mobile') ?? account?.mobile?.trim() ?? null, mono: true },
      ];
    }
    case 'business': {
      const statutory = answers.STATUTORY;
      const business = answers.BUSINESS_PROFILE;
      const constitution =
        onboarding.progress.constitution ?? str(business, 'constitution') ?? null;
      const gstin = str(statutory, 'primaryGstin') ?? str(first(statutory?.gstins), 'gstin');
      return [
        {
          label: 'Constitution',
          value: constitution
            ? (CONSTITUTION[constitution] ?? String(constitution).replace(/_/g, ' '))
            : null,
        },
        {
          label: 'Legal name',
          value:
            str(statutory, 'legalName') ??
            str(business, 'legalName') ??
            account?.legalName?.trim() ??
            null,
        },
        { label: 'GSTIN', value: gstin, mono: true },
        { label: 'PAN', value: str(statutory, 'pan'), mono: true },
        {
          label: 'State of registration',
          value: gstin ? (stateNameForGstin(gstin) ?? null) : null,
        },
        {
          label: 'Udyam number',
          value: str(record(statutory?.captured), 'udyam_number'),
          mono: true,
        },
      ];
    }
    case 'pickup': {
      const site = first(answers.FACILITY_CONTACTS?.facilities);
      const at = record(site?.address);
      const contact = record(record(answers.FACILITY_CONTACTS?.contacts)?.WAREHOUSE);
      return [
        { label: 'Address', value: str(at, 'line1') },
        { label: 'Landmark', value: str(at, 'line2') },
        { label: 'City', value: str(at, 'city') },
        { label: 'State', value: stateName(str(at, 'state') ?? '') ?? str(at, 'state') },
        { label: 'PIN code', value: str(at, 'pincode'), mono: true },
        { label: 'Collection contact', value: str(contact, 'fullName') },
        { label: 'Their mobile', value: str(contact, 'mobile'), mono: true },
        { label: 'Collection window', value: collectionWindow(site?.hours) },
      ];
    }
    case 'bank': {
      const bank = onboarding.payoutAccount;
      return [
        { label: 'Account number', value: bank ? `•••• ${bank.last4}` : null, mono: true },
        { label: 'Bank', value: bank?.bankName ?? null },
        { label: 'IFSC', value: bank?.ifsc ?? null, mono: true },
        {
          label: 'Verification',
          value: bank ? (BANK_STATUS[bank.pennyDropStatus] ?? 'Not verified') : null,
          missing: 'No account on file',
        },
        ...(bank?.frozenUntil
          ? [{ label: 'Payouts on hold until', value: day(bank.frozenUntil) }]
          : []),
      ];
    }
    case 'documents': {
      const uploaded = answers.DOCUMENTS_BANK?.uploadedDocTypes;
      const held = Array.isArray(uploaded) ? uploaded : [];
      return DOCUMENTS.map(([type, label]) => ({
        label,
        value: held.includes(type) ? 'Uploaded' : null,
        missing: 'Not uploaded',
      }));
    }
    case 'stock': {
      const stock = answers.CAPABILITY;
      const list = (v: unknown): string[] =>
        Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : [];
      const brands = list(stock?.brands);
      const grades = list(stock?.grades);
      const volume = str(stock, 'monthlyVolume');
      const direct = stock?.canDropship;
      return [
        { label: 'Brands', value: brands.length > 0 ? brands.join(', ') : null },
        { label: 'Monthly volume', value: volume ? (VOLUME[volume] ?? volume) : null },
        {
          label: 'Grades',
          value: grades.length > 0 ? grades.map((g) => GRADE[g] ?? g).join(', ') : null,
        },
        {
          label: 'Ships direct to the buyer',
          value: direct === true ? 'Yes' : direct === false ? 'No' : null,
        },
      ];
    }
    case 'agreement': {
      const agreement = answers.AGREEMENT;
      const on = str(agreement, 'acceptedAt');
      return [
        {
          label: 'Accepted by',
          value: agreement?.accepted === true ? str(agreement, 'acceptedName') : null,
          missing: 'Not accepted',
        },
        { label: 'Agreement version', value: str(agreement, 'agreementVersion'), mono: true },
        ...(on ? [{ label: 'Accepted on', value: day(on) }] : []),
      ];
    }
  }
}

export function SectionViewDialog({
  section,
  onboarding,
  account,
  onClose,
}: {
  section: ProfileSectionDef | null;
  onboarding: ResumableOnboarding;
  account: AccountFallback | null;
  onClose: () => void;
}): React.JSX.Element {
  const facts = section ? sectionFacts(section, onboarding, account) : [];
  const documents = section?.id === 'documents';
  return (
    <Modal
      open={section !== null}
      onClose={onClose}
      title={section?.title ?? ''}
      description={
        onboarding.status === 'VERIFIED'
          ? 'These details are approved and locked. To change anything, contact support.'
          : 'These details are with our review team and cannot be changed until they decide.'
      }
      // It asks for nothing, so a click beside it may close it.
      dismissOnBackdrop
    >
      {documents ? (
        <DocumentFacts onboarding={onboarding} />
      ) : (
        <dl className="profile-facts" data-testid="section-facts">
          {facts.map((f) => (
            <div key={f.label}>
              <dt>{f.label}</dt>
              {f.value === null ? (
                <dd data-missing="true">{f.missing ?? 'Not given'}</dd>
              ) : (
                <dd className={f.mono ? 'font-mono tnum' : undefined}>{f.value}</dd>
              )}
            </div>
          ))}
        </dl>
      )}
    </Modal>
  );
}

/**
 * The Documents card, read: the three uploads, and a way to open each.
 *
 * It is mounted only while its dialog is showing, so the file list is read
 * when the supplier asks for it and not on every visit to the hub.
 *
 * WHICH SOURCE SAYS A DOCUMENT IS UPLOADED
 * ----------------------------------------
 * The file list, once it has arrived: a row is "Uploaded" when a file of that
 * type exists that a reviewer has not rejected — the same test the edit card
 * applies. Until it arrives, and if it cannot be read at all, the rows fall
 * back to what the card recorded when it was saved, so the supplier is not
 * told "Not uploaded" about a file that is merely slow to list. A View control
 * appears only beside a file that is actually in the list: there is nothing to
 * open otherwise.
 *
 * EVERY STATE
 * -----------
 *   - **Reading the list**: the rows show, the View controls do not yet.
 *   - **The list would not load**: says so, says it is on our side, offers to
 *     try again. The rows stay, from the saved record.
 *   - **Opening a file**: that row's control says "Opening…" and is disabled.
 *   - **A file would not open**: a message under that row, in the server's
 *     words, and the control is there to try again.
 */
function DocumentFacts({ onboarding }: { onboarding: ResumableOnboarding }): React.JSX.Element {
  const [docs, setDocs] = React.useState<KycDocument[] | null>(null);
  const [listError, setListError] = React.useState<string | null>(null);
  const [opening, setOpening] = React.useState<string | null>(null);
  const [rowError, setRowError] = React.useState<Readonly<Record<string, string>>>({});

  const load = React.useCallback((): void => {
    setListError(null);
    void getDocuments().then((result) => {
      if (result.ok) setDocs(result.data);
      else setListError(result.message);
    });
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const recorded = onboarding.answers.DOCUMENTS_BANK?.uploadedDocTypes;
  const onRecord = Array.isArray(recorded) ? recorded : [];

  const view = async (type: string, id: string): Promise<void> => {
    setOpening(type);
    setRowError(({ [type]: _cleared, ...rest }) => rest);
    const result = await getDocumentUrl(id);
    setOpening(null);
    if (!result.ok) {
      setRowError((e) => ({ ...e, [type]: result.message }));
      return;
    }
    window.open(result.data.url, '_blank', 'noopener,noreferrer');
  };

  return (
    <>
      <dl className="profile-facts" data-testid="section-facts">
        {DOCUMENTS.map(([type, label]) => {
          const file = docs?.find((d) => d.docType === type && d.status !== 'REJECTED');
          const uploaded = docs ? file !== undefined : onRecord.includes(type);
          const problem = rowError[type];
          return (
            <div key={type} data-has-note={problem ? 'true' : undefined}>
              <dt>{label}</dt>
              {uploaded ? (
                <dd>
                  <span>Uploaded</span>
                  {file ? (
                    <button
                      type="button"
                      className="profile-facts-action"
                      disabled={opening === type}
                      aria-label={`View ${label}`}
                      onClick={() => void view(type, file.id)}
                    >
                      {opening === type ? 'Opening…' : 'View'}
                    </button>
                  ) : null}
                </dd>
              ) : (
                <dd data-missing="true">Not uploaded</dd>
              )}
              {problem ? (
                <p className="profile-facts-note" role="alert">
                  We could not open this file. {problem}
                </p>
              ) : null}
            </div>
          );
        })}
      </dl>
      {listError ? (
        <p className="profile-facts-note" role="alert" data-testid="documents-unavailable">
          We could not load your files to open them. That is on our side, not yours. {listError}{' '}
          <button type="button" className="profile-facts-action" onClick={load}>
            Try again
          </button>
        </p>
      ) : null}
    </>
  );
}
