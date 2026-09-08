'use client';

import * as React from 'react';
import Link from 'next/link';
import { EmptyState, RecordHeader, SidePanel, Skeleton, StatusPill } from '@trugrade/ui';
import type { ApiFailure } from '../../register/api';
import {
  CONSTITUTIONS,
  EMPLOYEE_BANDS,
  INDUSTRIES,
  ANNUAL_VOLUMES,
} from '../../register/picklists';
import { getProfile, type OrgProfile, type RegisteredAddress } from '../api';

/**
 * The profile record. See `page.tsx` for the archetype and the rules.
 *
 * Read-only: statutory particulars change through a support-led change-of-
 * particulars check, not through a form on this screen.
 */

type Phase =
  | { k: 'loading' }
  | { k: 'signed-out' }
  | { k: 'error'; message: string }
  | { k: 'ready'; profile: OrgProfile };

const problem = (failure: ApiFailure): string =>
  failure.code === 'UNKNOWN' || failure.code === 'NETWORK'
    ? 'We could not reach your account just now. That is our problem, not yours — nothing here has changed.'
    : failure.message;

const labelOf = (
  options: ReadonlyArray<{ value: string; label: string }>,
  value: string | null | undefined,
): string | null => {
  if (!value) return null;
  return options.find((o) => o.value === value)?.label ?? value;
};

const formatAddress = (a: RegisteredAddress): string =>
  [a.line1, a.line2, `${a.city}, ${a.state} ${a.pincode}`].filter(Boolean).join(' · ');

const statusLabel = (status: string): string =>
  status
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

export function ProfileBoard(): React.JSX.Element {
  const [phase, setPhase] = React.useState<Phase>({ k: 'loading' });

  React.useEffect(() => {
    void (async (): Promise<void> => {
      const result = await getProfile();
      if (result.ok) setPhase({ k: 'ready', profile: result.data });
      else if (result.status === 401) setPhase({ k: 'signed-out' });
      else setPhase({ k: 'error', message: problem(result) });
    })();
  }, []);

  if (phase.k === 'loading') return <ProfileSkeleton />;
  if (phase.k === 'signed-out') return <SignedOut />;
  if (phase.k === 'error') return <Failed message={phase.message} />;

  const p = phase.profile;
  const constitution = labelOf(CONSTITUTIONS, p.constitution);
  const industry = labelOf(INDUSTRIES, p.industry);
  const staffBand = labelOf(EMPLOYEE_BANDS, p.employeeCountBand);
  const volumeBand = labelOf(ANNUAL_VOLUMES, p.annualTurnoverBand);

  return (
    <>
      <RecordHeader
        title={p.legalName}
        subtitle={
          p.tradeName && p.tradeName !== p.legalName ? (
            <>
              Trading as <span className="mono">{p.tradeName}</span>
            </>
          ) : (
            'The particulars we hold for your organisation from registration.'
          )
        }
        status={
          <StatusPill tone={p.status === 'VERIFIED' ? 'pass' : 'neutral'} label={statusLabel(p.status)} />
        }
        identifiers={[
          ...(p.gstin
            ? [{ label: 'GSTIN', value: <span className="mono">{p.gstin}</span> }]
            : []),
          ...(p.pan
            ? [{ label: 'PAN', value: <span className="mono">{p.pan}</span> }]
            : []),
        ]}
      />

      <div className="rec">
        <div className="evid">
          <section className="tbl">
            <div className="tbh">
              <b>You</b>
              <span className="m">Signed in as {p.fullName}</span>
            </div>
            <div className="fbody">
              <dl className="facts">
                <Fact label="Your name" value={p.fullName} />
                <Fact label="Email" value={p.email} mono />
                <Fact label="Mobile" value={p.mobile} mono />
                <Fact label="Job title" value={p.jobTitle} />
              </dl>
            </div>
          </section>

          <section className="tbl">
            <div className="tbh">
              <b>Organisation</b>
              <span className="m">{p.orgType === 'BUYER' ? 'Buyer account' : 'Vendor account'}</span>
            </div>
            <div className="fbody">
              <dl className="facts">
                <Fact label="Legal name" value={p.legalName} />
                <Fact label="Trade name" value={p.tradeName} />
                <Fact label="Constitution" value={constitution} />
                {p.orgType === 'BUYER' && <Fact label="Industry" value={industry} />}
                {p.orgType === 'VENDOR' && (
                  <Fact label="Business category" value={p.businessCategory} />
                )}
                <Fact label="Staff band" value={staffBand ?? p.employeeCountBand} />
                <Fact label="Annual volume band" value={volumeBand ?? p.annualTurnoverBand} />
                <Fact label="Website" value={p.website} />
                <Fact
                  label="Registered address"
                  value={p.registeredAddress ? formatAddress(p.registeredAddress) : null}
                />
              </dl>
            </div>
          </section>

          <section className="tbl">
            <div className="tbh">
              <b>Statutory</b>
              <span className="m">What every invoice and payout is raised against</span>
            </div>
            <div className="fbody">
              <dl className="facts">
                <Fact label="GSTIN" value={p.gstin} mono />
                <Fact label="Name as per GST" value={p.gstLegalName ?? p.legalName} />
                <Fact
                  label="PAN"
                  value={p.pan}
                  mono
                  note={
                    p.pan
                      ? p.panVerified
                        ? 'Verified against the income-tax portal'
                        : 'Not yet verified against the income-tax portal'
                      : undefined
                  }
                />
                <Fact label="Name as per PAN" value={p.panName} />
              </dl>
              <p className="fnote off">
                GSTIN and PAN are bound to your invoices and tax credits. Changing them needs a
                document showing the new registration — raise a support ticket and we take it
                through the change-of-particulars check.
              </p>
            </div>
          </section>
        </div>

        <SidePanel
          title="Related"
          description="Other places your organisation's particulars appear."
          footnote="Your delivery and billing sites are separate from the registered address above. Billing addresses are locked to your GSTIN."
        >
          <Link className="pill wire" href="/account/addresses">
            Your addresses
          </Link>
          <Link className="pill wire" href="/account/team">
            Your team
          </Link>
        </SidePanel>
      </div>
    </>
  );
}

function Fact({
  label,
  value,
  mono = false,
  note,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
  note?: string;
}): React.JSX.Element {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={value ? (mono ? 'mono' : undefined) : 'notmeasured'}>
        {value ?? 'Not recorded'}
        {note && value ? <span className="denom">{note}</span> : null}
      </dd>
    </div>
  );
}

function ProfileSkeleton(): React.JSX.Element {
  return (
    <>
      <div className="wshead obhead">
        <Skeleton lines={2} />
      </div>
      <div className="rec">
        <div className="evid">
          <Skeleton lines={12} />
        </div>
      </div>
    </>
  );
}

function SignedOut(): React.JSX.Element {
  return (
    <EmptyState
      title="Sign in to see your profile"
      body="Your name, company and GST particulars are shown here once you are signed in."
      action={
        <Link className="pill solid" href="/sign-in">
          Sign in
        </Link>
      }
    />
  );
}

function Failed({ message }: { message: string }): React.JSX.Element {
  return (
    <EmptyState
      title="We could not load your profile"
      body={message}
      action={
        <button type="button" className="pill wire" onClick={() => window.location.reload()}>
          Try again
        </button>
      }
    />
  );
}
