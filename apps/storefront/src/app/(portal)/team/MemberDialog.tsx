'use client';

import * as React from 'react';
import { Button, Checkbox, Input, Modal, PermissionGrid } from '@trugrade/ui';
import {
  mobileSubscriberDigits,
  validateEmail,
  validateFullName,
  validateMobile,
} from '../../register/validation';
import type { TeamMember, TeamRole } from '../api';
import { CAPABILITY_MATRIX, ROLE_COLUMN_INDEX, ROLE_LABEL, ROLE_OPTIONS, TEAM_ROLE_COLUMNS } from './capability-matrix';

/**
 * One dialog, two jobs: invite somebody, or change what somebody may do.
 *
 * Inviting sends a single-use link. There is no password to set: a buyer's
 * colleague signs in with a code to the email or mobile on the invite.
 *
 * Managing follows the rules the server enforces and this screen says out loud:
 * nobody can grant a power they do not hold (a role arrives with `assignable`),
 * an account with no role can sign in and see nothing, and switching somebody
 * off is a suspension that keeps their name on the orders they raised.
 */

export interface InviteDraft {
  role: string;
  fullName: string;
  email: string;
  /** Ten subscriber digits. The caller adds +91. */
  mobile: string;
}

export interface MemberDialogProps {
  open: boolean;
  mode: 'invite' | 'manage';
  member: TeamMember | null;
  /** The server's role matrix, with whether the reader may grant each one. */
  roles: readonly TeamRole[];
  busy: boolean;
  error: string | null;
  /** The server's refusal per field, e.g. `{ mobile: 'This mobile number is already registered.' }`. */
  fieldErrors?: Partial<Record<'fullName' | 'email' | 'mobile', string>>;
  onClose: () => void;
  onInvite: (draft: InviteDraft) => void;
  onRoles: (roles: string[]) => void;
  onSuspend: () => void;
  onReactivate: () => void;
}

export function MemberDialog({
  open,
  mode,
  member,
  roles,
  busy,
  error,
  fieldErrors,
  onClose,
  onInvite,
  onRoles,
  onSuspend,
  onReactivate,
}: MemberDialogProps): React.JSX.Element {
  // A server refusal stays under its field until that field is edited.
  const [edited, setEdited] = React.useState<ReadonlySet<string>>(new Set());
  React.useEffect(() => setEdited(new Set()), [fieldErrors]);
  const serverError = (field: 'fullName' | 'email' | 'mobile'): string | undefined =>
    edited.has(field) ? undefined : fieldErrors?.[field];
  const markEdited = (field: string): void => setEdited((prev) => new Set(prev).add(field));

  const [draft, setDraft] = React.useState<InviteDraft>({
    role: 'CUSTOMER_BUYER',
    fullName: '',
    email: '',
    mobile: '',
  });
  const [picked, setPicked] = React.useState<string[]>([]);
  const [touched, setTouched] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setTouched(false);
    if (mode === 'manage' && member) {
      setPicked([...member.roles]);
      return;
    }
    setDraft({ role: 'CUSTOMER_BUYER', fullName: '', email: '', mobile: '' });
  }, [open, mode, member]);

  const mobileDisplay = draft.mobile ? `+91 ${draft.mobile}` : '+91 ';
  const none = picked.length === 0;

  const footer =
    mode === 'manage' ? (
      <div className="flex w-full flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {member?.status === 'ACTIVE' ? (
            <Button type="button" variant="danger" onClick={onSuspend} disabled={busy}>
              Switch off
            </Button>
          ) : null}
          {member?.status === 'SUSPENDED' ? (
            <Button type="button" variant="secondary" onClick={onReactivate} disabled={busy}>
              Switch on
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
            {...(none ? { disabledReason: 'Pick at least one role first.' } : {})}
            onClick={() => {
              if (none) return;
              onRoles(picked);
            }}
          >
            Save these roles
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
            setTouched(true);
            if (
              validateFullName(draft.fullName) ||
              validateEmail(draft.email) ||
              validateMobile(mobileDisplay)
            ) {
              return;
            }
            onInvite(draft);
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
      title={mode === 'invite' ? 'Invite a team member' : `What ${member?.fullName || 'they'} may do`}
      description={
        mode === 'invite'
          ? 'We email a single-use link. They sign in with a code — there is no password to set.'
          : 'Takes effect on their next request, and they are told about it.'
      }
      size="lg"
      footer={footer}
    >
      {mode === 'invite' ? (
        <div className="flex flex-col gap-5">
          <div>
            <label className="mb-1 block text-body-sm font-medium text-ink-2" htmlFor="member-role">
              Role
            </label>
            <select
              id="member-role"
              className="w-full rounded border border-rule bg-sheet px-3 py-2 text-body text-ink"
              value={draft.role}
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
            onChange={(e) => {
              markEdited('fullName');
              setDraft((d) => ({ ...d, fullName: e.target.value }));
            }}
            error={(touched ? validateFullName(draft.fullName) : undefined) ?? serverError('fullName')}
          />
          <Input
            label="Work email"
            required
            type="email"
            value={draft.email}
            onChange={(e) => {
              markEdited('email');
              setDraft((d) => ({ ...d, email: e.target.value }));
            }}
            error={(touched ? validateEmail(draft.email) : undefined) ?? serverError('email')}
          />
          <Input
            label="Mobile"
            required
            mono
            inputMode="numeric"
            maxLength={10}
            value={draft.mobile}
            hint="Ten digits. We add +91."
            onChange={(e) => {
              markEdited('mobile');
              setDraft((d) => ({ ...d, mobile: mobileSubscriberDigits(e.target.value) }));
            }}
            error={(touched ? validateMobile(mobileDisplay) : undefined) ?? serverError('mobile')}
          />

          <PermissionGrid
            rows={CAPABILITY_MATRIX}
            columns={[...TEAM_ROLE_COLUMNS]}
            highlightColumn={ROLE_COLUMN_INDEX[draft.role]}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <ul className="flex flex-col gap-3">
            {roles.map((r) => {
              const on = picked.includes(r.code);
              return (
                <li key={r.code}>
                  <Checkbox
                    label={ROLE_LABEL[r.code] ?? r.code}
                    checked={on}
                    disabled={!r.assignable}
                    onChange={() =>
                      setPicked((p) => (on ? p.filter((c) => c !== r.code) : [...p, r.code]))
                    }
                  />
                  <p className="ml-7 text-body-sm text-ink-3">
                    {ROLE_OPTIONS.find((o) => o.value === r.code)?.description ??
                      r.description ??
                      `${r.permissions.length} permission${r.permissions.length === 1 ? '' : 's'}`}
                    {!r.assignable ? (
                      // Said, not merely disabled: you cannot hand out a power
                      // you do not hold yourself.
                      <> You cannot give this out, because it grants more than your own account can do.</>
                    ) : null}
                  </p>
                </li>
              );
            })}
          </ul>
          {none ? (
            <p className="text-body-sm text-ink-2">
              Pick at least one role. Somebody with none can sign in and see nothing, which looks
              like a broken account — switch them off instead.
            </p>
          ) : null}
        </div>
      )}

      {error ? (
        <p className="mt-4 text-body-sm text-fail" role="alert">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
