import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { createHash, randomUUID, randomBytes, generateKeyPairSync } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { KeyObject } from 'node:crypto';
import { importPrivateKey, importPublicKey, signJwt, verifyJwt, type JwtClaims } from './jwt';
import { SESSION_POLICY, type Permission, type Role } from '@trugrade/contracts';
import { AppConfig } from '../config';
import { ClockPort } from '../clock';
import { RedisService } from '../redis/redis.service';
import { UnauthenticatedError } from '../errors/domain-errors';

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



@Injectable()
export class TokenService implements OnModuleInit {
  private readonly logger = new Logger(TokenService.name);
  private privateKey!: KeyObject;
  private publicKey!: KeyObject;

  constructor(
    private readonly config: AppConfig,
    private readonly clock: ClockPort,
    private readonly redis: RedisService,
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
    await this.redis.client.set(this.sessionKey(sessionId), JSON.stringify(record), 'EX', refreshTtl);
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

    const json = await this.redis.client.get(this.sessionKey(sessionId));
    if (!json) throw new UnauthenticatedError('Your session has ended. Please sign in again.');

    const record: SessionRecord = JSON.parse(json);

    if (record.currentRefreshHash !== sha256(raw)) {
      this.logger.warn(
        `Refresh token reuse detected on session ${sessionId} (family ${record.familyId}) — revoking the family.`,
      );
      await this.revokeFamily(record.familyId);
      throw new UnauthenticatedError(SESSION_POLICY.refreshReuseMessage);
    }

    const fresh = await reissue({ userId: record.userId, orgId: record.orgId });
    // Same session id and family: rotation, not a new login.
    return this.issue({
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
}
