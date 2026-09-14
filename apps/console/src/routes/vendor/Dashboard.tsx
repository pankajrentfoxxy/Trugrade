import * as React from 'react';
import { Link, useNavigate } from 'react-router';
import {
  Button,
  ClauseHeading,
  EmptyState,
  LedgerRow,
  LedgerSection,
  RegisterStrip,
  Skeleton,
  StatusPill,
} from '@trugrade/ui';
import type { ResumableOnboarding } from '../../../../storefront/src/app/register/api';
import { useResource } from '../../lib/useResource';
import { API, rupees, type DashboardTiles, type PayablesView, type VendorQueue } from './api';
import { getTeam, type TeamPayload } from './team/teamApi';
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
        Profile {pct}% complete — listing stays locked until verified.
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {PROFILE_SECTIONS.map((section) => {
          const done = sectionIsDone(section, onboarding);
          return (
            <article key={section.id} className="rounded border border-rule bg-sheet p-4">
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-body font-medium text-ink">{section.title}</h2>
                {done ? <StatusPill tone="pass" label="Done" /> : <StatusPill tone="warn" label="Open" />}
              </div>
              <p className="mt-2 text-body-sm text-ink-3">{sectionSummary(section, onboarding)}</p>
              <Button
                variant={done ? 'secondary' : 'primary'}
                className="mt-3"
                onClick={() => onOpen(section.id)}
              >
                {done ? 'Edit' : 'Fill'}
              </Button>
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
  const { data: onboarding } = useResource<ResumableOnboarding>(
    '/api/onboarding/steps',
    'Profile unavailable',
  );
  const { data: payables } = useResource<PayablesView>(API.payables, 'Payables unavailable');
  const [team, setTeam] = React.useState<TeamPayload | null>(null);

  React.useEffect(() => {
    void getTeam().then((result) => {
      setTeam(result.ok ? result.data : null);
    });
  }, []);

  const profileComplete = onboarding != null && onboarding.status === 'VERIFIED';

  if (error) {
    return <EmptyState title="Dashboard did not load" body={error} />;
  }

  if (!data || !onboarding) {
    return (
      <div className="vl-page">
        <ClauseHeading n="01" kicker="Today" title="Home" />
        <Skeleton lines={6} />
      </div>
    );
  }

  if (!profileComplete) {
    return (
      <div className="vl-page">
        <ClauseHeading
          n="01"
          kicker="Today"
          title="Home"
          actions={
            <Button variant="primary" onClick={() => void navigate('/vendor/profile')}>
              Open profile
            </Button>
          }
        />
        <ProfileGate onboarding={onboarding} onOpen={() => void navigate('/vendor/profile')} />
      </div>
    );
  }

  const needs = buildNeeds(data);
  const cells = [
    { label: 'Live listings', value: String(data.liveListings) },
    { label: 'Units on sale', value: String(data.unitsLive) },
    { label: 'Awaiting inspection', value: String(data.unitsAwaitingQc) },
    { label: 'POs to accept', value: String(data.posToAccept) },
    { label: 'Due to you', value: rupees(data.payoutsDue) },
  ];

  return (
    <div className="vl-page">
      <ClauseHeading
        n="01"
        kicker="Today"
        title="Home"
        actions={
          <Button variant="primary" onClick={() => void navigate('/vendor/listings')}>
            Listings
          </Button>
        }
      />

      <RegisterStrip cells={cells} />

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <LedgerSection n="02" title="Needs you" count={needs.length || undefined} aside="By urgency">
          {needs.length === 0 ? (
            <EmptyState title="Nothing waiting" body="Queues are clear." />
          ) : (
            <ul className="list-none p-0">
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
        </LedgerSection>

        <aside className="flex flex-col gap-6">
          <LedgerSection n="03" title="Next payout">
            {payables ? (
              <div className="flex flex-col gap-1">
                <LedgerRow label="Gross" value={rupees(payables.statement.gross)} />
                <LedgerRow
                  label="TDS"
                  value={`− ${rupees(payables.statement.tds.amount)}`}
                />
                <LedgerRow
                  label="Corrections"
                  value={`− ${rupees(payables.statement.penalties)}`}
                />
                <LedgerRow label="QC fees" value={`− ${rupees(payables.statement.qcFees)}`} />
                <LedgerRow label="Net" value={rupees(payables.statement.net)} total />
              </div>
            ) : (
              <Skeleton lines={4} />
            )}
          </LedgerSection>

          <LedgerSection n="04" title="Your team">
            {team ? (
              <ul className="list-none p-0">
                {team.members.slice(0, 5).map((m) => (
                  <li key={m.id} className="border-b border-rule-2 py-2 text-body-sm last:border-b-0">
                    <span className="text-ink">{m.fullName}</span>
                    <span className="ml-2 text-ink-3">{m.roles[0] ?? 'Member'}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-body-sm text-ink-3">Team unavailable.</p>
            )}
            <Link className="mt-2 inline-block text-body-sm underline" to="/vendor/team">
              Manage team
            </Link>
          </LedgerSection>
        </aside>
      </div>
    </div>
  );
}
