import * as React from 'react';
import { useParams } from 'react-router';
import { Button, EmptyState, Skeleton, StatusPill } from '@trugrade/ui';
import { changeControlFor, type ChangeControl } from '@trugrade/contracts';

export interface VendorReviewData {
  orgId: string;
  legalName: string;
  status: string;
  constitutionType: string | null;
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
    <div className="border-b border-rule-2 py-4">
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-mono text-label uppercase tracking-[0.13em] text-ink-2">{label}</span>
        <span className="text-body-sm text-ink-3">{CONTROL_LABEL[control]}</span>
      </div>
      <div className="mt-2 text-body text-ink">{children}</div>
    </div>
  );
}

/** A capture that was never made is not a "no". It is a gap, and it blocks. */
function NotCaptured(): React.JSX.Element {
  return <StatusPill tone="warn" label="Not captured" />;
}

export function VendorReviewRoute(): React.JSX.Element {
  const { orgId } = useParams<{ orgId: string }>();
  const [data, setData] = React.useState<VendorReviewData | null>(null);
  const [error, setError] = React.useState<string | null>(null);

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

  return (
    <div className="max-w-2xl">
      <h1 className="text-h1 text-ink">{data.legalName}</h1>
      <p className="mt-2 text-body-sm text-ink-2">
        {data.constitutionType ?? 'Constitution not declared'} · {data.status.replace(/_/g, ' ')}
      </p>

      <section className="mt-7">
        <h2 className="text-h3 text-ink">Commercial terms</h2>

        <Field field="vendor_facility.dispatch_address_id" label="Dispatch address">
          {data.dispatchSameAsRegistered ? (
            <span className="text-ink-2">Same as the registered address</span>
          ) : data.dispatchAddress ? (
            <>
              {data.dispatchAddress.line1}, {data.dispatchAddress.city},{' '}
              {data.dispatchAddress.state} {data.dispatchAddress.pincode}
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
            <StatusPill tone="pass" label="Can dropship" />
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
              Commission at <span className="font-mono tnum">{data.agreedCommissionPct}%</span>,
              frozen to a rupee amount per unit
            </span>
          )}
        </Field>
      </section>

      <div className="mt-7 flex items-center gap-3">
        <Button variant="primary" disabledReason={missing.length > 0 ? gapReason(missing) : ''}>
          Approve
        </Button>
        <Button variant="secondary">Request more information</Button>
        <Button variant="danger">Reject</Button>
      </div>
    </div>
  );
}

function gapReason(missing: string[]): string {
  return `Ask for the ${missing.join(', ')} before approving — every one of these is needed before their first listing can go live.`;
}
