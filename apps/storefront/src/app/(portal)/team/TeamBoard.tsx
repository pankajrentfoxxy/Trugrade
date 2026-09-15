'use client';

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
import type { ApiFailure } from '../../register/api';
import { inIst } from '../../../lib/deadline';
import {
  createInvite,
  getTeamWithInvites,
  resendInvite,
  revokeInvite,
  updateMember,
  type TeamInvite,
  type TeamMember,
  type TeamWithInvites,
} from '../api';
import { usePortal } from '../shell/PortalContext';
import { CAPABILITY_MATRIX, ROLE_LABEL, TEAM_ROLE_COLUMNS } from './capability-matrix';
import { MemberDialog, type InviteDraft } from './MemberDialog';

/**
 * The team board. See `page.tsx` for the archetype and the rules.
 *
 * A client component: authenticated read, and every row action writes.
 */

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function formatCountdown(seconds: number): string {
  if (seconds <= 0) return 'Expired';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

const problem = (failure: ApiFailure): string =>
  failure.code === 'UNKNOWN' || failure.code === 'NETWORK'
    ? 'We could not reach your account just now. That is our problem, not yours — nothing here has changed.'
    : failure.message;

type Phase =
  | { k: 'loading' }
  | { k: 'not-yours' }
  | { k: 'error'; message: string }
  | { k: 'ready'; team: TeamWithInvites };

export function TeamBoard(): React.JSX.Element {
  const { session } = usePortal();
  const canManage = session.permissions.includes('identity.team.manage');
  const canAssign = session.permissions.includes('identity.role.assign');
  const [phase, setPhase] = React.useState<Phase>({ k: 'loading' });
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [managing, setManaging] = React.useState<TeamMember | null>(null);
  const [dialogBusy, setDialogBusy] = React.useState(false);
  const [dialogError, setDialogError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<
    Partial<Record<'fullName' | 'email' | 'mobile', string>>
  >({});
  const [rowFailure, setRowFailure] = React.useState<string | null>(null);

  const load = React.useCallback(async (): Promise<void> => {
    const result = await getTeamWithInvites();
    if (result.ok) setPhase({ k: 'ready', team: result.data });
    else if (result.status === 403) setPhase({ k: 'not-yours' });
    else setPhase({ k: 'error', message: problem(result) });
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const refresh = (): void => {
    void load();
  };

  const handleInvite = async (draft: InviteDraft): Promise<void> => {
    setDialogBusy(true);
    setDialogError(null);
    setFieldErrors({});
    const result = await createInvite({
      email: draft.email.trim(),
      fullName: draft.fullName.trim(),
      mobile: `+91${draft.mobile}`,
      role: draft.role,
    });
    setDialogBusy(false);
    if (!result.ok) {
      setDialogError(result.message);
      setFieldErrors(result.fields);
      return;
    }
    setInviteOpen(false);
    refresh();
  };

  const handleRoles = async (roles: string[]): Promise<void> => {
    if (!managing) return;
    setDialogBusy(true);
    setDialogError(null);
    const result = await updateMember(managing.id, { roles });
    setDialogBusy(false);
    if (!result.ok) {
      setDialogError(result.message);
      return;
    }
    setManaging(null);
    refresh();
  };

  const handleStatus = async (status: 'ACTIVE' | 'SUSPENDED'): Promise<void> => {
    if (!managing) return;
    setDialogBusy(true);
    setDialogError(null);
    const result = await updateMember(managing.id, { status });
    setDialogBusy(false);
    if (!result.ok) {
      setDialogError(result.message);
      return;
    }
    setManaging(null);
    refresh();
  };

  const act = async (run: () => Promise<{ ok: boolean; message?: string }>): Promise<void> => {
    setRowFailure(null);
    const result = await run();
    if (!result.ok) {
      setRowFailure(result.message ?? 'That did not go through. Nothing has changed.');
      return;
    }
    refresh();
  };

  if (phase.k === 'loading') {
    return (
      <div className="hub-page">
        <HubPageHeader title="Team & access" />
        <Skeleton lines={8} />
      </div>
    );
  }
  if (phase.k === 'not-yours') {
    return (
      <div className="hub-page">
        <HubPageHeader title="Team & access" />
        <EmptyState
          title="The team is visible to owners and admins"
          body="Your role on this account does not include seeing who else is on it. Ask your account owner if you need a change made."
        />
      </div>
    );
  }
  if (phase.k === 'error') {
    return (
      <div className="hub-page">
        <HubPageHeader title="Team & access" />
        <EmptyState title="Team did not load" body={phase.message} />
      </div>
    );
  }

  const { team } = phase;
  const members = team.members;
  const invites = team.invites ?? [];
  const active = members.filter((m) => m.status === 'ACTIVE').length;
  const approvers = members.filter(
    (m) => m.status === 'ACTIVE' && m.roles.some((r) => r === 'CUSTOMER_OWNER' || r === 'CUSTOMER_APPROVER'),
  ).length;

  const notGiven = (what: string): React.JSX.Element => (
    <span className="text-ink-4">No {what}</span>
  );

  const memberColumns: ReadonlyArray<Column<TeamMember>> = [
    {
      key: 'name',
      header: 'Name',
      cell: (m) => (
        <span className="hub-who">
          <span className="hub-who__mono">{initials(m.fullName || m.email || '')}</span>
          <span className="hub-td-ink">
            {m.fullName || <span className="text-ink-4">Name not given</span>}
          </span>
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
      header: 'Mobile',
      cell: (m) =>
        m.mobile ? <span className="font-mono tnum">{m.mobile}</span> : notGiven('mobile'),
    },
    {
      key: 'role',
      header: 'Role',
      cell: (m) =>
        m.roles.length === 0 ? (
          // Not a blank cell: an account with no role can sign in and see
          // nothing, which looks like a bug rather than a decision.
          <span className="text-ink-4">No role — they can sign in and see nothing</span>
        ) : (
          <span className="inline-flex flex-wrap gap-1">
            {m.roles.map((r) => (
              <span key={r} className="hub-chip">
                {ROLE_LABEL[r] ?? r}
              </span>
            ))}
          </span>
        ),
    },
    {
      key: 'active',
      header: 'Last active',
      numeric: true,
      cell: (m) =>
        m.lastLoginAt === null ? (
          <span className="text-ink-4">Never signed in</span>
        ) : (
          inIst(m.lastLoginAt)
        ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (m) => (
        <StatusPill
          tone="neutral"
          label={
            m.status === 'ACTIVE'
              ? 'Active'
              : m.status === 'SUSPENDED'
                ? 'Switched off'
                : m.status.charAt(0) + m.status.slice(1).toLowerCase()
          }
        />
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      headerHidden: true,
      cell: (m) =>
        m.lockedReason ? (
          // The reason, in words, instead of a greyed-out control with no explanation.
          <span className="text-body-sm text-ink-3">{m.lockedReason}</span>
        ) : canAssign && !m.isYou ? (
          <Button variant="link" size="sm" onClick={() => setManaging(m)}>
            Manage
          </Button>
        ) : null,
    },
  ];

  const inviteColumns: ReadonlyArray<Column<TeamInvite>> = [
    { key: 'name', header: 'Name', cell: (inv) => <span className="hub-td-ink">{inv.fullName}</span> },
    {
      key: 'email',
      header: 'Email',
      cell: (inv) => (inv.email ? <span className="font-mono">{inv.email}</span> : notGiven('email')),
    },
    { key: 'role', header: 'Role', cell: (inv) => ROLE_LABEL[inv.role] ?? inv.role },
    { key: 'sent', header: 'Sent', numeric: true, cell: (inv) => inIst(inv.sentAt) },
    {
      key: 'expires',
      header: 'Expires in',
      numeric: true,
      cell: (inv) => <span className="font-mono tnum">{formatCountdown(inv.expiresInSeconds)}</span>,
    },
    {
      key: 'actions',
      header: 'Actions',
      headerHidden: true,
      cell: (inv) => (
        <div className="flex flex-wrap gap-2">
          <Button variant="link" size="sm" onClick={() => void act(() => resendInvite(inv.id))}>
            Resend
          </Button>
          <Button variant="link" size="sm" onClick={() => void act(() => revokeInvite(inv.id))}>
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
        subtitle={`${active} active · ${invites.length} ${invites.length === 1 ? 'invite' : 'invites'} pending`}
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
          { label: 'People', value: String(members.length), sub: `${active} active` },
          { label: 'Account owners', value: String(team.owners), sub: 'one is the floor' },
          { label: 'Can approve orders', value: String(approvers), sub: 'owners and approvers' },
          { label: 'Invites pending', value: String(invites.length), sub: 'links expire in 72 hours' },
        ]}
      />

      {rowFailure ? (
        <p role="alert" className="mb-4 text-body-sm text-fail">
          {rowFailure}
        </p>
      ) : null}

      <Panel title="Members" count={members.length}>
        <div className="hub-table-wrap">
          <DataBoard
            caption={`${members.length} ${members.length === 1 ? 'person' : 'people'} on your organisation's account, account owners first.`}
            columns={memberColumns}
            rows={members}
            rowKey={(m) => m.id}
          />
        </div>
      </Panel>

      {invites.length > 0 ? (
        <Panel title="Pending invites" count={invites.length}>
          <div className="hub-table-wrap">
            <DataBoard
              caption={`${invites.length} pending ${invites.length === 1 ? 'invite' : 'invites'}.`}
              columns={inviteColumns}
              rows={invites}
              rowKey={(inv) => inv.id}
            />
          </div>
        </Panel>
      ) : canManage ? (
        <Panel title="Pending invites">
          <div className="px-5 py-4">
            <EmptyState
              title="No invites outstanding"
              body="Invite a colleague and they appear here until they take up the link."
            />
          </div>
        </Panel>
      ) : null}

      <Panel title="What each role can do">
        <PermissionGrid rows={CAPABILITY_MATRIX} columns={[...TEAM_ROLE_COLUMNS]} />
        <p className="px-5 py-3 text-body-sm text-ink-3">● may · – may not</p>
      </Panel>

      <MemberDialog
        open={inviteOpen}
        mode="invite"
        member={null}
        roles={team.roles}
        busy={dialogBusy}
        error={dialogError}
        fieldErrors={fieldErrors}
        onClose={() => {
          setInviteOpen(false);
          setDialogError(null);
          setFieldErrors({});
        }}
        onInvite={(draft) => void handleInvite(draft)}
        onRoles={() => undefined}
        onSuspend={() => undefined}
        onReactivate={() => undefined}
      />
      <MemberDialog
        open={managing !== null}
        mode="manage"
        member={managing}
        roles={team.roles}
        busy={dialogBusy}
        error={dialogError}
        onClose={() => {
          setManaging(null);
          setDialogError(null);
        }}
        onInvite={() => undefined}
        onRoles={(roles) => void handleRoles(roles)}
        onSuspend={() => void handleStatus('SUSPENDED')}
        onReactivate={() => void handleStatus('ACTIVE')}
      />
    </div>
  );
}
