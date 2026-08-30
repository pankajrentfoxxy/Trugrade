import * as React from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  Breadcrumb,
  Button,
  EmptyState,
  RecordHeader,
  SidePanel,
  Skeleton,
  StatusPill,
} from '@trugrade/ui';
import { changeControlFor, type ChangeControl } from '@trugrade/contracts';
import { Section, Textarea } from '../lib/controls';
import {
  DocumentsPanel,
  VerificationPanel,
  labelForCheck,
  meaningOf,
  type KycDocument,
  type RejectionReason,
  type VerificationCheck,
} from './ReviewEvidence';

/**
 * ARCHETYPE C — Record. Identity header + evidence panel + actions side panel.
 * DENSITY: compact (admin), set on the app root by the shell.
 */

/** The three things a reviewer can do, in the API's own vocabulary. */
type Decision = 'APPROVED' | 'REJECTED' | 'INFO_REQUESTED';

/**
 * One route for all three, and not `steps/:stepKey/request-fix`.
 *
 * Request-fix sends a single *step* back, and this screen has no step in hand —
 * a reviewer here is looking at the application as a whole. So "request more
 * information" is `INFO_REQUESTED` on the decision route, which is also what
 * puts the application back in front of the applicant with the note attached.
 *
 * The error envelope is read the way `SkuRequests` reads it: the domain filter
 * nests the sentence under `error`, and a refusal whose explanation is thrown
 * away leaves the reviewer with a status code and no idea what to fix.
 */
async function postDecision(orgId: string, decision: Decision, notes?: string): Promise<void> {
  const res = await fetch(`/api/kyc/orgs/${orgId}/decision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ decision, notes }),
  });
  if (res.ok) return;
  const payload = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  throw new Error(payload?.error?.message ?? `That decision did not go through (${res.status}).`);
}

export interface VendorReviewData {
  orgId: string;
  orgType: string;
  legalName: string;
  status: string;
  constitutionType: string | null;
  /** All three computed on the server. A deadline a browser can move is not one. */
  slaDueAt: string | null;
  slaBreached: boolean;
  slaHours: number | null;
  /** Negative once we are past it. Computed on the server clock, never here. */
  hoursRemaining: number | null;
  decision: {
    decision: string;
    notes: string | null;
    reasonCodes: string[];
    decidedAt: string;
  } | null;
  checks: VerificationCheck[];
  /** The four Change 4 captures. */
  dispatchAddress: { line1: string; city: string; state: string; pincode: string } | null;
  dispatchSameAsRegistered: boolean;
  canDropship: boolean | null;
  dropshipConstraint: string | null;
  defaultWarrantyMonths: number | null;
  defaultWarrantyScope: { covers: string[]; excludes: string[]; serviceMode: string } | null;
  pricingMode: 'NET_PAYOUT' | 'COMMISSION' | null;
  agreedCommissionPct: number | null;
}

const CONTROL_LABEL: Record<ChangeControl, string> = {
  FREE: 'Vendor may change this',
  AUDITED: 'Vendor may change this — logged',
  APPROVAL: 'Change needs approval',
  LOCKED: 'Change needs re-verification',
};

/**
 * Every reviewed field says what happens if the vendor edits it later.
 *
 * Without this the reviewer has to hold the change-control matrix in their head,
 * and the failure mode is approving a dispatch address on the assumption it is
 * frozen when it is merely audited.
 */
function Field({
  field,
  label,
  children,
}: {
  field: string;
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const control = changeControlFor(field);
  return (
    <div className="border-b border-rule-2 py-4 last:border-b-0">
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-mono text-label uppercase tracking-[0.13em] text-ink-2">{label}</span>
        <span className="text-body-sm text-ink-3">{CONTROL_LABEL[control]}</span>
      </div>
      <div className="mt-2 text-body-sm text-ink">{children}</div>
    </div>
  );
}

/** A capture that was never made is not a "no". It is a gap, and it blocks. */
function NotCaptured(): React.JSX.Element {
  return <StatusPill tone="warn" label="Not captured" />;
}

/**
 * The documents, and the reason we may not be showing them.
 *
 * `kyc.document.read` is a permission of its own — OPS_MANAGER and SUPPORT hold
 * `kyc.application.read` and not it — so a 403 here is a normal outcome for a
 * legitimate reviewer, not an error. It is turned into a sentence rather than
 * thrown, because a blank documents panel reads as "there are none", which is
 * the same defect as a missing value rendering as a passing one.
 */
function useDocuments(orgId: string | undefined): {
  documents: KycDocument[] | null;
  reasons: RejectionReason[];
  error: string | null;
  /** Re-read after a decision, so the table and the database cannot disagree. */
  refresh: () => void;
} {
  const [documents, setDocuments] = React.useState<KycDocument[] | null>(null);
  const [reasons, setReasons] = React.useState<RejectionReason[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);

  React.useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    void (async () => {
      try {
        const [docsRes, reasonsRes] = await Promise.all([
          fetch(`/api/kyc/orgs/${orgId}/documents`, { credentials: 'include' }),
          fetch('/api/kyc/document-rejection-reasons', { credentials: 'include' }),
        ]);
        if (docsRes.status === 403) {
          if (!cancelled) setError('Your account does not hold the document permission.');
          return;
        }
        if (!docsRes.ok) throw new Error(`The documents did not load (${docsRes.status}).`);
        const docs = (await docsRes.json()) as KycDocument[];
        const list = reasonsRes.ok ? ((await reasonsRes.json()) as RejectionReason[]) : [];
        if (!cancelled) {
          setDocuments(docs);
          setReasons(list);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, nonce]);

  return { documents, reasons, error, refresh: () => setNonce((n) => n + 1) };
}

async function postDocumentDecision(
  orgId: string,
  documentId: string,
  body: { decision: 'VERIFIED' | 'REJECTED'; reasonCode?: string; specific?: string },
): Promise<void> {
  const res = await fetch(`/api/kyc/orgs/${orgId}/documents/${documentId}/review`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (res.ok) return;
  const payload = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  throw new Error(payload?.error?.message ?? `That decision did not go through (${res.status}).`);
}

export function VendorReviewRoute(): React.JSX.Element {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const [data, setData] = React.useState<VendorReviewData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const docs = useDocuments(orgId);
  /** Which decision is waiting on its note. Both refusals need one. */
  const [pending, setPending] = React.useState<Exclude<Decision, 'APPROVED'> | null>(null);
  const [notes, setNotes] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/kyc/review/${orgId}`, { credentials: 'include' });
        if (!res.ok) throw new Error(`Could not load this application (${res.status})`);
        const d = (await res.json()) as VendorReviewData;
        if (!cancelled) setData(d);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  async function decide(decision: Decision): Promise<void> {
    if (!orgId || submitting) return;
    setSubmitting(true);
    setFailure(null);
    try {
      await postDecision(orgId, decision, notes.trim() || undefined);
      // Back to the queue: the application this screen was about is no longer in
      // it, and leaving the reviewer on a decided application is how the same
      // one gets decided twice.
      navigate('/kyc');
    } catch (e) {
      setFailure((e as Error).message);
      setSubmitting(false);
    }
  }

  if (error) return <EmptyState title="Application did not load" body={error} />;
  if (!data) return <Skeleton lines={8} />;

  // A reviewer cannot approve past a missing capture. Every one of the four is
  // load-bearing in a later phase, and chasing it afterwards means chasing it
  // across the vendor's whole catalogue.
  const missing = [
    !data.dispatchSameAsRegistered && !data.dispatchAddress && 'dispatch address',
    data.canDropship === null && 'dropship capability',
    data.defaultWarrantyMonths === null && 'warranty term',
    data.pricingMode === null && 'pricing mode',
  ].filter((x): x is string => typeof x === 'string');

  /**
   * Checks that need a human before this application can be approved.
   *
   * **Provider failures are deliberately absent.** `meaningOf(...).ours` is the
   * one predicate that decides it: a GST portal outage is not an outstanding
   * question about the applicant, and listing it here would put our downtime on
   * the list of things they have to answer for.
   */
  const unresolved = data.checks.filter((c) => {
    const meaning = meaningOf(c.outcome);
    return !meaning.ours && c.outcome !== 'PASS';
  });
  const rejectedDocs = (docs.documents ?? []).filter((d) => d.status === 'REJECTED');

  return (
    <div className="tg-stack">
      <Breadcrumb
        // The last crumb is "Application", not the legal name: the name is
        // already the page's <h1>, and a breadcrumb that repeats the heading is
        // the same string announced twice.
        items={[{ label: 'Review queue', href: '/kyc' }, { label: 'Application' }]}
      />

      <RecordHeader
        title={data.legalName}
        subtitle={data.constitutionType ?? 'Constitution not declared'}
        status={
          <StatusPill
            // Amber only while it is genuinely in flight. Every other status is
            // a neutral fact about where the application sits.
            tone={data.status === 'UNDER_REVIEW' ? 'info' : 'neutral'}
            label={data.status.replace(/_/g, ' ')}
          />
        }
        identifiers={[
          { label: 'Organisation', value: data.orgId },
          { label: 'Applicant', value: data.orgType },
        ]}
      />

      <SlaBand data={data} />

      {data.decision && (
        // The decision already made, in the reviewer's own words. A record that
        // shows a REJECTED status and not the sentence behind it forces the next
        // person to guess, and the applicant has already been sent that sentence.
        <Section
          title="The decision on this application"
          subtitle={`Recorded ${new Date(data.decision.decidedAt).toLocaleString('en-IN')}.`}
        >
          <p className="max-w-prose text-body-sm text-ink">{data.decision.notes}</p>
          {data.decision.reasonCodes.length > 0 && (
            <p className="mt-2 font-mono text-label uppercase tracking-[0.13em] text-ink-3">
              {data.decision.reasonCodes.join(' · ')}
            </p>
          )}
        </Section>
      )}

      {/* Evidence on the left, the decision on the right. The actions are in one
          place and never beside the field they act on — a Reject button next to
          a dispatch address is how one gets pressed by accident. */}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="tg-stack">
          <VerificationPanel checks={data.checks} />

          <DocumentsPanel
            documents={docs.documents}
            error={docs.error}
            reasons={docs.reasons}
            {...(orgId
              ? {
                  onReview: async (documentId, body) => {
                    await postDocumentDecision(orgId, documentId, body);
                    docs.refresh();
                  },
                }
              : {})}
          />

          <Section title="Commercial terms" subtitle="Every field says what happens if they edit it later.">
            <Field field="vendor_facility.dispatch_address_id" label="Dispatch address">
              {data.dispatchSameAsRegistered ? (
                <span className="text-ink-2">Same as the registered address</span>
              ) : data.dispatchAddress ? (
                <>
                  {data.dispatchAddress.line1}, {data.dispatchAddress.city},{' '}
                  {data.dispatchAddress.state}{' '}
                  <span className="font-mono tnum">{data.dispatchAddress.pincode}</span>
                  <p className="mt-1 text-body-sm text-ink-2">
                    Becomes &ldquo;Dispatch From&rdquo; on the e-way bill for every unit they sell.
                  </p>
                </>
              ) : (
                <NotCaptured />
              )}
            </Field>

            <Field field="vendor_capability.can_dropship" label="Direct dispatch to buyer">
              {data.canDropship === null ? (
                <NotCaptured />
              ) : data.canDropship ? (
                // A capability the vendor declared, not a verdict we reached.
                <StatusPill tone="info" label="Can dropship" />
              ) : (
                <>
                  <StatusPill tone="warn" label="Hub leg required" />
                  {data.dropshipConstraint && (
                    <p className="mt-2 text-body-sm text-ink-2">{data.dropshipConstraint}</p>
                  )}
                </>
              )}
            </Field>

            <Field field="vendor_profile.default_warranty_months" label="Vendor warranty">
              {data.defaultWarrantyMonths === null ? (
                <NotCaptured />
              ) : (
                <>
                  <span className="font-mono tnum">{data.defaultWarrantyMonths} months</span>
                  {data.defaultWarrantyScope && (
                    <p className="mt-1 text-body-sm text-ink-2">
                      Covers {data.defaultWarrantyScope.covers.join(', ').toLowerCase()}
                      {data.defaultWarrantyScope.excludes.length > 0 &&
                        ` · excludes ${data.defaultWarrantyScope.excludes.join(', ').toLowerCase()}`}{' '}
                      · {data.defaultWarrantyScope.serviceMode.toLowerCase().replace('_', '-')}
                    </p>
                  )}
                </>
              )}
            </Field>

            <Field field="vendor_payout_preference.pricing_mode" label="Pricing basis">
              {data.pricingMode === null ? (
                <NotCaptured />
              ) : data.pricingMode === 'NET_PAYOUT' ? (
                <span>Net payout — they name the amount they receive</span>
              ) : (
                <span>
                  Commission at <span className="font-mono tnum">{data.agreedCommissionPct}%</span>{' '}
                  of the selling price, frozen to a rupee amount per unit
                </span>
              )}
            </Field>
          </Section>
        </div>

        <SidePanel
          title="Decision"
          description="The applicant reads whatever you write here."
          footnote={
            missing.length > 0
              ? gapReason(missing)
              : 'Approving lets this vendor list stock. Nothing else on this screen changes anything.'
          }
        >
          {/*
            Stated, and deliberately NOT enforced.

            §3C.1 says approval requires every automated check green or
            "explicitly overridden with a written justification". There is no
            override anywhere in this product — no table records one, no route
            writes one — so a hard block would leave every application with a
            single name mismatch permanently un-approvable with no way through.
            Naming what is outstanding, above the button, is the honest half we
            can actually deliver; the override is logged as not built.
          */}
          {(unresolved.length > 0 || rejectedDocs.length > 0) && (
            <div className="rounded border border-warn/40 bg-sheet-2 p-4">
              <p className="font-mono text-label uppercase tracking-[0.13em] text-warn">
                Outstanding before approval
              </p>
              <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-body-sm text-ink-2">
                {unresolved.map((c) => (
                  <li key={c.id}>
                    {labelForCheck(c.checkType)} — {meaningOf(c.outcome).label.toLowerCase()}
                  </li>
                ))}
                {rejectedDocs.length > 0 && (
                  <li>
                    <span className="font-mono tnum">{rejectedDocs.length}</span> document
                    {rejectedDocs.length === 1 ? '' : 's'} rejected and not replaced
                  </li>
                )}
              </ul>
              <p className="mt-2 text-body-sm text-ink-3">
                Nothing here blocks the button — there is no override record in this product yet, so
                the judgement is yours and the audit log carries your name.
              </p>
            </div>
          )}
          {/*
            A reason-disabled button is `aria-disabled`, not `disabled` — it stays
            focusable so the reason can be read, which also means it still fires a
            click. The gap check belongs on the handler as well as the attribute.

            While a note panel is open the approval steps down to secondary: one
            amber control per screen, and the confirm button is the live one.
          */}
          <Button
            variant={pending === null ? 'primary' : 'secondary'}
            block
            disabledReason={missing.length > 0 ? gapReason(missing) : ''}
            loading={submitting && pending === null}
            onClick={() => {
              if (missing.length === 0) void decide('APPROVED');
            }}
          >
            Approve
          </Button>
          <Button variant="secondary" block onClick={() => setPending('INFO_REQUESTED')}>
            Request more information
          </Button>
          <Button variant="ghost" block onClick={() => setPending('REJECTED')}>
            Reject
          </Button>

          {/*
            Both refusals are read verbatim by the applicant and the API refuses one
            without a note. Asking for it here, rather than letting the request come
            back 422, is the difference between a reviewer writing a sentence and a
            reviewer seeing an error they did not cause.
          */}
          {pending !== null && (
            <div className="border-t border-rule-2 pt-4">
              <Textarea
                id="decision-notes"
                label={
                  pending === 'REJECTED'
                    ? 'Why is this being rejected? The applicant reads this.'
                    : 'What do you need from them? The applicant reads this.'
                }
                rows={4}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
              <div className="mt-3 flex flex-col gap-2">
                <Button
                  variant={pending === 'REJECTED' ? 'danger' : 'primary'}
                  block
                  loading={submitting}
                  disabledReason={
                    notes.trim() ? '' : 'Write the reason first — the applicant sees it.'
                  }
                  onClick={() => {
                    if (notes.trim()) void decide(pending);
                  }}
                >
                  {pending === 'REJECTED' ? 'Confirm rejection' : 'Send request'}
                </Button>
                <Button
                  variant="ghost"
                  block
                  onClick={() => {
                    setPending(null);
                    setFailure(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {failure !== null && (
            <p role="alert" className="text-body-sm text-fail">
              {failure} Nothing has been changed.
            </p>
          )}
        </SidePanel>
      </div>
    </div>
  );
}

function gapReason(missing: string[]): string {
  return `Ask for the ${missing.join(', ')} before approving — every one of these is needed before their first listing can go live.`;
}

/**
 * Our own promise, on the record screen as well as the board.
 *
 * `warn` and never `fail` when it is broken. The 48 hours is a promise **we**
 * made; the applicant submitted and waited. A red band across a business's
 * record because our queue is long is the same defect T28 found on the board,
 * and it is worse here — this is the screen on which somebody is decided about.
 */
function SlaBand({ data }: { data: VendorReviewData }): React.JSX.Element {
  const settled = data.status === 'VERIFIED' || data.status === 'REJECTED';
  if (data.slaDueAt === null) {
    return (
      <p className="text-body-sm text-ink-4">
        No review clock is running on this application.
      </p>
    );
  }

  const hours = Math.round(Math.abs(data.hoursRemaining ?? 0));
  const promise =
    data.slaHours === null ? null : (
      <>
        {' '}
        Our promise for a {data.orgType.toLowerCase()} application is{' '}
        <span className="font-mono tnum">{data.slaHours}</span> working hours.
      </>
    );

  return (
    <div className="flex flex-wrap items-center gap-3 rounded border border-rule bg-sheet-2 px-4 py-3">
      {settled ? (
        <span className="text-body-sm text-ink-2">
          Decided. The review clock stopped when the decision was recorded.
        </span>
      ) : data.slaBreached ? (
        <>
          <StatusPill tone="warn" label="Past our promise" />
          <span className="text-body-sm text-ink-2">
            We are <span className="font-mono tnum text-ink">{hours} h</span> past the date we gave
            them.{promise}
          </span>
        </>
      ) : (
        <span className="text-body-sm text-ink-2">
          <span className="font-mono tnum text-ink">{hours} h</span> left before we break the
          promise we made.{promise}
        </span>
      )}
    </div>
  );
}
