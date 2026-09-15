import { refreshSession } from '../../../lib/auth';

export interface TeamMember {
  id: string;
  fullName: string;
  email: string | null;
  mobile: string | null;
  status: string;
  isOrgOwner: boolean;
  roles: string[];
  mfaEnabled: boolean;
  mfaRequired: boolean;
  lastLoginAt: string | null;
  isYou: boolean;
  lockedReason: string | null;
  facilityIds: string[];
  facilityLabels: string[];
}

export interface TeamInvite {
  id: string;
  email: string | null;
  fullName: string;
  role: string;
  facilityIds: string[];
  facilityLabels: string[];
  sentAt: string;
  expiresAt: string;
  expiresInSeconds: number;
}

export interface TeamFacility {
  id: string;
  label: string;
}

export interface TeamPayload {
  members: TeamMember[];
  owners: number;
  invites: TeamInvite[];
  facilities: TeamFacility[];
}

export interface ApiFailure {
  ok: false;
  status: number;
  message: string;
  fields: Record<string, string>;
}

export type ApiResult<T> = ({ ok: true; data: T } | ApiFailure) & { ok: boolean };

async function call<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    let res = await fetch(url, { credentials: 'include', ...init });
    if (res.status === 401) {
      await refreshSession();
      res = await fetch(url, { credentials: 'include', ...init });
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      // The API's refusals arrive as `{ error: { code, message, fields } }`. Reading
      // `body.message` found nothing, so every refusal — "this mobile number is
      // already registered", an expired invite, a weak password — read
      // "Request failed (422)".
      const envelope =
        body.error && typeof body.error === 'object'
          ? (body.error as Record<string, unknown>)
          : body;
      const fields =
        envelope.fields && typeof envelope.fields === 'object' && !Array.isArray(envelope.fields)
          ? (envelope.fields as Record<string, string>)
          : {};
      return {
        ok: false,
        status: res.status,
        message:
          typeof envelope.message === 'string'
            ? envelope.message
            : `That did not go through (${res.status}). Nothing was changed — try again.`,
        fields,
      };
    }
    return { ok: true, data: body as T };
  } catch {
    return {
      ok: false,
      status: 0,
      message: 'We could not reach the server. Try again.',
      fields: {},
    };
  }
}

export const getTeam = (): Promise<ApiResult<TeamPayload>> =>
  call<TeamPayload>('/api/account/team');

export interface CreateInviteBody {
  email: string;
  fullName: string;
  mobile: string;
  role: string;
  facilityIds: string[];
}

export const createInvite = (body: CreateInviteBody): Promise<ApiResult<{ invite: TeamInvite }>> =>
  call('/api/account/team/invites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

export const resendInvite = (inviteId: string): Promise<ApiResult<TeamInvite>> =>
  call(`/api/account/team/invites/${inviteId}/resend`, { method: 'POST' });

export const revokeInvite = (inviteId: string): Promise<ApiResult<{ ok: true }>> =>
  call(`/api/account/team/invites/${inviteId}`, { method: 'DELETE' });

export const updateMember = (
  userId: string,
  body: { role?: string; facilityIds?: string[]; status?: 'ACTIVE' | 'SUSPENDED' },
): Promise<ApiResult<TeamMember>> =>
  call(`/api/account/team/${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(body.role ? { roles: [body.role] } : {}),
      ...(body.facilityIds !== undefined ? { facilityIds: body.facilityIds } : {}),
      ...(body.status ? { status: body.status } : {}),
    }),
  });

export interface InvitePreview {
  fullName: string;
  email: string | null;
  role: string;
  roleLabel: string;
  orgLegalName: string;
  inviterName: string;
  mfaRequired: boolean;
  expired: boolean;
  alreadyUsed: boolean;
}

export const previewInvite = (token: string): Promise<ApiResult<InvitePreview>> =>
  call(`/api/account/team/invites/preview?token=${encodeURIComponent(token)}`);

export const acceptInvite = (
  token: string,
  password: string,
): Promise<ApiResult<{ mfaRequired: boolean }>> =>
  call('/api/account/team/invites/accept', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password }),
  });
