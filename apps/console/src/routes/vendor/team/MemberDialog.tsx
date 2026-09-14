import * as React from 'react';
import {
  Button,
  Chip,
  Input,
  Modal,
  PermissionGrid,
  StatusPill,
} from '@trugrade/ui';
import {
  mobileSubscriberDigits,
  validateEmail,
  validateFullName,
  validateMobile,
} from '../../../../../storefront/src/app/register/validation';
import {
  CAPABILITY_MATRIX,
  ROLE_OPTIONS,
  TEAM_ROLE_COLUMNS,
  VENDOR_ROLE_COLUMN_INDEX,
} from './capability-matrix';
import type { TeamFacility, TeamMember } from './teamApi';

export interface MemberDialogDraft {
  role: string;
  fullName: string;
  email: string;
  mobile: string;
  allFacilities: boolean;
  facilityIds: string[];
}

export interface MemberDialogProps {
  open: boolean;
  mode: 'invite' | 'manage';
  member: TeamMember | null;
  facilities: TeamFacility[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (draft: MemberDialogDraft) => void;
  onSuspend?: () => void;
  onReactivate?: () => void;
}

export function MemberDialog({
  open,
  mode,
  member,
  facilities,
  busy,
  error,
  onClose,
  onSubmit,
  onSuspend,
  onReactivate,
}: MemberDialogProps): React.JSX.Element {
  const [draft, setDraft] = React.useState<MemberDialogDraft>({
    role: 'VENDOR_ADMIN',
    fullName: '',
    email: '',
    mobile: '',
    allFacilities: true,
    facilityIds: [],
  });

  React.useEffect(() => {
    if (!open) return;
    if (mode === 'manage' && member) {
      setDraft({
        role: member.roles[0] ?? 'VENDOR_VIEWER',
        fullName: member.fullName,
        email: member.email ?? '',
        mobile: member.mobile?.replace(/^\+91/, '') ?? '',
        allFacilities: member.facilityIds.length === 0,
        facilityIds: [...member.facilityIds],
      });
      return;
    }
    setDraft({
      role: 'VENDOR_ADMIN',
      fullName: '',
      email: '',
      mobile: '',
      allFacilities: true,
      facilityIds: [],
    });
  }, [open, mode, member]);

  const highlight = VENDOR_ROLE_COLUMN_INDEX[draft.role];
  const mobileDisplay = draft.mobile ? `+91 ${draft.mobile}` : '+91 ';

  const footer =
    mode === 'manage' ? (
      <div className="flex w-full flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {member?.status === 'ACTIVE' && onSuspend ? (
            <Button type="button" variant="danger" onClick={onSuspend} disabled={busy}>
              Suspend
            </Button>
          ) : null}
          {member?.status === 'SUSPENDED' && onReactivate ? (
            <Button type="button" variant="secondary" onClick={onReactivate} disabled={busy}>
              Reactivate
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            loading={busy}
            onClick={() =>
              onSubmit({
                ...draft,
                facilityIds: draft.allFacilities ? [] : draft.facilityIds,
              })
            }
          >
            Save
          </Button>
        </div>
      </div>
    ) : (
      <div className="flex w-full flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="primary"
          loading={busy}
          onClick={() => {
            const nameErr = validateFullName(draft.fullName);
            const emailErr = validateEmail(draft.email);
            const mobileErr = validateMobile(mobileDisplay);
            if (nameErr || emailErr || mobileErr) return;
            if (!draft.allFacilities && draft.facilityIds.length === 0) return;
            onSubmit({
              ...draft,
              facilityIds: draft.allFacilities ? [] : draft.facilityIds,
            });
          }}
        >
          Send invite
        </Button>
      </div>
    );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === 'invite' ? 'Add a team member' : 'Manage member'}
      description={
        mode === 'invite'
          ? 'We email a single-use link. They set their own password.'
          : 'Role and facilities can be updated. Contact details are read-only.'
      }
      size="lg"
      footer={footer}
    >
      <div className="flex flex-col gap-5">
        <div>
          <label className="mb-1 block text-body-sm font-medium text-ink-2" htmlFor="member-role">
            Role
          </label>
          <select
            id="member-role"
            className="w-full rounded border border-rule bg-sheet px-3 py-2 text-body text-ink"
            value={draft.role}
            disabled={mode === 'manage'}
            onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value }))}
          >
            {ROLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-body-sm text-ink-3">
            {ROLE_OPTIONS.find((o) => o.value === draft.role)?.description}
          </p>
        </div>

        <Input
          label="Name"
          required
          value={draft.fullName}
          readOnly={mode === 'manage'}
          onChange={(e) => setDraft((d) => ({ ...d, fullName: e.target.value }))}
          error={mode === 'invite' ? validateFullName(draft.fullName) : undefined}
        />
        <Input
          label="Email ID"
          required
          type="email"
          value={draft.email}
          readOnly={mode === 'manage'}
          onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
          error={mode === 'invite' ? validateEmail(draft.email) : undefined}
        />
        <Input
          label="Phone"
          required
          mono
          inputMode="numeric"
          maxLength={10}
          value={draft.mobile}
          readOnly={mode === 'manage'}
          onChange={(e) =>
            setDraft((d) => ({ ...d, mobile: mobileSubscriberDigits(e.target.value) }))
          }
          error={mode === 'invite' ? validateMobile(mobileDisplay) : undefined}
        />

        <div>
          <p className="mb-2 text-body-sm font-medium text-ink-2">
            Which facilities can they act on?
          </p>
          <div className="flex flex-wrap gap-2">
            <Chip
              label="All facilities"
              selected={draft.allFacilities}
              onToggle={() => setDraft((d) => ({ ...d, allFacilities: true, facilityIds: [] }))}
            />
            {facilities.map((f) => (
              <Chip
                key={f.id}
                label={f.label}
                selected={!draft.allFacilities && draft.facilityIds.includes(f.id)}
                onToggle={() =>
                  setDraft((d) => {
                    if (d.allFacilities) {
                      return { ...d, allFacilities: false, facilityIds: [f.id] };
                    }
                    const next = d.facilityIds.includes(f.id)
                      ? d.facilityIds.filter((id) => id !== f.id)
                      : [...d.facilityIds, f.id];
                    return {
                      ...d,
                      allFacilities: next.length === 0,
                      facilityIds: next.length === 0 ? [] : next,
                    };
                  })
                }
              />
            ))}
          </div>
        </div>

        <PermissionGrid
          rows={CAPABILITY_MATRIX.map((row) => ({
            capability: row.mfa ? `${row.capability} [2FA]` : row.capability,
            marks: row.marks,
          }))}
          columns={[...TEAM_ROLE_COLUMNS]}
          highlightColumn={highlight}
        />

        {error ? (
          <p className="text-body-sm text-fail" role="alert">
            {error}
          </p>
        ) : null}
        {mode === 'manage' && member?.mfaRequired ? (
          <StatusPill tone="info" label="2FA mandatory for this role" />
        ) : null}
      </div>
    </Modal>
  );
}
