import { AsyncLocalStorage } from 'node:async_hooks';
import { Global, Injectable, Module } from '@nestjs/common';
import type { Permission, Role } from '@trugrade/contracts';
import { ForbiddenError } from '../errors/domain-errors';

/**
 * The authenticated caller, carried per request.
 *
 * This is the input to the org scope, which is the control that makes
 * "vendor A cannot read vendor B's rows" a property of the data layer rather
 * than of every service author remembering a `where` clause.
 */
export interface Principal {
  userId: string;
  /** The organisation this session acts for. Null only for platform staff. */
  orgId: string | null;
  orgType: 'VENDOR' | 'BUYER' | 'PLATFORM';
  roles: readonly Role[];
  permissions: ReadonlySet<Permission>;
  sessionId: string;
  /** Set when a platform admin is deliberately reading across orgs. Audit-logged. */
  crossOrgReason?: string;
}

export interface RequestContext {
  requestId: string;
  traceId?: string;
  ip?: string;
  userAgent?: string;
  principal?: Principal;
}

const contextStorage = new AsyncLocalStorage<RequestContext>();

@Global()
@Injectable()
export class RequestContextService {
  run<T>(ctx: RequestContext, fn: () => T): T {
    return contextStorage.run(ctx, fn);
  }

  get(): RequestContext | undefined {
    return contextStorage.getStore();
  }

  get principal(): Principal | undefined {
    return contextStorage.getStore()?.principal;
  }

  requirePrincipal(): Principal {
    const p = this.principal;
    if (!p) throw new ForbiddenError('This action requires a signed-in user.');
    return p;
  }

  /** Attach the principal once authentication has resolved it. */
  setPrincipal(principal: Principal): void {
    const ctx = contextStorage.getStore();
    if (ctx) ctx.principal = principal;
  }
}

/**
 * The repository-layer org scope.
 *
 * 02_ARCHITECTURE.md §3.2 layer 3: *a missing `where` clause in a service must
 * not be able to leak another org's rows.* So org filtering does not live in the
 * service — it lives here, and a repository that handles org-owned data calls
 * `scoped()` to build its `where`.
 *
 * Platform staff read across orgs; everyone else is pinned to their own, and the
 * pinning cannot be turned off by passing a different id, only by holding a
 * platform role.
 */
@Injectable()
export class OrgScope {
  constructor(private readonly ctx: RequestContextService) {}

  /**
   * Merge the caller's org constraint into a `where` clause.
   *
   * @param where the repository's own filter
   * @param column the column holding the owning org id on this table
   */
  scoped<W extends Record<string, unknown>>(
    where: W,
    column: 'org_id' | 'vendor_org_id' | 'buyer_org_id' | 'organization_id' = 'org_id',
  ): W & Record<string, unknown> {
    const p = this.ctx.principal;
    if (!p) {
      // No principal means an unauthenticated read. Those are public endpoints
      // that must go through a public repository method; reaching a scoped one
      // without a caller is a programming error, not an access decision.
      throw new ForbiddenError('This data requires a signed-in caller.', {
        reason: 'org_scope_without_principal',
      });
    }

    if (p.orgType === 'PLATFORM') return where;

    const existing = (where as Record<string, unknown>)[column];
    if (existing !== undefined && existing !== p.orgId) {
      // Someone asked for another org's rows explicitly. That is an IDOR attempt
      // whether or not it was deliberate, and it is worth a distinct signal.
      throw new ForbiddenError("You don't have access to that organisation's data.", {
        reason: 'cross_org_read_attempt',
        requested: existing,
        actual: p.orgId,
      });
    }

    return { ...where, [column]: p.orgId };
  }

  /** Assert a row the caller already holds belongs to them. For post-fetch checks. */
  assertOwns(rowOrgId: string | null | undefined, what = 'record'): void {
    const p = this.ctx.requirePrincipal();
    if (p.orgType === 'PLATFORM') return;
    if (!rowOrgId || rowOrgId !== p.orgId) {
      throw new ForbiddenError(`You don't have access to that ${what}.`, {
        reason: 'assert_owns_failed',
      });
    }
  }

  get currentOrgId(): string | null {
    return this.ctx.principal?.orgId ?? null;
  }

  get isPlatform(): boolean {
    return this.ctx.principal?.orgType === 'PLATFORM';
  }
}

@Global()
@Module({
  providers: [RequestContextService, OrgScope],
  exports: [RequestContextService, OrgScope],
})
export class ContextModule {}
