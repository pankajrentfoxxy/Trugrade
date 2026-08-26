import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/db/prisma.service';

/**
 * Where we can deliver, and what a pincode's freight zone is.
 *
 * Two tables, read set-at-a-time and never one pincode at a time. The offers
 * grid on a product page asks about ten supply points at once (PHASE_05 Task 4,
 * p95 < 500 ms for the whole grid), so every method here takes an array. A
 * single-pincode convenience that loops is how the N+1 gets reintroduced, so
 * there isn't one — `isServiceable` is a one-element batch.
 *
 * **On reading `identity.pincode_master` from here.** It is national reference
 * data (India Post's list, ~19 000 rows), our own `logistics.pincode_service-
 * ability` carries a hard foreign key into it, and `identity` exposes no lookup
 * for it on `IIdentityService`. `qc/internal/scheduling.service.ts` already reads
 * it the same way for the same reason. What the module seam forbids is a JOIN
 * across the two schemas, and there isn't one: this is a separate statement
 * against a single schema, and the correlation happens in TypeScript.
 */

/** A pincode's freight zone, as `carrier_rate_card.from_zone`/`to_zone` spell it. */
export interface PincodeZone {
  pincode: string;
  /**
   * `'NCR'` when the pincode is in the National Capital Region, otherwise
   * `pincode_master.zone` ('NORTH', 'SOUTH', …).
   *
   * NCR is its own zone rather than a subset of NORTH because the pilot's
   * economics are entirely different inside it: Q11 puts the whole pilot on
   * in-house delivery within NCR, and an in-house rate card priced as
   * NORTH→NORTH would also price Chandigarh→Lucknow, where we have no riders.
   */
  zone: string;
  /** For the place-of-supply split in the landed price. Not used for routing. */
  stateCode: string;
}

/** One carrier's published capability for one destination pincode. */
export interface CarrierService {
  carrierId: string;
  carrierCode: string;
  serviceType: string;
  transitDaysMin: number;
  transitDaysMax: number;
  /**
   * Out of delivery area. Carries a flat surcharge on the rate card, which has
   * to reach the landed price rather than surface at checkout — drip pricing is
   * a named prohibited practice in the CCPA Dark Patterns Guidelines 2023.
   */
  isOda: boolean;
}

interface ZoneRow {
  pincode: string;
  zone: string;
  is_ncr: boolean;
  state_code: string;
}

interface ServiceRow {
  pincode: string;
  carrier_id: string;
  carrier_code: string;
  service_type: string;
  transit_days_min: number;
  transit_days_max: number;
  is_oda: boolean;
}

const unique = (values: readonly string[]): string[] => [...new Set(values)];

@Injectable()
export class ServiceabilityService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A pincode absent from the returned Map is one India Post does not publish —
   * which is a typo far more often than it is a real address, and the quote says
   * so rather than silently pricing it as unserviceable-because-remote.
   */
  async zonesFor(pincodes: readonly string[]): Promise<Map<string, PincodeZone>> {
    const wanted = unique(pincodes);
    if (wanted.length === 0) return new Map();

    const rows = await this.prisma.$queryRaw<ZoneRow[]>`
      SELECT pincode, zone, is_ncr, state_code
        FROM identity.pincode_master
       WHERE pincode = ANY(${wanted}::char(6)[])`;

    return new Map(
      rows.map((r) => [
        r.pincode,
        { pincode: r.pincode, zone: r.is_ncr ? 'NCR' : r.zone, stateCode: r.state_code },
      ]),
    );
  }

  /**
   * Every active carrier that can deliver **to** each of these pincodes.
   *
   * `supports_leg` is filtered to OUTBOUND on purpose. Porter is registered
   * INBOUND-only (it is intra-city, two-wheeler, single-drop — see the carrier
   * fake), and a buyer-facing delivery quote priced on a carrier that cannot
   * carry the outbound leg is a promise we cannot keep.
   *
   * Both tables are `logistics`, so the join is inside one module's schema.
   */
  async outboundServicesFor(
    pincodes: readonly string[],
  ): Promise<Map<string, CarrierService[]>> {
    const wanted = unique(pincodes);
    if (wanted.length === 0) return new Map();

    const rows = await this.prisma.$queryRaw<ServiceRow[]>`
      SELECT s.pincode,
             s.service_type,
             s.transit_days_min,
             s.transit_days_max,
             s.is_oda,
             c.id   AS carrier_id,
             c.code AS carrier_code
        FROM logistics.pincode_serviceability s
        JOIN logistics.carrier c ON c.id = s.carrier_id
       WHERE s.pincode = ANY(${wanted}::char(6)[])
         AND c.is_active
         AND 'OUTBOUND' = ANY(c.supports_leg)
       ORDER BY c.priority, c.code, s.service_type`;

    const out = new Map<string, CarrierService[]>();
    for (const r of rows) {
      const list = out.get(r.pincode) ?? [];
      list.push({
        carrierId: r.carrier_id,
        carrierCode: r.carrier_code,
        serviceType: r.service_type,
        transitDaysMin: r.transit_days_min,
        transitDaysMax: r.transit_days_max,
        isOda: r.is_oda,
      });
      out.set(r.pincode, list);
    }
    return out;
  }

  async isServiceable(pincode: string): Promise<boolean> {
    const services = await this.outboundServicesFor([pincode]);
    return (services.get(pincode)?.length ?? 0) > 0;
  }
}
