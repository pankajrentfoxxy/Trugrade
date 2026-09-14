import * as React from 'react';
import {
  Button,
  DataBoard,
  EmptyState,
  HubKpiRow,
  HubPageHeader,
  Panel,
  PermissionGrid,
  Skeleton,
  StatusPill,
  type Column,
} from '@trugrade/ui';
import { useAuth } from '../../lib/auth';
import { Board, NotMeasured } from '../../lib/controls';
import {
  CAPABILITY_MATRIX,
  MFA_ROLES,
  ROLE_LABEL,
  TEAM_ROLE_COLUMNS,
} from './team/capability-matrix';
import { MemberDialog, type MemberDialogDraft } from './team/MemberDialog';
import {
  createInvite,
  getTeam,
  resendInvite,
  revokeInvite,
  updateMember,
  type TeamInvite,
  type TeamMember,
  type TeamPayload,
} from './team/teamApi';

/**
 * ARCHETYPE B — Team register, pending invites, capability matrix.
 */

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

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

function formatCountdown(seconds: number): string {
  if (seconds <= 0) return 'Expired';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function facilitySummary(member: TeamMember): React.ReactNode {
  if (member.facilityIds.length === 0) return 'All';
  const labels = member.facilityLabels;
  if (labels.length <= 2) {
    return labels.map((label) => (
      <span key={label} className="hub-chip">
        {label}
      </span>
    ));
  }
  return (
    <>
      {labels.slice(0, 2).map((label) => (
        <span key={label} className="hub-chip">
          {label}
        </span>
      ))}
      <span className="font-mono text-label tnum text-ink-3">+{labels.length - 2}</span>
    </>
  );
}

export function VendorTeamRoute(): React.JSX.Element {
  const { principal } = useAuth();
  const canManage = principal?.permissions.includes('identity.team.manage') ?? false;
  const [data, setData] = React.useState<TeamPayload | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [manageMember, setManageMember] = React.useState<TeamMember | null>(null);
  const [dialogBusy, setDialogBusy] = React.useState(false);
  const [dialogError, setDialogError] = React.useState<string | null>(null);

  const load = React.useCallback(async (): Promise<void> => {
    const result = await getTeam();
    if (!result.ok) {
      setLoadError(result.message);
      setData(null);
      return;
    }
    setLoadError(null);
    setData(result.data);
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const refresh = (): void => {
    void load();
  };

  if (loadError) {
    return (
      <div className="hub-page">
        <HubPageHeader title="Team & access" />
        <EmptyState title="Team did not load" body={`${loadError}. Nothing has changed.`} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="hub-page">
        <HubPageHeader title="Team & access" />
        <Skeleton lines={8} />
      </div>
    );
  }

  const members = data.members;
  const invites = data.invites ?? [];
  const facilities = data.facilities ?? [];

  const counts = {
    owner: members.filter((m) => m.roles.includes('VENDOR_OWNER')).length,
    ops: members.filter((m) => m.roles.includes('VENDOR_ADMIN')).length,
    finance: members.filter((m) => m.roles.includes('VENDOR_FINANCE')).length,
    warehouse: members.filter((m) => m.roles.includes('VENDOR_VIEWER')).length,
    mfa: members.filter((m) => m.mfaEnabled).length,
  };

  const handleInvite = async (draft: MemberDialogDraft): Promise<void> => {
    setDialogBusy(true);
    setDialogError(null);
    const result = await createInvite({
      email: draft.email.trim(),
      fullName: draft.fullName.trim(),
      mobile: `+91${draft.mobile}`,
      role: draft.role,
      facilityIds: draft.facilityIds,
    });
    setDialogBusy(false);
    if (!result.ok) {
      setDialogError(result.message);
      return;
    }
    setInviteOpen(false);
    refresh();
  };

  const handleManage = async (draft: MemberDialogDraft): Promise<void> => {
    if (!manageMember) return;
    setDialogBusy(true);
    setDialogError(null);
    const result = await updateMember(manageMember.id, { facilityIds: draft.facilityIds });
    setDialogBusy(false);
    if (!result.ok) {
      setDialogError(result.message);
      return;
    }
    setManageMember(null);
    refresh();
  };

  const handleStatus = async (status: 'ACTIVE' | 'SUSPENDED'): Promise<void> => {
    if (!manageMember) return;
    setDialogBusy(true);
    setDialogError(null);
    const result = await updateMember(manageMember.id, { status });
    setDialogBusy(false);
    if (!result.ok) {
      setDialogError(result.message);
      return;
    }
    setManageMember(null);
    refresh();
  };

  const notGiven = (what: string): React.JSX.Element => (
    <NotMeasured label="Not given" why={`No ${what} on this account.`} />
  );

  const memberColumns: ReadonlyArray<Column<TeamMember>> = [
    {
      key: 'name',
      header: 'Name',
      cell: (m) => (
        <span className="hub-who">
          <span className="hub-who__mono">{initials(m.fullName)}</span>
          <span className="hub-td-ink">{m.fullName}</span>
          {m.isYou ? <span className="hub-who__you">you</span> : null}
        </span>
      ),
    },
    {
      key: 'email',
      header: 'Email',
      cell: (m) => (m.email ? <span className="font-mono">{m.email}</span> : notGiven('email')),
    },
    {
      key: 'phone',
      header: 'Phone',
      cell: (m) =>
        m.mobile ? <span className="font-mono tnum">{m.mobile}</span> : notGiven('mobile'),
    },
    {
      key: 'role',
      header: 'Role',
      cell: (m) => (
        <span className="inline-flex flex-wrap items-center gap-2">
          {roleLabel(m.roles)}
          {MFA_ROLES.has(m.roles[0] ?? '') ? <StatusPill tone="info" label="2FA" /> : null}
        </span>
      ),
    },
    {
      key: 'facilities',
      header: 'Facilities',
      cell: (m) => (
        <span className="inline-flex flex-wrap items-center gap-1">{facilitySummary(m)}</span>
      ),
    },
    { key: 'mfa', header: '2FA', cell: (m) => (m.mfaEnabled ? 'On' : 'Off') },
    { key: 'active', header: 'Last active', numeric: true, cell: (m) => lastActive(m.lastLoginAt) },
    {
      key: 'status',
      header: 'Status',
      cell: (m) => (
        <StatusPill
          tone={m.status === 'ACTIVE' ? 'neutral' : 'warn'}
          label={
            m.status === 'ACTIVE' ? 'Active' : m.status.charAt(0) + m.status.slice(1).toLowerCase()
          }
        />
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      headerHidden: true,
      cell: (m) =>
        canManage && !m.lockedReason && !m.isYou ? (
          <Button variant="link" size="sm" onClick={() => setManageMember(m)}>
            Manage
          </Button>
        ) : null,
    },
  ];

  const inviteColumns: ReadonlyArray<Column<TeamInvite>> = [
    {
      key: 'email',
      header: 'Email',
      cell: (inv) =>
        inv.email ? <span className="font-mono">{inv.email}</span> : notGiven('email'),
    },
    { key: 'role', header: 'Role', cell: (inv) => ROLE_LABEL[inv.role] ?? inv.role },
    {
      key: 'facilities',
      header: 'Facilities',
      cell: (inv) => (inv.facilityIds.length === 0 ? 'All' : inv.facilityLabels.join(', ')),
    },
    { key: 'sent', header: 'Sent', numeric: true, cell: (inv) => lastActive(inv.sentAt) },
    {
      key: 'expires',
      header: 'Expires',
      numeric: true,
      cell: (inv) => formatCountdown(inv.expiresInSeconds),
    },
    {
      key: 'actions',
      header: 'Actions',
      headerHidden: true,
      cell: (inv) => (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="link"
            size="sm"
            onClick={() => {
              if (inv.email) window.location.href = `mailto:${inv.email}`;
            }}
          >
            View email
          </Button>
          <Button variant="link" size="sm" onClick={() => void resendInvite(inv.id).then(refresh)}>
            Resend
          </Button>
          <Button variant="link" size="sm" onClick={() => void revokeInvite(inv.id).then(refresh)}>
            Revoke
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="hub-page">
      <HubPageHeader
        title="Team & access"
        subtitle={`${members.filter((m) => m.status === 'ACTIVE').length} active · ${invites.length} invite${invites.length === 1 ? '' : 's'} pending`}
        actions={
          canManage ? (
            <Button variant="primary" onClick={() => setInviteOpen(true)}>
              Invite member
            </Button>
          ) : null
        }
      />

      <HubKpiRow
        cells={[
          { label: 'Owner', value: String(counts.owner) },
          { label: 'Operations', value: String(counts.ops) },
          { label: 'Finance', value: String(counts.finance) },
          { label: 'Warehouse', value: String(counts.warehouse) },
          { label: '2FA on', value: String(counts.mfa), sub: `of ${members.length} active` },
        ]}
      />

      <Panel title="Members" count={members.length}>
        <Board tableMinWidth={980}>
          <DataBoard
            caption={`${members.length} ${members.length === 1 ? 'member' : 'members'}.`}
            columns={memberColumns}
            rows={members}
            rowKey={(m) => m.id}
          />
        </Board>
      </Panel>

      {invites.length > 0 ? (
        <Panel title="Pending invites" count={invites.length}>
          <Board tableMinWidth={860}>
            <DataBoard
              caption={`${invites.length} pending ${invites.length === 1 ? 'invite' : 'invites'}.`}
              columns={inviteColumns}
              rows={invites}
              rowKey={(inv) => inv.id}
            />
          </Board>
        </Panel>
      ) : null}

      <Panel title="What each role can do">
        <PermissionGrid
          rows={CAPABILITY_MATRIX.map((row) => ({
            capability: row.mfa ? `${row.capability} [2FA]` : row.capability,
            marks: row.marks,
          }))}
          columns={[...TEAM_ROLE_COLUMNS]}
        />
        <p className="px-5 py-3 text-body-sm text-ink-3">
          ● full · ◐ assigned facilities only · – none
        </p>
      </Panel>

      <MemberDialog
        open={inviteOpen}
        mode="invite"
        member={null}
        facilities={facilities}
        busy={dialogBusy}
        error={dialogError}
        onClose={() => setInviteOpen(false)}
        onSubmit={(draft) => void handleInvite(draft)}
      />

      <MemberDialog
        open={manageMember !== null}
        mode="manage"
        member={manageMember}
        facilities={facilities}
        busy={dialogBusy}
        error={dialogError}
        onClose={() => setManageMember(null)}
        onSubmit={(draft) => void handleManage(draft)}
        onSuspend={() => void handleStatus('SUSPENDED')}
        onReactivate={() => void handleStatus('ACTIVE')}
      />
    </div>
  );
}
