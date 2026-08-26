/**
 * Domain errors.
 *
 * Two audiences, always: `message` is what a person reads and must be specific
 * enough to act on (08 §8 rule 2 — "Address proof is dated Jan 2025. We need one
 * from the last 3 months.", never "Document rejected."); `detail` is what an
 * engineer reads and never reaches a response body.
 *
 * VR-META-03 forbids stack detail, SQL, internal ids and vendor identity in
 * anything the user sees, so the split is structural rather than a convention.
 */

export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'UNAUTHENTICATED'
  | 'CONFLICT'
  | 'ILLEGAL_STATE_TRANSITION'
  | 'INSUFFICIENT_STOCK'
  | 'RATE_LIMITED'
  | 'PROVIDER_ERROR'
  | 'PROVIDER_TIMEOUT'
  | 'PRECONDITION_FAILED'
  | 'INTERNAL';

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  /** Engineer-facing context. Logged, never serialised to a client. */
  readonly detail?: Record<string, unknown>;
  /** Field-level messages for a form, keyed by field path. */
  readonly fields?: Record<string, string>;

  constructor(
    code: ErrorCode,
    httpStatus: number,
    message: string,
    opts: {
      detail?: Record<string, unknown>;
      fields?: Record<string, string>;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: opts.cause });
    this.name = new.target.name;
    this.code = code;
    this.httpStatus = httpStatus;
    this.detail = opts.detail;
    this.fields = opts.fields;
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, fields?: Record<string, string>) {
    super('VALIDATION_FAILED', 422, message, { fields });
  }
}

export class NotFoundError extends DomainError {
  /**
   * Deliberately does not name the entity type or id in the user-facing message.
   * "Order 8f3c… not found" tells an attacker probing ids that everything else
   * they tried *does* exist.
   */
  constructor(what: string, detail?: Record<string, unknown>) {
    super('NOT_FOUND', 404, `We couldn't find that ${what}.`, { detail });
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = "You don't have permission to do that.", detail?: Record<string, unknown>) {
    super('FORBIDDEN', 403, message, { detail });
  }
}

export class UnauthenticatedError extends DomainError {
  constructor(message = 'Please sign in to continue.') {
    super('UNAUTHENTICATED', 401, message);
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, detail?: Record<string, unknown>) {
    super('CONFLICT', 409, message, { detail });
  }
}

/** VR-157. Carries from/to so the audit log records the attempted transition. */
export class IllegalStateTransitionError extends DomainError {
  constructor(
    readonly entity: string,
    readonly from: string,
    readonly to: string,
  ) {
    super('ILLEGAL_STATE_TRANSITION', 409, "That action isn't available from the current status.", {
      detail: { entity, from, to },
    });
  }
}

export class InsufficientStockError extends DomainError {
  constructor(requested: number, available: number, where: string) {
    super(
      'INSUFFICIENT_STOCK',
      409,
      available === 0
        ? `Those units have just been taken. Nothing is available at ${where} right now.`
        : `Only ${available} of the ${requested} units you selected are still available at ${where}.`,
      { detail: { requested, available, where } },
    );
  }
}

export class RateLimitedError extends DomainError {
  constructor(retryAfterSeconds: number, message = 'Too many requests. Please try again shortly.') {
    super('RATE_LIMITED', 429, message, { detail: { retryAfterSeconds } });
  }
}

/**
 * The distinction that matters most in Indian KYC UX (PHASE_01 Task 5):
 * a PROVIDER_ERROR is *our* problem, a FAIL is the applicant's. Conflating them
 * makes people re-upload documents pointlessly.
 */
export class ProviderError extends DomainError {
  constructor(
    readonly provider: string,
    detail?: Record<string, unknown>,
    readonly isTimeout = false,
  ) {
    super(
      isTimeout ? 'PROVIDER_TIMEOUT' : 'PROVIDER_ERROR',
      502,
      "We couldn't reach that service just now. We'll retry automatically — there's nothing for you to do.",
      { detail: { provider, ...detail } },
    );
  }
}

export class PreconditionFailedError extends DomainError {
  constructor(message: string, detail?: Record<string, unknown>) {
    super('PRECONDITION_FAILED', 412, message, { detail });
  }
}
