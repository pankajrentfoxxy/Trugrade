import { Body, Controller, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { uuidSchema, type Permission, type Role } from '@trugrade/contracts';
import { Public } from '../../shared/auth/guards';
import { ZodValidationPipe } from '../../shared/http/http';
import { UnauthenticatedError, ValidationError } from '../../shared/errors/domain-errors';
import { RequestContextService } from '../../shared/db/org-scope';
import { TokenService, type IssuedTokens } from '../../shared/auth/token.service';
import { AppConfig } from '../../shared/config';
import { ClockPort } from '../../shared/clock';
import { RateLimiter, type RateLimitRule } from '../../shared/redis/redis.service';
import { IdentityService, type OrgType } from './identity.service';
import { OtpService } from './internal/otp.service';
import { AuditService, maskValue } from './internal/audit.service';
import {
  ContactChangeService,
  type ContactChangeView,
} from './internal/contact-change.service';
import {
  contactChangeCancelSchema,
  contactChangeRequestSchema,
  contactChangeVerifySchema,
  loginSchema,
  mfaVerifySchema,
  registerSchema,
  registrationOtpSchema,
  registrationOtpVerifySchema,
  type ContactChangeCancelDto,
  type ContactChangeRequestDto,
  type ContactChangeVerifyDto,
  type LoginDto,
  type MfaVerifyDto,
  type RegisterDto,
  type RegistrationOtpDto,
  type RegistrationOtpVerifyDto,
} from './dto/identity.dto';

/** Ten new organisations a day from one address is already generous. */
const REGISTER_LIMIT: RateLimitRule = { name: 'auth-register', limit: 10, windowSeconds: 86_400 };

/**
 * The per-IP half of the registration-OTP limits.
 *
 * `OtpService` already limits per *target* — 60 s cooldown, 5 an hour, 20 a day
 * — and that is the right defence against someone hammering one address. It is
 * no defence at all against the attack these two routes actually invite: an
 * unauthenticated caller walking a list of mobile numbers, one code each, never
 * touching the same target twice. Every one of those costs us an SMS. So the
 * budget that catches it has to be keyed on the caller, not on the target.
 *
 * Twenty an hour is roughly a shared office getting through a signup day; two
 * hundred is a script.
 */
const REGISTER_OTP_IP_LIMIT: RateLimitRule = {
  name: 'auth-register-otp-ip',
  limit: 20,
  windowSeconds: 3600,
};

/** Twice the send budget: a person who mistypes a code twice is normal. */
const REGISTER_OTP_VERIFY_IP_LIMIT: RateLimitRule = {
  name: 'auth-register-otp-verify-ip',
  limit: 40,
  windowSeconds: 3600,
};

/**
 * How long a verified channel stays proof.
 *
 * Longer than the OTP's own five minutes because the code is verified at the
 * TOP of registration step 1 and `POST /auth/register` is called at the bottom
 * of it — with a company name, a full name and a password chosen in between.
 * Five minutes there means a person who reads the password rules loses their
 * verification. Half an hour is still far short of "an unattended tab tomorrow".
 */
const REGISTRATION_PROOF_SECONDS = 1_800;

/** Free-form per `NotificationPort`, like `LOGIN_OTP_TEMPLATE` below. */
const REGISTER_OTP_TEMPLATE = 'AUTH_REGISTER_OTP';

/**
 * Sign in, sign out, and "who am I" — the routes every other route depends on
 * existing.
 *
 * **Where the tokens live.** The access token is a 15-minute RS256 JWT and the
 * refresh token is an opaque, rotating secret. Both go back as `httpOnly`
 * cookies, and the access token is *also* in the response body. That is not
 * belt-and-braces for its own sake — they serve two different clients. A browser
 * cannot be trusted to hold a token in JS (an XSS reads `localStorage` and
 * replays it for a month), so the console and the storefront authenticate by
 * cookie and never touch a token; the technician app and any server-to-server
 * caller take the body's `accessToken` and send `Authorization: Bearer`, which
 * is the path `AuthGuard` checks first.
 *
 * Cookie CSRF is closed off by `SameSite=Lax` — a cross-site POST carries no
 * cookie — plus the credentialed, origin-pinned CORS policy in `main.ts`. There
 * is deliberately no CSRF token on top: a second mechanism that is only correct
 * while the first one is redundant is a second thing to get wrong.
 *
 * **Why the access cookie expires slightly early.** `AuthGuard` throws on an
 * *invalid* token even on a `@Public()` route, so a stale `tg_access` cookie
 * still being sent would make `GET /auth/session` 401 before the refresh cookie
 * ever got a look — and session restore on reload is the one thing that must
 * work from the refresh cookie alone. Giving the cookie a `Max-Age` a little
 * shorter than the token's lifetime makes the browser drop it first. `Max-Age`
 * is a duration the browser measures from receipt, so unlike an `Expires` date
 * it is immune to a skewed client clock.
 *
 * **What is not here.** Rate limiting, lockout, the constant-time miss and the
 * login audit trail all live in `IdentityService.loginWithPassword` (VR-060),
 * where they are covered by that service's tests and cannot be skipped by a
 * second caller. A controller re-implementing any of them would be a second copy
 * of a security rule, which is much the same as not having one.
 */

const ACCESS_COOKIE = 'tg_access';
const REFRESH_COOKIE = 'tg_refresh';

/**
 * The refresh cookie is scoped to the only paths that may present it. A cookie
 * sent on every API call leaks through every logging proxy and every mis-scoped
 * subresource; this one rides along on four routes.
 */
const REFRESH_COOKIE_PATH = '/api/auth';

/** Absorbs request latency, so the browser never sends a token the server has just aged out. */
const ACCESS_COOKIE_SKEW_SECONDS = 30;

/** Free-form per `NotificationPort`; the template body itself lives with the provider. */
const LOGIN_OTP_TEMPLATE = 'AUTH_LOGIN_OTP';

/**
 * Exactly the shape `apps/console/src/lib/auth.tsx` types as `Principal`, plus
 * the fields a non-browser client needs. Built field by field: this is the one
 * response in the app that describes the caller to themselves, and a spread of
 * an internal object here is how an internal flag becomes a public contract.
 */
export interface SessionResponse {
  userId: string;
  orgId: string | null;
  orgType: OrgType;
  roles: Role[];
  permissions: Permission[];
  /** True while this session still owes a second factor. See the MFA section. */
  mfaRequired: boolean;
  /** For a Bearer client. Browsers ignore it and use the cookie. */
  accessToken?: string;
  fullName?: string;
}

/** The wire shape of a contact-change request. Neither address appears in full. */
export interface ContactChangeResponse {
  requestId: string;
  field: 'EMAIL' | 'MOBILE';
  oldValueMasked: string;
  newValueMasked: string;
  oldVerified: boolean;
  newVerified: boolean;
  status: string;
  expiresAt: string;
  /** True only once BOTH codes have landed and the account column has moved. */
  completed: boolean;
  /** Non-production only, straight from `OtpService`. */
  devCodes?: { old?: string; new?: string };
}

/**
 * The answer to "send a code to this address", and deliberately the SAME answer
 * whether the address is already registered or not.
 *
 * Nothing in this shape is derived from a lookup, because no lookup happens. That
 * is the point: an unauthenticated route that answers differently for a known
 * address is a directory of our vendors, and vendor anonymity is the property
 * this business is built on. A competitor who can ask "is this dealer on
 * Trugrade" one address at a time has our supplier list.
 */
export interface RegistrationOtpResponse {
  channel: 'EMAIL' | 'MOBILE';
  /** Masked. The caller typed it, so this is a confirmation, not a disclosure. */
  sentTo: string;
  expiresAt: string;
  resendAvailableAt: string;
  /** Non-production only, straight from `OtpService`. */
  devCode?: string;
}

export interface RegistrationOtpVerifiedResponse {
  channel: 'EMAIL' | 'MOBILE';
  /**
   * The normalised value, echoed back so the client posts the identical string
   * to `POST /auth/register`. `+91` is added here, not in the browser.
   */
  value: string;
  verified: true;
  /** After this, the channel must be verified again. */
  proofExpiresAt: string;
}

@Controller('auth')
export class IdentityController {
  constructor(
    private readonly identity: IdentityService,
    private readonly tokens: TokenService,
    private readonly otp: OtpService,
    private readonly contactChange: ContactChangeService,
    private readonly audit: AuditService,
    private readonly ctx: RequestContextService,
    private readonly config: AppConfig,
    private readonly limiter: RateLimiter,
    private readonly clock: ClockPort,
  ) {}

  // -------------------------------------------------------------------------
  // Registration-time contact verification
  // -------------------------------------------------------------------------
  //
  // `mfa/otp` and `mfa/verify` below cannot serve this. They read the principal
  // out of the request context to decide where to send the code, and an
  // applicant has no principal, no user row and no org — there is nothing for
  // them to be the second factor OF. So these two are the same OTP primitive
  // pointed at a bare address instead of at an account.
  //
  // Being `@Public()` is what makes them dangerous, and the two hazards are
  // different from each other:
  //
  //   1. **Cost.** Every call sends an SMS we pay for. `OtpService` caps a
  //      single target; `REGISTER_OTP_IP_LIMIT` caps a caller walking a list.
  //   2. **Enumeration.** Neither route looks the address up, so neither can
  //      leak whether it is registered. The response is assembled from the
  //      request and the clock, and nothing else.
  //
  // Whether the address is already in use is answered by `POST /auth/register`,
  // to someone who has just proved they can read that mailbox.

  /**
   * Send a six-digit code to a work email or an Indian mobile.
   *
   * A resend is the same call again; `OtpService` supersedes the live code and
   * refuses inside the 60-second cooldown with the remaining time in the
   * message. There is no separate resend route, because a second route is a
   * second place for the cooldown to be forgotten.
   */
  @Post('register/otp')
  @Public()
  @HttpCode(200)
  async sendRegistrationOtp(
    @Body(new ZodValidationPipe(registrationOtpSchema)) body: RegistrationOtpDto,
  ): Promise<RegistrationOtpResponse> {
    const ctx = this.ctx.get();
    await this.limiter.consume(REGISTER_OTP_IP_LIMIT, ctx?.ip ?? 'unknown');

    const issued = await this.otp.issue({
      target: body.value,
      purpose: 'REGISTRATION',
      channel: body.channel === 'EMAIL' ? 'EMAIL' : 'SMS',
      templateCode: REGISTER_OTP_TEMPLATE,
      isProduction: this.config.isProduction,
    });

    return {
      channel: body.channel,
      sentTo: maskValue(body.value),
      expiresAt: issued.expiresAt.toISOString(),
      resendAvailableAt: issued.resendAvailableAt.toISOString(),
      ...(issued.devCode ? { devCode: issued.devCode } : {}),
    };
  }

  /**
   * Check the code. A wrong one burns an attempt, an expired one says so.
   *
   * Nothing is written here beyond the OTP row's own `consumed_at` — and that
   * row IS the record that the channel is verified. There is no account to hang
   * a flag on yet, and inventing a "pending registration" table to hold for
   * thirty minutes what `otp_request` already holds durably would be a second
   * source of truth about the same fact. `POST /auth/register` reads it back
   * through `wasRecentlyVerified` and refuses without it, which is what makes
   * this route mean something rather than being a screen that says "verified".
   */
  @Post('register/otp/verify')
  @Public()
  @HttpCode(200)
  async verifyRegistrationOtp(
    @Body(new ZodValidationPipe(registrationOtpVerifySchema)) body: RegistrationOtpVerifyDto,
  ): Promise<RegistrationOtpVerifiedResponse> {
    const ctx = this.ctx.get();
    await this.limiter.consume(REGISTER_OTP_VERIFY_IP_LIMIT, ctx?.ip ?? 'unknown');

    await this.otp.verify({ target: body.value, purpose: 'REGISTRATION', code: body.code });

    return {
      channel: body.channel,
      value: body.value,
      verified: true,
      proofExpiresAt: new Date(
        this.clock.nowMs() + REGISTRATION_PROOF_SECONDS * 1000,
      ).toISOString(),
    };
  }

  // -------------------------------------------------------------------------
  // Password sign-in
  // -------------------------------------------------------------------------

  /**
   * 200, not 201. Nothing was created at a URL the client could go and fetch,
   * and a 201 without a `Location` is a lie some HTTP clients act on.
   */
  /**
   * Create an organisation and its owner account, then sign them straight in.
   *
   * The service half of this has existed since Phase 1 —
   * `createOrganizationWithOwner` builds the org, the owner, the role grant and
   * the password in one transaction — but nothing ever exposed it over HTTP, so
   * the platform had no way to make an account at all. Every "sign up" button
   * pointed at a page that could not have worked.
   *
   * It logs the caller in on success rather than bouncing them to a sign-in
   * form. They have just proved they know the password by choosing it, and a
   * registration that ends at a login screen is a registration a third of people
   * abandon.
   *
   * `orgType` decides the owner role: VENDOR_OWNER or CUSTOMER_OWNER. There is
   * no third option, and an INTERNAL account is never self-served.
   */
  @Post('register')
  @Public()
  @HttpCode(201)
  async register(
    @Body(new ZodValidationPipe(registerSchema)) body: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse> {
    const ctx = this.ctx.get();
    // Same limiter as the lead form: registration is a write that creates two
    // rows and sends nothing, which makes it worth abusing.
    await this.limiter.consume(REGISTER_LIMIT, ctx?.ip ?? 'unknown');

    await this.assertContactsVerified(body.email, body.mobile);

    await this.identity.createOrganizationWithOwner({
      orgType: body.orgType,
      legalName: body.companyName,
      fullName: body.fullName,
      email: body.email,
      mobile: body.mobile,
      password: body.password,
    });

    const { tokens, user, mfaRequired } = await this.identity.loginWithPassword({
      identifier: body.email,
      password: body.password,
      ip: ctx?.ip,
      userAgent: ctx?.userAgent,
    });

    this.setSessionCookies(res, tokens);
    return {
      ...principalOf(user),
      mfaRequired,
      accessToken: tokens.accessToken,
      fullName: user.fullName,
    };
  }

  @Post('login')
  @Public()
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse> {
    const ctx = this.ctx.get();
    const { tokens, user, mfaRequired } = await this.identity.loginWithPassword({
      identifier: body.email,
      password: body.password,
      ip: ctx?.ip,
      userAgent: ctx?.userAgent,
    });

    this.setSessionCookies(res, tokens);
    return {
      ...principalOf(user),
      mfaRequired,
      accessToken: tokens.accessToken,
      fullName: user.fullName,
    };
  }

  /**
   * Session restore, and the only route the console calls on a cold load.
   *
   * Two paths. With a live access token the answer is already in the request —
   * the guard verified it and put the principal in the context, so this is a
   * pure read. Without one, the refresh cookie is rotated and a fresh pair
   * issued, which is what makes a reload after fifteen idle minutes silent.
   *
   * The roles and permissions returned are the ones *in the token*, not a fresh
   * read of the database, and that is deliberate: they are precisely what the
   * guards will enforce for the rest of this token's life. A console drawing its
   * menu from a newer picture than the API enforces shows buttons that 403. The
   * next rotation reconciles the two.
   *
   * ponytail: rotation has no grace window, so two tabs restoring in the same
   * instant after an idle period can trip refresh-reuse detection and sign the
   * user out. Rare by construction — rotation only happens once the access
   * cookie is gone. The fix, if it ever reaches support, is a few seconds of
   * tolerance for the previous token inside `TokenService.rotate`, not a lock
   * here.
   */
  @Get('session')
  @Public()
  async session(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse> {
    const principal = this.ctx.principal;
    if (principal) {
      // `mfaRequired` comes off the principal, not hardcoded false.
      //
      // It used to be false here unconditionally, which made this route lie
      // about the one session it exists to describe. This is a @Public() route,
      // so a principal reaches it having skipped `PermissionsGuard`'s MFA check
      // — precisely the session that still owes a second factor. Every guarded
      // route then 403s with `mfa_required` while /auth/session insists nothing
      // is outstanding.
      //
      // Not hypothetical: VENDOR_OWNER is in MFA_REQUIRED_ROLES, so a vendor
      // could register, be told they were signed in, and have the very next
      // call — POST /onboarding/start — refused. The client's only recourse was
      // to infer the state from a 403, which is guessing from a symptom.
      //
      // The guard already verified the token and read `claims.mfa`; it now keeps
      // the answer on the principal. Re-verifying the cookie here instead needed
      // a try/catch, and its failure arm had to guess — with the safe-LOOKING
      // guess (assume satisfied) failing open on the one field that must not.
      return {
        ...principalOf(principal),
        mfaRequired: !principal.mfaSatisfied,
        accessToken: cookie(req, ACCESS_COOKIE),
      };
    }

    const presented = cookie(req, REFRESH_COOKIE);
    if (!presented) throw new UnauthenticatedError();

    const tokens = await this.identity.refresh(presented);
    this.setSessionCookies(res, tokens);

    // The rotated access token is the authoritative description of the session
    // just issued — including whether MFA is still outstanding — so it is read
    // back rather than reassembled from a second source.
    const claims = await this.tokens.verifyAccess(tokens.accessToken);
    return {
      userId: claims.sub,
      orgId: claims.org_id,
      orgType: claims.org_type,
      roles: claims.roles,
      permissions: claims.scope,
      mfaRequired: !claims.mfa,
      accessToken: tokens.accessToken,
    };
  }

  /**
   * Public, and 204 whatever happens.
   *
   * Signing out must not be able to fail. If the access token expired while the
   * tab sat open, an authenticated logout would 401 and leave the person staring
   * at a session they cannot end, with the refresh cookie live for another
   * thirty days. So the cookies are cleared first and the server-side revocation
   * is best-effort on top of that.
   */
  @Post('logout')
  @Public()
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const principal = this.ctx.principal;
    const presented = cookie(req, REFRESH_COOKIE);
    this.clearSessionCookies(res);

    if (principal) {
      await this.identity.logout(principal.sessionId, principal.userId);
      return;
    }
    if (!presented) return;

    // No principal, so possession of the *current* refresh secret is the only
    // authorisation on offer, and rotating first is how that gets proven: the
    // session id is merely the token's prefix, and a bare uuid must never be
    // enough to sign somebody else out.
    try {
      const rotated = await this.identity.refresh(presented);
      await this.tokens.revokeSession(rotated.sessionId);
    } catch {
      // Expired, already revoked, or replayed — and in the replay case rotation
      // has just killed the whole family, which is a stronger logout than the
      // one asked for. The cookies are gone either way.
    }
  }

  // -------------------------------------------------------------------------
  // The second factor
  // -------------------------------------------------------------------------
  //
  // `MFA_REQUIRED_ROLES` covers the roles that can move money or change where it
  // goes — VENDOR_OWNER and every platform admin among them. Login issues those
  // sessions with `mfa: false` and `AuthGuard` then refuses every non-public
  // route until the factor lands, so without these two routes those accounts can
  // sign in and do nothing whatsoever.
  //
  // Both are `@Public()` for the same reason: the session that needs them is by
  // definition the one the guard is refusing. A public route still resolves its
  // principal when a token is present, and skips only the MFA check — so these
  // run authenticated in every sense that matters here, with the principal read
  // from the request context and never taken from the body.

  @Post('mfa/otp')
  @Public()
  @HttpCode(200)
  async requestMfaCode(): Promise<{
    sentTo: string;
    expiresAt: string;
    resendAvailableAt: string;
    devCode?: string;
  }> {
    const user = await this.identity.getUser(this.requirePrincipal().userId);
    const target = mfaTarget(user);

    const issued = await this.otp.issue({
      target,
      purpose: 'LOGIN',
      channel: user.email ? 'EMAIL' : 'SMS',
      templateCode: LOGIN_OTP_TEMPLATE,
      refType: 'user_account',
      refId: user.userId,
      isProduction: this.config.isProduction,
      variables: { name: user.fullName },
    });

    // Masked, never echoed. Whoever requested the code already knows their own
    // address; anyone else holding a half-finished session must not learn it.
    return {
      sentTo: maskValue(target),
      expiresAt: issued.expiresAt.toISOString(),
      resendAvailableAt: issued.resendAvailableAt.toISOString(),
      devCode: issued.devCode,
    };
  }

  /**
   * Verifying the code is not enough on its own: `mfa` is a claim inside the
   * access token the guard reads, and the token in the caller's hand still says
   * `false`. So the session record is marked and then rotated — rotation carries
   * the flag forward — and the caller leaves holding a token that actually opens
   * the doors. Marking without re-issuing would look like success and change
   * nothing until the next refresh.
   */
  @Post('mfa/verify')
  @Public()
  @HttpCode(200)
  async verifyMfa(
    @Body(new ZodValidationPipe(mfaVerifySchema)) body: MfaVerifyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse> {
    const principal = this.requirePrincipal();
    const presented = cookie(req, REFRESH_COOKIE);
    if (!presented) throw new UnauthenticatedError();

    const user = await this.identity.getUser(principal.userId);
    await this.otp.verify({ target: mfaTarget(user), purpose: 'LOGIN', code: body.code });
    await this.tokens.markMfaSatisfied(principal.sessionId);

    const tokens = await this.identity.refresh(presented);
    this.setSessionCookies(res, tokens);

    await this.audit.record({
      action: 'identity.mfa.verified',
      entityType: 'session',
      entityId: principal.sessionId,
      actorUserId: user.userId,
      actorOrgId: user.orgId,
    });

    return {
      ...principalOf(user),
      mfaRequired: false,
      accessToken: tokens.accessToken,
      fullName: user.fullName,
    };
  }

  // -------------------------------------------------------------------------
  // Changing the login email or mobile
  // -------------------------------------------------------------------------
  //
  // Not `@Public()`, unlike the MFA pair above, and that is the whole security
  // posture of this flow in one decorator: it runs as a fully established
  // session, so `AuthGuard` has already made an account whose role requires a
  // second factor produce one before it can even reach here. The user id comes
  // from the request context and never from the body — a route that changes the
  // contact details of whichever user id it is handed is an account-takeover
  // endpoint with extra steps.
  //
  // Everything else — both codes, the alert to the old address, the expiry and
  // the audit trail — lives in `ContactChangeService`, where a second caller
  // cannot skip any of it.

  @Post('contact-change')
  @HttpCode(200)
  async requestContactChange(
    @Body(new ZodValidationPipe(contactChangeRequestSchema)) body: ContactChangeRequestDto,
  ): Promise<ContactChangeResponse> {
    return contactChangeResponse(
      await this.contactChange.request(this.requirePrincipal().userId, body),
    );
  }

  @Post('contact-change/:id/verify')
  @HttpCode(200)
  async verifyContactChange(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(contactChangeVerifySchema)) body: ContactChangeVerifyDto,
  ): Promise<ContactChangeResponse> {
    return contactChangeResponse(
      await this.contactChange.verify(this.requirePrincipal().userId, id, body.side, body.code),
    );
  }

  @Post('contact-change/:id/cancel')
  @HttpCode(200)
  async cancelContactChange(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(contactChangeCancelSchema)) body: ContactChangeCancelDto,
  ): Promise<ContactChangeResponse> {
    return contactChangeResponse(
      await this.contactChange.cancel(this.requirePrincipal().userId, id, body.reason),
    );
  }

  // -------------------------------------------------------------------------
  // Cookies
  // -------------------------------------------------------------------------

  private setSessionCookies(res: Response, tokens: IssuedTokens): void {
    const accessTtl = this.config.get('JWT_ACCESS_TTL_SECONDS');
    res.cookie(ACCESS_COOKIE, tokens.accessToken, {
      ...this.cookieOptions(),
      maxAge: Math.max(1, accessTtl - ACCESS_COOKIE_SKEW_SECONDS) * 1000,
    });
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
      ...this.cookieOptions(),
      path: REFRESH_COOKIE_PATH,
      maxAge: this.config.get('JWT_REFRESH_TTL_SECONDS') * 1000,
    });
  }

  /**
   * Cleared with the identical attributes they were set with. A browser matches
   * a deletion on name, domain and path, so a mismatch here leaves the cookie
   * exactly where it was and the logout only appears to have worked.
   */
  private clearSessionCookies(res: Response): void {
    res.clearCookie(ACCESS_COOKIE, this.cookieOptions());
    res.clearCookie(REFRESH_COOKIE, { ...this.cookieOptions(), path: REFRESH_COOKIE_PATH });
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      // Lax rather than Strict: Strict drops the cookie on a plain link into the
      // console from an email, which reads to the user as a random signed-out
      // state. Lax still withholds it from every cross-site POST, which is the
      // CSRF case that matters.
      sameSite: 'lax',
      // Never `secure` in development — a cookie the browser refuses to send
      // over http://localhost is a login that silently does not work.
      secure: this.config.isProduction,
      domain: this.config.get('SESSION_COOKIE_DOMAIN'),
      path: '/',
    };
  }

  /**
   * Both channels must have been proved within the last half hour.
   *
   * `createOrganizationWithOwner` stamps `email_verified_at` and
   * `mobile_verified_at` on the new owner with the comment "contact verification
   * is what got them here, so both are verified". Until `register/otp/verify`
   * existed, nothing made that true — the columns recorded a verification that
   * had never happened, and a vendor could be approved on an address nobody
   * could read. This is the check that turns that comment into a fact, and it
   * belongs before the transaction so the message can name the channel.
   *
   * Checked one at a time so the message names WHICH one is missing. "Verify
   * your contact details" in front of a form with two fields, one of them green,
   * is the message that generates the support ticket.
   */
  private async assertContactsVerified(email: string, mobile: string): Promise<void> {
    const [emailProved, mobileProved] = await Promise.all([
      this.otp.wasRecentlyVerified(email, 'REGISTRATION', REGISTRATION_PROOF_SECONDS),
      this.otp.wasRecentlyVerified(mobile, 'REGISTRATION', REGISTRATION_PROOF_SECONDS),
    ]);

    if (!emailProved) {
      throw new ValidationError(
        'Verify your work email first — enter the 6-digit code we sent to it, then create the account.',
        { email: 'This email has not been verified yet.' },
      );
    }
    if (!mobileProved) {
      throw new ValidationError(
        'Verify your mobile number first — enter the 6-digit code we sent to it, then create the account.',
        { mobile: 'This mobile number has not been verified yet.' },
      );
    }
  }

  /** 401, not the 403 `requirePrincipal()` raises: the caller needs to sign in, not to be told off. */
  private requirePrincipal(): { userId: string; sessionId: string } {
    const principal = this.ctx.principal;
    if (!principal) throw new UnauthenticatedError();
    return principal;
  }
}

const cookie = (req: Request, name: string): string | undefined =>
  (req as Request & { cookies?: Record<string, string> }).cookies?.[name];

/**
 * One builder for both sources of truth — the decoded token on a warm request,
 * the freshly read user row after a login — so the two cannot drift into
 * describing the same session differently.
 */
function principalOf(source: {
  userId: string;
  orgId: string | null;
  orgType: OrgType;
  roles: readonly Role[];
  permissions: Iterable<Permission>;
}): Omit<SessionResponse, 'mfaRequired'> {
  return {
    userId: source.userId,
    orgId: source.orgId,
    orgType: source.orgType,
    roles: [...source.roles],
    permissions: [...source.permissions],
  };
}

/**
 * Where the code goes. Email first, because it is the channel a desk-bound
 * console user already has open; the mobile is the fallback for an account
 * registered without one. An account with neither cannot complete MFA and
 * cannot be helped by retrying, so it says so here rather than failing three
 * layers down at the notification provider.
 */
function mfaTarget(user: { email: string | null; mobile: string | null }): string {
  const target = user.email ?? user.mobile;
  if (!target) {
    throw new ValidationError(
      'This account has no verified email or mobile number, so we cannot send a code. Ask your organisation owner to add one.',
    );
  }
  return target;
}

/**
 * Built field by field, like `SessionResponse` and for the same reason. The
 * service's view already masks both addresses; this makes the wire shape an
 * explicit list rather than whatever that type happens to grow next.
 */
function contactChangeResponse(view: ContactChangeView): ContactChangeResponse {
  return {
    requestId: view.requestId,
    field: view.field,
    oldValueMasked: view.oldValueMasked,
    newValueMasked: view.newValueMasked,
    oldVerified: view.oldVerified,
    newVerified: view.newVerified,
    status: view.status,
    expiresAt: view.expiresAt.toISOString(),
    completed: view.completed,
    devCodes: view.devCodes,
  };
}
