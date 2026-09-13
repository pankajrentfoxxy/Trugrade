import * as React from 'react';
import {
  Button,
  ClauseHeading,
  EmptyState,
  LedgerSection,
  PermissionGrid,
  RegisterStrip,
  Skeleton,
  type PermissionMark,
} from '@trugrade/ui';
import { useResource } from '../../lib/useResource';

/**
 * ARCHETYPE B — Board. Team register and role matrix.
 * Roles map to existing constants: VENDOR_OWNER, VENDOR_ADMIN (Operations),
 * VENDOR_FINANCE, VENDOR_VIEWER (Warehouse). VENDOR_OPS is shown as Operations.
 */

interface TeamMemberView {
  id: string;
  fullName: string;
  email: string | null;
  status: string;
  isOrgOwner: boolean;
  roles: string[];
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  isYou: boolean;
  lockedReason: string | null;
}

interface TeamView {
  members: TeamMemberView[];
  owners: number;
}

const ROLE_LABEL: Record<string, string> = {
  VENDOR_OWNER: 'Owner',
  VENDOR_ADMIN: 'Operations',
  VENDOR_OPS: 'Operations',
  VENDOR_FINANCE: 'Finance',
  VENDOR_VIEWER: 'Warehouse',
};

const GRID_COLUMNS = ['Owner', 'Operations', 'Finance', 'Warehouse'] as const;

const GRID_ROWS: readonly { capability: string; marks: readonly PermissionMark[] }[] = [
  { capability: 'View listings', marks: ['full', 'full', 'full', 'full'] },
  { capability: 'Create / edit listings', marks: ['full', 'full', 'none', 'none'] },
  { capability: 'Respond to grade corrections', marks: ['full', 'full', 'none', 'none'] },
  { capability: 'Acknowledge POs', marks: ['full', 'full', 'none', 'limited'] },
  { capability: 'View payables', marks: ['full', 'none', 'full', 'none'] },
  { capability: 'Manage team', marks: ['full', 'none', 'none', 'none'] },
];

function roleLabel(roles: string[]): string {
  const first = roles[0];
  return first ? (ROLE_LABEL[first] ?? first) : '—';
}

function lastActive(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(d);
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function VendorTeamRoute(): React.JSX.Element {
  const { data, error } = useResource<TeamView>('/api/account/team', 'Team is unavailable');
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [highlight, setHighlight] = React.useState<number | undefined>(undefined);
  const [inviteError, setInviteError] = React.useState<string | null>(null);

  if (error) {
    return (
      <div className="vl-page">
        <ClauseHeading n="01" kicker="Account" title="Team & access" />
        <EmptyState title="Team did not load" body={`${error}. Nothing has changed.`} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="vl-page">
        <ClauseHeading n="01" kicker="Account" title="Team & access" />
        <Skeleton lines={8} />
      </div>
    );
  }

  const members = data.members;
  const counts = {
    owner: members.filter((m) => m.roles.includes('VENDOR_OWNER')).length,
    ops: members.filter((m) => m.roles.includes('VENDOR_ADMIN') || m.roles.includes('VENDOR_OPS'))
      .length,
    finance: members.filter((m) => m.roles.includes('VENDOR_FINANCE')).length,
    warehouse: members.filter((m) => m.roles.includes('VENDOR_VIEWER')).length,
    mfa: members.filter((m) => m.mfaEnabled).length,
  };

  const register = (
    <RegisterStrip
      cells={[
        { label: 'Owner', value: String(counts.owner) },
        { label: 'Operations', value: String(counts.ops) },
        { label: 'Finance', value: String(counts.finance) },
        { label: 'Warehouse', value: String(counts.warehouse) },
        { label: '2FA on', value: String(counts.mfa), sub: `of ${members.length} active` },
      ]}
    />
  );

  const membersTable = (
    <LedgerSection n="02" title="Members" count={members.length}>
      <div className="vl-table-wrap">
        <table className="vl-table min-w-[860px]">
          <thead>
            <tr>
              {['Name', 'Email', 'Role', 'Last active', '2FA', 'Status'].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className={m.status !== 'ACTIVE' ? 'text-ink-3' : undefined}>
                <td>
                  <span className="vl-who">
                    <span className="vl-who__mono">{initials(m.fullName)}</span>
                    <span className="vl-td-ink">{m.fullName}</span>
                    {m.isYou ? <span className="vl-who__you">you</span> : null}
                  </span>
                </td>
                <td className="font-mono text-[12px]">{m.email ?? '—'}</td>
                <td>{roleLabel(m.roles)}</td>
                <td className="font-mono tabular-nums">{lastActive(m.lastLoginAt)}</td>
                <td className="font-mono">{m.mfaEnabled ? 'ON' : '—'}</td>
                <td className="font-mono text-[11px] uppercase">
                  {m.status === 'SUSPENDED' ? (
                    <span className="text-fail">Suspended</span>
                  ) : (
                    m.status
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </LedgerSection>
  );

  const roles = (
    <LedgerSection n="03" title="Role capabilities">
      <PermissionGrid rows={GRID_ROWS} columns={[...GRID_COLUMNS]} highlightColumn={highlight} />
    </LedgerSection>
  );

  const invite = inviteOpen ? (
    <aside className="vl-dock" aria-label="Invite">
      <h2 className="vl-dock__title">Invite</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setInviteError('Invite send is not available on this release.');
        }}
      >
        <label className="vl-field">
          Email
          <input required type="email" />
        </label>
        <label className="vl-field">
          Role
          <select
            onChange={(e) => {
              const map: Record<string, number> = {
                VENDOR_OWNER: 0,
                VENDOR_ADMIN: 1,
                VENDOR_FINANCE: 2,
                VENDOR_VIEWER: 3,
              };
              setHighlight(map[e.target.value]);
            }}
            defaultValue="VENDOR_ADMIN"
          >
            <option value="VENDOR_OWNER">Owner</option>
            <option value="VENDOR_ADMIN">Operations</option>
            <option value="VENDOR_FINANCE">Finance</option>
            <option value="VENDOR_VIEWER">Warehouse</option>
          </select>
        </label>
        {inviteError ? (
          <p className="mb-4 text-[13px] text-fail" role="alert">
            {inviteError}
          </p>
        ) : null}
        <Button type="submit" variant="primary">
          Send invite
        </Button>
      </form>
    </aside>
  ) : null;

  return (
    <div className="vl-page">
      <ClauseHeading
        n="01"
        kicker="Account · register of users"
        title="Team & access"
        actions={
          <Button variant="primary" onClick={() => setInviteOpen((v) => !v)}>
            {inviteOpen ? 'Close invite' : 'Invite member'}
          </Button>
        }
      />

      {inviteOpen ? (
        <div className="vl-split">
          <div className="vl-split__main">
            {register}
            {membersTable}
            {roles}
          </div>
          {invite}
        </div>
      ) : (
        <>
          {register}
          {membersTable}
          {roles}
        </>
      )}
    </div>
  );
}
