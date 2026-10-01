import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { RequestContextService } from '../../../shared/db/org-scope';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ForbiddenError, NotFoundError } from '../../../shared/errors/domain-errors';

/**
 * The buyer's wishlist: models saved to come back to.
 *
 * Owned exactly like the cart — one person inside one buyer organisation — so
 * every statement here is bounded by both ids from the session, never from the
 * request, and another buyer's saves are simply not visible. Platform staff and
 * suppliers have no wishlist, for the same reason they have no cart.
 *
 * A save is a model at a grade, which is what a storefront card is. What it
 * costs, whether it is in stock and which supply point fills it are read live
 * by the storefront when it draws the list; storing a price here would only
 * store a number that goes stale.
 *
 * A signed-out visitor's saves live in their browser; on sign-in the
 * storefront sends them to `merge`, which adds what is new and ignores what is
 * already saved or no longer exists.
 */
export const wishlistItemSchema = z.object({
  skuId: z.string().uuid(),
  grade: z.enum(['A_PLUS', 'A', 'B']),
});
export type WishlistItemDto = z.infer<typeof wishlistItemSchema>;

/** At most this many saves come across from a browser in one merge. */
export const MERGE_MAX = 200;
export const wishlistMergeSchema = z.object({
  items: z.array(wishlistItemSchema).max(MERGE_MAX),
});
export type WishlistMergeDto = z.infer<typeof wishlistMergeSchema>;

export interface WishlistEntry {
  skuId: string;
  grade: 'A_PLUS' | 'A' | 'B';
  addedAt: string;
}

export interface WishlistView {
  items: WishlistEntry[];
}

@Injectable()
export class WishlistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ctx: RequestContextService,
  ) {}

  /** A wishlist belongs to a buyer organisation and one person inside it. */
  private owner(): { orgId: string; userId: string } {
    const p = this.ctx.requirePrincipal();
    if (!p.orgId || p.orgType !== 'BUYER') {
      throw new ForbiddenError('A wishlist belongs to a buyer account.', {
        reason: 'not_a_buyer_principal',
      });
    }
    return { orgId: p.orgId, userId: p.userId };
  }

  async view(): Promise<WishlistView> {
    const { orgId, userId } = this.owner();
    const rows = await this.prisma.$queryRaw<
      Array<{ sku_id: string; grade: WishlistEntry['grade']; added_at: Date }>
    >`
      SELECT sku_id, grade::text AS grade, added_at
        FROM ordering.wishlist_item
       WHERE buyer_org_id = ${orgId}::uuid AND user_id = ${userId}::uuid
       ORDER BY added_at DESC`;
    return {
      items: rows.map((r) => ({
        skuId: r.sku_id,
        grade: r.grade,
        addedAt: r.added_at.toISOString(),
      })),
    };
  }

  /**
   * Save one model at one grade. Saving it twice is the same save.
   *
   * The insert selects from the catalogue rather than trusting the id, so an id
   * that names no active model is a 404 and never a foreign-key 500.
   */
  async add(item: WishlistItemDto): Promise<WishlistView> {
    const { orgId, userId } = this.owner();
    const known = await this.insert(orgId, userId, [item]);
    if (known === 0) {
      throw new NotFoundError('model', { reason: 'no_such_active_sku' });
    }
    return this.view();
  }

  async remove(item: WishlistItemDto): Promise<WishlistView> {
    const { orgId, userId } = this.owner();
    await this.prisma.$executeRaw`
      DELETE FROM ordering.wishlist_item
       WHERE buyer_org_id = ${orgId}::uuid AND user_id = ${userId}::uuid
         AND sku_id = ${item.skuId}::uuid AND grade = ${item.grade}::public.grade_type`;
    return this.view();
  }

  /**
   * A browser's saves, brought into the account on sign-in.
   *
   * Additive and quiet: what is already saved stays as it is, and a save naming
   * a model that has since left the catalogue is dropped rather than refused —
   * one stale entry in a browser must not cost the buyer the rest.
   */
  async merge(input: WishlistMergeDto): Promise<WishlistView> {
    const { orgId, userId } = this.owner();
    await this.insert(orgId, userId, input.items);
    return this.view();
  }

  /** How many of `items` name an active model — inserted now or saved already. */
  private async insert(
    orgId: string,
    userId: string,
    items: readonly WishlistItemDto[],
  ): Promise<number> {
    if (items.length === 0) return 0;
    const skuIds = items.map((i) => i.skuId);
    const grades = items.map((i) => i.grade);
    const [row] = await this.prisma.$queryRaw<Array<{ known: number }>>`
      WITH wanted AS (
        SELECT DISTINCT w.sku_id, w.grade
          FROM unnest(${skuIds}::uuid[], ${grades}::public.grade_type[]) AS w(sku_id, grade)
          JOIN catalog.sku s ON s.id = w.sku_id AND s.is_active
      ), ins AS (
        INSERT INTO ordering.wishlist_item (buyer_org_id, user_id, sku_id, grade)
        SELECT ${orgId}::uuid, ${userId}::uuid, sku_id, grade FROM wanted
        ON CONFLICT ON CONSTRAINT uq_wishlist_item DO NOTHING
        RETURNING 1
      )
      SELECT count(*)::int AS known FROM wanted`;
    return row?.known ?? 0;
  }
}
