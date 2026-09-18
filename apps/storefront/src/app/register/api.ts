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
  /**
   * Seconds until the caller may try again, off the `Retry-After` header.
   *
   * The header, not the body: `ErrorBody` deliberately drops `detail`, so
   * `RateLimitedError`'s own `retryAfterSeconds` never reaches a client any other
   * way. Null on every refusal that is not a 429 — and null on a 429 too if the
   * header went missing, because a wait we did not measure must not be drawn as
   * a number we made up.
   */
  retryAfterSeconds: number | null;
}

export type ApiResult<T> = ({ ok: true } & { data: T }) | ApiFailure;

const NETWORK_FAILURE: Omit<ApiFailure, 'ok'> = {
  status: 0,
  code: 'NETWORK',
  message: 'We could not reach the server. Your answers are still here — try again.',
  fields: {},
  retryAfterSeconds: null,
};

/**
 * Exported because it is the storefront's one browser API client, not registration's.
 * `/sign-in` (T10) and `/cart` (T15) both go through it: one place unwraps
 * `DomainExceptionFilter`'s envelope and one place reads `Retry-After`, so a
 * second copy cannot render an actionable refusal as "(422)".
 */
/**
 * Paths that must NEVER be retried after a session restore.
 *
 * Authentication routes are rate limited per identifier AND per IP, and a
 * silently replayed POST /auth/login spends two of the buyer's attempts for one
 * thing they did once — which is how somebody gets locked out for fifteen
 * minutes by a single click. A 401 from an auth route is also the answer, not a
 * symptom: "those details did not match" does not become true on a second ask.
 */
const NEVER_RETRY = ['/api/auth/'];

/**
 * The access cookie is short-lived on purpose (15 minutes) and `GET
 * /auth/session` is what rotates it — there is no separate /auth/refresh route.
 *
 * Nothing called it, so ANY authenticated screen open longer than fifteen
 * minutes told a signed-in buyer to sign in again. The cart found it first, but
 * registration is where it hurts most: seven steps that the seeded definitions
 * themselves estimate at about forty minutes, against a fifteen-minute cookie.
 * A vendor filling in facility hours would simply be thrown out mid-form.
 *
 * So the restore lives HERE, in the one client every screen already uses, rather
 * than in each screen that remembers. One restore, then replay; a second 401
 * means there is genuinely no session and the signed-out path is the right
 * answer rather than a loop.
 */
async function withSessionRestore<T>(
  path: string,
  init: RequestInit,
  first: ApiResult<T>,
): Promise<ApiResult<T>> {
  if (first.ok || first.status !== 401) return first;
  if (NEVER_RETRY.some((p) => path.startsWith(p))) return first;

  const restored = await rawCall<{ userId: string }>('/api/auth/session', { method: 'GET' });
  // Only a 401 ends the session. A restore that failed because the network
  // blinked proves nothing, so the caller gets its original refusal to report.
  if (!restored.ok) return restored.status === 401 ? sessionLost<T>() : first;

  const replay = await rawCall<T>(path, init);
  return !replay.ok && replay.status === 401 ? sessionLost<T>() : replay;
}

/**
 * The session is gone. End it, and never resolve.
 *
 * Resolving would hand the caller a 401 to render, and a 401 must never reach a
 * buyer as text: it is not something they did, it is a fifteen-minute cookie
 * that lapsed while they filled in a form the seeded step definitions estimate
 * at forty minutes. There is no honest value to return either — the request did
 * not succeed and will not. So nothing settles, no `catch` runs, no error state
 * is set, and the shell's gate moves them to the sign-in screen.
 *
 * `POST /auth/logout` is `@Public()` and answers 204 whatever happens.
 */
let signingOut = false;

function sessionLost<T>(): Promise<ApiResult<T>> {
  if (!signingOut) {
    signingOut = true;
    void rawCall('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    sessionLostHandler?.();
  }
  return new Promise<ApiResult<T>>(() => undefined);
}

/** Set by the portal shell, so this module never imports the router. */
let sessionLostHandler: (() => void) | null = null;

export function setSessionLostHandler(fn: (() => void) | null): void {
  sessionLostHandler = fn;
  // A handler arriving means a shell mounted with a live session.
  if (fn) signingOut = false;
}

export async function call<T>(path: string, init: RequestInit): Promise<ApiResult<T>> {
  return withSessionRestore(path, init, await rawCall<T>(path, init));
}

async function rawCall<T>(path: string, init: RequestInit): Promise<ApiResult<T>> {
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

  if (!res.ok) return failureFrom(res.status, body, res.headers.get('Retry-After'));

  return { ok: true, data: body as T };
}

/**
 * `DomainExceptionFilter`'s envelope, unwrapped.
 *
 * Shared with the XHR upload below rather than written twice: an upload refusal
 * carries the only wording that says *which* file was refused and why, and a
 * second copy of this unwrapping is how that message becomes "(422)".
 */
function failureFrom(status: number, body: unknown, retryAfter?: string | null): ApiFailure {
  const err = (body as { error?: { code?: string; message?: string; fields?: unknown } } | null)
    ?.error;
  const seconds = Number(retryAfter);
  return {
    ok: false,
    status,
    code: err?.code ?? 'UNKNOWN',
    message:
      err?.message ?? `That did not go through (${status}). Nothing you typed has been lost.`,
    fields: (err?.fields as Record<string, string> | undefined) ?? {},
    retryAfterSeconds: Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : null,
  };
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
  /**
   * A second factor is outstanding and every non-public route will refuse until
   * it lands. True for `MFA_REQUIRED_ROLES` — VENDOR_OWNER among them — so a
   * supplier meets this the moment their account is created.
   *
   * Trustworthy on `GET /auth/session` too, not only on the registration
   * response: that route reads it off `principal.mfaSatisfied`, which is the
   * current session cookie's own `mfa` claim — `identity.controller.ts`'s
   * `session()` used to hardcode `false` here, which is precisely how a vendor
   * could register, be told they were signed in, and have the very next call
   * refused. Fixed there; a caller that re-fetches the session after
   * `verifyMfa` — see `syncSession` in the console's `AuthContext` — gets a
   * `false` back the moment the second factor lands, with no need to infer it
   * from a 403.
   */
  mfaRequired: boolean;
  /** The signed-in user's own details — survives after the ACCOUNT draft is cleared. */
  fullName?: string;
  email?: string;
  mobile?: string;
}

/** Name, email and mobile from the account that registered — for contact prefill. */
export interface AccountHolderDetails {
  fullName: string;
  email: string;
  mobile: string;
}

export const accountHolderFromSession = (session: SessionView): AccountHolderDetails => ({
  fullName: session.fullName ?? '',
  email: session.email ?? '',
  mobile: session.mobile ?? '',
});

export const sendOtp = (channel: OtpChannel, value: string): Promise<ApiResult<OtpSent>> =>
  post<OtpSent>('/api/auth/register/otp', { channel, value });

export const verifyOtp = (
  channel: OtpChannel,
  value: string,
  code: string,
): Promise<ApiResult<OtpVerified>> =>
  post<OtpVerified>('/api/auth/register/otp/verify', { channel, value, code });

export interface RegisterInput {
  fullName: string;
  email: string;
  mobile: string;
  password: string;
}

/**
 * `orgType` decides the owner role the server grants — CUSTOMER_OWNER or
 * VENDOR_OWNER — and therefore which seven or five steps the org is given. It
 * is a parameter rather than a constant because the buyer flow and the vendor
 * flow are the same shell over the same endpoint, and a hard-coded 'BUYER' here
 * is how the second one silently registers the wrong kind of organisation.
 */
export const register = (
  orgType: 'BUYER' | 'VENDOR',
  input: RegisterInput,
): Promise<ApiResult<SessionView>> =>
  post<SessionView>('/api/auth/register', { orgType, ...input });

export const getSession = (): Promise<ApiResult<SessionView>> =>
  get<SessionView>('/api/auth/session');

/* ==========================================================================
 * Signing in — POST /api/auth/login*, /api/auth/password/*
 * ======================================================================== */

/**
 * Sign in with a password.
 *
 * The refusal is deliberately not inspected here beyond its shape. The server
 * answers a wrong password and an address it has never seen with the identical
 * 401 and the identical sentence, and a client that branched on the code to say
 * something more helpful for one of them would rebuild the enumeration oracle
 * the server went to the trouble of closing.
 */
export const login = (email: string, password: string): Promise<ApiResult<SessionView>> =>
  post<SessionView>('/api/auth/login', { email, password });

/**
 * Ask for a sign-in code — the customer path, with no password at all.
 *
 * Answers identically whether or not the address has an account, and whether or
 * not a code was actually sent. `sentTo` is a mask of what was typed, not of
 * anything we hold.
 */
export const sendLoginCode = (email: string): Promise<ApiResult<OtpSent>> =>
  post<OtpSent>('/api/auth/login/otp', { email });

export const verifyLoginCode = (email: string, code: string): Promise<ApiResult<SessionView>> =>
  post<SessionView>('/api/auth/login/otp/verify', { email, code });

export const sendPasswordResetCode = (email: string): Promise<ApiResult<OtpSent>> =>
  post<OtpSent>('/api/auth/password/forgot', { email });

/** 204 on success. Every session open at the time is signed out, including none. */
export const resetPassword = (input: {
  email: string;
  code: string;
  password: string;
}): Promise<ApiResult<null>> => post<null>('/api/auth/password/reset', input);

export const logout = (): Promise<ApiResult<null>> => post<null>('/api/auth/logout');

/* ==========================================================================
 * The second factor — POST /api/auth/mfa/*
 * ======================================================================== */

export interface MfaCodeSent {
  /** Masked by the server. Never re-derived here — see `OtpSent.sentTo`. */
  sentTo: string;
  expiresAt: string;
  resendAvailableAt: string;
  /** Non-production only. Never rendered; it exists so tests can drive the flow. */
  devCode?: string;
}

/**
 * Both routes are `@Public()` server-side, for the reason that makes them work
 * at all: the session that needs them is the one the guard is refusing. They
 * still run authenticated — the principal comes from the access cookie and the
 * refresh cookie is what `mfa/verify` rotates.
 */
export const requestMfaCode = (): Promise<ApiResult<MfaCodeSent>> =>
  post<MfaCodeSent>('/api/auth/mfa/otp');

export const verifyMfa = (code: string): Promise<ApiResult<SessionView>> =>
  post<SessionView>('/api/auth/mfa/verify', { code });

/* ==========================================================================
 * The buyer's sign-in — POST /api/auth/buyer/*
 * ======================================================================== */

/**
 * Ask for the buyer's code. `identifier` is a mobile number or a work email,
 * and the answer is the same shape whether or not anything is behind it — a
 * mask of what was typed, never of anything we hold.
 */
export const sendBuyerCode = (identifier: string): Promise<ApiResult<OtpSent>> =>
  post<OtpSent>('/api/auth/buyer/otp', { identifier });

/** The session, plus whether this code created the organisation. */
export interface BuyerSession extends SessionView {
  created: boolean;
}

export const verifyBuyerCode = (
  identifier: string,
  code: string,
): Promise<ApiResult<BuyerSession>> =>
  post<BuyerSession>('/api/auth/buyer/otp/verify', { identifier, code });

/* ==========================================================================
 * Filling in the account — PATCH /api/auth/me, POST /api/auth/contact/*
 * ======================================================================== */

export const updateMe = (fullName: string): Promise<ApiResult<SessionView>> =>
  call<SessionView>('/api/auth/me', { method: 'PATCH', body: JSON.stringify({ fullName }) });

/** A code to a FIRST email or mobile on the signed-in account. */
export const sendContactAddCode = (
  field: OtpChannel,
  value: string,
): Promise<ApiResult<OtpSent>> => post<OtpSent>('/api/auth/contact/otp', { field, value });

export const verifyContactAddCode = (
  field: OtpChannel,
  value: string,
  code: string,
): Promise<ApiResult<SessionView>> =>
  post<SessionView>('/api/auth/contact/verify', { field, value, code });

/* ==========================================================================
 * Onboarding — the stepper
 * ======================================================================== */

/**
 * The onboarding shapes moved to `@trugrade/contracts` so the supplier console
 * reads them from a package rather than by a relative path into this app.
 * Re-exported so every storefront import keeps working unchanged.
 */
import type {
  FieldRequirement,
  ResumableOnboarding,
  ReviewDecision,
  StepDefinition,
  StepProgress,
  StepStatus,
} from '@trugrade/contracts';

export type {
  FieldRequirement,
  ResumableOnboarding,
  ReviewDecision,
  StepDefinition,
  StepProgress,
  StepStatus,
};

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

/* ==========================================================================
 * Verification — POST /api/onboarding/verify/*
 * ======================================================================== */

/**
 * The five things a check can come back as.
 *
 * `PROVIDER_ERROR` and `TIMEOUT` are the same thing to the applicant and are
 * **not** failures: the portal did not answer, no attempt was consumed, and
 * there is nothing for them to correct. `willRetryAutomatically` is the flag to
 * branch on rather than the string, because it is the server's own answer to
 * "is this ours to fix".
 */
export type VerificationOutcome = 'PASS' | 'FAIL' | 'MISMATCH' | 'PROVIDER_ERROR' | 'TIMEOUT';

export interface VerificationOutcomeView {
  id: string;
  checkType: string;
  outcome: VerificationOutcome;
  /** The server's own wording. Rendered verbatim — it names what failed. */
  message: string;
  /**
   * The resolved entity. On a GSTIN this carries `legalName`, which is the
   * whole reason a tick is trustworthy: a name that is not theirs is the most
   * useful signal on this screen.
   */
  resolved?: Record<string, unknown>;
  matchScore?: number;
  attemptNo: number;
  /** Of five per day, per value. A provider error does not spend one. */
  attemptsRemaining: number;
  willRetryAutomatically: boolean;
}

/** What the GST portal returned, as far as this screen reads it. */
export interface GstinPostalAddress {
  line1: string;
  line2: string;
  city: string;
  state: string;
  pincode: string;
}

export interface GstinTaxpayer {
  legalName?: string;
  tradeName?: string;
  status?: string;
  stateCode?: string;
  registrationDate?: string;
  taxpayerType?: string;
  principalAddress?: string;
  constitutionType?: string;
  vendorCategory?: string;
  registeredAddress?: GstinPostalAddress;
}

export interface PanHolder {
  name?: string;
  status?: string;
  holderType?: string;
}

export const verifyGstin = (input: {
  gstin: string;
  expectedLegalName?: string;
  expectedPan?: string;
}): Promise<ApiResult<VerificationOutcomeView>> =>
  post<VerificationOutcomeView>('/api/onboarding/verify/gstin', input);

export const verifyPan = (input: {
  pan: string;
  expectedName?: string;
  entityType?: string;
}): Promise<ApiResult<VerificationOutcomeView>> =>
  post<VerificationOutcomeView>('/api/onboarding/verify/pan', input);

/** What the bank returned about the account, as far as this screen reads it. */
export interface BankAccountHolder {
  accountNumber?: string;
  ifsc?: string;
  /** The name the bank holds. The whole reason a penny-drop is worth doing. */
  beneficiaryName?: string;
  bankName?: string;
  branch?: string;
  creditReference?: string;
}

/**
 * The penny-drop. One rupee into the account, and the bank tells us whose it is.
 *
 * Called as the applicant fills the form, and it **does not commit anything** —
 * see `commitBankAccount` below. Same five outcomes as the GSTIN check, and the
 * same rule about the last two: a bank that did not answer is our problem, costs
 * them no attempt, and is never coloured as a refusal.
 */
export const lookupIfsc = (
  ifsc: string,
): Promise<ApiResult<{ bank: string; branch: string; city: string }>> =>
  get<{ bank: string; branch: string; city: string }>(
    `/api/onboarding/ifsc/${encodeURIComponent(ifsc.trim().toUpperCase())}`,
  );

export const pennyDrop = (input: {
  accountNumber: string;
  ifsc: string;
  /** The name the bank's answer is scored against, fuzzily. VR-026. */
  expectedName: string;
}): Promise<ApiResult<VerificationOutcomeView>> =>
  post<VerificationOutcomeView>('/api/onboarding/verify/bank', input);

/** What committing an account did, in the order the server did it. */
export interface BankAccountChangeResult {
  /** The penny-drop the server ran itself. A non-PASS means nothing below happened. */
  verification: VerificationOutcomeView;
  accountId: string | null;
  /**
   * Payouts to this account are refused by the database until this instant.
   * An anti-takeover control, not a processing delay — the screen says so.
   */
  frozenUntil: string | null;
  /** Channels the owner alert actually left by. Empty is an incident, not a state. */
  alertedVia: string[];
}

/**
 * Commit the payout account. **Deliberately not the same call as the check
 * above**, and not a flag on it.
 *
 * `verify/bank` answers "does this account exist and is it mine" and is meant to
 * be called from a form as somebody types. This one writes the account, starts a
 * payout freeze and alerts the org's owner on every channel they hold — because
 * the threat it defends against is not a typo, it is somebody with a session
 * redirecting the payout account to their own. Folding the two together would
 * mean a mistyped-then-corrected account number freezes a vendor's payouts.
 *
 * It runs its own penny-drop before writing anything, so committing costs a
 * second attempt against the five-a-day limit.
 */
export const commitBankAccount = (input: {
  accountNumber: string;
  ifsc: string;
  accountHolderName: string;
  accountType: 'CURRENT' | 'SAVINGS' | 'CC' | 'OD';
  /**
   * A code from `requestBankChangeCode`. The server refuses every change without
   * one, for every role. Optional here only because the retired storefront vendor
   * step still compiles against this client; it is unreachable and is refused.
   */
  otpCode?: string;
}): Promise<ApiResult<BankAccountChangeResult>> =>
  post<BankAccountChangeResult>('/api/onboarding/bank-account', input);

export interface BankChangeCodeSent {
  /** Masked by the server. */
  sentTo: string;
  expiresAt: string;
  resendAvailableAt: string;
  /** Only while the server's OTP_DEV_CODE_IN_RESPONSE is on. */
  devCode?: string;
}

/** Ask for the code that confirms a payout account change, sent to the person asking. */
export const requestBankChangeCode = (): Promise<ApiResult<BankChangeCodeSent>> =>
  post<BankChangeCodeSent>('/api/onboarding/bank-account/otp');

/** One row of this org's own attempt history, masked exactly as a reviewer sees it. */
export interface VerificationAttempt {
  id: string;
  checkType: string;
  outcome: string;
  maskedInput: string;
  provider: string;
  failureReason: string | null;
  attemptNo: number;
  checkedAt: string;
}

export const getVerifications = (): Promise<ApiResult<VerificationAttempt[]>> =>
  get<VerificationAttempt[]>('/api/onboarding/verifications');

/* ==========================================================================
 * Submission — POST /api/onboarding/submit
 * ======================================================================== */

/**
 * Starts the review SLA clock and returns the date it is due.
 *
 * A 409 comes back naming the steps that are not finished, in `message`. That
 * refusal is the same list the review screen already renders, so it is shown as
 * written rather than replaced with "please complete all steps".
 */
export const submitForReview = (): Promise<ApiResult<{ slaDueAt: string }>> =>
  post<{ slaDueAt: string }>('/api/onboarding/submit');

/* ==========================================================================
 * Documents — GET/POST/DELETE /api/onboarding/documents
 * ======================================================================== */

/**
 * One row of `kyc.document_type_rule`. **Data, not a constant.**
 *
 * The label, the age rule, how many files of this type are allowed and the size
 * cap are all the server's, so ops can add a document type or change a rule
 * without a release — and so the screen never asks for a document we stopped
 * needing, or promises a cap that has moved.
 */
export interface DocumentTypeRule {
  docType: string;
  label: string;
  /** NULL means the document does not go stale. A GST certificate never does. */
  maxAgeDays: number | null;
  requiresExpiry: boolean;
  maxFiles: number;
  maxBytes: number;
  acceptedMime: string[];
}

export type DocumentStatus = 'UPLOADED' | 'UNDER_REVIEW' | 'VERIFIED' | 'REJECTED' | 'EXPIRED';

export interface KycDocument {
  id: string;
  docType: string;
  label: string;
  originalFilename: string | null;
  mime: string;
  sizeBytes: number;
  status: DocumentStatus;
  documentDate: string | null;
  /** NULL for a PDF, which has no EXIF. Never rendered as a tick when NULL. */
  exifStrippedAt: string | null;
  /** NULL until a scanner exists — "not scanned", never "clean". */
  avVerdict: string | null;
  /** The reviewer's own words. Rendered verbatim. */
  rejectionReason: string | null;
  reviewNote: string | null;
  expiresOn: string | null;
  uploadedAt: string;
}

export const getDocumentTypes = (): Promise<ApiResult<DocumentTypeRule[]>> =>
  get<DocumentTypeRule[]>('/api/onboarding/documents/types');

export interface PincodeArea {
  value: string;
  label: string;
}

export interface PincodeLookup {
  pincode: string;
  stateCode: string;
  stateName: string;
  areas: PincodeArea[];
}

export const lookupPincode = (pincode: string): Promise<ApiResult<PincodeLookup>> =>
  get<PincodeLookup>(`/api/onboarding/pincodes/${encodeURIComponent(pincode)}`);

export const getDocuments = (): Promise<ApiResult<KycDocument[]>> =>
  get<KycDocument[]>('/api/onboarding/documents');

export const deleteDocument = (documentId: string): Promise<ApiResult<null>> =>
  call<null>(`/api/onboarding/documents/${documentId}`, { method: 'DELETE' });

export const getDocumentUrl = (
  documentId: string,
): Promise<ApiResult<{ url: string; expiresInSeconds: number }>> =>
  get<{ url: string; expiresInSeconds: number }>(`/api/onboarding/documents/${documentId}/url`);

/**
 * Upload one file, with progress.
 *
 * `XMLHttpRequest` rather than `fetch` for one reason: fetch has no upload
 * progress event, and the step promises a per-file percentage. One request per
 * file, so each file carries its own progress and its own refusal — a batch
 * endpoint would have to invent a partial-success shape.
 *
 * **Nothing here decides whether the bytes are acceptable.** The magic-byte
 * sniff, the size cap, the EXIF strip, the active-content check and the age rule
 * all live in `DocumentService`, and its message is what the applicant reads.
 */
export function uploadDocument(input: {
  docType: string;
  file: File;
  /** `YYYY-MM-DD`, only for a type the rule table gives a `maxAgeDays`. */
  documentDate?: string;
  onProgress?: (pct: number) => void;
}): Promise<ApiResult<KycDocument>> {
  return uploadDocumentOnce(input).then(async (first) => {
    if (first.ok || first.status !== 401) return first;
    const restored = await getSession();
    return restored.ok ? uploadDocumentOnce(input) : first;
  });
}

function uploadDocumentOnce(input: {
  docType: string;
  file: File;
  documentDate?: string;
  onProgress?: (pct: number) => void;
}): Promise<ApiResult<KycDocument>> {
  return new Promise((resolve) => {
    const form = new FormData();
    form.append('docType', input.docType);
    if (input.documentDate) form.append('documentDate', input.documentDate);
    // Last, and named `file`: `FileInterceptor('file')` reads this field.
    form.append('file', input.file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/onboarding/documents');
    xhr.withCredentials = true;

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !input.onProgress) return;
      input.onProgress(Math.round((event.loaded / event.total) * 100));
    };

    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText) as unknown;
      } catch {
        body = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ ok: true, data: body as KycDocument });
        return;
      }
      resolve(failureFrom(xhr.status, body, xhr.getResponseHeader('Retry-After')));
    };

    // A dropped connection is not a refusal of the file — it says so, and the
    // file stays in the list so it can be retried without picking it again.
    xhr.onerror = () => resolve({ ok: false, ...NETWORK_FAILURE });
    xhr.onabort = () => resolve({ ok: false, ...NETWORK_FAILURE });

    xhr.send(form);
  });
}
