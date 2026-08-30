import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/db/prisma.service';
import { ReturnsService } from './internal/returns.service';
import { WarrantyService, type OpenWarrantyUnit } from './internal/warranty.service';

export type { OpenWarrantyUnit };

/**
 * A seal the buyer found broken or missing at their own door — T24.
 *
 * No org id. The buyer's organisation is read from the request context inside
 * this module, so there is no argument a caller could get wrong and no signature
 * that is one careless call away from opening a return on another company's
 * machine.
 */
export interface SealDiscrepancy {
  /** `ordering.order_line_unit.id` — what a return is raised against. */
  orderLineUnitId: string;
  serialNumber: string;
  sealCode: string;
  /** BROKEN or MISSING. Both are the same claim: nobody can vouch for what is inside. */
  finding: 'BROKEN' | 'MISSING';
}

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

  /**
   * Open warranty cover for machines that have just been delivered — T23.
   *
   * **Delivery is what creates a `platform.warranty` row.** Cover starts when
   * the buyer has the machine, not when they paid and not when it left the
   * supply point; a term that ran while the laptop was on a lorry would be a
   * term we sold and did not give. `ordering` owns the delivery event and calls
   * in here, rather than writing into `platform.*` across the seam.
   *
   * The caller supplies the facts it owns — which unit, which supply point
   * stands behind it, for how many months — and this module decides the term.
   * The top-up and the platform floor are `platform_config` keys and the
   * arithmetic is `max(vendor months + top-up, floor)`, the same the price was
   * built from, so the buyer is covered for exactly what they were sold.
   *
   * **Idempotent.** `uq_warranty_unit` makes a re-run a no-op, which matters
   * because the only caller is a button an operator can press twice.
   */
  openWarranties(
    units: readonly OpenWarrantyUnit[],
  ): Promise<{ opened: number; alreadyCovered: number }>;

  /**
   * Open the discrepancy a broken seal opens by itself — T24.
   *
   * **`03_UX_SPEC.md` §3A.3 requires this to be one tap, not a support call.**
   * Rule 7(4) take-back is ours and non-delegable, so a buyer who finds a broken
   * seal at their door must not then have to persuade somebody that they did.
   * `ordering` owns the delivery manifest and knows the machine; `platform` owns
   * returns and decides what one is. Ordering asks for one rather than writing
   * into `platform.*` across the seam — the same shape as the bulk-requirement
   * lead and the warranty cover that already run this way.
   *
   * **Idempotent**, and by `uq_return_open_per_unit` rather than by care: the
   * only caller is a button a person can press twice, and a second return on one
   * machine gets two inspections and neither of them the whole story. A machine
   * that already has a live return gets its number back unchanged.
   */
  openSealDiscrepancy(
    input: SealDiscrepancy,
  ): Promise<{ returnNumber: string; alreadyOpen: boolean }>;
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly warranty: WarrantyService,
    private readonly returns: ReturnsService,
  ) {}

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

  openWarranties(
    units: readonly OpenWarrantyUnit[],
  ): Promise<{ opened: number; alreadyCovered: number }> {
    return this.warranty.openWarranties(units);
  }

  /** Delegated verbatim: what a return is, and who may have one, lives in one file. */
  openSealDiscrepancy(
    input: SealDiscrepancy,
  ): Promise<{ returnNumber: string; alreadyOpen: boolean }> {
    return this.returns.openSealDiscrepancy(input);
  }
}
