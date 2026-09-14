import * as React from 'react';
import {
  Button,
  ClauseHeading,
  EmptyState,
  LedgerSection,
  PermissionGrid,
  RegisterStrip,
  Skeleton,
  StatusPill,
} from '@trugrade/ui';
import { useAuth } from '../../lib/auth';
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
      <span key={label} className="vl-chip">
        {label}
      </span>
    ));
  }
  return (
    <>
      {labels.slice(0, 2).map((label) => (
        <span key={label} className="vl-chip">
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
      <div className="vl-page">
        <ClauseHeading n="01" kicker="Account" title="Team & access" />
        <EmptyState title="Team did not load" body={`${loadError}. Nothing has changed.`} />
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

  return (
    <div className="vl-page">
      <ClauseHeading
        n="01"
        kicker="Account · register of users"
        title="Team & access"
        actions={
          canManage ? (
            <Button variant="primary" onClick={() => setInviteOpen(true)}>
              Invite member
            </Button>
          ) : null
        }
      />

      <RegisterStrip
        cells={[
          { label: 'Owner', value: String(counts.owner) },
          { label: 'Operations', value: String(counts.ops) },
          { label: 'Finance', value: String(counts.finance) },
          { label: 'Warehouse', value: String(counts.warehouse) },
          { label: '2FA on', value: String(counts.mfa), sub: `of ${members.length} active` },
        ]}
      />

      <LedgerSection n="02" title="Members" count={members.length}>
        <div className="vl-table-wrap">
          <table className="vl-table min-w-[980px]">
            <thead>
              <tr>
                {[
                  'Name',
                  'Email',
                  'Phone',
                  'Role',
                  'Facilities',
                  '2FA',
                  'Last active',
                  'Status',
                  '',
                ].map((h) => (
                  <th key={h || 'actions'}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const canManageRow = canManage && !m.lockedReason && !m.isYou;
                return (
                  <tr key={m.id} className={m.status !== 'ACTIVE' ? 'text-ink-3' : undefined}>
                    <td>
                      <span className="vl-who">
                        <span className="vl-who__mono">{initials(m.fullName)}</span>
                        <span className="vl-td-ink">{m.fullName}</span>
                        {m.isYou ? <span className="vl-who__you">you</span> : null}
                      </span>
                    </td>
                    <td className="font-mono text-[12px]">{m.email ?? '—'}</td>
                    <td className="font-mono text-[12px] tnum">{m.mobile ?? '—'}</td>
                    <td>
                      <span className="inline-flex flex-wrap items-center gap-2">
                        {roleLabel(m.roles)}
                        {MFA_ROLES.has(m.roles[0] ?? '') ? (
                          <StatusPill tone="info" label="2FA" />
                        ) : null}
                      </span>
                    </td>
                    <td>
                      <span className="inline-flex flex-wrap items-center gap-1">
                        {facilitySummary(m)}
                      </span>
                    </td>
                    <td className="font-mono">{m.mfaEnabled ? 'ON' : '—'}</td>
                    <td className="font-mono tabular-nums">{lastActive(m.lastLoginAt)}</td>
                    <td className="font-mono text-[11px] uppercase">
                      {m.status === 'SUSPENDED' ? (
                        <span className="text-fail">Suspended</span>
                      ) : (
                        m.status
                      )}
                    </td>
                    <td>
                      {canManageRow ? (
                        <Button variant="link" size="sm" onClick={() => setManageMember(m)}>
                          Manage
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </LedgerSection>

      {invites.length > 0 ? (
        <LedgerSection n="03" title="Pending invites" count={invites.length}>
          <div className="vl-table-wrap">
            <table className="vl-table min-w-[860px]">
              <thead>
                <tr>
                  {['Email', 'Role', 'Facilities', 'Sent', 'Expires', ''].map((h) => (
                    <th key={h || 'actions'}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invites.map((inv: TeamInvite) => (
                  <tr key={inv.id} className="bg-sheet-2 text-ink-3">
                    <td className="font-mono text-[12px]">{inv.email ?? '—'}</td>
                    <td>{ROLE_LABEL[inv.role] ?? inv.role}</td>
                    <td>
                      {inv.facilityIds.length === 0
                        ? 'All'
                        : inv.facilityLabels.join(', ')}
                    </td>
                    <td className="font-mono tabular-nums">{lastActive(inv.sentAt)}</td>
                    <td className="font-mono tabular-nums">
                      {formatCountdown(inv.expiresInSeconds)}
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="link"
                          size="sm"
                          onClick={() => {
                            if (inv.email) {
                              window.location.href = `mailto:${inv.email}`;
                            }
                          }}
                        >
                          View email
                        </Button>
                        <Button
                          variant="link"
                          size="sm"
                          onClick={() => void resendInvite(inv.id).then(refresh)}
                        >
                          Resend
                        </Button>
                        <Button
                          variant="link"
                          size="sm"
                          onClick={() => void revokeInvite(inv.id).then(refresh)}
                        >
                          Revoke
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </LedgerSection>
      ) : null}

      <LedgerSection n="04" title="What each role can do">
        <PermissionGrid
          rows={CAPABILITY_MATRIX.map((row) => ({
            capability: row.mfa ? `${row.capability} [2FA]` : row.capability,
            marks: row.marks,
          }))}
          columns={[...TEAM_ROLE_COLUMNS]}
        />
        <p className="mt-3 text-body-sm text-ink-3">
          ● full · ◐ assigned facilities only · – none
        </p>
      </LedgerSection>

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
