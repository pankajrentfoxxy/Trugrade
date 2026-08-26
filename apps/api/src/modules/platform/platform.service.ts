import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/db/prisma.service';

/**
 * The public interface of the `platform` module.
 *
 * This interface is the future network contract (02_ARCHITECTURE.md §1.1 rule 4).
 * When `platform` is extracted into its own service the folder moves, the in-process
 * bus becomes SQS and the direct call becomes an HTTP client — and this interface
 * does not change. That is the whole point of writing it down now.
 *
 * Owns: returns, warranty, warranty claims, tickets, disputes, vendor scorecards, reviews, config, feature flags, notification templates/log, integration log, data-subject requests
 *
 * Other modules reach this through `src/modules/platform` (the barrel) and nothing
 * else. `internal/`, `entities/` and `dto/` are private, and the
 * `no-cross-module-import` lint rule makes that an error rather than a wish.
 */
export interface IPlatformService {
  /** Liveness of this module's own dependencies, surfaced on /health. */
  selfCheck(): Promise<{ ok: boolean; detail?: string }>;

  /**
   * Raise an internal work item for our own staff, with its payload attached.
   *
   * `platform.ticket` is the only table in the schema that means "something a
   * human on our side has to pick up", so a sibling module that produces work —
   * ordering's bulk-requirement intake is the first — asks for one here rather
   * than inventing a second queue or writing into `platform.*` across the seam.
   *
   * The payload lands on an **internal** ticket message. That flag is load
   * bearing: a requirement list is the buyer's commercial intent and belongs to
   * the sales conversation, not to a thread the buyer can be shown verbatim.
   */
  openInternalLead(input: OpenInternalLeadInput): Promise<InternalLead>;
}

export interface OpenInternalLeadInput {
  /** The organisation the work is *about*. `platform.ticket.org_id` is NOT NULL. */
  orgId: string;
  /** Free text on the column, so it is the caller's vocabulary. */
  category: string;
  subject: string;
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  /** Serialised onto the first message. Anything JSON-shaped. */
  detail: unknown;
}

export interface InternalLead {
  id: string;
  /** `platform.ticket.ticket_number` — what staff quote at each other. */
  reference: string;
}

@Injectable()
export class PlatformService implements IPlatformService {
  constructor(private readonly prisma: PrismaService) {}

  async selfCheck(): Promise<{ ok: boolean; detail?: string }> {
    return { ok: true };
  }

  /**
   * Ticket and first message in one transaction: a lead whose payload failed to
   * write is worse than no lead, because the queue then shows a row that says
   * "a customer wants something" and nothing about what.
   *
   * ponytail: the reference is the month plus eight hex characters rather than a
   * gapless counter. Nothing reconciles ticket numbers — unlike invoice numbers,
   * which VR-146 requires to be gapless and which take an advisory lock for it.
   * The UNIQUE on the column is the backstop, and a collision is a retry, not a
   * corruption. Give it a sequence the day support wants "how many this month"
   * answered by subtraction.
   */
  async openInternalLead(input: OpenInternalLeadInput): Promise<InternalLead> {
    const suffix = Math.floor(Math.random() * 0xffff_ffff)
      .toString(16)
      .toUpperCase()
      .padStart(8, '0');

    return this.prisma.runInTransaction(async () => {
      const [ticket] = await this.prisma.$queryRaw<Array<{ id: string; ticket_number: string }>>`
        INSERT INTO platform.ticket (org_id, category, priority, subject, ticket_number, status)
        VALUES (${input.orgId}::uuid, ${input.category}, ${input.priority ?? 'NORMAL'},
                ${input.subject},
                'TKT-' || to_char(now(), 'YYYYMM') || '-' || ${suffix},
                'OPEN')
        RETURNING id, ticket_number`;

      await this.prisma.$executeRaw`
        INSERT INTO platform.ticket_message (ticket_id, body, is_internal)
        VALUES (${ticket!.id}::uuid, ${JSON.stringify(input.detail, null, 2)}, TRUE)`;

      return { id: ticket!.id, reference: ticket!.ticket_number };
    });
  }
}
