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

  if (!res.ok) return failureFrom(res.status, body);

  return { ok: true, data: body as T };
}

/**
 * `DomainExceptionFilter`'s envelope, unwrapped.
 *
 * Shared with the XHR upload below rather than written twice: an upload refusal
 * carries the only wording that says *which* file was refused and why, and a
 * second copy of this unwrapping is how that message becomes "(422)".
 */
function failureFrom(status: number, body: unknown): ApiFailure {
  const err = (body as { error?: { code?: string; message?: string; fields?: unknown } } | null)
    ?.error;
  return {
    ok: false,
    status,
    code: err?.code ?? 'UNKNOWN',
    message:
      err?.message ?? `That did not go through (${status}). Nothing you typed has been lost.`,
    fields: (err?.fields as Record<string, string> | undefined) ?? {},
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
   * **Trustworthy on the registration response, not on `GET /auth/session`**:
   * that route reports `false` whenever a principal resolves, and it resolves
   * for a session whose token says `mfa: false`. Reported. On a resumed session
   * the 403 from the first onboarding call is what tells us instead.
   */
  mfaRequired: boolean;
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

/**
 * A field this org must supply on a step, after the constitution gate.
 * `onboarding_field_requirement` data — CIN for a private limited company, an
 * LLPIN for an LLP, and nothing at all for a proprietorship.
 */
export interface FieldRequirement {
  fieldCode: string;
  label: string;
  required: boolean;
  helpText: string | null;
}

export interface StepProgress extends StepDefinition {
  isRequired: boolean;
  status: StepStatus;
  completionPct: number;
  /** Verbatim from the reviewer. Rendered as written, never summarised. */
  blockingReason: string | null;
  lastSavedAt: string | null;
  /** Already gated by constitution: render these, do not re-derive them. */
  fields: FieldRequirement[];
}

export interface ResumableOnboarding {
  orgId: string;
  /** `org_status`: REGISTERED → KYC_SUBMITTED → UNDER_REVIEW → VERIFIED / REJECTED. */
  status: string;
  /** Set by `POST /submit`. The promise made to the applicant, in working hours. */
  slaDueAt: string | null;
  /** The server's own answer, not a clock comparison done here. */
  slaBreached: boolean;
  progress: {
    /** `constitution_type`, the org's own. Survives step 2's draft being cleared. */
    constitution: string | null;
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
export interface GstinTaxpayer {
  legalName?: string;
  tradeName?: string;
  status?: string;
  stateCode?: string;
  registrationDate?: string;
  taxpayerType?: string;
  principalAddress?: string;
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
}): Promise<ApiResult<BankAccountChangeResult>> =>
  post<BankAccountChangeResult>('/api/onboarding/bank-account', input);

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

export const getDocuments = (): Promise<ApiResult<KycDocument[]>> =>
  get<KycDocument[]>('/api/onboarding/documents');

export const deleteDocument = (documentId: string): Promise<ApiResult<null>> =>
  call<null>(`/api/onboarding/documents/${documentId}`, { method: 'DELETE' });

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
      resolve(failureFrom(xhr.status, body));
    };

    // A dropped connection is not a refusal of the file — it says so, and the
    // file stays in the list so it can be retried without picking it again.
    xhr.onerror = () => resolve({ ok: false, ...NETWORK_FAILURE });
    xhr.onabort = () => resolve({ ok: false, ...NETWORK_FAILURE });

    xhr.send(form);
  });
}
