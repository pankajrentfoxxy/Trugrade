import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { createHash, randomUUID, randomBytes, generateKeyPairSync } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { KeyObject } from 'node:crypto';
import { importPrivateKey, importPublicKey, signJwt, verifyJwt, type JwtClaims } from './jwt';
import { SESSION_POLICY, type Permission, type Role } from '@trugrade/contracts';
import { AppConfig } from '../config';
import { ClockPort } from '../clock';
import { RedisService, LockService } from '../redis/redis.service';
import { RateLimitedError, UnauthenticatedError } from '../errors/domain-errors';

export interface AccessTokenClaims extends JwtClaims {
  sub: string;
  org_id: string | null;
  org_type: 'VENDOR' | 'BUYER' | 'PLATFORM';
  roles: Role[];
  /** Flattened permission set, so a guard never has to hit the database. */
  scope: Permission[];
  sid: string;
  jti: string;
  /** True once MFA has been satisfied for this session. */
  mfa: boolean;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
  sessionId: string;
}

/**
 * Session record kept in Redis so revocation is real. A JWT alone cannot be
 * revoked; a JWT plus a server-side session can.
 */
interface SessionRecord {
  userId: string;
  orgId: string | null;
  /** The family this refresh token belongs to. Reuse kills the whole family. */
  familyId: string;
  /** SHA-256 of the currently valid refresh token. Rotates on every use. */
  currentRefreshHash: string;
  mfa: boolean;
  createdAt: string;
  lastUsedAt: string;
  userAgent?: string;
  ip?: string;
}

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/** `IssuedTokens` carries two `Date`s, which do not survive a Redis round trip. */
const serializeIssued = (t: IssuedTokens): string =>
  JSON.stringify({
    ...t,
    accessExpiresAt: t.accessExpiresAt.toISOString(),
    refreshExpiresAt: t.refreshExpiresAt.toISOString(),
  });

const deserializeIssued = (json: string): IssuedTokens => {
  const raw = JSON.parse(json) as Omit<IssuedTokens, 'accessExpiresAt' | 'refreshExpiresAt'> & {
    accessExpiresAt: string;
    refreshExpiresAt: string;
  };
  return {
    ...raw,
    accessExpiresAt: new Date(raw.accessExpiresAt),
    refreshExpiresAt: new Date(raw.refreshExpiresAt),
  };
};

@Injectable()
export class TokenService implements OnModuleInit {
  private readonly logger = new Logger(TokenService.name);
  private privateKey!: KeyObject;
  private publicKey!: KeyObject;

  constructor(
    private readonly config: AppConfig,
    private readonly clock: ClockPort,
    private readonly redis: RedisService,
    private readonly locks: LockService,
  ) {}

  onModuleInit(): void {
    const { privatePem, publicPem } = this.resolveKeys();
    this.privateKey = importPrivateKey(privatePem);
    this.publicKey = importPublicKey(publicPem);
  }

  /**
   * Production supplies the PEMs from Secrets Manager. Development generates a
   * keypair on first run into `.keys/` (gitignored) so `pnpm dev` needs no setup
   * step — if a developer has to read a README paragraph to get running, the
   * foundation task failed.
   */
  private resolveKeys(): { privatePem: string; publicPem: string } {
    const inlinePriv = this.config.get('JWT_PRIVATE_KEY');
    const inlinePub = this.config.get('JWT_PUBLIC_KEY');
    if (inlinePriv && inlinePub) return { privatePem: inlinePriv, publicPem: inlinePub };

    const privPath = this.config.get('JWT_PRIVATE_KEY_PATH');
    const pubPath = this.config.get('JWT_PUBLIC_KEY_PATH');

    if (existsSync(privPath) && existsSync(pubPath)) {
      return {
        privatePem: readFileSync(privPath, 'utf8'),
        publicPem: readFileSync(pubPath, 'utf8'),
      };
    }

    if (this.config.isProduction) {
      throw new Error('JWT keypair missing in production. It must come from Secrets Manager.');
    }

    this.logger.warn(`No JWT keypair found — generating a development pair at ${privPath}`);
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    mkdirSync(dirname(privPath), { recursive: true });
    writeFileSync(privPath, privatePem, { mode: 0o600 });
    writeFileSync(pubPath, publicPem);
    return { privatePem, publicPem };
  }

  async issue(input: {
    userId: string;
    orgId: string | null;
    orgType: 'VENDOR' | 'BUYER' | 'PLATFORM';
    roles: Role[];
    permissions: Permission[];
    mfa: boolean;
    userAgent?: string;
    ip?: string;
    /** Continuing an existing family on refresh; a fresh login starts a new one. */
    familyId?: string;
    sessionId?: string;
  }): Promise<IssuedTokens> {
    const sessionId = input.sessionId ?? randomUUID();
    const familyId = input.familyId ?? randomUUID();
    const now = this.clock.now();
    const accessTtl = this.config.get('JWT_ACCESS_TTL_SECONDS');
    const refreshTtl = this.config.get('JWT_REFRESH_TTL_SECONDS');

    const issuedAt = Math.floor(now.getTime() / 1000);
    const accessToken = signJwt(
      {
        sub: input.userId,
        iss: this.config.get('API_PUBLIC_URL'),
        iat: issuedAt,
        exp: issuedAt + accessTtl,
        jti: randomUUID(),
        org_id: input.orgId,
        org_type: input.orgType,
        roles: input.roles,
        scope: input.permissions,
        sid: sessionId,
        mfa: input.mfa,
      },
      this.privateKey,
    );

    // The refresh token is opaque random, not a JWT. Nothing needs to read it
    // without the server, and an opaque token cannot leak claims if it is logged.
    const refreshToken = randomBytes(48).toString('base64url');

    const record: SessionRecord = {
      userId: input.userId,
      orgId: input.orgId,
      familyId,
      currentRefreshHash: sha256(refreshToken),
      mfa: input.mfa,
      createdAt: now.toISOString(),
      lastUsedAt: now.toISOString(),
      userAgent: input.userAgent,
      ip: input.ip,
    };
    await this.redis.client.set(
      this.sessionKey(sessionId),
      JSON.stringify(record),
      'EX',
      refreshTtl,
    );
    await this.redis.client.sadd(this.familyKey(familyId), sessionId);
    await this.redis.client.expire(this.familyKey(familyId), refreshTtl);
    await this.redis.client.sadd(this.userKey(input.userId), sessionId);

    return {
      accessToken,
      refreshToken: `${sessionId}.${refreshToken}`,
      accessExpiresAt: new Date(now.getTime() + accessTtl * 1000),
      refreshExpiresAt: new Date(now.getTime() + refreshTtl * 1000),
      sessionId,
    };
  }

  async verifyAccess(token: string): Promise<AccessTokenClaims> {
    try {
      const claims = verifyJwt<AccessTokenClaims>(token, this.publicKey, {
        issuer: this.config.get('API_PUBLIC_URL'),
        nowSeconds: Math.floor(this.clock.nowMs() / 1000),
      });

      // A valid signature is not enough. If the session was revoked the token is
      // dead even though it has not expired — that is the whole point of keeping
      // a server-side session.
      if (!(await this.redis.client.exists(this.sessionKey(claims.sid)))) {
        throw new UnauthenticatedError('Your session has ended. Please sign in again.');
      }
      return claims;
    } catch (e) {
      if (e instanceof UnauthenticatedError) throw e;
      throw new UnauthenticatedError('Please sign in to continue.');
    }
  }

  /**
   * Rotate a refresh token.
   *
   * VR-059: **reuse of an already-rotated token revokes the entire family.** A
   * second use of a token we have already replaced means either a replay or a
   * stolen token being used in parallel with the legitimate one, and there is no
   * benign explanation. Killing the family logs the attacker out along with the
   * victim, which is the correct trade.
   *
   * Except within `refreshGraceSeconds` of the rotation being repeated, which
   * does have a benign explanation and a common one — see below.
   */
  async rotate(
    presented: string,
    reissue: (session: { userId: string; orgId: string | null }) => Promise<{
      orgType: 'VENDOR' | 'BUYER' | 'PLATFORM';
      roles: Role[];
      permissions: Permission[];
    }>,
  ): Promise<IssuedTokens> {
    const [sessionId, raw] = presented.split('.', 2);
    if (!sessionId || !raw) throw new UnauthenticatedError(SESSION_POLICY.refreshReuseMessage);

    /**
     * Serialised per session, because everything below is a read-modify-write on
     * one Redis key.
     *
     * Two tabs racing through it unserialised BOTH read the record before either
     * writes, so both pass the hash check, both mint tokens, and the browser — one
     * cookie jar — keeps whichever `Set-Cookie` landed last, which is not
     * necessarily the one Redis ends up recognising. The next refresh then trips
     * reuse detection and revokes a session nobody attacked.
     *
     * Holding the lock collapses that into the sequential case: the loser waits,
     * re-reads, finds its token retired, and collects the replay entry.
     */
    try {
      return await this.locks.withLocks([`lock:rot:${sessionId}`], () =>
        this.rotateExclusively(sessionId, raw, reissue),
      );
    } catch (e) {
      // `withLocks` speaks in stock-checkout terms; a renewal is not that. This
      // is close to unreachable — the critical section is a lookup and three
      // writes — but a wrong sentence on a login screen is worth two lines.
      if (e instanceof RateLimitedError) {
        throw new RateLimitedError(1, 'Your session is being renewed. Try that again in a moment.');
      }
      throw e;
    }
  }

  private async rotateExclusively(
    sessionId: string,
    raw: string,
    reissue: (session: { userId: string; orgId: string | null }) => Promise<{
      orgType: 'VENDOR' | 'BUYER' | 'PLATFORM';
      roles: Role[];
      permissions: Permission[];
    }>,
  ): Promise<IssuedTokens> {
    const json = await this.redis.client.get(this.sessionKey(sessionId));
    if (!json) throw new UnauthenticatedError('Your session has ended. Please sign in again.');

    const record: SessionRecord = JSON.parse(json);
    const presentedHash = sha256(raw);

    if (record.currentRefreshHash !== presentedHash) {
      // Before treating this as an attack, check whether it is the far more
      // common benign case: two tabs — or one tab whose provider mounted twice —
      // refreshing at the same instant, both presenting the token the other just
      // retired. `GET /auth/session` is the rotation point, so every concurrent
      // page load races here. Revoking the family for that logs a legitimate
      // user out of an account they are actively using, and leaves them holding
      // a freshly-set access cookie whose session no longer exists.
      //
      // So a rotation stays replayable for a few seconds: the loser of the race
      // gets back the exact tokens the winner was issued. Identical responses
      // mean the outcome no longer depends on which Set-Cookie the browser
      // applies last, which is what makes this deterministic rather than merely
      // less likely to break.
      //
      // Outside the window the original rule is untouched — a second use of a
      // token we replaced minutes ago still has no benign explanation.
      const replay = await this.redis.client.get(this.rotationKey(presentedHash));
      if (replay) return deserializeIssued(replay);

      this.logger.warn(
        `Refresh token reuse detected on session ${sessionId} (family ${record.familyId}) — revoking the family.`,
      );
      await this.revokeFamily(record.familyId);
      throw new UnauthenticatedError(SESSION_POLICY.refreshReuseMessage);
    }

    const fresh = await reissue({ userId: record.userId, orgId: record.orgId });
    // Same session id and family: rotation, not a new login.
    const issued = await this.issue({
      userId: record.userId,
      orgId: record.orgId,
      orgType: fresh.orgType,
      roles: fresh.roles,
      permissions: fresh.permissions,
      mfa: record.mfa,
      familyId: record.familyId,
      sessionId,
      userAgent: record.userAgent,
      ip: record.ip,
    });

    /**
     * The replay entry, keyed by the hash of the token just retired — so only a
     * caller presenting that exact token can collect it, and it evaporates on
     * its own.
     *
     * This does hold a refresh token in Redis in the clear for `refreshGraceSeconds`,
     * which the session record deliberately never does. The trade is bounded and
     * worth naming: an attacker who can read this key already has the session
     * record next to it, and the entry outlives the race by seconds. Handing back
     * a token we already issued to the legitimate holder is strictly less
     * dangerous than the lockout the alternative causes.
     *
     * Nothing clears these on `revokeFamily`; they are inert once it runs, because
     * every token they carry names a session id that has just been deleted.
     */
    await this.redis.client.set(
      this.rotationKey(presentedHash),
      serializeIssued(issued),
      'EX',
      SESSION_POLICY.refreshGraceSeconds,
    );

    return issued;
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.redis.client.del(this.sessionKey(sessionId));
  }

  async revokeFamily(familyId: string): Promise<void> {
    const sessions = await this.redis.client.smembers(this.familyKey(familyId));
    if (sessions.length) {
      await this.redis.client.del(...sessions.map((s) => this.sessionKey(s)));
    }
    await this.redis.client.del(this.familyKey(familyId));
  }

  /** Every session for a user. Used on password change and on suspension. */
  async revokeAllForUser(userId: string): Promise<number> {
    const sessions = await this.redis.client.smembers(this.userKey(userId));
    if (sessions.length) await this.redis.client.del(...sessions.map((s) => this.sessionKey(s)));
    await this.redis.client.del(this.userKey(userId));
    return sessions.length;
  }

  async markMfaSatisfied(sessionId: string): Promise<void> {
    const json = await this.redis.client.get(this.sessionKey(sessionId));
    if (!json) return;
    const record: SessionRecord = JSON.parse(json);
    record.mfa = true;
    const ttl = await this.redis.client.ttl(this.sessionKey(sessionId));
    await this.redis.client.set(
      this.sessionKey(sessionId),
      JSON.stringify(record),
      'EX',
      ttl > 0 ? ttl : this.config.get('JWT_REFRESH_TTL_SECONDS'),
    );
  }

  private sessionKey = (id: string): string => `sess:${id}`;
  private familyKey = (id: string): string => `fam:${id}`;
  private userKey = (id: string): string => `usess:${id}`;
  /** Keyed by the RETIRED token's hash, so only its presenter can replay it. */
  private rotationKey = (retiredHash: string): string => `rot:${retiredHash}`;
}
