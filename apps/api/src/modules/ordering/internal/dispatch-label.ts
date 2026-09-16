import { supplyPointLabel } from '@trugrade/contracts';
import { PrismaService } from '../../../shared/db/prisma.service';

/** What a machine with no supply point on file is called. Never a blank. */
export const UNKNOWN_DISPATCH_LABEL = 'Dispatch point to be confirmed';

/**
 * The anonymised dispatch label per machine — `Supply Point F · Noida`.
 *
 * One definition, because there are now two buyer-facing screens that need it
 * (the order record and the order's documents) and a second copy is a second
 * place for a vendor name to appear. This is the seam between "where the lorry
 * leaves from", which the buyer needs, and "who the supplier is", which they
 * never learn.
 *
 * Joined inside `listing`'s own schema and on BOTH keys the unique constraint
 * uses: `uq_supply_point_vendor_city` makes a code unique per city rather than
 * globally, so joining on `code` alone would eventually merge two supply points
 * into one on screen.
 */
export async function dispatchLabels(
  prisma: PrismaService,
  unitIds: readonly (string | null)[],
): Promise<Map<string, string>> {
  // Nulls are filtered, not just counted.
  //
  // An `order_line_unit` carries no `unit_id` until a machine is allocated to
  // it, so an order awaiting allocation produced `[null, null]` — non-empty, so
  // the length guard passed, and Prisma types an all-null array as `integer[]`,
  // which Postgres refuses to cast to `uuid[]`. That 500'd the buyer's whole
  // delivery screen with the opaque "something went wrong at our end". A machine
  // with no unit simply has no supply point yet, which is what
  // `UNKNOWN_DISPATCH_LABEL` is for.
  const ids = unitIds.filter((id): id is string => typeof id === 'string' && id.length > 0);
  if (ids.length === 0) return new Map();
  const rows = await prisma.$queryRaw<
    Array<{ id: string; supply_point_code: string | null; city: string | null }>
  >`
    SELECT u.id, u.supply_point_code, p.city
      FROM listing.unit u
      LEFT JOIN listing.supply_point p
             ON p.vendor_org_id = u.vendor_org_id AND p.code = u.supply_point_code
     WHERE u.id = ANY(${ids}::uuid[])`;
  return new Map(
    rows.map((r) => [
      r.id,
      r.supply_point_code && r.city
        ? supplyPointLabel(r.supply_point_code, r.city)
        : UNKNOWN_DISPATCH_LABEL,
    ]),
  );
}
