import * as React from 'react';
import {
  EmptyState,
  RecordHeader,
  SidePanel,
  Skeleton,
  StatusPill,
} from '@trugrade/ui';
import { PageHeader } from '../../lib/controls';
import { useResource } from '../../lib/useResource';
import { API, type OrgProfile } from './profile-api';

/**
 * ARCHETYPE C — Record. The vendor organisation's registration particulars.
 * DENSITY: default (vendor portal), set on the app root by the shell.
 */

const labelOf = (value: string | null | undefined): string | null =>
  value && value.length > 0 ? value : null;

const formatAddress = (p: OrgProfile): string | null => {
  if (!p.registeredAddress) return null;
  const a = p.registeredAddress;
  return [a.line1, a.line2, `${a.city}, ${a.state} ${a.pincode}`].filter(Boolean).join(' · ');
};

const statusLabel = (status: string): string =>
  status
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

export function VendorProfileRoute(): React.JSX.Element {
  const { data, error } = useResource<OrgProfile>(`${API}/account/profile`, 'Profile');

  if (!data && !error) {
    return (
      <>
        <PageHeader title="Your profile">Loading your registration particulars…</PageHeader>
        <Skeleton lines={12} />
      </>
    );
  }

  if (error) {
    return (
      <>
        <PageHeader title="Your profile" />
        <EmptyState
          title="We could not load your profile"
          body={`${error}. Nothing here has changed.`}
        />
      </>
    );
  }

  if (!data) {
    return (
      <>
        <PageHeader title="Your profile" />
        <EmptyState title="No profile on record" body="Sign in again if this looks wrong." />
      </>
    );
  }

  const p = data;

  return (
    <>
      <PageHeader title="Your profile">
        The company and statutory particulars we hold from your registration.
      </PageHeader>

      <RecordHeader
        className="mt-4"
        title={p.legalName}
        subtitle={
          p.tradeName && p.tradeName !== p.legalName ? (
            <>
              Trading as <span className="font-mono tnum">{p.tradeName}</span>
            </>
          ) : (
            'Legal entity on every purchase order and payout.'
          )
        }
        status={
          <StatusPill tone={p.status === 'VERIFIED' ? 'pass' : 'neutral'} label={statusLabel(p.status)} />
        }
        identifiers={[
          ...(p.gstin
            ? [{ label: 'GSTIN', value: <span className="font-mono tnum">{p.gstin}</span> }]
            : []),
          ...(p.pan
            ? [{ label: 'PAN', value: <span className="font-mono tnum">{p.pan}</span> }]
            : []),
        ]}
      />

      <div className="mt-6 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-5">
          <ProfileSection title="You" note={`Signed in as ${p.fullName}`}>
            <Fact label="Your name" value={p.fullName} />
            <Fact label="Email" value={p.email} mono />
            <Fact label="Mobile" value={p.mobile} mono />
            <Fact label="Job title" value={p.jobTitle} />
          </ProfileSection>

          <ProfileSection title="Organisation" note="Vendor account">
            <Fact label="Legal name" value={p.legalName} />
            <Fact label="Trade name" value={p.tradeName} />
            <Fact label="Constitution" value={p.constitution} />
            <Fact label="Business category" value={p.businessCategory} />
            <Fact label="Staff band" value={p.employeeCountBand} />
            <Fact label="Website" value={p.website} />
            <Fact label="Registered address" value={formatAddress(p)} />
          </ProfileSection>

          <ProfileSection title="Statutory" note="What every invoice and payout is raised against">
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
            <p className="border-t border-rule-2 pt-4 text-body-sm text-ink-3">
              GSTIN and PAN are bound to your payouts and TDS. Changing them needs a document
              showing the new registration — raise a support ticket and we take it through the
              change-of-particulars check.
            </p>
          </ProfileSection>
        </div>

        <SidePanel
          title="Need to change something?"
          description="Statutory fields are read-only here."
          footnote="Bank account and payout details are on Payables, after penny-drop verification."
        >
          <a className="text-body-sm text-acc-ink underline underline-offset-4" href="/vendor/payables">
            Payout account
          </a>
        </SidePanel>
      </div>
    </>
  );
}

function ProfileSection({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="tg-card overflow-hidden rounded-lg border border-rule bg-sheet">
      <div className="flex flex-wrap items-center gap-2 border-b border-rule bg-sheet-2 px-4 py-3">
        <h2 className="text-h3 text-ink">{title}</h2>
        <span className="font-mono text-label uppercase tracking-[0.12em] text-ink-4">{note}</span>
      </div>
      <dl className="flex flex-col px-4 py-1">{children}</dl>
    </section>
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
  const shown = labelOf(value);
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-rule-2 py-2.5 last:border-b-0">
      <dt className="text-body-sm text-ink-3">{label}</dt>
      <dd
        className={`text-right text-body-sm ${shown ? (mono ? 'font-mono tnum text-ink' : 'text-ink') : 'text-ink-4'}`}
      >
        {shown ?? 'Not recorded'}
        {note && shown ? (
          <span className="mt-0.5 block text-label text-ink-4">{note}</span>
        ) : null}
      </dd>
    </div>
  );
}
