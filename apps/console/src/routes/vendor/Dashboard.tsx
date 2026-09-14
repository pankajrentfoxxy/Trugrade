import * as React from 'react';
import { Link, useNavigate } from 'react-router';
import {
  Button,
  ClauseHeading,
  EmptyState,
  InfoPopover,
  LedgerRow,
  LedgerSection,
  RegisterStrip,
  Skeleton,
  Stepper,
  type RegisterCell,
} from '@trugrade/ui';
import type { ResumableOnboarding } from '../../../../storefront/src/app/register/api';
import { useResource } from '../../lib/useResource';
import { API, NO_DATE, onDate, rupees, type DashboardTiles, type VendorQueue } from './api';

function profileCompletionPct(onboarding: ResumableOnboarding | undefined): number {
  if (!onboarding?.progress?.steps) return 0;
  const required = onboarding.progress.steps.filter((s) => s.isRequired);
  if (required.length === 0) return 0;
  const sum = required.reduce(
    (acc, s) => acc + (s.status === 'COMPLETE' ? 100 : s.completionPct),
    0,
  );
  return Math.round(sum / required.length);
}

/**
 * ARCHETYPE E — Workspace.
 * MANIFEST: clause heading, register strip, needs-you table, money ledger.
 */

const FIRST_RUN = [
  'Pick the machine from our catalog and declare its condition.',
  'We inspect at your site. Nothing goes on sale before it is sealed.',
  'Machines that pass go live. You are paid after delivery.',
] as const;

const FIRST_RUN_LABELS = ['Declare it', 'We inspect it', 'It goes live'] as const;

function slaText(q: VendorQueue): string {
  if (q.slaHours === null) return '—';
  if (q.breachedCount !== null && q.breachedCount > 0) return `Over by ${q.breachedCount}`;
  return `${q.slaHours} h`;
}

function ageText(q: VendorQueue): string {
  return q.oldestWaitHours === null ? '—' : `${q.oldestWaitHours} h`;
}

export function VendorDashboardRoute(): React.JSX.Element {
  const navigate = useNavigate();
  const { data, error } = useResource<DashboardTiles>(
    API.dashboard,
    'Your dashboard is unavailable',
  );
  const { data: onboarding } = useResource<ResumableOnboarding>(
    '/api/onboarding/steps',
    'Profile progress is unavailable',
  );

  const profilePct = profileCompletionPct(onboarding ?? undefined);
  const listingUnlocked = onboarding?.status === 'VERIFIED';

  if (error) {
    return (
      <EmptyState
        title="Your dashboard did not load"
        body={`${error}. Nothing has been changed — reload to try again.`}
        action={
          <Link className="vl-link" to="/vendor/listings">
            Open your listings
          </Link>
        }
      />
    );
  }

  if (!data) {
    return (
      <div className="vl-page">
        <ClauseHeading n="01" kicker="Vendor day sheet" title="Today" />
        <Skeleton lines={4} />
      </div>
    );
  }

  if (data.unitsEverListed === 0) {
    return (
      <div className="vl-page">
        <ClauseHeading
          n="01"
          kicker="Getting started"
          title="Complete your profile"
          actions={
            listingUnlocked ? (
              <Button variant="primary" onClick={() => void navigate('/vendor/listings/new')}>
                Create listing
              </Button>
            ) : (
              <Button variant="primary" onClick={() => void navigate('/vendor/profile')}>
                Open profile
              </Button>
            )
          }
        />
        <RegisterStrip
          cells={[
            { label: 'Profile', value: `${profilePct}%`, sub: 'required before listing' },
            {
              label: 'Listings',
              value: listingUnlocked ? 'Unlocked' : 'Locked',
              sub: listingUnlocked ? 'ready to sell' : 'after approval',
            },
          ]}
        />
        <Stepper
          label="Getting started"
          steps={FIRST_RUN.map((summary, i) => ({
            key: String(i),
            label: FIRST_RUN_LABELS[i] ?? '',
            status: i === 0 ? 'current' : 'upcoming',
            summary,
          }))}
        />
        {listingUnlocked ? (
          <p>
            <Link className="vl-link" to="/vendor/listings/new">
              Start the first listing
            </Link>
          </p>
        ) : (
          <p className="text-body-sm text-ink-3">
            <Link className="vl-link" to="/vendor/profile">
              Finish your supplier profile
            </Link>{' '}
            — listing opens after approval.
          </p>
        )}
      </div>
    );
  }

  const cells: RegisterCell[] = [
    {
      label: 'Units on sale',
      value: String(data.unitsLive),
      sub: `${data.unitsSoldThisMonth} sold this month`,
    },
    {
      label: 'Awaiting inspection',
      value: String(data.unitsAwaitingQc),
      sub: data.queues.awaitingInspection.oldestWaitHours !== null
        ? `oldest ${data.queues.awaitingInspection.oldestWaitHours} h`
        : 'not timed',
    },
    {
      label: 'Corrections',
      value: String(data.queues.gradeCorrections.count),
      sub:
        data.queues.gradeCorrections.breachedCount !== null
          ? `${data.queues.gradeCorrections.breachedCount} past SLA`
          : 'SLA not measured',
    },
    {
      label: 'Due to you',
      value: rupees(data.payoutsDue),
      sub:
        data.payoutsDueOn && onDate(data.payoutsDueOn) !== NO_DATE
          ? `expected ${onDate(data.payoutsDueOn)}`
          : 'No date — payout cycle sets it',
    },
  ];

  const needs = [
    {
      key: 'corrections',
      type: 'Grade correction',
      subject: 'Grade corrections awaiting your answer',
      state: data.queues.gradeCorrections.count > 0 ? 'Awaiting response' : 'Clear',
      age: ageText(data.queues.gradeCorrections),
      sla: slaText(data.queues.gradeCorrections),
      href: '/vendor/corrections',
      count: data.queues.gradeCorrections.count,
      breached: data.queues.gradeCorrections.breachedCount,
      slaHours: data.queues.gradeCorrections.slaHours,
    },
    {
      key: 'awaiting-qc',
      type: 'Inspection',
      subject: 'Machines awaiting inspection',
      state: data.queues.awaitingInspection.count > 0 ? 'Unscheduled' : 'Clear',
      age: ageText(data.queues.awaitingInspection),
      sla: slaText(data.queues.awaitingInspection),
      href: '/vendor/listings?status=AWAITING_QC',
      count: data.queues.awaitingInspection.count,
      breached: data.queues.awaitingInspection.breachedCount,
      slaHours: data.queues.awaitingInspection.slaHours,
    },
  ]
    .filter((row) => row.count > 0)
    .sort((a, b) => {
      const aKnown = a.breached === null ? 1 : 0;
      const bKnown = b.breached === null ? 1 : 0;
      if (aKnown !== bKnown) return aKnown - bKnown;
      return (b.breached ?? 0) - (a.breached ?? 0);
    });

  const now = new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(new Date());

  return (
    <div className="vl-page">
      <ClauseHeading
        n="01"
        kicker="Vendor day sheet"
        title="Today"
        meta={`${now} IST`}
        actions={
          <>
            <Button variant="secondary" onClick={() => void navigate('/vendor/listings')}>
              Bulk upload
            </Button>
            <Button variant="primary" onClick={() => void navigate('/vendor/listings/new')}>
              Create listing
            </Button>
          </>
        }
      />

      <div data-testid="kpi-row">
        <RegisterStrip cells={cells} />
        <Link className="sr-only" to="/vendor/listings?status=ACTIVE">
          Live units
        </Link>
      </div>

      <LedgerSection
        n="02"
        title="Needs you"
        count={needs.length > 0 ? needs.length : undefined}
        aside="Ordered by SLA"
      >
        {needs.length > 0 ? (
          <div className="vl-table-wrap" data-testid="queue-list">
            <table className="vl-table min-w-[720px]">
              <thead>
                <tr>
                  {['Type', 'Subject', 'State', 'Age', 'SLA', ''].map((h) => (
                    <th key={h || 'act'}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {needs.map((row) => {
                  const sev =
                    row.breached !== null && row.breached > 0
                      ? 'vl-sev vl-sev--fail'
                      : row.slaHours === null
                        ? 'vl-sev vl-sev--warn'
                        : 'vl-sev vl-sev--ok';
                  return (
                    <tr key={row.key}>
                      <td>
                        <span className={sev} aria-hidden="true" />
                        {row.type}
                      </td>
                      <td className="vl-td-ink">{row.subject}</td>
                      <td>{row.state}</td>
                      <td className="font-mono tabular-nums vl-td-ink">{row.age}</td>
                      <td
                        className={`font-mono tabular-nums ${
                          row.breached !== null && row.breached > 0 ? 'text-fail' : 'vl-td-ink'
                        }`}
                      >
                        {row.slaHours !== null ? (
                          <>
                            SLA
                            {row.breached !== null && row.breached > 0
                              ? ` · ${row.breached} past SLA`
                              : ` ${row.slaHours} h`}
                          </>
                        ) : (
                          <span className="text-ink-4">Breaches not measured</span>
                        )}
                      </td>
                      <td className="text-right">
                        <Link to={row.href} className="vl-link">
                          Open
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </LedgerSection>

      <LedgerSection
        n="03"
        title="Money"
        aside={
          <Link to="/vendor/payables" className="vl-section__aside">
            Payables
          </Link>
        }
      >
        <div className="vl-money">
          <LedgerRow
            label={
              <span className="inline-flex items-center gap-2">
                Net due
                <InfoPopover label="About net due">
                  Accrued and eligible payables, net of TDS. No payout date is invented when the
                  cycle has not set one.
                </InfoPopover>
              </span>
            }
            value={rupees(data.payoutsDue)}
            total
          />
        </div>
      </LedgerSection>
    </div>
  );
}
