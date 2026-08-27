/**
 * The browser half of registration.
 *
 * Everything goes through the same-origin `/api` rewrite so the refresh cookie
 * stays first-party and `httpOnly`. The access token in a register/login
 * response body is deliberately never stored: a token held in JS is a token
 * handed to the first XSS that lands, and the cookie the server just set is
 * what authenticates the next request anyway.
 *
 * Each call returns a discriminated result rather than throwing. A registration
 * form has to render every refusal — a burnt OTP attempt, an address already in
 * use, a GST portal that timed out — beside the field that caused it, and an
 * exception is the wrong shape for that.
 */

/** `DomainExceptionFilter` renders every refusal in this envelope. */
export interface ApiFailure {
  ok: false;
  status: number;
  code: string;
  message: string;
  /** Field code → message, straight from Zod or from the domain error. */
  fields: Record<string, string>;
}

export type ApiResult<T> = ({ ok: true } & { data: T }) | ApiFailure;

const NETWORK_FAILURE: Omit<ApiFailure, 'ok'> = {
  status: 0,
  code: 'NETWORK',
  message: 'We could not reach the server. Your answers are still here — try again.',
  fields: {},
};

async function call<T>(path: string, init: RequestInit): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
  } catch {
    return { ok: false, ...NETWORK_FAILURE };
  }

  const body: unknown = res.status === 204 ? null : await res.json().catch(() => null);

  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string; fields?: unknown } } | null)
      ?.error;
    return {
      ok: false,
      status: res.status,
      code: err?.code ?? 'UNKNOWN',
      message:
        err?.message ??
        `That did not go through (${res.status}). Nothing you typed has been lost.`,
      fields: (err?.fields as Record<string, string> | undefined) ?? {},
    };
  }

  return { ok: true, data: body as T };
}

const post = <T>(path: string, body?: unknown): Promise<ApiResult<T>> =>
  call<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

const put = <T>(path: string, body: unknown): Promise<ApiResult<T>> =>
  call<T>(path, { method: 'PUT', body: JSON.stringify(body) });

const get = <T>(path: string): Promise<ApiResult<T>> => call<T>(path, { method: 'GET' });

/* ==========================================================================
 * Identity — POST /api/auth/*
 * ======================================================================== */

export type OtpChannel = 'EMAIL' | 'MOBILE';

export interface OtpSent {
  channel: OtpChannel;
  /** Masked by the server: `pri****@ac**.in`. We never re-derive it. */
  sentTo: string;
  expiresAt: string;
  resendAvailableAt: string;
  /** Non-production only. Never rendered — it exists so tests can drive the flow. */
  devCode?: string;
}

export interface OtpVerified {
  channel: OtpChannel;
  value: string;
  verified: true;
  proofExpiresAt: string;
}

export interface SessionView {
  userId: string;
  orgId: string | null;
  orgType: 'VENDOR' | 'BUYER' | 'INTERNAL';
  roles: string[];
  permissions: string[];
}

export const sendOtp = (channel: OtpChannel, value: string): Promise<ApiResult<OtpSent>> =>
  post<OtpSent>('/api/auth/register/otp', { channel, value });

export const verifyOtp = (
  channel: OtpChannel,
  value: string,
  code: string,
): Promise<ApiResult<OtpVerified>> =>
  post<OtpVerified>('/api/auth/register/otp/verify', { channel, value, code });

export interface RegisterInput {
  companyName: string;
  fullName: string;
  email: string;
  mobile: string;
  password: string;
}

/** BUYER only from this screen. A vendor registers through its own seven-step flow. */
export const register = (input: RegisterInput): Promise<ApiResult<SessionView>> =>
  post<SessionView>('/api/auth/register', { orgType: 'BUYER', ...input });

export const getSession = (): Promise<ApiResult<SessionView>> =>
  get<SessionView>('/api/auth/session');

/* ==========================================================================
 * Onboarding — the stepper
 * ======================================================================== */

/** A step as defined, before any org has answered it. `GET /onboarding/steps/definitions`. */
export interface StepDefinition {
  stepCode: string;
  stepOrder: number;
  title: string;
  purposeNote: string | null;
  estimatedMinutes: number | null;
}

export type StepStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'SUBMITTED' | 'NEEDS_FIX' | 'COMPLETE';

export interface StepProgress extends StepDefinition {
  isRequired: boolean;
  status: StepStatus;
  completionPct: number;
  /** Verbatim from the reviewer. Rendered as written, never summarised. */
  blockingReason: string | null;
  lastSavedAt: string | null;
}

export interface ResumableOnboarding {
  orgId: string;
  status: string;
  progress: {
    steps: StepProgress[];
    /** Where the client lands: the first required step that is not COMPLETE. */
    resumeAt: string | null;
    completedSteps: number;
    requiredSteps: number;
    isSubmittable: boolean;
  };
  answers: Record<string, Record<string, unknown>>;
}

export const startOnboarding = (): Promise<ApiResult<null>> => post<null>('/api/onboarding/start');

export const getOnboarding = (): Promise<ApiResult<ResumableOnboarding>> =>
  get<ResumableOnboarding>('/api/onboarding/steps');

/**
 * Save a partial draft. Called on blur, not only on Next — the whole promise of
 * the rail ("close this and come back") is false if a draft is written once at
 * the end of a step.
 */
export const saveStep = (
  stepCode: string,
  answers: Record<string, unknown>,
  completionPct: number,
): Promise<ApiResult<null>> =>
  put<null>(`/api/onboarding/steps/${stepCode}`, { answers, completionPct });

export const completeStep = (stepCode: string): Promise<ApiResult<null>> =>
  post<null>(`/api/onboarding/steps/${stepCode}/complete`);
