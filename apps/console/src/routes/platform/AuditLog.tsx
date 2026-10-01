import * as React from 'react';
import { DataBoard, EmptyState, Skeleton, type Column } from '@trugrade/ui';
import { Board } from '../../lib/controls';
import { useAuth } from '../../lib/auth';
import { useResource } from '../../lib/useResource';
import { useUrlState } from '../../lib/urlState';

/**
 * ARCHETYPE B — Board. The audit log, read-only in the strongest sense.
 * DENSITY: compact (admin), set on the app root by the shell.
 *
 * DRAWN TO A SUPPLIED DESIGN, its markup and colours verbatim
 * (`.audit-board`/`.al-*` in `index.css`, `--admin-*` in `globals.css`) — same
 * arrangement as the catalog, orders, review-queue and people boards.
 * `DataBoard` is still the table: day separators use its native `group` (a
 * real `colSpan` header row, always expanded — there is no collapse control
 * for a day); the before/after panel uses its native `detail` (a real
 * `colSpan` row, opened per `AuditRow.id`). "Group repeated sign-ins" is the
 * one thing neither primitive fits — it needs to fold a RUN of consecutive
 * same-actor rows into one summary row and later unfold exactly that run,
 * which is a second, finer grouping dimension `DataBoard` does not have one
 * of two for. `buildDisplayRows` below does that folding in plain data before
 * the rows ever reach the table, so the table still only ever sees one flat
 * row list.
 *
 * ## There is still no action on this screen
 *
 * `identity.audit_log` is append-only in the database — `trg_append_only`
 * refuses UPDATE and DELETE — and the API exposes no write route. The mock's
 * "Export" button is rendered disabled for the same reason its own copy
 * gives: an export must itself be logged (§3C.7), and that endpoint is not
 * built.
 *
 * ## What the supplied design asks for that this product cannot answer yet
 *
 * - **Event categories, the vendor/applicant org name on an external actor,
 *   and search** are not query parameters `AuditController.list` accepts —
 *   it takes one `action` substring with no OR, `entityType`, `entityId`,
 *   `actor` and a date range. Category pills, the "Who" select and the search
 *   box below all filter the PAGE of rows already fetched, not the server's
 *   `total`/`matching` counts, and every caption that touches them says so.
 *   An external actor's org/type is likewise not on `AuditRow.actor` at all,
 *   so the mock's "Vendor · Northgate" becomes the honest "External".
 * - **The third pattern** — sign-ins logged for people the People page says
 *   have no second factor — would mean this screen also fetching
 *   `/api/account/team`. Not added; the other two patterns (one shared IP,
 *   a suspiciously fast KYC approval) are computed for real, from this same
 *   page of rows.
 */

interface AuditActor {
  userId: string;
  fullName: string | null;
  email: string | null;
}

interface AuditRow {
  id: string;
  occurredAt: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  actor: AuditActor | null;
  actorOrgId: string | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  before: unknown;
  after: unknown;
}

interface AuditLog {
  asAt: string;
  rows: AuditRow[];
  counts: {
    total: number;
    matching: number;
    returned: number;
    beyondThisPage: number;
    excludedByFilter: number;
  };
  facets: {
    actions: Array<{ value: string; count: number }>;
    entityTypes: Array<{ value: string; count: number }>;
  };
  coverage: {
    partitionedFrom: string | null;
    partitionedTo: string | null;
    partitions: number;
    hasDefaultPartition: boolean;
    oldestRow: string | null;
    newestRow: string | null;
    rangeIsCovered: boolean;
  };
}

const IST = 'Asia/Kolkata';

function istTime(iso: string): string {
  return new Date(iso)
    .toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: IST })
    .replace(/\s?(AM|PM)/i, (m) => m.toLowerCase());
}
function istShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: IST });
}
function istDayKey(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: IST,
  });
}

/**
 * Category -> the real action codes seen in this log (`/api/admin/audit-log`
 * facets, 1 Oct 2026 snapshot). A prefix test, not a fixed list, so a new
 * action in a known namespace still sorts correctly without this file
 * changing. Anything matching none of these still shows under "All events".
 */
const CATEGORIES = [
  {
    key: 'kyc',
    label: 'KYC & onboarding',
    dot: 'var(--admin-violet)',
    match: (a: string) => a.startsWith('kyc.'),
  },
  {
    key: 'org',
    label: 'Organizations',
    dot: 'var(--admin-accent)',
    match: (a: string) =>
      a.startsWith('identity.organization.') ||
      a.startsWith('identity.user.') ||
      a.startsWith('identity.contact.') ||
      a.startsWith('account.'),
  },
  {
    key: 'money',
    label: 'Orders & money',
    dot: 'var(--admin-info)',
    match: (a: string) =>
      a.startsWith('procurement.') || a.startsWith('payment.') || a.startsWith('ordering.'),
  },
  {
    key: 'signin',
    label: 'Sign-ins',
    dot: 'var(--admin-dot-raised)',
    match: (a: string) =>
      a.startsWith('identity.login') || a.startsWith('identity.logout') || a.startsWith('identity.mfa') || a.startsWith('identity.password'),
  },
  {
    key: 'settings',
    label: 'Settings & roles',
    dot: 'var(--admin-bad)',
    match: (a: string) => a.startsWith('identity.role') || a.startsWith('platform.'),
  },
] as const;

function categoryOf(action: string): (typeof CATEGORIES)[number] | undefined {
  return CATEGORIES.find((c) => c.match(action));
}

/** Short, human names for the action codes this console actually emits.
 * Unlisted codes fall back to the raw code, still shown in mono beneath. */
const EVENT_NAME: Readonly<Record<string, string>> = {
  'identity.login.succeeded': 'Signed in',
  'identity.login.failed': 'Sign-in failed',
  'identity.logout': 'Signed out',
  'identity.mfa.verified': 'Passed two-step sign-in',
  'identity.password.reset': 'Password reset',
  'identity.organization.created': 'Organization created',
  'identity.organization.profile_promoted': 'Organization profile promoted',
  'identity.user.renamed': 'Person renamed',
  'identity.contact.added': 'Contact added',
  'kyc.onboarding.step_answers': 'Onboarding step answered',
  'kyc.onboarding.step_completed': 'Onboarding step completed',
  'kyc.document.uploaded': 'KYC document uploaded',
  'kyc.document.deleted': 'KYC document deleted',
  'kyc.document.verified': 'KYC document verified',
  'kyc.submitted_for_review': 'KYC submitted for review',
  'kyc.review.approved': 'KYC approved',
  'account.address.created': 'Address added',
  'account.address.updated': 'Address updated',
  'account.invite.created': 'Invite sent',
  'account.invite.accepted': 'Invite accepted',
  'account.member.updated': 'Member updated',
  'payment.document.downloaded': 'Payment document downloaded',
  'procurement.po.responded': 'Purchase order responded to',
  'procurement.po.dispatched': 'Purchase order dispatched',
};
const eventName = (action: string): string => EVENT_NAME[action] ?? action.replace(/[._]/g, ' ');

/** Sign-in events plain enough to fold into one summary when the same person
 * does several in a row — never an event with its own before/after. */
const GROUPABLE = new Set(['identity.login.succeeded', 'identity.logout', 'identity.mfa.verified']);

type DisplayRow = { kind: 'row'; row: AuditRow } | { kind: 'group'; key: string; members: AuditRow[] };

/**
 * Folds consecutive same-actor sign-in/out/MFA rows into one group row,
 * following the server's own order — so a page it already sorted newest-first
 * is grouped here without a second sort. A run shorter than two stays plain;
 * folding a single sign-in would hide a real row behind a summary of one.
 */
function buildDisplayRows(
  rows: readonly AuditRow[],
  groupingOn: boolean,
  expandedGroups: ReadonlySet<string>,
): DisplayRow[] {
  if (!groupingOn) return rows.map((row) => ({ kind: 'row', row }));
  const out: DisplayRow[] = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i]!;
    if (row.actor && GROUPABLE.has(row.action)) {
      let j = i + 1;
      while (j < rows.length) {
        const next = rows[j]!;
        if (!next.actor || next.actor.userId !== row.actor.userId || !GROUPABLE.has(next.action)) break;
        j++;
      }
      const members = rows.slice(i, j);
      if (members.length >= 2) {
        const key = `grp-${row.actor.userId}-${row.id}`;
        if (expandedGroups.has(key)) {
          for (const m of members) out.push({ kind: 'row', row: m });
        } else {
          out.push({ kind: 'group', key, members });
        }
        i = j;
        continue;
      }
    }
    out.push({ kind: 'row', row });
    i++;
  }
  return out;
}

/** "signed in 10 times and passed two-step sign-in 5 times" — built from the
 * action counts actually in the group, not written per combination. */
function groupSummary(members: readonly AuditRow[]): string {
  const counts = { login: 0, mfa: 0, logout: 0 };
  for (const m of members) {
    if (m.action === 'identity.login.succeeded') counts.login++;
    else if (m.action === 'identity.mfa.verified') counts.mfa++;
    else if (m.action === 'identity.logout') counts.logout++;
  }
  const clauses: string[] = [];
  if (counts.login > 0) clauses.push(`signed in${counts.login > 1 ? ` ${counts.login} times` : ''}`);
  if (counts.mfa > 0) clauses.push(`passed two-step sign-in${counts.mfa > 1 ? ` ${counts.mfa} times` : ''}`);
  if (counts.logout > 0) clauses.push(`signed out${counts.logout > 1 ? ` ${counts.logout} times` : ''}`);
  return clauses.join(' and ');
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

/**
 * `AuditRow.actorOrgId` is not reliably "the actor's own org" — on a KYC
 * review it is `input.orgId`, the APPLICANT's org, because that is what the
 * action is scoped to (`kyc.service.ts`: `actorOrgId: input.orgId` on the
 * `kyc.review.*` record). Taken at face value, that puts the super admin's
 * own approval under "External". Sign-in/out/MFA events don't have this
 * problem — their `actorOrgId` is always the signed-in session's own org —
 * so `homeOrgByActor` below trusts those to learn each actor's real home org
 * for this page, and every other row for that same actor borrows it.
 */
function resolveActorOrgId(row: AuditRow, homeOrgByActor: ReadonlyMap<string, string>): string | null {
  if (!row.actor) return null;
  return homeOrgByActor.get(row.actor.userId) ?? row.actorOrgId;
}

function isStaff(row: AuditRow, myOrgId: string | undefined, homeOrgByActor: ReadonlyMap<string, string>): boolean {
  const org = resolveActorOrgId(row, homeOrgByActor);
  return org !== null && org === myOrgId;
}

function WhoCell({
  row,
  myOrgId,
  homeOrgByActor,
}: {
  row: AuditRow;
  myOrgId: string | undefined;
  homeOrgByActor: ReadonlyMap<string, string>;
}): React.JSX.Element {
  if (row.actor === null) {
    return <span style={{ color: 'var(--admin-faint)' }}>No signed-in actor</span>;
  }
  const staff = isStaff(row, myOrgId, homeOrgByActor);
  const name = row.actor.fullName ?? row.actor.email ?? row.actor.userId;
  return (
    <div className="al-who">
      <span className={`al-avatar ${staff ? 'al-avatar--staff' : 'al-avatar--ext'}`}>{initials(name)}</span>
      <div>
        <div className="al-who__name">
          {name}
          <span className={`al-tag ${staff ? 'al-tag--staff' : 'al-tag--ext'}`}>
            {staff ? 'Staff' : 'External'}
          </span>
        </div>
        {row.actor.email && <div className="al-who__email">{row.actor.email}</div>}
      </div>
    </div>
  );
}

/** Shallow key diff of two JSON snapshots — only fields that actually
 * changed, which is what "Only changed fields are shown" means literally
 * here rather than as a caption nobody checked. */
function diffFields(before: unknown, after: unknown): Array<{ field: string; before: string; after: string }> {
  const b = before && typeof before === 'object' ? (before as Record<string, unknown>) : {};
  const a = after && typeof after === 'object' ? (after as Record<string, unknown>) : {};
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const out: Array<{ field: string; before: string; after: string }> = [];
  for (const k of keys) {
    const bv = b[k];
    const av = a[k];
    if (JSON.stringify(bv) === JSON.stringify(av)) continue;
    out.push({ field: k, before: formatVal(bv), after: formatVal(av) });
  }
  return out;
}
function formatVal(v: unknown): string {
  if (v === undefined) return '—';
  if (v === null) return 'null';
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

function DiffBox({ row }: { row: AuditRow }): React.JSX.Element {
  const fields = diffFields(row.before, row.after);
  return (
    <div className="al-diff__box">
      <div className="al-diff__head">
        <span>Field</span>
        <span>Before</span>
        <span>After</span>
      </div>
      {fields.length === 0 ? (
        <div className="al-diff__note">The two snapshots carry no field that differs.</div>
      ) : (
        fields.map((f) => (
          <div className="al-diff__row" key={f.field}>
            <span>{f.field}</span>
            <span className="b">{f.before}</span>
            <span className="a">{f.after}</span>
          </div>
        ))
      )}
      <div className="al-diff__note">
        Only changed fields are shown. PAN, bank details, tokens and OTPs are masked before they&rsquo;re
        written, so they never appear here.
      </div>
    </div>
  );
}

interface Pattern {
  sev: 'bad' | 'warn';
  text: React.ReactNode;
  showId?: string;
}

/** Computed from this page's rows only — see the file-top comment for why a
 * third, cross-page pattern from the mock is not here. */
function computePatterns(rows: readonly AuditRow[]): Pattern[] {
  const out: Pattern[] = [];

  const ips = new Set(rows.map((r) => r.ip).filter((v): v is string => v !== null));
  if (rows.length > 0 && ips.size === 1) {
    out.push({
      sev: 'warn',
      text: (
        <>
          <strong>
            Every event on this page comes from <span className="mono">{[...ips][0]}</span>.
          </strong>{' '}
          The real IP address isn&rsquo;t being recorded, so you can&rsquo;t tell where a sign-in came
          from.
        </>
      ),
    });
  }

  const submissions = new Map<string, AuditRow>();
  for (const r of rows) {
    if (r.action === 'kyc.submitted_for_review' && r.entityId) submissions.set(r.entityId, r);
  }
  const FAST_APPROVAL_MS = 5 * 60 * 1000;
  for (const r of rows) {
    if (r.action !== 'kyc.review.approved' || !r.entityId) continue;
    const sub = submissions.get(r.entityId);
    if (!sub) continue;
    const deltaMs = new Date(r.occurredAt).getTime() - new Date(sub.occurredAt).getTime();
    if (deltaMs < 0 || deltaMs >= FAST_APPROVAL_MS) continue;
    const seconds = Math.round(deltaMs / 1000);
    const human =
      seconds < 60
        ? `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`
        : `${Math.round(seconds / 60)} ${Math.round(seconds / 60) === 1 ? 'minute' : 'minutes'}`;
    out.push({
      sev: 'bad',
      text: (
        <>
          <strong>KYC approved {human} after it was submitted.</strong>{' '}
          {sub.actor?.email ? (
            <>
              The applicant used <span className="mono">{sub.actor.email}</span>, and{' '}
            </>
          ) : null}
          {r.actor?.fullName ?? 'Someone'} approved it at {istTime(r.occurredAt)} on{' '}
          {istShortDate(r.occurredAt)}.
        </>
      ),
      showId: r.id,
    });
  }

  return out;
}

const PAGE = 50;

export function AuditLogRoute(): React.JSX.Element {
  const { principal } = useAuth();
  // No control sets this any more — the exact-action dropdown is gone in
  // favour of the category pills below, which filter client-side (see the
  // file-top comment). The URL param still round-trips to the server if
  // someone lands on a link that set it, which is why it is read here.
  const [action] = useUrlState('action');
  const [entityType, setEntityType] = useUrlState('entityType');
  const [from, setFrom] = useUrlState('from');
  const [to, setTo] = useUrlState('to');
  const [page, setPage] = useUrlState('page', '1');
  const [who, setWho] = useUrlState('who');
  const [cat, setCat] = useUrlState('cat');
  const [q, setQ] = useUrlState('q');
  const [grouped, setGrouped] = useUrlState('group', '1');
  const [expandedGroups, setExpandedGroups] = React.useState<ReadonlySet<string>>(new Set());
  const [expandedDiffs, setExpandedDiffs] = React.useState<ReadonlySet<string>>(new Set());

  const pageNo = Math.max(1, Number(page) || 1);
  const params = new URLSearchParams({ limit: String(PAGE), offset: String((pageNo - 1) * PAGE) });
  if (action) params.set('action', action);
  if (entityType) params.set('entityType', entityType);
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  const { data, error } = useResource<AuditLog>(
    `/api/admin/audit-log?${params.toString()}`,
    'The audit log did not load',
  );

  if (error) {
    return (
      <EmptyState
        title="The audit log did not load"
        body={`${error}. Nothing has been changed — this screen only ever reads.`}
      />
    );
  }

  if (!data) {
    return (
      <div className="audit-board">
        <div className="al-head">
          <div>
            <div className="al-title-row">
              <h1 className="al-title">Audit log</h1>
            </div>
            <p className="al-sub">Loading the log.</p>
          </div>
        </div>
        <Skeleton lines={12} />
      </div>
    );
  }

  const { counts, coverage, facets } = data;
  const serverFiltered = action !== '' || entityType !== '' || from !== '' || to !== '';
  const lastPage = Math.max(1, Math.ceil(counts.matching / PAGE));

  const homeOrgByActor = new Map<string, string>();
  for (const r of data.rows) {
    if (r.actor && GROUPABLE.has(r.action) && r.actorOrgId) homeOrgByActor.set(r.actor.userId, r.actorOrgId);
  }

  const needle = q.trim().toLowerCase();
  const quickFiltered = data.rows
    .filter((r) =>
      who === 'staff'
        ? isStaff(r, principal?.orgId, homeOrgByActor)
        : who === 'ext'
          ? r.actor !== null && !isStaff(r, principal?.orgId, homeOrgByActor)
          : true,
    )
    .filter((r) => (cat ? categoryOf(r.action)?.key === cat : true))
    .filter((r) =>
      needle
        ? r.id.includes(needle) ||
          (r.actor?.fullName ?? '').toLowerCase().includes(needle) ||
          (r.actor?.email ?? '').toLowerCase().includes(needle) ||
          (r.entityId ?? '').toLowerCase().includes(needle)
        : true,
    );
  const quickActive = who !== '' || cat !== '' || needle !== '';

  const display = buildDisplayRows(quickFiltered, grouped === '1', expandedGroups);
  const patterns = computePatterns(data.rows);

  const columns: ReadonlyArray<Column<DisplayRow>> = [
    {
      key: 'when',
      header: 'Time',
      cell: (d) => {
        if (d.kind === 'group') {
          const first = d.members[0]!;
          const last = d.members[d.members.length - 1]!;
          return (
            <>
              <div className="al-time">
                {istTime(last.occurredAt)} – {istTime(first.occurredAt)}
              </div>
              <div className="al-id">
                #{[...d.members].map((m) => m.id).sort((a, b) => Number(a) - Number(b))[0]} – #
                {[...d.members].map((m) => m.id).sort((a, b) => Number(b) - Number(a))[0]}
              </div>
            </>
          );
        }
        return (
          <>
            <div className="al-time">{istTime(d.row.occurredAt)}</div>
            <div className="al-id">#{d.row.id}</div>
          </>
        );
      },
    },
    {
      key: 'event',
      header: 'Event',
      cell: (d) => {
        if (d.kind === 'group') {
          const first = d.members[0]!;
          const expanded = expandedGroups.has(d.key);
          const who2 = first.actor ? initials(first.actor.fullName ?? first.actor.email ?? '') : '?';
          return (
            <button
              type="button"
              className="al-group__btn"
              aria-expanded={expanded}
              onClick={() =>
                setExpandedGroups((prev) => {
                  const next = new Set(prev);
                  if (next.has(d.key)) next.delete(d.key);
                  else next.add(d.key);
                  return next;
                })
              }
            >
              <span className="chev" aria-hidden="true">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </span>
              <span className={`al-avatar al-avatar--${isStaff(first, principal?.orgId, homeOrgByActor) ? 'staff' : 'ext'}`}>
                {who2}
              </span>
              <span>
                <strong>{first.actor?.fullName ?? first.actor?.email ?? 'Someone'}</strong> {groupSummary(d.members)} ·{' '}
                {d.members.length} events
              </span>
            </button>
          );
        }
        const { row } = d;
        const c = categoryOf(row.action);
        return (
          <div className="al-ev">
            <span className="d" style={{ background: c?.dot ?? 'var(--admin-dot-raised)' }} />
            <div>
              <div className="al-ev__name">{eventName(row.action)}</div>
              <div className="al-ev__code">{row.action}</div>
            </div>
          </div>
        );
      },
    },
    {
      key: 'who',
      header: 'Who',
      cell: (d) =>
        d.kind === 'group' ? null : (
          <WhoCell row={d.row} myOrgId={principal?.orgId} homeOrgByActor={homeOrgByActor} />
        ),
    },
    {
      key: 'on',
      header: 'On',
      cell: (d) => {
        if (d.kind === 'group') return null;
        const { row } = d;
        if (row.entityType === null) return <span className="al-none">—</span>;
        return (
          <>
            <div className="al-obj__type">{row.entityType}</div>
            {row.entityId !== null && <div className="al-obj__id">{row.entityId.slice(0, 8)}…</div>}
          </>
        );
      },
    },
    {
      key: 'change',
      header: 'Change',
      cell: (d) => {
        if (d.kind === 'group') return null;
        const { row } = d;
        const has = row.before !== null || row.after !== null;
        if (!has) return <span className="al-none">—</span>;
        const expanded = expandedDiffs.has(row.id);
        const label = row.before !== null && row.after !== null ? 'Before & after' : row.after !== null ? 'After only' : 'Before only';
        return (
          <>
            <button
              type="button"
              className="al-change"
              aria-expanded={expanded}
              onClick={() =>
                setExpandedDiffs((prev) => {
                  const next = new Set(prev);
                  if (next.has(row.id)) next.delete(row.id);
                  else next.add(row.id);
                  return next;
                })
              }
            >
              {label}
            </button>
            {row.action === 'kyc.review.approved' && patterns.some((p) => p.showId === row.id) && (
              <span className="al-flag">Flagged above</span>
            )}
          </>
        );
      },
    },
    {
      key: 'ip',
      header: 'From IP',
      cell: (d) => {
        const row = d.kind === 'group' ? d.members[0]! : d.row;
        const allSameIp = new Set(data.rows.map((r) => r.ip).filter(Boolean)).size === 1;
        if (row.ip === null) return <span className="al-none">—</span>;
        return <span className={`al-ip ${allSameIp ? 'al-ip--flag' : ''}`}>{row.ip}</span>;
      },
    },
  ];

  const groupOf = (d: DisplayRow): string => istDayKey(d.kind === 'group' ? d.members[0]!.occurredAt : d.row.occurredAt);

  return (
    <div className="audit-board">
      <div className="al-head">
        <div>
          <div className="al-title-row">
            <h1 className="al-title">Audit log</h1>
            <span className="al-lock">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="5" y="11" width="14" height="10" rx="2" />
                <path d="M8 11V8a4 4 0 0 1 8 0v3" />
              </svg>
              Read-only · no one can edit or delete entries
            </span>
          </div>
          <p className="al-sub">
            <strong>
              {counts.total} {counts.total === 1 ? 'event' : 'events'}
            </strong>
            {coverage.oldestRow && coverage.newestRow && (
              <>
                {' '}
                from {istShortDate(coverage.oldestRow)} to {istShortDate(coverage.newestRow)}
              </>
            )}{' '}
            · every change to accounts, KYC, orders and settings
          </p>
        </div>
        <button type="button" className="al-btn" disabled title="Export isn't built yet. It must log itself first (§3C.7).">
          Export · coming later
        </button>
      </div>

      {patterns.length > 0 && (
        <section className="al-flags" aria-label="Patterns worth a look">
          <div className="al-flags__head">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v5" />
              <path d="M12 16.5v.01" />
            </svg>
            Patterns worth a look
            <span>Spotted in this page&rsquo;s {data.rows.length} entries</span>
          </div>
          <ul>
            {patterns.map((p, i) => (
              <li key={i}>
                <span className="sev" style={{ background: p.sev === 'bad' ? 'var(--admin-bad)' : 'var(--admin-warn)' }} />
                <span className="txt">{p.text}</span>
                {p.showId && (
                  <button type="button" className="al-btn al-btn--sm" onClick={() => setQ(`#${p.showId}`)}>
                    Show
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="al-filters">
        <div className="al-row">
          <label className="al-search">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            <input
              type="search"
              placeholder="Search this page: person, email or record ID"
              aria-label="Search the audit log"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <select className="al-select" aria-label="Who" value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">Anyone</option>
            <option value="staff">Staff only</option>
            <option value="ext">Vendors &amp; buyers only</option>
          </select>
          <select
            className="al-select"
            aria-label="Record type"
            value={entityType}
            onChange={(e) => {
              setEntityType(e.target.value);
              setPage('1');
            }}
          >
            <option value="">Any record</option>
            {facets.entityTypes.map((e) => (
              <option key={e.value} value={e.value}>
                {e.value} ({e.count})
              </option>
            ))}
          </select>
          <div className="al-range">
            <input
              type="date"
              aria-label="From"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage('1');
              }}
            />
            <span>–</span>
            <input
              type="date"
              aria-label="To"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPage('1');
              }}
            />
          </div>
        </div>
        <div className="al-row">
          <div className="al-cats" role="group" aria-label="Event type">
            <button type="button" className="al-cat" aria-pressed={cat === ''} onClick={() => setCat('')}>
              All events
            </button>
            {CATEGORIES.map((c) => (
              <button
                key={c.key}
                type="button"
                className="al-cat"
                aria-pressed={cat === c.key}
                onClick={() => setCat(cat === c.key ? '' : c.key)}
              >
                <span className="d" style={{ background: c.dot }} />
                {c.label}
              </button>
            ))}
          </div>
          <label className="al-toggle">
            <input
              type="checkbox"
              checked={grouped === '1'}
              onChange={(e) => setGrouped(e.target.checked ? '1' : '0')}
            />
            Group repeated sign-ins
          </label>
          <span className="al-tz">Times in IST</span>
        </div>
      </div>

      <p className="al-sub" style={{ marginTop: 0 }}>
        Showing <strong>{counts.returned}</strong> of <strong>{counts.matching}</strong> matching rows, out
        of <strong>{counts.total}</strong> in the whole log.
        {counts.excludedByFilter > 0 && <> The filters excluded <strong>{counts.excludedByFilter}</strong> rows.</>}
        {counts.beyondThisPage > 0 && <> <strong>{counts.beyondThisPage}</strong> more are beyond this page.</>}
        {quickActive && (
          <>
            {' '}
            Of this page, <strong>{quickFiltered.length}</strong> of <strong>{data.rows.length}</strong> match
            your quick filters.
          </>
        )}
      </p>

      {!coverage.rangeIsCovered && (
        <p className="al-sub" style={{ color: 'var(--admin-warn-ink)' }}>
          Part of the range you asked for is outside every partition this table has, so a zero here is not
          evidence that nothing happened.
        </p>
      )}

      <Board tableMinWidth={1200} className="al-card">
        <DataBoard
          className="al-table"
          caption={
            quickActive
              ? `${quickFiltered.length} of ${data.rows.length} rows on this page match your quick filters.`
              : 'Audit log entries, newest first.'
          }
          columns={columns}
          rows={display}
          rowKey={(d) => (d.kind === 'group' ? d.key : d.row.id)}
          rowClassName={(d) => (d.kind === 'group' ? 'al-group' : undefined)}
          group={{ of: groupOf, header: ({ key }) => key, className: 'al-day' }}
          detail={{
            open: (d) => d.kind === 'row' && expandedDiffs.has(d.row.id),
            render: (d) => (d.kind === 'row' ? <DiffBox row={d.row} /> : null),
            className: 'al-diff',
          }}
          empty={
            <EmptyState
              title={serverFiltered || quickActive ? 'No entry matches these filters' : 'The audit log is empty'}
              body={
                serverFiltered || quickActive
                  ? `${counts.total} entries exist; these filters matched none of them. Clear a filter to see the rest of the log.`
                  : 'No action has ever been recorded on this platform.'
              }
            />
          }
        />
        <div className="al-foot">
          <span>
            Showing events <strong>#{data.rows[data.rows.length - 1]?.id ?? '—'} – #{data.rows[0]?.id ?? '—'}</strong>{' '}
            · page {pageNo} of {lastPage} · newest first
          </span>
          {counts.matching > PAGE && (
            <nav className="al-pages" aria-label="Pages">
              <button type="button" disabled={pageNo <= 1} onClick={() => setPage(String(pageNo - 1))}>
                ‹ Newer
              </button>
              <span>
                Page {pageNo} of {lastPage}
              </span>
              <button type="button" disabled={pageNo >= lastPage} onClick={() => setPage(String(pageNo + 1))}>
                Older ›
              </button>
            </nav>
          )}
        </div>
      </Board>

      <section aria-labelledby="al-a-h">
        <h2 id="al-a-h" style={{ fontSize: 17, fontWeight: 600, marginBottom: 12 }}>
          About this log
        </h2>
        <div className="al-about">
          <div className="al-fact">
            <span className="al-fact__icon" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="5" y="11" width="14" height="10" rx="2" />
                <path d="M8 11V8a4 4 0 0 1 8 0v3" />
              </svg>
            </span>
            <h3>Can&rsquo;t be changed</h3>
            <p>No one can edit or delete an entry, including us. That&rsquo;s why there are no actions on this page.</p>
          </div>
          <div className="al-fact">
            <span className="al-fact__icon" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
                <path d="M4 4l16 16" />
              </svg>
            </span>
            <h3>Sensitive values masked</h3>
            <p>PAN, bank account numbers, tokens, OTPs and password hashes are masked before they&rsquo;re stored.</p>
          </div>
          <div className="al-fact">
            <span className="al-fact__icon" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="5" width="18" height="16" rx="2" />
                <path d="M3 10h18M8 3v4M16 3v4" />
              </svg>
            </span>
            <h3>
              {coverage.partitions} monthly partition{coverage.partitions === 1 ? '' : 's'}
            </h3>
            <p>
              {coverage.hasDefaultPartition ? 'Has a DEFAULT partition.' : 'No DEFAULT partition —'} a query outside{' '}
              {coverage.partitionedFrom?.slice(0, 10) ?? 'the covered range'} to{' '}
              {coverage.partitionedTo?.slice(0, 10) ?? 'the covered range'} would match nothing. Oldest entry:{' '}
              {coverage.oldestRow ? istShortDate(coverage.oldestRow) : 'none'}.
            </p>
          </div>
          <div className="al-fact">
            <span className="al-fact__icon" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 4v11" />
                <path d="M7 10l5 5 5-5" />
                <path d="M5 20h14" />
              </svg>
            </span>
            <h3>No export yet</h3>
            <p>An export must itself be written to this log (§3C.7). Until that&rsquo;s built, the button stays off.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
