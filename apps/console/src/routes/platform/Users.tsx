import * as React from 'react';
import { createPortal } from 'react-dom';
import {
  Button,
  cn,
  DataBoard,
  EmptyState,
  Input,
  Modal,
  Skeleton,
  type Column,
} from '@trugrade/ui';
import { Board } from '../../lib/controls';
import { useAuth } from '../../lib/auth';
import { roleLabel } from '../../lib/roles';
import { daysSince } from '../../lib/clock';
import {
  MOBILE_PREFIX,
  addUserFormValid,
  mobileSubscriberDigits,
  toE164Mobile,
  typeMobile,
  validateAddUserForm,
} from '../../lib/indian-contact';
import { Field } from '../../lib/controls';
import { useUrlState } from '../../lib/urlState';
import {
  createMember,
  getTeam,
  resetMemberMfa,
  setMemberPassword,
  updateMember,
  type Team,
  type TeamMember,
  type TeamRole,
} from './usersApi';
import {
  memberPermissions,
  permissionCatalog,
  permissionsByModule,
} from './team-permissions';

/**
 * ARCHETYPE B — Board. Platform staff in the signed-in organisation.
 * DENSITY: compact (admin), set on the app root by the shell.
 *
 * DRAWN TO A SUPPLIED DESIGN, its markup and colours verbatim
 * (`.people-board`/`.pp-*` in `index.css`, `--admin-*` in `globals.css`) —
 * same arrangement as the catalog, orders and review-queue boards. `DataBoard`
 * stays the table, inside `Board` (`.pp-card`/`.pp-table`); the row kebab menu
 * keeps the existing `RowActionsMenu` below unchanged.
 *
 * Two things in the mock have no field behind them on `TeamMember`/
 * `TeamRole`, so each gets an honest substitute rather than an invented one:
 *
 * - **No "system account" flag exists.** The mock's example data (a seed
 *   account with an `@…internal` address) happens to look like one, but
 *   nothing in the API says so, and guessing from the email domain would be
 *   exactly the kind of invented fact `CLAUDE.md` rules out. The badge and
 *   its dedicated avatar shape are dropped; that row renders like any other.
 * - **No bulk "require MFA for everyone" action exists.** Every
 *   money-moving or KYC role already forces a second factor at sign-in
 *   (`MFA_REQUIRED_ROLES` on the server) — what the banner below reports is
 *   that nobody in those roles has actually enrolled one yet. There is no
 *   endpoint that flips a switch for the whole org, so the mock's danger
 *   button is not reproduced; the banner states the fact and nothing else,
 *   the same "nearest honest destination" call `CatalogTree.tsx` already
 *   documents for its own two unreachable mock controls.
 *
 * Two things in the mock that DO have a field, computed rather than copied
 * from its one example org:
 *
 * - **Which empty roles get the red "nobody yet" treatment** is a judgement
 *   call, not something a permission diff can produce — the superadmin role
 *   already holds every permission in the system by definition, so "is this
 *   capability covered by someone" is true for every role and would flag
 *   nothing. `MONEY_CRITICAL_ROLES` below names the same two roles the mock
 *   does, as an explicit, commented product decision rather than a derived one.
 * - **The "includes the only X" line** under a stat tile IS derived — a
 *   member counts as a single point of failure when a role they hold has
 *   exactly one holder. `singlePointNote` below is the same rule applied to
 *   both qualifying tiles; the mock used it for one and a different
 *   (unreproducible) fact for the other.
 */

/** Below this, "last signed in" stops being routine and starts being a gap. */
const STALE_DAYS = 14;

/** The roles this product cannot route around if nobody holds them — see the
 * file-top comment for why this can't be derived from a permission diff. */
const MONEY_CRITICAL_ROLES = new Set(['TREASURY', 'AP_CLERK']);

type Phase =
  | { k: 'loading' }
  | { k: 'error'; message: string }
  | { k: 'ready'; team: Team };

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

function PersonCell({ member }: { member: TeamMember }): React.JSX.Element {
  return (
    <div className="pp-person">
      <span className="pp-avatar" aria-hidden="true">
        {initials(member.fullName)}
      </span>
      <div>
        <div className="pp-name">
          {member.fullName}
          {member.isYou && <span className="pp-you">You</span>}
        </div>
        <div className="pp-email">
          {member.email ?? member.mobile ?? 'No contact recorded'}
        </div>
        {member.jobTitle !== null && <div className="pp-email">{member.jobTitle}</div>}
      </div>
    </div>
  );
}

function RolesCell({ member }: { member: TeamMember }): React.JSX.Element {
  if (member.roles.length === 0) {
    return <span className="pp-rolechip" style={{ color: 'var(--admin-faint)' }}>No role assigned</span>;
  }
  return (
    <div className="pp-rolechips">
      {member.roles.map((r) => (
        <span key={r} className="pp-rolechip" title={r}>
          {roleLabel(r)}
        </span>
      ))}
    </div>
  );
}

function accountStatusLabel(status: string): string {
  if (status === 'ACTIVE') return 'Active';
  if (status === 'SUSPENDED') return 'Inactive';
  if (status === 'DEACTIVATED') return 'Removed';
  return status;
}

function AccountCell({ member }: { member: TeamMember }): React.JSX.Element {
  const variant = member.status === 'ACTIVE' ? 'ok' : member.status === 'DEACTIVATED' ? 'bad' : 'off';
  return <span className={cn('pp-pill', `pp-pill--${variant}`)}>{accountStatusLabel(member.status)}</span>;
}

/** "27 days ago" read the way a person says it, not a day-count. */
function relativeSeen(days: number): string {
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}

function SeenCell({ member }: { member: TeamMember }): React.JSX.Element {
  if (member.lastLoginAt === null) {
    return (
      <div className="pp-seen pp-seen--never">
        <div className="pp-seen__rel">Never signed in</div>
      </div>
    );
  }
  const days = daysSince(member.lastLoginAt);
  const stale = days >= STALE_DAYS;
  return (
    <div className={cn('pp-seen', stale && 'pp-seen--stale')}>
      <div className="pp-seen__rel">{relativeSeen(days)}</div>
      <div className="pp-seen__abs">
        {new Date(member.lastLoginAt).toLocaleString('en-IN', {
          day: 'numeric',
          month: 'short',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        })}
      </div>
    </div>
  );
}

function TwoFaCell({ member }: { member: TeamMember }): React.JSX.Element {
  if (member.mfaEnabled) {
    return (
      <span className="pp-2fa pp-2fa--on">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
          <path d="M5 13l4 4L19 7" />
        </svg>
        On
      </span>
    );
  }
  return (
    <span className="pp-2fa">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
      Off
    </span>
  );
}

/** A role code this member holds that no other active account also holds —
 * losing them would leave that role empty. `undefined` when none of their
 * roles are that scarce. */
function singlePointRole(member: TeamMember, roleCounts: ReadonlyMap<string, number>): string | undefined {
  return member.roles.find((r) => roleCounts.get(r) === 1);
}

/** "Includes the only KYC reviewer" — or the plural shape when more than one
 * qualifies, or nothing when none of this subset is a sole role-holder. */
function singlePointNote(
  members: readonly TeamMember[],
  roleCounts: ReadonlyMap<string, number>,
): string | undefined {
  const codes = new Set(
    members.flatMap((m) => {
      const r = singlePointRole(m, roleCounts);
      return r ? [r] : [];
    }),
  );
  if (codes.size === 0) return undefined;
  if (codes.size === 1) return `Includes the only ${roleLabel([...codes][0]!)}`;
  return `Includes the only holder of ${codes.size} roles`;
}

export function UsersRoute(): React.JSX.Element {
  const { principal } = useAuth();
  const [role, setRole] = useUrlState('role');
  const [status, setStatus] = useUrlState('status');
  const [quick, setQuick] = useUrlState('quick');
  const [q, setQ] = useUrlState('q');
  const [phase, setPhase] = React.useState<Phase>({ k: 'loading' });
  const [addOpen, setAddOpen] = React.useState(false);
  const [editingRoles, setEditingRoles] = React.useState<TeamMember | null>(null);
  const [editingPermissions, setEditingPermissions] = React.useState<TeamMember | null>(null);
  const [passwordFor, setPasswordFor] = React.useState<TeamMember | null>(null);

  const canWrite = principal?.permissions.includes('identity.user.write') ?? false;
  const canAssign = principal?.permissions.includes('identity.role.assign') ?? false;

  const load = React.useCallback(async (): Promise<void> => {
    setPhase({ k: 'loading' });
    const result = await getTeam();
    if (result.ok) setPhase({ k: 'ready', team: result.data });
    else setPhase({ k: 'error', message: result.message });
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (phase.k === 'error') {
    return (
      <EmptyState
        title="The team list did not load"
        body={`${phase.message}. Nobody's access has changed — reload to try again.`}
      />
    );
  }

  if (phase.k === 'loading') {
    return (
      <div className="people-board">
        <div className="pp-head">
          <div>
            <h1 className="pp-title">People</h1>
            <p className="pp-sub">Loading the team.</p>
          </div>
        </div>
        <Skeleton lines={10} />
      </div>
    );
  }

  const { team } = phase;
  const members = team.members;
  const total = members.length;
  const activeMembers = members.filter((m) => m.status === 'ACTIVE');
  const inactiveCount = members.filter((m) => m.status === 'SUSPENDED').length;
  const mfaOnCount = members.filter((m) => m.mfaEnabled).length;
  const neverSignedIn = activeMembers.filter((m) => m.lastLoginAt === null);
  const stale = activeMembers.filter(
    (m) => m.lastLoginAt !== null && daysSince(m.lastLoginAt) >= STALE_DAYS,
  );
  const highStakesNoMfa = members.filter((m) => m.mfaRequired && !m.mfaEnabled);
  const ownerNoMfa = members.some((m) => m.isOrgOwner && !m.mfaEnabled);

  const roleCounts = new Map<string, number>(
    team.roles.map((r) => [r.code, members.filter((m) => m.roles.includes(r.code)).length]),
  );
  const filledRoles = team.roles.filter((r) => (roleCounts.get(r.code) ?? 0) > 0);
  const emptyRoles = team.roles.filter((r) => (roleCounts.get(r.code) ?? 0) === 0);

  const needle = q.trim().toLowerCase();
  const quickFilter = (m: TeamMember): boolean => {
    if (quick === 'active') return m.status === 'ACTIVE';
    if (quick === 'mfa-off') return !m.mfaEnabled;
    if (quick === 'never') return m.status === 'ACTIVE' && m.lastLoginAt === null;
    if (quick === 'stale') return m.status === 'ACTIVE' && m.lastLoginAt !== null && daysSince(m.lastLoginAt) >= STALE_DAYS;
    return true;
  };
  const filtered = members
    .filter((m) => (!role || m.roles.includes(role)) && (!status || m.status === status))
    .filter(quickFilter)
    .filter((m) => (needle ? m.fullName.toLowerCase().includes(needle) || (m.email ?? '').toLowerCase().includes(needle) : true))
    .slice()
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
  const hasFilter = role !== '' || status !== '' || quick !== '' || needle !== '';

  const columns: ReadonlyArray<Column<TeamMember>> = [
    { key: 'person', header: 'Person', cell: (m) => <PersonCell member={m} /> },
    { key: 'roles', header: 'Role', cell: (m) => <RolesCell member={m} /> },
    { key: 'account', header: 'Account', cell: (m) => <AccountCell member={m} /> },
    { key: 'seen', header: 'Last signed in', cell: (m) => <SeenCell member={m} /> },
    { key: 'mfa', header: 'Two-step sign-in', cell: (m) => <TwoFaCell member={m} /> },
    ...(canWrite || canAssign
      ? [
          {
            key: 'actions',
            header: '',
            headerHidden: true,
            className: 'num',
            cell: (m: TeamMember) => (
              <RowActions
                member={m}
                canWrite={canWrite}
                canAssign={canAssign}
                onEditRoles={() => setEditingRoles(m)}
                onEditPermissions={() => setEditingPermissions(m)}
                onChangePassword={() => setPasswordFor(m)}
                onChanged={() => void load()}
              />
            ),
          } as Column<TeamMember>,
        ]
      : []),
  ];

  return (
    <div className="people-board">
      <div className="pp-head">
        <div>
          <h1 className="pp-title">People</h1>
          <p className="pp-sub">
            {total} {total === 1 ? 'account' : 'accounts'} · {activeMembers.length} active · who can
            sign in to the console, and what they can do
          </p>
        </div>
        {canWrite && (
          <button type="button" className="pp-btn pp-btn--primary" onClick={() => setAddOpen(true)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add user
          </button>
        )}
      </div>

      {highStakesNoMfa.length > 0 && (
        <div className="pp-alert" role="alert">
          <span className="pp-alert__icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
              <path d="M12 9v4M12 16.5v.01" />
            </svg>
          </span>
          <p className="pp-alert__txt">
            {mfaOnCount === 0 ? (
              <>
                <strong>No one has two-step sign-in{ownerNoMfa ? ', including the super admin' : ''}.</strong>{' '}
                One leaked password is enough to approve KYC, change prices or move money.
              </>
            ) : (
              <>
                <strong>
                  {highStakesNoMfa.length} {plural(highStakesNoMfa.length, 'account', 'accounts')} that can
                  move money or approve KYC {plural(highStakesNoMfa.length, 'has', 'have')} no two-step
                  sign-in.
                </strong>{' '}
                Each one is a single leaked password away from the same risk.
              </>
            )}
          </p>
        </div>
      )}

      <div className="pp-stats" role="group" aria-label="Quick filters">
        <button
          type="button"
          className="pp-stat"
          aria-pressed={quick === 'active'}
          onClick={() => setQuick(quick === 'active' ? '' : 'active')}
        >
          <span className="pp-stat__label">Active accounts</span>
          <span className="pp-stat__n">
            {activeMembers.length}
            <small>of {total}</small>
          </span>
          {inactiveCount > 0 && <span className="pp-stat__meta">{inactiveCount} inactive</span>}
        </button>
        <button
          type="button"
          className={cn('pp-stat', mfaOnCount === 0 && 'pp-stat--bad')}
          aria-pressed={quick === 'mfa-off'}
          onClick={() => setQuick(quick === 'mfa-off' ? '' : 'mfa-off')}
        >
          <span className="pp-stat__label">Two-step sign-in on</span>
          <span className="pp-stat__n">
            {mfaOnCount}
            <small>of {total}</small>
          </span>
          <span className="pp-stat__meta">
            {mfaOnCount === 0 ? 'Nobody is protected' : `${total - mfaOnCount} without it`}
          </span>
        </button>
        <button
          type="button"
          className={cn('pp-stat', neverSignedIn.length > 0 && 'pp-stat--warn')}
          aria-pressed={quick === 'never'}
          onClick={() => setQuick(quick === 'never' ? '' : 'never')}
        >
          <span className="pp-stat__label">Active, never signed in</span>
          <span className="pp-stat__n">{neverSignedIn.length}</span>
          {singlePointNote(neverSignedIn, roleCounts) && (
            <span className="pp-stat__meta">{singlePointNote(neverSignedIn, roleCounts)}</span>
          )}
        </button>
        <button
          type="button"
          className={cn('pp-stat', stale.length > 0 && 'pp-stat--warn')}
          aria-pressed={quick === 'stale'}
          onClick={() => setQuick(quick === 'stale' ? '' : 'stale')}
        >
          <span className="pp-stat__label">Not seen in {STALE_DAYS}+ days</span>
          <span className="pp-stat__n">{stale.length}</span>
          {singlePointNote(stale, roleCounts) && (
            <span className="pp-stat__meta">{singlePointNote(stale, roleCounts)}</span>
          )}
        </button>
      </div>

      <section className="pp-roles" aria-labelledby="pp-r-h">
        <div className="pp-roles__head">
          <h2 id="pp-r-h">Roles</h2>
          <p>
            Click a role to filter the list. {emptyRoles.length}{' '}
            {plural(emptyRoles.length, 'role has', 'roles have')} nobody in{' '}
            {emptyRoles.length === 1 ? 'it' : 'them'}.
          </p>
        </div>
        {filledRoles.length > 0 && (
          <div className="pp-roles__group">
            <span className="pp-roles__label">Filled</span>
            <div className="pp-roles__chips">
              {filledRoles.map((r) => (
                <button
                  key={r.code}
                  type="button"
                  className="pp-role"
                  aria-pressed={role === r.code}
                  onClick={() => setRole(role === r.code ? '' : r.code)}
                >
                  {roleLabel(r.code)} <span className="n">{roleCounts.get(r.code)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {emptyRoles.length > 0 && (
          <div className="pp-roles__group">
            <span className="pp-roles__label">Nobody yet</span>
            <div className="pp-roles__chips">
              {emptyRoles.map((r) => {
                const crit = MONEY_CRITICAL_ROLES.has(r.code);
                return (
                  <button
                    key={r.code}
                    type="button"
                    className={cn('pp-role', crit ? 'pp-role--crit' : 'pp-role--empty')}
                    aria-pressed={role === r.code}
                    title={crit ? 'No one is assigned this role, and it is one of this team’s money-moving roles.' : undefined}
                    onClick={() => setRole(role === r.code ? '' : r.code)}
                  >
                    {roleLabel(r.code)} <span className="n">0</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <div className="pp-toolbar">
        <label className="pp-search">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            type="search"
            placeholder="Search name or email"
            aria-label="Search people"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <label className="pp-select">
          Role
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">Every role</option>
            {team.roles.map((r) => (
              <option key={r.code} value={r.code}>
                {roleLabel(r.code)}
              </option>
            ))}
          </select>
        </label>
        <label className="pp-select">
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any</option>
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Inactive</option>
            <option value="DEACTIVATED">Removed</option>
          </select>
        </label>
      </div>

      <Board className="pp-card">
        <DataBoard
          className="pp-table"
          caption={`${filtered.length} of ${total} people, sorted A to Z.`}
          columns={columns}
          rows={filtered}
          rowKey={(m) => m.id}
          rowClassName={(m) => cn(m.status !== 'ACTIVE' && 'is-muted')}
          empty={
            <EmptyState
              title={hasFilter ? 'Nobody matches these filters' : 'No users yet'}
              body={
                hasFilter
                  ? 'Clear a filter to see the rest of your organisation.'
                  : 'Add the first person who should be able to sign in on this account.'
              }
            />
          }
        />
        {filtered.length > 0 && (
          <div className="pp-foot">
            Showing <strong>{filtered.length}</strong> of <strong>{total}</strong> people · A–Z
          </div>
        )}
      </Board>

      {canWrite && addOpen && (
        <AddUserModal
          roles={team.roles}
          onClose={() => setAddOpen(false)}
          onSaved={async () => {
            setAddOpen(false);
            await load();
          }}
        />
      )}

      {canAssign && editingRoles !== null && (
        <RoleEditorModal
          member={editingRoles}
          roles={team.roles}
          onClose={() => setEditingRoles(null)}
          onSaved={async () => {
            setEditingRoles(null);
            await load();
          }}
        />
      )}

      {canAssign && editingPermissions !== null && (
        <PermissionEditorModal
          member={editingPermissions}
          roles={team.roles}
          heldPermissions={principal?.permissions ?? []}
          onClose={() => setEditingPermissions(null)}
          onSaved={async () => {
            setEditingPermissions(null);
            await load();
          }}
        />
      )}

      {canWrite && passwordFor !== null && (
        <PasswordModal
          member={passwordFor}
          onClose={() => setPasswordFor(null)}
          onSaved={() => {
            setPasswordFor(null);
          }}
        />
      )}
    </div>
  );
}

interface RowMenuItem {
  label: string;
  destructive?: boolean;
  onSelect: () => void | Promise<void>;
}

function RowActionsMenu({
  label,
  items,
  busy,
}: {
  label: string;
  items: readonly RowMenuItem[];
  busy: boolean;
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [anchor, setAnchor] = React.useState<{ top: number; right: number } | null>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  const placeMenu = React.useCallback((): void => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    setAnchor({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
  }, []);

  React.useEffect(() => {
    if (!open) return;
    placeMenu();
    const onPointer = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onLayout = (): void => {
      placeMenu();
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onLayout);
    window.addEventListener('scroll', onLayout, true);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onLayout);
      window.removeEventListener('scroll', onLayout, true);
    };
  }, [open, placeMenu]);

  if (items.length === 0) {
    return <span className="text-body-sm text-ink-4">No actions</span>;
  }

  const menu =
    open && anchor !== null
      ? createPortal(
          <div
            ref={menuRef}
            className="row-actions-pop-fixed"
            role="menu"
            aria-label={`Actions for ${label}`}
            style={{ top: anchor.top, right: anchor.right }}
          >
            <div className="row-actions-panel">
              {items.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  className={item.destructive ? 'row-actions-item destructive' : 'row-actions-item'}
                  disabled={busy}
                  onClick={() => {
                    setOpen(false);
                    void item.onSelect();
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="row-actions-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="row-actions-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${label}`}
        disabled={busy}
        onClick={() => {
          setOpen((v) => {
            const next = !v;
            if (next) placeMenu();
            return next;
          });
        }}
      >
        <span aria-hidden="true">···</span>
      </button>
      {menu}
    </div>
  );
}

function RowActions({
  member,
  canWrite,
  canAssign,
  onEditRoles,
  onEditPermissions,
  onChangePassword,
  onChanged,
}: {
  member: TeamMember;
  canWrite: boolean;
  canAssign: boolean;
  onEditRoles: () => void;
  onEditPermissions: () => void;
  onChangePassword: () => void;
  onChanged: () => void;
}): React.JSX.Element {
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  if (member.lockedReason !== null && !member.isYou) {
    return <span className="text-body-sm text-ink-3">{member.lockedReason}</span>;
  }

  if (member.status === 'DEACTIVATED') {
    return (
      <span className="text-body-sm text-ink-4">
        Removed permanently. Historical records still name this person.
      </span>
    );
  }

  const act = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setFailure(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const items: RowMenuItem[] = [];

  if (canAssign) {
    items.push({ label: 'Change roles', onSelect: onEditRoles });
    items.push({ label: 'Change permissions', onSelect: onEditPermissions });
    if (member.status === 'ACTIVE') {
      items.push({
        label: 'Make inactive',
        onSelect: () =>
          act(async () => {
            const result = await updateMember(member.id, { status: 'SUSPENDED' });
            if (!result.ok) throw new Error(result.message);
          }),
      });
    } else {
      items.push({
        label: 'Reactivate',
        onSelect: () =>
          act(async () => {
            const result = await updateMember(member.id, { status: 'ACTIVE' });
            if (!result.ok) throw new Error(result.message);
          }),
      });
    }
    items.push({
      label: 'Remove permanently',
      destructive: true,
      onSelect: () => {
        if (
          !window.confirm(
            `Remove ${member.fullName} permanently? They cannot sign in again, but orders and audit records that name them are kept.`,
          )
        ) {
          return;
        }
        void act(async () => {
          const result = await updateMember(member.id, { status: 'DEACTIVATED' });
          if (!result.ok) throw new Error(result.message);
        });
      },
    });
  }

  if (canWrite && member.status === 'ACTIVE') {
    items.push({ label: 'Change password', onSelect: onChangePassword });
    items.push({
      label: 'Reset MFA',
      onSelect: () => {
        if (
          !window.confirm(
            `Reset second factor for ${member.fullName}? Every session they hold will end and they must verify again on next sign-in.`,
          )
        ) {
          return;
        }
        void act(async () => {
          const result = await resetMemberMfa(member.id);
          if (!result.ok) throw new Error(result.message);
        });
      },
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <RowActionsMenu label={member.fullName} items={items} busy={busy} />
      {failure !== null && (
        <span className="max-w-[220px] text-body-sm text-fail" role="alert">
          {failure}
        </span>
      )}
    </div>
  );
}

function AddUserModal({
  roles,
  onClose,
  onSaved,
}: {
  roles: readonly TeamRole[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}): React.JSX.Element {
  const [fullName, setFullName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [mobile, setMobile] = React.useState(MOBILE_PREFIX);
  const [jobTitle, setJobTitle] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [picked, setPicked] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [dirty, setDirty] = React.useState<Record<string, boolean>>({});
  const [submitAttempted, setSubmitAttempted] = React.useState(false);

  const formInput = React.useMemo(
    () => ({ fullName, email, mobile, jobTitle, password, roles: picked }),
    [fullName, email, mobile, jobTitle, password, picked],
  );

  const markDirty = (key: string): void => {
    setDirty((d) => (d[key] ? d : { ...d, [key]: true }));
  };

  React.useEffect(() => {
    if (!submitAttempted && !Object.values(dirty).some(Boolean)) return;
    setFieldErrors(validateAddUserForm(formInput));
  }, [formInput, dirty, submitAttempted]);

  const submitDisabledReason = React.useMemo((): string | undefined => {
    const errors = validateAddUserForm(formInput);
    if (errors.roles) return errors.roles;
    if (errors.fullName) return errors.fullName;
    if (errors.email) return errors.email;
    if (errors.mobile) return errors.mobile;
    if (errors.jobTitle) return errors.jobTitle;
    if (errors.password) return errors.password;
    return undefined;
  }, [formInput]);

  const save = async (): Promise<void> => {
    setSubmitAttempted(true);
    setDirty((d) => ({ ...d, roles: true }));
    const errors = validateAddUserForm(formInput);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setBusy(true);
    setFailure(null);
    const result = await createMember({
      fullName: fullName.trim(),
      email: email.trim(),
      mobile: toE164Mobile(mobile),
      jobTitle: jobTitle.trim(),
      roles: picked,
      password,
    });
    setBusy(false);
    if (result.ok) await onSaved();
    else {
      setFailure(result.message);
      if (Object.keys(result.fields).length > 0) setFieldErrors(result.fields);
    }
  };

  const show = (key: string): string | undefined =>
    dirty[key] || submitAttempted ? fieldErrors[key] : undefined;

  const canSubmit = addUserFormValid(formInput);

  return (
    <Modal
      open
      onClose={onClose}
      title="Add user"
      description="Work email, mobile, password and at least one role are all required."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            {...(!canSubmit ? { disabledReason: submitDisabledReason ?? 'Fix the fields marked below first.' } : {})}
            onClick={() => void save()}
          >
            Add this person
          </Button>
        </>
      }
    >
      {failure !== null && (
        <p className="mb-4 text-body-sm text-fail" role="alert">
          {failure}
        </p>
      )}
      <div className="flex flex-col gap-4">
        <Input
          label="Full name"
          value={fullName}
          error={show('fullName')}
          onChange={(e) => {
            markDirty('fullName');
            setFullName(e.target.value);
          }}
          required
        />
        <Input
          label="Work email"
          type="email"
          value={email}
          error={show('email')}
          onChange={(e) => {
            markDirty('email');
            setEmail(e.target.value);
          }}
          required
        />
        <Field label="Mobile" htmlFor="add-user-mobile" error={show('mobile')} hint="10 digits after +91. The country code cannot be removed.">
          <div
            className={cn(
              'flex overflow-hidden rounded border bg-sheet focus-within:border-ink-3',
              show('mobile') ? 'border-fail' : 'border-rule',
            )}
          >
            <span className="flex shrink-0 items-center border-r border-rule bg-sheet-2 px-3 font-mono text-body-sm text-ink-2">
              +91
            </span>
            <input
              id="add-user-mobile"
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              className="min-w-0 flex-1 bg-transparent px-4 py-3 font-mono text-body-sm text-ink outline-none"
              value={mobileSubscriberDigits(mobile)}
              onChange={(e) => {
                markDirty('mobile');
                setMobile(typeMobile(`${MOBILE_PREFIX}${e.target.value}`));
              }}
              aria-invalid={show('mobile') !== undefined}
            />
          </div>
        </Field>
        <Input
          label="Job title"
          value={jobTitle}
          error={show('jobTitle')}
          onChange={(e) => {
            markDirty('jobTitle');
            setJobTitle(e.target.value);
          }}
          required
        />
        <Input
          label="Initial password"
          type="password"
          value={password}
          error={show('password')}
          onChange={(e) => {
            markDirty('password');
            setPassword(e.target.value);
          }}
          required
          hint="At least 12 characters with upper, lower, digit and symbol."
        />
        <Field
          label="Roles"
          htmlFor="add-user-roles"
          required
          error={show('roles')}
          hint="Pick at least one role. Somebody with none can sign in and see nothing."
        >
          <fieldset
            id="add-user-roles"
            className={cn(
              'flex flex-col gap-2 rounded border p-3',
              show('roles') ? 'border-fail' : 'border-rule',
            )}
          >
            {roles.map((r) => {
              const on = picked.includes(r.code);
              return (
                <label key={r.code} className={`flex gap-2 text-body-sm ${r.assignable ? '' : 'opacity-50'}`}>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!r.assignable}
                    onChange={() => {
                      markDirty('roles');
                      setPicked(on ? picked.filter((c) => c !== r.code) : [...picked, r.code]);
                    }}
                  />
                  {roleLabel(r.code)}
                </label>
              );
            })}
          </fieldset>
        </Field>
      </div>
    </Modal>
  );
}

function PermissionEditorModal({
  member,
  roles,
  heldPermissions,
  onClose,
  onSaved,
}: {
  member: TeamMember;
  roles: readonly TeamRole[];
  heldPermissions: readonly string[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}): React.JSX.Element {
  const catalog = React.useMemo(() => permissionCatalog(roles), [roles]);
  const groups = React.useMemo(() => permissionsByModule(catalog), [catalog]);
  const held = React.useMemo(() => new Set(heldPermissions), [heldPermissions]);
  const [picked, setPicked] = React.useState<string[]>(() => memberPermissions(member, roles));
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  const none = picked.length === 0;

  const save = async (): Promise<void> => {
    if (none) return;
    setBusy(true);
    setFailure(null);
    const result = await updateMember(member.id, { permissions: picked });
    setBusy(false);
    if (result.ok) await onSaved();
    else setFailure(result.fields.permissions ?? result.message);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Permissions for ${member.fullName}`}
      description="Roles are fixed bundles. Pick the permissions this person should hold — we map them to the smallest matching role set on save."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            {...(none ? { disabledReason: 'Pick at least one permission.' } : {})}
            onClick={() => void save()}
          >
            Save permissions
          </Button>
        </>
      }
    >
      {failure !== null && (
        <p className="mb-4 text-body-sm text-fail" role="alert">
          {failure}
        </p>
      )}
      <p className="mb-4 font-mono text-body-sm tnum text-ink-3">
        {picked.length} of {catalog.length} permissions selected
      </p>
      <div className="flex max-h-[min(420px,60vh)] flex-col gap-4 overflow-y-auto pr-1">
        {groups.map((group) => (
          <section key={group.module} className="flex flex-col gap-2">
            <h3 className="text-body-sm font-medium text-ink-2">{group.label}</h3>
            <ul className="flex flex-col gap-2">
              {group.permissions.map((option) => {
                const on = picked.includes(option.code);
                const canGrant = held.has(option.code);
                const disabled = !on && !canGrant;
                return (
                  <li key={option.code}>
                    <label
                      className={cn(
                        'flex flex-col gap-1 rounded border px-3 py-2',
                        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                        on ? 'border-acc/40 bg-sheet-2' : 'border-rule',
                      )}
                    >
                      <span className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={on}
                          disabled={disabled}
                          onChange={() =>
                            setPicked((current) =>
                              on
                                ? current.filter((c) => c !== option.code)
                                : [...current, option.code].sort(),
                            )
                          }
                        />
                        <span className="font-mono text-body-sm text-ink">{option.code}</span>
                      </span>
                      {disabled && (
                        <span className="text-body-sm text-ink-4">
                          You do not hold this permission, so you cannot grant it.
                        </span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}

function RoleEditorModal({
  member,
  roles,
  onClose,
  onSaved,
}: {
  member: TeamMember;
  roles: readonly TeamRole[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}): React.JSX.Element {
  const [picked, setPicked] = React.useState<string[]>(member.roles);
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  const save = async (): Promise<void> => {
    if (picked.length === 0) return;
    setBusy(true);
    setFailure(null);
    const result = await updateMember(member.id, { roles: picked });
    setBusy(false);
    if (result.ok) await onSaved();
    else setFailure(result.message);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Roles for ${member.fullName}`}
      description="Takes effect on their next request."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            {...(picked.length === 0 ? { disabledReason: 'Pick at least one role.' } : {})}
            onClick={() => void save()}
          >
            Save roles
          </Button>
        </>
      }
    >
      {failure !== null && (
        <p className="mb-4 text-body-sm text-fail" role="alert">
          {failure}
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {roles.map((r) => {
          const on = picked.includes(r.code);
          return (
            <li key={r.code}>
              <label className={`flex flex-col gap-1 ${r.assignable ? '' : 'opacity-50'}`}>
                <span className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!r.assignable}
                    onChange={() =>
                      setPicked((p) => (on ? p.filter((c) => c !== r.code) : [...p, r.code]))
                    }
                  />
                  <span className="text-body-sm text-ink">{roleLabel(r.code)}</span>
                </span>
                {!r.assignable && (
                  <span className="text-body-sm text-ink-4">
                    You cannot grant this — it exceeds your own permissions.
                  </span>
                )}
              </label>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}

function PasswordModal({
  member,
  onClose,
  onSaved,
}: {
  member: TeamMember;
  onClose: () => void;
  onSaved: () => void;
}): React.JSX.Element {
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  const mismatch = confirm.length > 0 && password !== confirm;
  const canSave = password.length >= 12 && password === confirm;

  const save = async (): Promise<void> => {
    if (!canSave) return;
    setBusy(true);
    setFailure(null);
    const result = await setMemberPassword(member.id, password);
    setBusy(false);
    if (result.ok) onSaved();
    else setFailure(result.message);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Password for ${member.fullName}`}
      description="Every session they hold will end when you save this."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            {...(!canSave ? { disabledReason: mismatch ? 'Passwords do not match.' : 'Enter a valid password.' } : {})}
            onClick={() => void save()}
          >
            Set password
          </Button>
        </>
      }
    >
      {failure !== null && (
        <p className="mb-4 text-body-sm text-fail" role="alert">
          {failure}
        </p>
      )}
      <div className="flex flex-col gap-4">
        <Input
          label="New password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <Input
          label="Confirm password"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={mismatch ? 'Passwords do not match.' : undefined}
          required
        />
      </div>
    </Modal>
  );
}
