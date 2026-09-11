import * as React from 'react';
import { createPortal } from 'react-dom';
import {
  Button,
  Chip,
  cn,
  DataBoard,
  EmptyState,
  Input,
  Modal,
  Skeleton,
  type Column,
} from '@trugrade/ui';
import { Board, NotMeasured, PageHeader, Select } from '../../lib/controls';
import { useAuth } from '../../lib/auth';
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
import { Num } from './types';
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
 */

const ROLE_LABEL: Record<string, string> = {
  PLATFORM_SUPERADMIN: 'Super admin',
  OPS_MANAGER: 'Operations',
  KYC_REVIEWER: 'KYC reviewer',
  CATALOG_ADMIN: 'Catalog',
  PRICING_ADMIN: 'Pricing',
  QC_MANAGER: 'QC manager',
  TECHNICIAN: 'Technician',
  LOGISTICS_MANAGER: 'Logistics',
  RIDER: 'Rider',
  FINANCE: 'Finance',
  SUPPORT: 'Support',
  AUDITOR: 'Auditor',
  DPO: 'DPO',
  VENDOR_OWNER: 'Owner',
  VENDOR_ADMIN: 'Admin',
  VENDOR_OPS: 'Operations',
  VENDOR_FINANCE: 'Finance',
  VENDOR_VIEWER: 'Viewer',
  CUSTOMER_OWNER: 'Account owner',
  CUSTOMER_ADMIN: 'Admin',
  CUSTOMER_BUYER: 'Procurer',
  CUSTOMER_APPROVER: 'Approver',
  CUSTOMER_FINANCE: 'Finance',
  CUSTOMER_VIEWER: 'Viewer',
};

const roleLabel = (code: string): string => ROLE_LABEL[code] ?? code;

const stamp = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

type Phase =
  | { k: 'loading' }
  | { k: 'error'; message: string }
  | { k: 'ready'; team: Team };

function PersonCell({ member }: { member: TeamMember }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-body-sm text-ink">
        {member.fullName}
        {member.isYou && <span className="ml-2 text-body-sm text-ink-4">you</span>}
      </span>
      <span className="font-mono text-body-sm text-ink-3">
        {member.email ?? member.mobile ?? (
          <NotMeasured why="No email or mobile on this account." label="No contact recorded" />
        )}
      </span>
      {member.jobTitle !== null && (
        <span className="text-body-sm text-ink-3">{member.jobTitle}</span>
      )}
    </div>
  );
}

function RolesCell({ member }: { member: TeamMember }): React.JSX.Element {
  if (member.roles.length === 0) {
    return (
      <NotMeasured
        why="This account has no role assigned."
        label="No role assigned"
      />
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {member.roles.map((r) => (
        <span
          key={r}
          className="rounded border border-rule bg-sheet-2 px-2 py-1 text-body-sm text-ink-2"
          title={r}
        >
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

/** Same shape for every state — only the ink colour changes. StatusPill mixes filled pass with outlined warn. */
function AccountStatusBadge({ status }: { status: string }): React.JSX.Element {
  const label = accountStatusLabel(status);
  const tone =
    status === 'ACTIVE'
      ? 'text-pass'
      : status === 'SUSPENDED'
        ? 'text-warn'
        : status === 'DEACTIVATED'
          ? 'text-fail'
          : 'text-ink-2';

  return (
    <span
      className={cn(
        'inline-flex w-fit items-center gap-2 rounded-sm border border-rule bg-sheet-2 px-3 py-1',
        'font-mono text-label uppercase tracking-[0.13em]',
        tone,
      )}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
      {label}
    </span>
  );
}

function AccountCell({ member }: { member: TeamMember }): React.JSX.Element {
  return (
    <div className="flex flex-col items-start gap-1">
      <AccountStatusBadge status={member.status} />
      {member.lastLoginAt === null ? (
        <NotMeasured why="This person has never signed in." label="Never signed in" />
      ) : (
        <span className="font-mono text-body-sm tnum text-ink-3">
          Last in {stamp(member.lastLoginAt)}
        </span>
      )}
      {member.mfaEnabled ? (
        <span className="text-body-sm text-ink-3">Second factor on</span>
      ) : (
        <NotMeasured why="No second factor enrolled." label="No second factor" />
      )}
    </div>
  );
}

export function UsersRoute(): React.JSX.Element {
  const { principal } = useAuth();
  const [role, setRole] = useUrlState('role');
  const [status, setStatus] = useUrlState('status');
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

  if (phase.k === 'loading') return <Skeleton lines={10} />;

  const { team } = phase;
  const filtered = team.members.filter(
    (m) => (!role || m.roles.includes(role)) && (!status || m.status === status),
  );
  const hasFilter = role !== '' || status !== '';

  const columns: ReadonlyArray<Column<TeamMember>> = [
    { key: 'person', header: 'Person', cell: (m) => <PersonCell member={m} /> },
    { key: 'roles', header: 'Roles', cell: (m) => <RolesCell member={m} /> },
    { key: 'account', header: 'Account', cell: (m) => <AccountCell member={m} /> },
    ...(canWrite || canAssign
      ? [
          {
            key: 'actions',
            header: 'Actions',
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
    <div className="tg-stack">
      <PageHeader title="Users">
        Everybody who can sign in on your organisation&apos;s account.{' '}
        <Num>{team.members.length}</Num> {team.members.length === 1 ? 'person' : 'people'},{' '}
        <Num>{team.owners}</Num> {team.owners === 1 ? 'owner' : 'owners'}.
        {canWrite && (
          <span className="mt-4 block">
            <Button variant="primary" onClick={() => setAddOpen(true)}>
              Add user
            </Button>
          </span>
        )}
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-2">
        <Select
          label="Role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          options={[
            { value: '', label: `Every role (${team.members.length})` },
            ...team.roles.map((r) => ({
              value: r.code,
              label: `${roleLabel(r.code)} (${team.members.filter((m) => m.roles.includes(r.code)).length})`,
            })),
          ]}
        />
        <Select
          label="Account status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={[
            { value: '', label: 'Every status' },
            {
              value: 'ACTIVE',
              label: `Active (${team.members.filter((m) => m.status === 'ACTIVE').length})`,
            },
            {
              value: 'SUSPENDED',
              label: `Inactive (${team.members.filter((m) => m.status === 'SUSPENDED').length})`,
            },
            {
              value: 'DEACTIVATED',
              label: `Removed (${team.members.filter((m) => m.status === 'DEACTIVATED').length})`,
            },
          ]}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {team.roles.map((r) => {
          const count = team.members.filter((m) => m.roles.includes(r.code)).length;
          return (
            <Chip
              key={r.code}
              label={roleLabel(r.code)}
              count={count}
              selected={role === r.code}
              onToggle={() => setRole(role === r.code ? '' : r.code)}
            />
          );
        })}
      </div>

      <Board>
        <DataBoard
          caption={`${filtered.length} ${filtered.length === 1 ? 'person' : 'people'} in your organisation.`}
          columns={columns}
          rows={filtered}
          rowKey={(m) => m.id}
          empty={
            <EmptyState
              title={hasFilter ? 'Nobody matches these filters' : 'No users yet'}
              body={
                hasFilter
                  ? 'Clear the filters to see everyone in your organisation.'
                  : 'Add the first person who should be able to sign in on this account.'
              }
            />
          }
        />
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
