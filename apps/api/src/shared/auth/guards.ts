import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  SetMetadata,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { MFA_REQUIRED_ROLES, type Permission, type Role } from '@trugrade/contracts';
import { ForbiddenError, UnauthenticatedError } from '../errors/domain-errors';
import { RequestContextService, type Principal } from '../db/org-scope';
import { TokenService, type AccessTokenClaims } from './token.service';

export const IS_PUBLIC = 'trugrade:public';
export const REQUIRED_PERMISSIONS = 'trugrade:permissions';
export const REQUIRED_ROLES = 'trugrade:roles';

/**
 * Mark an endpoint reachable without a session.
 *
 * Deny-by-default: `AuthGuard` is global, so an endpoint is authenticated unless
 * it says otherwise. The opposite default — allow unless marked — is how one
 * forgotten decorator becomes a data breach.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);

/** Guards check permissions, not role names. A role is a bundle and bundles change. */
export const RequirePermissions = (...perms: Permission[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_PERMISSIONS, perms);

/** Only where the *role itself* is the rule, e.g. "platform staff only". */
export const RequireRoles = (...roles: Role[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_ROLES, roles);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Principal => {
    const req = ctx.switchToHttp().getRequest<Request & { principal?: Principal }>();
    if (!req.principal) throw new UnauthenticatedError();
    return req.principal;
  },
);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly ctx: RequestContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);

    const req = context.switchToHttp().getRequest<Request & { principal?: Principal }>();
    const token = this.extractToken(req);

    // A public endpoint still resolves a principal when a token is present, so a
    // signed-in buyer browsing the storefront gets their own prices and their
    // saved searches without every public controller special-casing it.
    if (!token) {
      if (isPublic) return true;
      throw new UnauthenticatedError();
    }

    // Best-effort, and that is the whole point: on a public route a token we
    // cannot verify means "anonymous", never "refused".
    //
    // POST /auth/login is @Public(), and this used to throw before the isPublic
    // check below ever ran — so a stale `tg_access` cookie refused the one
    // request whose entire job is to replace it. Anyone whose session died while
    // the cookie was still in the jar could not sign back in until the cookie
    // aged out on its own, with nothing in the UI able to clear it.
    let claims: AccessTokenClaims;
    try {
      claims = await this.tokens.verifyAccess(token);
    } catch (e) {
      if (isPublic) return true;
      throw e;
    }

    const principal: Principal = {
      userId: claims.sub,
      orgId: claims.org_id,
      orgType: claims.org_type,
      roles: claims.roles,
      permissions: new Set(claims.scope),
      sessionId: claims.sid,
      mfaSatisfied: claims.mfa,
    };
    req.principal = principal;
    this.ctx.setPrincipal(principal);

    if (isPublic) return true;

    // MFA is mandatory for roles that can move money or change where it goes.
    // Checked here rather than at login so a session cannot be established
    // pre-MFA and then used for a privileged call.
    const needsMfa = principal.roles.some((r) => MFA_REQUIRED_ROLES.includes(r));
    if (needsMfa && !claims.mfa) {
      throw new ForbiddenError(
        'This account requires two-factor authentication. Enter the code from your authenticator app to continue.',
        { reason: 'mfa_required' },
      );
    }

    return true;
  }

  private extractToken(req: Request): string | undefined {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.slice(7);
    // The storefront keeps the access token in a cookie so an XSS cannot read it
    // out of JS memory; the console uses the Authorization header.
    const cookie = (req as Request & { cookies?: Record<string, string> }).cookies?.['tg_access'];
    return cookie;
  }
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly ctx: RequestContextService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { principal?: Principal }>();
    const required = this.reflector.getAllAndOverride<Permission[]>(REQUIRED_PERMISSIONS, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(REQUIRED_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required?.length && !requiredRoles?.length) return true;

    /**
     * Read from the REQUEST, not from the async context.
     *
     * Nest runs guards before interceptors, and the AsyncLocalStorage context is
     * established by `RequestContextInterceptor` — so at guard time
     * `ctx.principal` is always undefined. This guard read it anyway and threw
     * UNAUTHENTICATED on every route carrying `@RequirePermissions`, with a
     * perfectly valid token attached. `/auth/session` looked fine only because it
     * is `@Public()` and never reaches here.
     *
     * `AuthGuard` stamps `req.principal` a moment earlier, and the request object
     * is the one thing that survives the ordering. The context is still seeded
     * from the same place for handlers; this is the same fix at the other end.
     */
    const principal = req.principal ?? this.ctx.principal;
    if (!principal) throw new UnauthenticatedError();

    if (required?.length) {
      const missing = required.filter((p) => !principal.permissions.has(p));
      if (missing.length) {
        // The message never names the permission — that tells a prober what
        // exists. The detail does, for the log.
        throw new ForbiddenError("You don't have permission to do that.", {
          missing,
          held: [...principal.permissions],
        });
      }
    }

    if (requiredRoles?.length && !requiredRoles.some((r) => principal.roles.includes(r))) {
      throw new ForbiddenError("You don't have permission to do that.", {
        requiredRoles,
        held: principal.roles,
      });
    }

    return true;
  }
}
