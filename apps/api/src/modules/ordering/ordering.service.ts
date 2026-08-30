import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/db/prisma.service';
import { OwnedUnitsService, type OwnedUnit } from './internal/owned-units.service';

export type { OwnedUnit };

/**
 * The public interface of the `ordering` module.
 *
 * This interface is the future network contract (02_ARCHITECTURE.md §1.1 rule 4).
 * When `ordering` is extracted into its own service the folder moves, the in-process
 * bus becomes SQS and the direct call becomes an HTTP client — and this interface
 * does not change. That is the whole point of writing it down now.
 *
 * Owns: cart, order, order approval, sub-order, order line, order line unit, order events, RFQ
 *
 * Other modules reach this through `src/modules/ordering` (the barrel) and nothing
 * else. `internal/`, `entities/` and `dto/` are private, and the
 * `no-cross-module-import` lint rule makes that an error rather than a wish.
 */
export interface IOrderingService {
  /** Liveness of this module's own dependencies, surfaced on /health. */
  selfCheck(): Promise<{ ok: boolean; detail?: string }>;

  /**
   * Orders that reached the buyer, for the storefront's public figures.
   *
   * DELIVERED and not "shipped" or "paid": the public page reports outcomes a
   * buyer would recognise as one, and only ordering knows which of its statuses
   * that is. A caller filtering `ordering."order"` itself would pin that
   * judgement outside the module that owns the state machine.
   */
  countDelivered(): Promise<number>;

  /**
   * Every machine the signed-in organisation owns, with when each arrived.
   *
   * On the barrel because `platform` owns warranty, claims and returns and all
   * three start with the same question: which serials are this buyer's, and has
   * the machine reached them? Ownership is `order_line_unit` -> `order_line` ->
   * `sub_order` -> `order.buyer_org_id`, four tables in ordering's schema and a
   * state machine ordering owns. A caller reconstructing that join would pin the
   * definition of "yours" outside the module that decides it.
   *
   * **Org-scoped from the request context, with no org argument to get wrong.**
   * A signature that took an `orgId` would be one careless call away from
   * serving another company's asset register.
   */
  ownedUnits(): Promise<OwnedUnit[]>;

  /** The same, narrowed to one order. Empty when the order is not this org's. */
  ownedUnitsForOrder(orderNumber: string): Promise<OwnedUnit[]>;
}

@Injectable()
export class OrderingService implements IOrderingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly owned: OwnedUnitsService,
  ) {}

  async selfCheck(): Promise<{ ok: boolean; detail?: string }> {
    return { ok: true };
  }

  async countDelivered(): Promise<number> {
    return this.prisma.db.order.count({ where: { status: 'DELIVERED' } });
  }

  ownedUnits(): Promise<OwnedUnit[]> {
    return this.owned.forThisOrg();
  }

  ownedUnitsForOrder(orderNumber: string): Promise<OwnedUnit[]> {
    return this.owned.forOrder(orderNumber);
  }
}
