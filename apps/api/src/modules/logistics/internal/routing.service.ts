import { Inject, Injectable } from '@nestjs/common';
import { Money } from '@trugrade/contracts';
import { ClockPort } from '../../../shared/clock';
import { PrismaService } from '../../../shared/db/prisma.service';
import { FreightService } from './freight.service';
import { CARRIER_REGISTRY, type CarrierRegistry } from '../../../shared/adapters/adapters.module';

/**
 * Which carrier takes this consignment, and why the others did not.
 *
 * The order of the checks is the whole design, and it is not cost-first:
 *
 *   1. **Serviceable?** A carrier that cannot reach the pincode is not a
 *      cheaper option, it is not an option.
 *   2. **Capable?** `carrier.supports_leg` and the adapter's own refusals.
 *      `FakePorter` turns down multi-package and inter-city work because the
 *      real Porter does; a fall-through that swallowed that refusal would book a
 *      two-wheeler for a Pune-to-Gurugram consignment.
 *   3. **A routing rule?** `logistics.routing_rule` rows beat everything below.
 *      "NCR goes in-house" and "high value goes BlueDart only" live there as
 *      data, so changing them is an ops decision rather than a deploy.
 *   4. **Cheapest rate card for the lane and weight.**
 *   5. **`carrier.priority`** breaks a tie.
 *
 * **The excluded carriers come back with the reason.** They are written onto
 * `shipment.detail` and rendered on the ops screen, because "why did this go by
 * DTDC" is asked about a consignment that has already moved, and by then the
 * rate cards and the serviceability sync have both changed underneath.
 */

export interface RoutingRequest {
  leg: 'INBOUND' | 'OUTBOUND' | 'RETURN';
  fromPincode: string;
  toPincode: string;
  fromCity: string;
  toCity: string;
  units: number;
  weightGrams: number;
  declaredValue: Money;
  /** False routes through the hub: a broken seal is re-inspected, never delivered. */
  sealsIntact: boolean;
  /** An order drawing on more than one supply point consolidates. */
  multiVendorOrder: boolean;
  /** `vendor.vendor_tier`. New and watchlist vendors are routed differently. */
  vendorTier: string | null;
}

export interface CarrierChoice {
  carrierId: string;
  carrierCode: string;
  adapterKey: string;
  quotedFreight: Money;
  rateCardId: string | null;
  routingRuleId: string | null;
  routeType: 'DIRECT' | 'VIA_HUB' | 'CONSOLIDATED';
  etaFrom: Date | null;
  etaTo: Date | null;
  /** Every carrier that was considered and dropped, with the reason. */
  excluded: Array<{ carrierCode: string; reason: string }>;
}

interface CarrierRow {
  id: string;
  code: string;
  adapter_key: string;
  supports_leg: string[];
  priority: number;
}

/** NCR, as the in-house fake defines it. One definition, used by the rules too. */
const NCR_PINCODE = /^(11|12[012]|20[13]|24[15])/;

@Injectable()
export class RoutingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly freight: FreightService,
    @Inject(CARRIER_REGISTRY) private readonly carriers: CarrierRegistry,
  ) {}

  async select(request: RoutingRequest): Promise<CarrierChoice> {
    const excluded: Array<{ carrierCode: string; reason: string }> = [];

    // The cost side comes from `FreightService`, which is what quoted this lane
    // to the buyer at checkout. A second implementation of the rate-card
    // arithmetic here would be a booking priced differently from the quote the
    // buyer accepted, which is the one number that must not move.
    const priced = await this.freight.quoteCandidates({
      fromPincode: request.fromPincode,
      toPincode: request.toPincode,
      weightGrams: request.weightGrams,
      units: request.units,
    });
    const priceOf = new Map(priced.map((p) => [p.carrierCode, p]));

    const rows = await this.prisma.$queryRaw<CarrierRow[]>`
      SELECT id, code, adapter_key, supports_leg, priority
        FROM logistics.carrier
       WHERE is_active
       ORDER BY priority`;

    const candidates: CarrierRow[] = [];
    for (const row of rows) {
      if (!row.supports_leg.includes(request.leg)) {
        excluded.push({ carrierCode: row.code, reason: `Does not carry ${request.leg} legs` });
        continue;
      }
      const adapter = this.carriers.get(row.code);
      if (!adapter) {
        excluded.push({ carrierCode: row.code, reason: 'No adapter is bound for this carrier' });
        continue;
      }
      // The adapter's own answer, not ours. Porter refuses inter-city here.
      const service = await adapter.checkServiceability(
        request.fromPincode,
        request.toPincode,
        request.weightGrams,
      );
      if (!service.serviceable) {
        excluded.push({
          carrierCode: row.code,
          reason: `Does not serve ${request.fromPincode} to ${request.toPincode}`,
        });
        continue;
      }
      candidates.push(row);
    }

    if (candidates.length === 0) {
      throw new NoCarrierError(request, excluded);
    }

    const rule = await this.matchingRule(request);
    if (rule) {
      const ruled = candidates.find((c) => c.code === rule.carrier_code);
      const fallback = rule.fallback_carrier_code
        ? candidates.find((c) => c.code === rule.fallback_carrier_code)
        : undefined;
      const chosen = ruled ?? fallback;
      if (chosen) {
        for (const other of candidates) {
          if (other.code !== chosen.code) {
            excluded.push({ carrierCode: other.code, reason: `Routing rule "${rule.name}"` });
          }
        }
        const quote = priceOf.get(chosen.code);
        return {
          carrierId: chosen.id,
          carrierCode: chosen.code,
          adapterKey: chosen.adapter_key,
          // A rule may name a carrier with no card for this lane — in-house on a
          // pilot route, typically. Zero is the honest figure for "no rate is
          // agreed"; `freight_cost` records what it actually cost.
          quotedFreight: quote?.amount ?? Money.ZERO,
          rateCardId: null,
          routingRuleId: rule.id,
          routeType: rule.route_type,
          ...this.eta(quote?.etaDays ?? null),
          excluded,
        };
      }
      // The rule named a carrier that cannot take this lane. That is worth
      // recording rather than silently ignoring: it is usually the rule that is
      // wrong, and nobody finds out from a consignment that shipped anyway.
      excluded.push({
        carrierCode: rule.carrier_code,
        reason: `Routing rule "${rule.name}" named it, but it cannot take this lane`,
      });
    }

    // `priced` is already cheapest-first, on the lane's own terms. Walking it in
    // order and taking the first carrier that survived the checks above is the
    // cost rule and the tie-break in one, and it cannot disagree with the quote
    // the buyer accepted at checkout.
    let best: { row: CarrierRow; amount: Money; days: number } | null = null;
    for (const quote of priced) {
      const row = candidates.find((c) => c.code === quote.carrierCode);
      if (!row) continue;
      if (!best) {
        best = { row, amount: quote.amount, days: quote.etaDays };
      } else {
        excluded.push({ carrierCode: row.code, reason: 'A cheaper carrier serves this lane' });
      }
    }
    for (const row of candidates) {
      if (!priceOf.has(row.code)) {
        excluded.push({
          carrierCode: row.code,
          reason: 'No rate card covers this lane and weight',
        });
      }
    }

    if (!best) throw new NoCarrierError(request, excluded);

    return {
      carrierId: best.row.id,
      carrierCode: best.row.code,
      adapterKey: best.row.adapter_key,
      quotedFreight: best.amount,
      rateCardId: null,
      routingRuleId: null,
      // DIRECT for a drop-ship: the machines go vendor to customer and never
      // touch a hub. `route_type` defaults to VIA_HUB in the schema, which is
      // the wrong default for this model and the reason it is always set here.
      routeType: 'DIRECT',
      ...this.eta(best.days),
      excluded,
    };
  }

  /**
   * Tier order, lowest trust first, as `vendor_tier` declares it.
   *
   * `routing_rule.min_vendor_tier` is read as the **ceiling** of the band the
   * rule targets, because the only seeded rule using it is "New or watchlist
   * vendor ships through the hub" at BRONZE — a rule about vendors we do not yet
   * trust. Reading it as a floor would route every PLATINUM vendor through the
   * hub and none of the new ones, which is the opposite of what it says.
   */
  private static readonly TIER_RANK: Readonly<Record<string, number>> = {
    WATCHLIST: 0,
    BRONZE: 1,
    SILVER: 2,
    GOLD: 3,
    PLATINUM: 4,
  };

  /** The highest-priority active rule whose conditions all hold. */
  private async matchingRule(request: RoutingRequest): Promise<{
    id: string;
    name: string;
    carrier_code: string;
    fallback_carrier_code: string | null;
    route_type: 'DIRECT' | 'VIA_HUB' | 'CONSOLIDATED';
  } | null> {
    const fromNcr = NCR_PINCODE.test(request.fromPincode);
    const toNcr = NCR_PINCODE.test(request.toPincode);
    const sameCity = request.fromCity.trim().toLowerCase() === request.toCity.trim().toLowerCase();

    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        carrier_code: string;
        fallback_carrier_code: string | null;
        route_type: 'DIRECT' | 'VIA_HUB' | 'CONSOLIDATED';
        min_vendor_tier: string | null;
      }>
    >`
      SELECT id, name, carrier_code, fallback_carrier_code, route_type,
             min_vendor_tier::text AS min_vendor_tier
        FROM logistics.routing_rule
       WHERE is_active
         AND effective_from <= CURRENT_DATE
         AND seal_must_be_intact = ${request.sealsIntact}
         AND (multi_vendor_order IS NULL OR multi_vendor_order = ${request.multiVendorOrder})
         AND (from_is_ncr IS NULL OR from_is_ncr = ${fromNcr})
         AND (to_is_ncr   IS NULL OR to_is_ncr   = ${toNcr})
         AND (same_city   IS NULL OR same_city   = ${sameCity})
         AND (min_units   IS NULL OR min_units  <= ${request.units})
         AND (max_units   IS NULL OR max_units  >= ${request.units})
         AND (min_value   IS NULL OR min_value  <= ${request.declaredValue.toString()}::numeric)
         AND (max_value   IS NULL OR max_value  >= ${request.declaredValue.toString()}::numeric)
       ORDER BY priority`;

    const tier = request.vendorTier ? RoutingService.TIER_RANK[request.vendorTier] : undefined;
    for (const row of rows) {
      if (row.min_vendor_tier !== null) {
        const ceiling = RoutingService.TIER_RANK[row.min_vendor_tier];
        if (ceiling === undefined || tier === undefined || tier > ceiling) continue;
      }
      return row;
    }
    return null;
  }

  /** A band, not an instant. A carrier that promises a minute is lying. */
  private eta(transitDays: number | null): { etaFrom: Date | null; etaTo: Date | null } {
    if (transitDays === null) return { etaFrom: null, etaTo: null };
    const day = 86_400_000;
    const from = new Date(this.clock.nowMs() + transitDays * day);
    return { etaFrom: from, etaTo: new Date(from.getTime() + day) };
  }
}

/**
 * Nothing can carry this consignment.
 *
 * It carries the exclusions rather than a bare message, because the first
 * question is always "why not", and the answer is per carrier.
 */
export class NoCarrierError extends Error {
  constructor(
    readonly request: RoutingRequest,
    readonly excluded: Array<{ carrierCode: string; reason: string }>,
  ) {
    super(
      `No carrier can take ${request.units} unit(s) from ${request.fromPincode} to ${request.toPincode}.`,
    );
    this.name = 'NoCarrierError';
  }
}
