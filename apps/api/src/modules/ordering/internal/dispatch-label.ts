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
  unitIds: readonly string[],
): Promise<Map<string, string>> {
  if (unitIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<
    Array<{ id: string; supply_point_code: string | null; city: string | null }>
  >`
    SELECT u.id, u.supply_point_code, p.city
      FROM listing.unit u
      LEFT JOIN listing.supply_point p
             ON p.vendor_org_id = u.vendor_org_id AND p.code = u.supply_point_code
     WHERE u.id = ANY(${[...unitIds]}::uuid[])`;
  return new Map(
    rows.map((r) => [
      r.id,
      r.supply_point_code && r.city
        ? supplyPointLabel(r.supply_point_code, r.city)
        : UNKNOWN_DISPATCH_LABEL,
    ]),
  );
}
