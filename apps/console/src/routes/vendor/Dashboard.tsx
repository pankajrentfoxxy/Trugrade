import * as React from 'react';
import { Link, useNavigate } from 'react-router';
import {
  Button,
  HubPageHeader,
  EmptyState,
  LedgerRow,
  Panel,
  HubKpiRow,
  Skeleton,
  StatusPill,
} from '@trugrade/ui';
import type { ResumableOnboarding } from '@trugrade/contracts';
import { useResource } from '../../lib/useResource';
import { useVendorOnboarding } from '../../lib/vendorOnboarding';
import { AskOwnerGate } from './ProfileLockGate';
import type { OrgProfile } from './profile-api';
import { API, rupees, type DashboardTiles, type PayablesView, type VendorQueue } from './api';
import { getTeam, type TeamPayload } from './team/teamApi';
import { ROLE_LABEL } from './team/capability-matrix';
import {
  PROFILE_SECTIONS,
  profileCompletionPct,
  sectionIsDone,
  sectionSummary,
  type ProfileSectionId,
} from './profile/sections.config';

/**
 * ARCHETYPE E — Workspace. KPI strip, needs-you queue, payout side rail.
 */

type NeedRow = {
  key: string;
  severity: 'fail' | 'warn' | 'ok';
  subject: string;
  meta: string;
  age: string;
  href: string;
};

/**
 * The tiles are typed as numbers, but an older API build that predates a field
 * simply omits it, and `String(undefined)` puts the word "undefined" on screen
 * where a count belongs. Say nothing rather than say that.
 */
function count(n: number | undefined): string | null {
  return typeof n === 'number' ? String(n) : null;
}

function queueAge(q: VendorQueue): string {
  return q.oldestWaitHours === null ? '—' : `${q.oldestWaitHours} h`;
}

function buildNeeds(data: DashboardTiles): NeedRow[] {
  const rows: NeedRow[] = [];
  if (data.posToAccept > 0) {
    rows.push({
      key: 'pos',
      severity: 'warn',
      subject: 'Purchase orders to accept',
      meta: `${data.posToAccept} issued`,
      age: '—',
      href: '/vendor/orders?status=RAISED',
    });
  }
  if (data.queues.gradeCorrections.count > 0) {
    const breached = data.queues.gradeCorrections.breachedCount ?? 0;
    rows.push({
      key: 'corrections',
      severity: breached > 0 ? 'fail' : 'warn',
      subject: 'Grade corrections',
      meta: `${data.queues.gradeCorrections.count} waiting`,
      age: queueAge(data.queues.gradeCorrections),
      href: '/vendor/corrections',
    });
  }
  if (data.queues.awaitingInspection.count > 0) {
    rows.push({
      key: 'qc',
      severity: 'ok',
      subject: 'Awaiting inspection',
      meta: `${data.queues.awaitingInspection.count} machines`,
      age: queueAge(data.queues.awaitingInspection),
      href: '/vendor/qc/visits',
    });
  }
  return rows.sort((a, b) => {
    const rank = { fail: 0, warn: 1, ok: 2 };
    return rank[a.severity] - rank[b.severity];
  });
}

function ProfileGate({
  onboarding,
  onOpen,
}: {
  onboarding: ResumableOnboarding;
  onOpen: (id: ProfileSectionId) => void;
}): React.JSX.Element {
  const pct = profileCompletionPct(onboarding);
  return (
    <>
      <div className="rounded border border-warn bg-warn-wash px-4 py-3 text-body-sm text-ink">
        Profile {pct}% complete —{' '}
        {onboarding.editable
          ? 'listing stays locked until verified.'
          : 'submitted, so it cannot be edited while our team reviews it. Listing unlocks once it is approved.'}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {PROFILE_SECTIONS.map((section) => {
          const done = sectionIsDone(section, onboarding);
          return (
            <article key={section.id} className="rounded border border-rule bg-sheet p-4">
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-body font-medium text-ink">{section.title}</h2>
                {done ? (
                  <StatusPill tone="pass" label="Done" />
                ) : (
                  <StatusPill tone="warn" label="Open" />
                )}
              </div>
              <p className="mt-2 text-body-sm text-ink-3">{sectionSummary(section, onboarding)}</p>
              {onboarding.editable ? (
                <Button
                  variant={done ? 'secondary' : 'primary'}
                  className="mt-3"
                  onClick={() => onOpen(section.id)}
                >
                  {done ? 'Edit' : 'Fill'}
                </Button>
              ) : null}
            </article>
          );
        })}
      </div>
    </>
  );
}

export function VendorDashboardRoute(): React.JSX.Element {
  const navigate = useNavigate();
  const { data, error } = useResource<DashboardTiles>(API.dashboard, 'Dashboard unavailable');
  const onboarding = useVendorOnboarding();
  const { data: profile, error: profileError } = useResource<OrgProfile>(
    '/api/account/profile',
    'Profile unavailable',
  );
  const { data: payables, error: payablesError } = useResource<PayablesView>(
    API.payables,
    'Payables unavailable',
  );
  const [team, setTeam] = React.useState<TeamPayload | null>(null);

  React.useEffect(() => {
    void getTeam().then((result) => {
      setTeam(result.ok ? result.data : null);
    });
  }, []);

  // Onboarding answers the question for the owner and admin; every other seat is
  // refused it by design (403), and reads the org's own status instead. Neither
  // answer is allowed to hold the whole page on a skeleton.
  const verified =
    onboarding.kind === 'ready'
      ? onboarding.data.status === 'VERIFIED'
      : profile
        ? profile.status === 'VERIFIED'
        : undefined;

  if (error) {
    return <EmptyState title="Dashboard did not load" body={error} />;
  }

  if (onboarding.kind !== 'ready' && verified === undefined && profileError) {
    return <EmptyState title="Dashboard did not load" body={profileError} />;
  }

  if (!data || onboarding.kind === 'loading' || verified === undefined) {
    return (
      <div className="hub-page">
        <HubPageHeader title="Home" />
        <Skeleton lines={6} />
      </div>
    );
  }

  if (!verified) {
    if (onboarding.kind !== 'ready') {
      return (
        <div className="hub-page">
          <HubPageHeader title="Home" />
          <AskOwnerGate section="listings, orders and payouts" />
        </div>
      );
    }
    return (
      <div className="hub-page">
        <HubPageHeader
          title="Home"
          actions={
            <Button variant="primary" onClick={() => void navigate('/vendor/profile')}>
              Open profile
            </Button>
          }
        />
        <ProfileGate onboarding={onboarding.data} onOpen={() => void navigate('/vendor/profile')} />
      </div>
    );
  }

  const needs = buildNeeds(data);
  const cells = [
    { label: 'Live listings', value: count(data.liveListings) },
    { label: 'Units on sale', value: count(data.unitsLive) },
    { label: 'Awaiting inspection', value: count(data.unitsAwaitingQc) },
    { label: 'POs to accept', value: count(data.posToAccept) },
    { label: 'Due to you', value: rupees(data.payoutsDue) },
  ];

  return (
    <div className="hub-page">
      <HubPageHeader
        title="Home"
        actions={
          <Button variant="primary" onClick={() => void navigate('/vendor/listings')}>
            Listings
          </Button>
        }
      />

      <HubKpiRow cells={cells} />

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel title="Needs you" count={needs.length || undefined} actions="By urgency">
          {needs.length === 0 ? (
            <div className="px-5 py-4">
              <EmptyState title="Nothing waiting" body="Queues are clear." />
            </div>
          ) : (
            <ul className="list-none px-5 py-1">
              {needs.map((row) => (
                <li
                  key={row.key}
                  className="flex items-center gap-3 border-b border-rule-2 py-3 last:border-b-0"
                >
                  <span
                    className={`size-2 shrink-0 rounded-full ${
                      row.severity === 'fail'
                        ? 'bg-fail'
                        : row.severity === 'warn'
                          ? 'bg-warn'
                          : 'bg-ink-3'
                    }`}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <Link to={row.href} className="text-ink underline underline-offset-4">
                      {row.subject}
                    </Link>
                    <p className="text-body-sm text-ink-3">{row.meta}</p>
                  </div>
                  <span className="font-mono tnum text-body-sm text-ink-2">{row.age}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <aside className="flex flex-col gap-6">
          <Panel title="Next payout">
            {payables ? (
              <>
                <LedgerRow label="Gross" value={rupees(payables.statement.gross)} />
                <LedgerRow label="TDS" value={`− ${rupees(payables.statement.tds.amount)}`} />
                <LedgerRow
                  label="Corrections"
                  value={`− ${rupees(payables.statement.penalties)}`}
                />
                <LedgerRow label="QC fees" value={`− ${rupees(payables.statement.qcFees)}`} />
                <LedgerRow label="Net" value={rupees(payables.statement.net)} total />
              </>
            ) : payablesError ? (
              <p className="px-5 py-4 text-body-sm text-ink-3">
                {payablesError.includes('(403)')
                  ? 'Payouts are visible to the account owner and finance.'
                  : `${payablesError}. Reload to try again.`}
              </p>
            ) : (
              <div className="px-5 py-4">
                <Skeleton lines={4} />
              </div>
            )}
          </Panel>

          <Panel title="Your team">
            <div className="px-5 py-3">
              {team ? (
                <ul className="list-none p-0">
                  {team.members.slice(0, 5).map((m) => (
                    <li
                      key={m.id}
                      className="border-b border-rule-2 py-2 text-body-sm last:border-b-0"
                    >
                      <span className="text-ink">{m.fullName}</span>
                      {/* The label, not the constant. `VENDOR_ADMIN` is our
                          word for it; "Operations Manager" is the supplier's. */}
                      <span className="ml-2 text-ink-3">
                        {(m.roles[0] && ROLE_LABEL[m.roles[0]]) ?? 'Member'}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-body-sm text-ink-3">Team unavailable.</p>
              )}
              <Link className="hub-link mt-3 inline-block text-body-sm" to="/vendor/team">
                Manage team
              </Link>
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
