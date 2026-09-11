import { refreshSession } from '../../lib/auth';

export interface TeamMember {
  id: string;
  fullName: string;
  email: string | null;
  mobile: string | null;
  jobTitle: string | null;
  department: string | null;
  status: string;
  isOrgOwner: boolean;
  roles: string[];
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  isYou: boolean;
  lockedReason: string | null;
}

export interface TeamRole {
  code: string;
  description: string | null;
  permissions: string[];
  assignable: boolean;
}

export interface Team {
  members: TeamMember[];
  roles: TeamRole[];
  owners: number;
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
      const fields =
        body.fields && typeof body.fields === 'object' && !Array.isArray(body.fields)
          ? (body.fields as Record<string, string>)
          : {};
      return {
        ok: false,
        status: res.status,
        message:
          typeof body.message === 'string'
            ? body.message
            : `Request failed (${res.status})`,
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

export const getTeam = (): Promise<ApiResult<Team>> =>
  call<Team>('/api/account/team', { method: 'GET' });

export interface CreateMemberBody {
  fullName: string;
  email: string;
  mobile: string;
  jobTitle: string;
  department?: string | null;
  roles: string[];
  password: string;
}

export const createMember = (body: CreateMemberBody): Promise<ApiResult<TeamMember>> =>
  call<TeamMember>('/api/account/team/members', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

export const updateMember = (
  userId: string,
  body: {
    roles?: string[];
    permissions?: string[];
    status?: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
  },
): Promise<ApiResult<TeamMember>> =>
  call<TeamMember>(`/api/account/team/${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

export const setMemberPassword = (
  userId: string,
  password: string,
): Promise<ApiResult<{ ok: true }>> =>
  call<{ ok: true }>(`/api/account/team/${userId}/password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });

export const resetMemberMfa = (userId: string): Promise<ApiResult<TeamMember>> =>
  call<TeamMember>(`/api/account/team/${userId}/mfa-reset`, { method: 'POST' });
