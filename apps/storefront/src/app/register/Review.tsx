'use client';

import * as React from 'react';
import {
  AddressCard,
  Button,
  EmptyState,
  Skeleton,
  StatusPill,
  type Address,
  type StatusPillProps,
} from '@trugrade/ui';
import {
  getDocuments,
  type KycDocument,
  type ReviewDecision,
  type StepProgress,
} from './api';
import {
  ANNUAL_VOLUMES,
  BUYER_DOCUMENTS,
  CONSTITUTIONS,
  CONTACT_ROLES,
  EMPLOYEE_BANDS,
  HEARD_FROM,
  INDUSTRIES,
  LANGUAGES,
  NOTIFICATION_CHANNELS,
  RECEIVING_DAYS,
  labelFor,
  stateName,
} from './picklists';
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
} from './review-parts';
import type { BillingAddress, DeliveryAddress, Person } from './StepContacts';
import { receivingHoursLabel } from './validation';

/**
 * The review screen, the submission, and everything after it.
 *
 * **A gap is shown as a gap.** Every row we do not hold renders "Not provided"
 * in `--ink-4`, and a step with a missing required answer says so in its header
 * instead of a tick — a review screen that shows five ticks and then refuses to
 * submit is worse than no review screen.
 *
 * **A reviewer's words are rendered verbatim.** `blocking_reason` is what a
 * person typed about this application; paraphrasing it, or wrapping it in
 * "there was a problem with your submission", loses the only sentence that says
 * what to do next.
 *
 * **The SLA is shown honestly.** The due date is the server's; the hours left
 * are counted from it; and once it is past, the screen says so rather than
 * quietly showing a stale promise.
 *
 * One known limit, and it is an API gap rather than a choice here:
 * `completeStep` clears a step's draft and no module has registered a promotion,
 * so a COMPLETE step's answers exist nowhere a client can read. What this screen
 * holds are the answers given in *this* session. After a cold reload, a
 * completed step says it is complete and says plainly that its answers are not
 * shown here — which is true, rather than a screen of false gaps.
 */

/* ==========================================================================
 * One step's answers → rows
 * ======================================================================== */

const accountRows = (a: Record<string, unknown>): Row[] => [
  { label: 'Your name', value: str(a, 'fullName'), required: true },
  { label: 'Company', value: str(a, 'companyName'), required: true },
  { label: 'Work email', value: str(a, 'email'), required: true, mono: true },
  { label: 'Mobile', value: str(a, 'mobile'), required: true, mono: true },
  { label: 'How you found us', value: labelOrBlank(HEARD_FROM, str(a, 'heardFrom')) },
];

const companyRows = (a: Record<string, unknown>): Row[] => [
  { label: 'Legal name', value: str(a, 'legalName'), required: true },
  { label: 'Trade name', value: str(a, 'tradeName') },
  { label: 'Constitution', value: labelOrBlank(CONSTITUTIONS, str(a, 'constitution')), required: true },
  { label: 'Industry', value: labelOrBlank(INDUSTRIES, str(a, 'industry')), required: true },
  { label: 'Year established', value: str(a, 'yearEstablished'), required: true, mono: true },
  { label: 'Employees', value: labelOrBlank(EMPLOYEE_BANDS, str(a, 'employeeBand')), required: true },
  { label: 'Laptops a year', value: labelOrBlank(ANNUAL_VOLUMES, str(a, 'annualVolume')), required: true },
  { label: 'Website', value: str(a, 'website') },
];

interface SavedGstin {
  gstin?: string;
  isPrimary?: boolean;
  deferred?: boolean;
  outcome?: { outcome?: string } | null;
}

const statutoryRows = (a: Record<string, unknown>): Row[] => {
  const gstins = Array.isArray(a.gstins) ? (a.gstins as SavedGstin[]) : [];
  return [
    { label: 'PAN', value: str(a, 'pan'), required: true, mono: true },
    { label: 'CIN', value: str(a, 'cin'), mono: true },
    { label: 'Primary GSTIN', value: str(a, 'primaryGstin'), required: true, mono: true },
    ...gstins
      .filter((g) => g.gstin && !g.isPrimary)
      .map((g, i) => ({
        label: `Other GSTIN ${i + 1}`,
        value: g.gstin ?? '',
        mono: true,
      })),
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

const documentsRows = (a: Record<string, unknown>): Row[] => {
  const channels = Array.isArray(a.channels) ? (a.channels as string[]) : [];
  return [
    {
      label: 'Notifications',
      value: channels
        .map((c) => NOTIFICATION_CHANNELS.find((n) => n.code === c)?.label ?? c)
        .join(', '),
      required: true,
    },
    { label: 'Language', value: labelOrBlank(LANGUAGES, str(a, 'language')), required: true },
    {
      label: 'Purchase orders',
      // A false flag is an answer, not an absence, so it says what it means.
      value: a.poRequired === true ? 'Required on every invoice' : 'Not required',
    },
  ];
};

/* ==========================================================================
 * Addresses and contacts — the step-4 half, which is not a row list
 * ======================================================================== */

const toAddress = (a: BillingAddress, gstin?: string): Address => ({
  label: gstin ? `Billing — ${gstin}` : 'Billing address',
  line1: a.line1,
  ...(a.line2 ? { line2: a.line2 } : {}),
  city: a.city,
  state: stateName(a.state) ?? a.state,
  pincode: a.pincode,
  ...(gstin ? { gstin } : {}),
});

const toDeliveryAddress = (d: DeliveryAddress): Address => ({
  label: d.label || 'Delivery address',
  line1: d.line1,
  ...(d.line2 ? { line2: d.line2 } : {}),
  city: d.city,
  state: stateName(d.state) ?? d.state,
  pincode: d.pincode,
  ...(d.landmark ? { landmark: d.landmark } : {}),
  ...(d.contactName ? { contactName: d.contactName } : {}),
  ...(d.contactMobile ? { contactMobile: d.contactMobile } : {}),
  ...(d.gateInstructions ? { gateInstructions: d.gateInstructions } : {}),
  ...(d.days && d.opensAt && d.closesAt
    ? { receivingHours: receivingHoursLabel(labelFor(RECEIVING_DAYS, d.days), d.opensAt, d.closesAt) }
    : {}),
});

/** Everything step 4 must hold. Any one of them empty is a gap on that step. */
export function contactsGap(answers: Record<string, unknown>): boolean {
  const contacts = (answers.contacts ?? {}) as Record<string, Partial<Person>>;
  const billing = Array.isArray(answers.billing) ? (answers.billing as BillingAddress[]) : [];
  const delivery = Array.isArray(answers.delivery) ? (answers.delivery as DeliveryAddress[]) : [];
  return (
    CONTACT_ROLES.filter((r) => r.required).some((r) => !contacts[r.code]?.fullName) ||
    billing.length === 0 ||
    billing.some((a) => !hasPostal(a)) ||
    !delivery.some(hasPostal)
  );
}

/**
 * An address we hold enough of to print on a label. Anything less is a gap and
 * is rendered as one — an `AddressCard` built from empty strings reads as a
 * real address with a missing street, which is worse than saying nothing.
 */
const hasPostal = (a: Partial<BillingAddress>): boolean =>
  Boolean(a.line1?.trim() && a.city?.trim() && a.pincode?.trim());

function ContactsSummary({ answers }: { answers: Record<string, unknown> }): React.JSX.Element {
  const contacts = (answers.contacts ?? {}) as Record<string, Partial<Person>>;
  const billing = Array.isArray(answers.billing) ? (answers.billing as BillingAddress[]) : [];
  const delivery = Array.isArray(answers.delivery) ? (answers.delivery as DeliveryAddress[]) : [];

  const cards = [
    ...billing.filter(hasPostal).map((address, i) => (
      <AddressCard
        key={address.gstin || `billing-${i}`}
        address={toAddress(address, address.gstin)}
      />
    )),
    ...delivery.filter(hasPostal).map((address, i) => (
      <AddressCard
        key={`${address.label}-${i}`}
        address={toDeliveryAddress(address)}
        badge={<StatusPill tone="neutral" label="Delivery" />}
      />
    )),
  ];

  return (
    <div className="flex flex-col gap-5">
      <Rows
        rows={CONTACT_ROLES.map((role) => {
          const person = contacts[role.code];
          const parts = [person?.fullName, person?.email, person?.mobile].filter(Boolean);
          return {
            label: role.label,
            value: parts.join(' · '),
            required: role.required,
          };
        })}
      />

      {/* Only what is MISSING gets a row: a complete address is the card below,
          and repeating it as "Below" is a row that says nothing. */}
      <Rows
        rows={[
          ...billing
            .filter((address) => !hasPostal(address))
            .map((address, i) => ({
              label: address.gstin ? `Billing — ${address.gstin}` : `Billing address ${i + 1}`,
              required: true,
            })),
          ...(delivery.some(hasPostal)
            ? []
            : [{ label: 'Delivery address', required: true }]),
        ]}
      />

      {cards.length > 0 && <div className="grid gap-4 sm:grid-cols-2">{cards}</div>}
    </div>
  );
}

/* ==========================================================================
 * The documents actually held, read back from the server
 * ======================================================================== */

const DOC_TONE: Record<string, StatusPillProps['tone']> = {
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
  const required = BUYER_DOCUMENTS.filter((d) => d.required);
  // The order the step asked for them in. `GET /documents` is newest-first,
  // which puts the optional one at the top of the checklist.
  const order = (doc: KycDocument): number => {
    const at = BUYER_DOCUMENTS.findIndex((d) => d.docType === doc.docType);
    return at === -1 ? BUYER_DOCUMENTS.length : at;
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
 * The screen
 * ======================================================================== */

export interface ReviewProps {
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

export function Review({
  steps,
  answers,
  orgStatus,
  slaDueAt,
  slaBreached,
  decision,
  isSubmittable,
  onEdit,
  onSubmit,
}: ReviewProps): React.JSX.Element {
  const [docs, setDocs] = React.useState<KycDocument[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [refusal, setRefusal] = React.useState<string | null>(null);

  React.useEffect(() => {
    void (async () => {
      const result = await getDocuments();
      setDocs(result.ok ? result.data : []);
    })();
  }, []);

  const submitted = WITH_US.includes(orgStatus) || orgStatus === 'VERIFIED' || orgStatus === 'REJECTED';
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
            title="Start with what has been inspected today"
            body="Every laptop on the shop has been opened, graded and photographed. Filters for battery health and inspection score are the ones nobody else can offer."
            action={
              <Button variant="secondary" onClick={() => window.location.assign('/')}>
                Browse laptops
              </Button>
            }
          />
        }
      />
    );
  }

  const outstanding = steps.filter((s) => s.isRequired && s.status !== 'COMPLETE');

  const block = (stepCode: string, rows: (a: Record<string, unknown>) => Row[]) => {
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

  const contactsStep = steps.find((s) => s.stepCode === 'CONTACTS_ADDRESSES');
  const documentsStep = steps.find((s) => s.stepCode === 'DOCUMENTS');
  const contactAnswers = answers.CONTACTS_ADDRESSES;
  const documentAnswers = answers.DOCUMENTS;

  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-[62ch]">
        This is everything we will send to a reviewer. A step locks once it is finished, so the
        ones still open are the ones you can change here — after that, a reviewer can send any step
        back and it opens again.
      </p>

      {block('ACCOUNT', accountRows)}
      {block('BUSINESS_PROFILE', companyRows)}
      {block('STATUTORY', statutoryRows)}

      {contactsStep &&
        (contactAnswers ? (
          <StepBlock
            step={contactsStep}
            hasGap={contactsGap(contactAnswers)}
            onEdit={() => onEdit('CONTACTS_ADDRESSES')}
          >
            <ContactsSummary answers={contactAnswers} />
          </StepBlock>
        ) : (
          unreadable(contactsStep, onEdit)
        ))}

      {documentsStep && (
        <StepBlock
          step={documentsStep}
          hasGap={
            docs !== null &&
            BUYER_DOCUMENTS.filter((d) => d.required).some(
              (d) => !docs.some((doc) => doc.docType === d.docType && doc.status !== 'REJECTED'),
            )
          }
          onEdit={() => onEdit('DOCUMENTS')}
        >
          {docs === null ? <Skeleton lines={3} /> : <DocumentList docs={docs} />}
          {documentAnswers ? (
            <Rows rows={documentsRows(documentAnswers)} />
          ) : (
            <p className="text-body-sm text-ink-4">
              Your notification and purchase-order preferences are saved with the application. They
              are not shown here after a reload.
            </p>
          )}
        </StepBlock>
      )}

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

const OUTCOME: Record<string, StatusCopy> = {
  KYC_SUBMITTED: {
    title: 'Your application is with our team',
    body: 'Nothing more is needed from you right now. We will email the contacts you gave us the moment there is a decision.',
    tone: 'info',
  },
  UNDER_REVIEW: {
    title: 'A reviewer is looking at your application',
    body: 'Someone has picked it up. If they need anything else, it will appear on this page and in your inbox.',
    tone: 'info',
  },
  INFO_REQUESTED: {
    title: 'We need something from you',
    body: 'The reviewer has asked for a change. Their words are below — open the step it refers to and send it again.',
    tone: 'fail',
  },
  VERIFIED: {
    title: 'Your account is open',
    body: 'You can buy on this account now. Prices, stock and delivery dates are live.',
    tone: 'pass',
  },
  REJECTED: {
    title: 'We could not open this account',
    body: 'The reason is below. If you think it is wrong, reply to the email we sent and a person will look again.',
    tone: 'fail',
  },
};
