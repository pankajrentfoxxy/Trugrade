'use client';

import * as React from 'react';
import { Button, EmptyState, Skeleton, StatusPill } from '@trugrade/ui';
import {
  getDocuments,
  type KycDocument,
  type ReviewDecision,
  type StepProgress,
} from '../../register/api';
import {
  ACCOUNT_TYPES,
  CONSTITUTIONS,
  HEARD_FROM,
  LANGUAGES,
  FACILITY_TYPES,
  MONTHLY_VOLUMES,
  PAYOUT_CYCLES,
  PRICING_MODES,
  SOURCING_CHANNELS,
  STAFF_BANDS,
  SUPPLY_CATEGORIES,
  VENDOR_AGREEMENTS,
  VENDOR_CATEGORIES,
  VENDOR_CONTACT_ROLES,
  VENDOR_DOCUMENTS,
  VENDOR_NOTIFICATION_CHANNELS,
} from '../../register/picklists';
import {
  ApplicationStatus,
  Rows,
  StepBlock,
  WITH_US,
  labelOrBlank,
  str,
  unreadable,
  type Row,
  type StatusCopy,
} from '../../register/review-parts';

/**
 * The supplier's review screen and everything after it.
 *
 * The grammar is `review-parts` — "Not provided" for a gap, a reviewer's
 * `blocking_reason` verbatim, the SLA counted off the server's own due date, and
 * the per-step state list. What is here is the seven steps a *vendor* has and
 * what each of them is worth reading back: the capability declaration, the sites
 * goods leave from, the account we pay into, and what they agreed to.
 *
 * The one known limit is the same one the buyer's screen carries: `completeStep`
 * clears a step's draft and no module has registered a promotion, so a COMPLETE
 * step's answers exist nowhere a client can read. After a cold reload such a
 * step says it is complete and says plainly that its answers are not shown —
 * which is true, rather than a screen of false gaps.
 */

/* ==========================================================================
 * One step's answers → rows
 * ======================================================================== */

const list = (a: Record<string, unknown>, key: string): string[] =>
  Array.isArray(a[key])
    ? (a[key] as unknown[]).filter((v): v is string => typeof v === 'string')
    : [];

/**
 * Codes → the words the applicant chose them by.
 *
 * A review screen that prints `CORPORATE_BUYBACK` is asking somebody to check
 * their own answers against a list they have never seen. An unknown code is
 * printed as it stands rather than dropped — it is still an answer.
 */
const labelled = (
  options: readonly { code: string; label: string }[],
  codes: readonly string[],
): string =>
  codes.map((c) => options.find((o) => o.code === c)?.label ?? c).join(', ');

const accountRows = (a: Record<string, unknown>): Row[] => [
  { label: 'Your name', value: str(a, 'fullName'), required: true },
  { label: 'Company', value: str(a, 'companyName'), required: true },
  { label: 'Work email', value: str(a, 'email'), required: true, mono: true },
  { label: 'Mobile', value: str(a, 'mobile'), required: true, mono: true },
  { label: 'City you work from', value: str(a, 'city'), required: true },
  {
    label: 'Laptops a month',
    value: labelOrBlank(MONTHLY_VOLUMES, str(a, 'monthlyVolume')),
    required: true,
  },
  { label: 'Brands', value: list(a, 'brands').join(', ') },
  { label: 'How you found us', value: labelOrBlank(HEARD_FROM, str(a, 'heardFrom')) },
];

const businessRows = (a: Record<string, unknown>): Row[] => [
  { label: 'Legal name', value: str(a, 'legalName'), required: true },
  { label: 'Trade name', value: str(a, 'tradeName') },
  {
    label: 'Constitution',
    value: labelOrBlank(CONSTITUTIONS, str(a, 'constitution')),
    required: true,
  },
  { label: 'Incorporated', value: str(a, 'incorporationDate'), mono: true },
  // `category` — the key `StepVendorBusiness` actually writes.
  { label: 'What you are', value: labelOrBlank(VENDOR_CATEGORIES, str(a, 'category')), required: true },
  { label: 'People', value: labelOrBlank(STAFF_BANDS, str(a, 'staffBand')) },
];

interface SavedGstin {
  gstin?: string;
  isPrimary?: boolean;
  outcome?: { outcome?: string } | null;
}

const statutoryRows = (a: Record<string, unknown>): Row[] => {
  const gstins = Array.isArray(a.gstins) ? (a.gstins as SavedGstin[]) : [];
  return [
    { label: 'PAN', value: str(a, 'pan'), required: true, mono: true },
    { label: 'Primary GSTIN', value: str(a, 'primaryGstin'), required: true, mono: true },
    ...gstins
      .filter((g) => g.gstin && !g.isPrimary)
      .map((g, i) => ({ label: `Other GSTIN ${i + 1}`, value: g.gstin ?? '', mono: true })),
    { label: 'CIN', value: str(a, 'cin'), mono: true },
    { label: 'Udyam', value: str(a, 'udyam'), mono: true },
    { label: 'TAN', value: str(a, 'tan'), mono: true },
    {
      label: 'GST portal checks',
      value:
        gstins.length > 0
          ? `${gstins.filter((g) => g.outcome?.outcome === 'PASS').length} of ${gstins.length} passed`
          : '',
      required: true,
      mono: true,
    },
  ];
};

const capabilityRows = (a: Record<string, unknown>): Row[] => {
  const mix = (a.gradeMix ?? {}) as Record<string, unknown>;
  const mixed = Object.entries(mix)
    .filter(([, pct]) => Number(pct) > 0)
    .map(([grade, pct]) => `${grade.replace('_PLUS', '+')} ${String(pct)}%`);
  // `monthlyCapacity` — the key `StepCapability` actually writes.
  const monthly = str(a, 'monthlyCapacity');
  return [
    { label: 'Laptops a month', value: monthly, required: true, mono: true },
    {
      label: 'Grade mix',
      // Every percentage carries its denominator.
      value: mixed.length > 0 && monthly ? `${mixed.join(' · ')} of ${monthly} units` : '',
      required: true,
    },
    {
      label: 'Categories',
      value: labelled(SUPPLY_CATEGORIES, list(a, 'categories')),
      required: true,
    },
    {
      label: 'Sourced from',
      value: labelled(SOURCING_CHANNELS, list(a, 'sourcingChannels')),
      required: true,
    },
    {
      label: 'Dispatches direct',
      value:
        a.canDropship === true
          ? 'Yes — ships to the buyer on our invoice'
          : a.canDropship === false
            ? 'No — we would have to take the goods in first'
            : '',
      required: true,
    },
    {
      label: 'Serials up front',
      value:
        a.canProvideSerialsUpfront === true
          ? 'Yes — listed unit by unit'
          : a.canProvideSerialsUpfront === false
            ? 'No — serial attached at dispatch'
            : '',
      required: true,
    },
    {
      label: 'Typical price',
      value:
        str(a, 'priceBandMin') && str(a, 'priceBandMax')
          ? `Rs ${Number(str(a, 'priceBandMin')).toLocaleString('en-IN')} to Rs ${Number(str(a, 'priceBandMax')).toLocaleString('en-IN')}`
          : '',
      mono: true,
    },
    {
      label: 'Lead time',
      value: str(a, 'leadTimeDays') ? `${str(a, 'leadTimeDays')} days` : '',
      mono: true,
    },
  ];
};

interface SavedFacility {
  /** `StepFacility` writes `label`, not `name`. */
  label?: string;
  facilityType?: string;
  address?: { city?: string; pincode?: string };
}

const facilityRows = (a: Record<string, unknown>): Row[] => {
  const facilities = Array.isArray(a.facilities) ? (a.facilities as SavedFacility[]) : [];
  const contacts = (a.contacts ?? {}) as Record<string, { fullName?: string }>;
  const named = Object.values(contacts).filter((c) => c.fullName).length;
  const required = VENDOR_CONTACT_ROLES.filter((r) => r.required).length;
  return [
    {
      label: 'Sites',
      value: facilities
        .filter((f) => f.label)
        .map((f) => {
          const type = f.facilityType ? labelOrBlank(FACILITY_TYPES, f.facilityType) : '';
          const where = f.address?.city ?? '';
          return [f.label, type, where].filter(Boolean).join(' — ');
        })
        .join(' · '),
      required: true,
    },
    {
      label: 'Contacts',
      // The denominator, because "3 named" hides whether one is missing.
      value: named > 0 ? `${named} of ${required} required roles named` : '',
      required: true,
    },
  ];
};

/** Step 6, read back. The account number is never held here — only its last four. */
const bankRows = (a: Record<string, unknown>): Row[] => {
  const last4 = str(a, 'accountLast4');
  const outcome = str(a, 'pennyDropOutcome');
  return [
    { label: 'Account holder', value: str(a, 'accountHolderName'), required: true },
    // Masked exactly as the server stores it: `account_number_last4`.
    { label: 'Account', value: last4 ? `•••• ${last4}` : '', required: true, mono: true },
    { label: 'IFSC', value: str(a, 'ifsc'), required: true, mono: true },
    { label: 'Type', value: labelOrBlank(ACCOUNT_TYPES, str(a, 'accountType')) },
    {
      // A MISMATCH is never printed as a pass. Anything that is not PASS says
      // what it actually was.
      label: 'Bank check',
      value:
        outcome === 'PASS'
          ? `Confirmed — the bank holds it as ${str(a, 'bankHolderName') || 'a name it did not return'}`
          : outcome
            ? `Not confirmed — the bank answered ${outcome.replace(/_/g, ' ').toLowerCase()}`
            : '',
      required: true,
    },
    {
      label: 'Payouts frozen until',
      value: str(a, 'frozenUntil') ? formatWhen(str(a, 'frozenUntil')) : '',
      mono: true,
    },
  ];
};

/** Step 7, read back. */
const agreementRows = (a: Record<string, unknown>): Row[] => {
  const accepted = (a.accepted ?? {}) as Record<string, unknown>;
  const count = VENDOR_AGREEMENTS.filter((g) => accepted[g.code] === true).length;
  const threshold = str(a, 'payoutThreshold');
  return [
    {
      label: 'Agreements',
      // The denominator is the point: "4 accepted" hides which four.
      value:
        count > 0 ? `${count} of ${VENDOR_AGREEMENTS.length} accepted, recorded not signed` : '',
      required: true,
      mono: false,
    },
    { label: 'Accepted by', value: str(a, 'signatoryName'), required: true },
    {
      label: 'Pricing',
      value: labelOrBlank(
        PRICING_MODES.map((m) => ({ value: m.value, label: m.label })),
        str(a, 'pricingMode'),
      ),
      required: true,
    },
    // Only where it means anything: a NET_PAYOUT vendor was never asked for a
    // rate, and "Not provided" against a question nobody put is noise.
    ...(str(a, 'pricingMode') === 'COMMISSION'
      ? [
          {
            label: 'Commission asked',
            value: str(a, 'commissionRate') ? `${str(a, 'commissionRate')}%` : '',
            required: true,
            mono: true,
          },
        ]
      : []),
    {
      label: 'Cycle requested',
      value: labelOrBlank(
        PAYOUT_CYCLES.map((c) => ({ value: c.value, label: c.label })),
        str(a, 'payoutCycle'),
      ),
      required: true,
    },
    {
      label: 'Minimum payout',
      value: threshold ? `Rs ${Number(threshold).toLocaleString('en-IN')}` : '',
      required: true,
      mono: true,
    },
    {
      label: 'Purchase invoice',
      value:
        a.invoiceUploadRequired === true
          ? 'You raise it and upload it'
          : a.invoiceUploadRequired === false
            ? 'We self-bill on your behalf'
            : '',
      required: true,
    },
    {
      label: 'Notifications',
      value: list(a, 'channels')
        .map((c) => VENDOR_NOTIFICATION_CHANNELS.find((n) => n.code === c)?.label ?? c)
        .join(', '),
      required: true,
    },
    { label: 'Language', value: labelOrBlank(LANGUAGES, str(a, 'language')), required: true },
  ];
};

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/* ==========================================================================
 * The documents actually held, read back from the server
 * ======================================================================== */

const DOC_TONE: Record<string, 'pass' | 'info' | 'fail' | 'warn' | 'neutral'> = {
  VERIFIED: 'pass',
  UPLOADED: 'info',
  UNDER_REVIEW: 'info',
  REJECTED: 'fail',
  EXPIRED: 'warn',
};

const DOC_LABEL: Record<string, string> = {
  VERIFIED: 'Verified',
  UPLOADED: 'With our team',
  UNDER_REVIEW: 'Being reviewed',
  REJECTED: 'Rejected',
  EXPIRED: 'Expired',
};

function DocumentList({ docs }: { docs: readonly KycDocument[] }): React.JSX.Element {
  const required = VENDOR_DOCUMENTS.filter((d) => d.required);
  // The order the step asked for them in. `GET /documents` is newest-first,
  // which puts the optional ones at the top of the checklist.
  const order = (doc: KycDocument): number => {
    const at = VENDOR_DOCUMENTS.findIndex((d) => d.docType === doc.docType);
    return at === -1 ? VENDOR_DOCUMENTS.length : at;
  };
  const ordered = [...docs].sort((a, b) => order(a) - order(b));
  const missing = required.filter(
    (d) => !docs.some((doc) => doc.docType === d.docType && doc.status !== 'REJECTED'),
  );

  return (
    <div className="flex flex-col gap-3">
      {docs.length === 0 ? (
        <p className="text-body-sm text-ink-4">
          No document has been uploaded yet — this step still needs{' '}
          <span className="tnum">{required.length}</span>.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {ordered.map((doc) => (
            <li
              key={doc.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded border border-rule bg-sheet px-4 py-3"
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-body-sm text-ink">{doc.label}</span>
                <span className="truncate font-mono text-label text-ink-3">
                  {doc.originalFilename ?? 'filename not kept'}
                </span>
              </span>
              <StatusPill
                tone={DOC_TONE[doc.status] ?? 'neutral'}
                label={DOC_LABEL[doc.status] ?? doc.status}
              />
              {doc.rejectionReason && (
                <p role="alert" className="w-full text-body-sm text-fail">
                  {doc.rejectionReason}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {missing.length > 0 && docs.length > 0 && (
        <p className="text-body-sm text-ink-4">
          Still to come: {missing.map((m) => m.docType.replace(/_/g, ' ').toLowerCase()).join(', ')}.
        </p>
      )}
    </div>
  );
}

/* ==========================================================================
 * After submission
 * ======================================================================== */

const OUTCOME: Record<string, StatusCopy> = {
  KYC_SUBMITTED: {
    title: 'Your application is with our team',
    body: 'Nothing more is needed from you right now. We will write to the contacts you gave us on step 5 the moment there is a decision.',
    tone: 'info',
  },
  UNDER_REVIEW: {
    title: 'A reviewer is looking at your application',
    body: 'Someone has picked it up. They check your registrations against the certificates you sent, and the payout account against the cancelled cheque. If anything is missing it appears on this page and in your inbox.',
    tone: 'info',
  },
  INFO_REQUESTED: {
    title: 'We need something from you',
    body: 'The reviewer has asked for a change. Their words are below — open the step it refers to and send it again.',
    tone: 'fail',
  },
  VERIFIED: {
    title: 'You are approved to supply',
    body: 'You can list stock now. Every machine is inspected before it goes on the shelf, and a purchase order reaches you the moment a buyer orders one.',
    tone: 'pass',
  },
  REJECTED: {
    title: 'We could not open this supplier account',
    body: 'The reason is below. If you think it is wrong, reply to the email we sent and a person will look again.',
    tone: 'fail',
  },
};

/* ==========================================================================
 * The screen
 * ======================================================================== */

export interface VendorReviewProps {
  steps: readonly StepProgress[];
  answers: Record<string, Record<string, unknown>>;
  orgStatus: string;
  slaDueAt: string | null;
  slaBreached: boolean;
  /** The reviewer's own words. `ApplicationStatus` renders them verbatim. */
  decision: ReviewDecision | null;
  isSubmittable: boolean;
  onEdit: (stepCode: string) => void;
  onSubmit: () => Promise<string | null>;
}

export function VendorReview({
  steps,
  answers,
  orgStatus,
  slaDueAt,
  slaBreached,
  decision,
  isSubmittable,
  onEdit,
  onSubmit,
}: VendorReviewProps): React.JSX.Element {
  const [docs, setDocs] = React.useState<KycDocument[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [refusal, setRefusal] = React.useState<string | null>(null);

  React.useEffect(() => {
    void (async () => {
      const result = await getDocuments();
      setDocs(result.ok ? result.data : []);
    })();
  }, []);

  const submitted =
    WITH_US.includes(orgStatus) || orgStatus === 'VERIFIED' || orgStatus === 'REJECTED';
  const needsFix = steps.filter((s) => s.status === 'NEEDS_FIX');

  const submit = async (): Promise<void> => {
    setBusy(true);
    setRefusal(null);
    try {
      setRefusal(await onSubmit());
    } finally {
      setBusy(false);
    }
  };

  if (submitted) {
    return (
      <ApplicationStatus
        orgStatus={orgStatus}
        slaDueAt={slaDueAt}
        slaBreached={slaBreached}
        needsFix={needsFix}
        onEdit={onEdit}
        copy={OUTCOME}
        steps={steps}
        decision={decision}
        approved={
          <EmptyState
            title="List your first machines"
            body="Add stock unit by unit or upload a serial list. We book an inspection, the machines are graded, and they go on the shelf with their own report."
            action={
              <Button variant="secondary" onClick={() => window.location.assign('/')}>
                Back to Trugrade
              </Button>
            }
          />
        }
      />
    );
  }

  const outstanding = steps.filter((s) => s.isRequired && s.status !== 'COMPLETE');

  const block = (
    stepCode: string,
    rows: (a: Record<string, unknown>) => Row[],
  ): React.JSX.Element | null => {
    const step = steps.find((s) => s.stepCode === stepCode);
    if (!step) return null;
    const held = answers[stepCode];
    if (!held) return unreadable(step, onEdit);
    const built = rows(held);
    return (
      <StepBlock
        key={stepCode}
        step={step}
        hasGap={built.some((r) => r.required && !r.value)}
        onEdit={() => onEdit(stepCode)}
      >
        <Rows rows={built} />
      </StepBlock>
    );
  };

  const bankStep = steps.find((s) => s.stepCode === 'DOCUMENTS_BANK');
  const bankAnswers = answers.DOCUMENTS_BANK;

  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-[62ch]">
        This is everything we will send to a reviewer. A step locks once it is finished, so the ones
        still open are the ones you can change here — after that, a reviewer can send any step back
        and it opens again.
      </p>

      {block('ACCOUNT', accountRows)}
      {block('BUSINESS_PROFILE', businessRows)}
      {block('STATUTORY', statutoryRows)}
      {block('CAPABILITY', capabilityRows)}
      {block('FACILITY_CONTACTS', facilityRows)}

      {bankStep && (
        <StepBlock
          step={bankStep}
          hasGap={
            (docs !== null &&
              VENDOR_DOCUMENTS.filter((d) => d.required).some(
                (d) => !docs.some((doc) => doc.docType === d.docType && doc.status !== 'REJECTED'),
              )) ||
            bankAnswers?.pennyDropOutcome !== 'PASS'
          }
          onEdit={() => onEdit('DOCUMENTS_BANK')}
        >
          {docs === null ? <Skeleton lines={3} /> : <DocumentList docs={docs} />}
          {bankAnswers ? (
            <Rows rows={bankRows(bankAnswers)} />
          ) : (
            <p className="text-body-sm text-ink-4">
              The payout account is held with your application and is not shown here after a reload.
            </p>
          )}
        </StepBlock>
      )}

      {block('AGREEMENT', agreementRows)}

      {refusal && (
        <p role="alert" className="rounded border border-fail bg-sheet-2 p-4 text-body-sm text-fail">
          {refusal}
        </p>
      )}

      <div className="flex flex-col gap-3 border-t border-rule-2 pt-5">
        {!isSubmittable && outstanding.length > 0 && (
          <p className="text-body-sm text-ink-2">
            <span className="tnum">{outstanding.length}</span>{' '}
            {outstanding.length === 1 ? 'step is' : 'steps are'} not finished:{' '}
            {outstanding.map((s) => s.title).join(', ')}. Finish{' '}
            {outstanding.length === 1 ? 'it' : 'them'} and this page will let you submit.
          </p>
        )}
        <div>
          <Button
            type="button"
            variant="primary"
            loading={busy}
            disabled={!isSubmittable}
            onClick={() => void submit()}
          >
            Submit for review
          </Button>
        </div>
      </div>
    </div>
  );
}
