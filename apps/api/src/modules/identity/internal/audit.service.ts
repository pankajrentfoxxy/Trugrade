import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ClockPort } from '../../../shared/clock';
import { RequestContextService } from '../../../shared/db/org-scope';

/**
 * The audit log.
 *
 * Append-only by grant — `REVOKE UPDATE, DELETE` — so an engineer cannot "just
 * fix" a row in production. That is the point, and it is why this service has no
 * update or delete method to call.
 *
 * Two things it does that a naive logger does not:
 *
 *   1. **Redacts before writing.** The before/after snapshots are the most likely
 *      place for a PAN or a bank account to end up in a table that support staff
 *      can read. Sensitive keys are masked on the way in, not on the way out.
 *   2. **Never throws into the caller.** An audit write that fails must not roll
 *      back the business action it was recording — it logs loudly instead. The
 *      inverse (losing the order to keep the log) is the wrong trade.
 */

/** Keys whose values never appear in an audit snapshot in full. */
const SENSITIVE_KEYS = [
  'password',
  'password_hash',
  'code_hash',
  'refresh_token',
  'refresh_token_hash',
  'mfa_secret',
  'mfa_secret_enc',
  'account_number',
  'pan',
  'aadhaar',
  'aadhaar_last4',
  'token',
  'secret',
  'api_key',
  'licence_key',
  'signature',
  'otp',
  'code',
];

/** `06AAEC****1ZP` — enough to recognise, not enough to use. */
export function maskValue(value: unknown): string {
  const s = String(value);
  if (s.length <= 4) return '****';
  if (s.length <= 8) return `${s.slice(0, 2)}****`;
  return `${s.slice(0, 4)}${'*'.repeat(Math.min(6, s.length - 8))}${s.slice(-3)}`;
}

export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 6) return '[deep]';
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value !== 'object') return value;

  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (SENSITIVE_KEYS.some((s) => lower.includes(s))) {
      out[key] = v === null || v === undefined ? v : maskValue(v);
    } else {
      out[key] = redact(v, depth + 1);
    }
  }
  return out;
}

export interface AuditEntry {
  action: string;
  entityType?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  /** Overrides the ambient request context, for jobs and system actions. */
  actorUserId?: string | null;
  actorOrgId?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly ctx: RequestContextService,
  ) {}

  async record(entry: AuditEntry): Promise<void> {
    const context = this.ctx.get();
    try {
      await this.prisma.db.audit_log.create({
        data: {
          actor_user_id: entry.actorUserId ?? context?.principal?.userId ?? null,
          actor_org_id: entry.actorOrgId ?? context?.principal?.orgId ?? null,
          action: entry.action,
          entity_type: entry.entityType ?? null,
          entity_id: entry.entityId ?? null,
          before_json: entry.before === undefined ? undefined : (redact(entry.before) as object),
          after_json: entry.after === undefined ? undefined : (redact(entry.after) as object),
          ip: context?.ip ?? null,
          user_agent: context?.userAgent ?? null,
          request_id: context?.requestId ?? null,
          created_at: this.clock.now(),
        },
      });
    } catch (e) {
      // Deliberately swallowed. Losing an audit row is bad; losing the order it
      // was recording because the audit table was full is worse.
      this.logger.error(
        `AUDIT WRITE FAILED for ${entry.action} on ${entry.entityType}:${entry.entityId} — ${(e as Error).message}`,
      );
    }
  }

  /** Read side, for the admin viewer. Filtered, never exported wholesale. */
  async query(filter: {
    actorUserId?: string;
    entityType?: string;
    entityId?: string;
    action?: string;
    from?: Date;
    to?: Date;
    limit?: number;
  }): Promise<
    Array<{
      id: bigint;
      action: string;
      entity_type: string | null;
      entity_id: string | null;
      actor_user_id: string | null;
      created_at: Date;
      before_json: unknown;
      after_json: unknown;
    }>
  > {
    return this.prisma.db.audit_log.findMany({
      where: {
        ...(filter.actorUserId ? { actor_user_id: filter.actorUserId } : {}),
        ...(filter.entityType ? { entity_type: filter.entityType } : {}),
        ...(filter.entityId ? { entity_id: filter.entityId } : {}),
        ...(filter.action ? { action: { contains: filter.action } } : {}),
        ...(filter.from || filter.to
          ? {
              created_at: {
                ...(filter.from ? { gte: filter.from } : {}),
                ...(filter.to ? { lte: filter.to } : {}),
              },
            }
          : {}),
      },
      orderBy: { created_at: 'desc' },
      take: Math.min(filter.limit ?? 100, 500),
    });
  }
}
