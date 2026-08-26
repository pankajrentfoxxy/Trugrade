import { Injectable } from '@nestjs/common';
import { Money, moneyFromDb } from '@trugrade/contracts';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ClockPort } from '../../../shared/clock';
import {
  freightLaneKey,
  type DispatchEstimate,
  type FreightQuote,
  type FreightQuoteRequest,
} from '../dto/freight.dto';
import { ServiceabilityService, type CarrierService } from './serviceability.service';

/**
 * Freight pricing, out of `logistics.carrier_rate_card`.
 *
 * ## Why there is no carrier API call here
 *
 * Q12/Q13: no carrier account is live, so every adapter runs under
 * `INTEGRATION_MODE=mock` and the fakes in `shared/adapters/fakes` are the only
 * implementations that exist. That is not quite the reason this file ignores
 * them, though — the reason is that a rate quote was never going to come from a
 * carrier API. `FakeBlueDart.quote()` throws `NO_RATE_API` and says so in the
 * hint: Blue Dart publishes no rate-quote API, and quotes come from our own
 * contract card. The negotiated card in the database is the authority on price
 * for every carrier we will ever add; `pincode_serviceability` is the synced
 * view of the one thing carriers do publish. Booking a shipment (Phase 8) goes
 * through `CarrierPort`. Pricing one does not.
 *
 * ## Why nothing is cached
 *
 * The same argument as `MarginRuleRepository`: a fuel surcharge ops edits on
 * Tuesday has to move the landed price on Tuesday, and a process-lifetime cache
 * makes that true only after a restart — intermittently, because one pod
 * restarts and the other does not. The card table is a few dozen rows; the whole
 * batch costs three statements however many lanes it prices.
 */

/** A rate card, with its weight band already in integer grams. See `activeCards`. */
interface RateCard {
  carrierId: string;
  fromZone: string;
  toZone: string;
  fromGrams: number;
  toGrams: number;
  baseRate: Money;
  perKgRate: Money;
  fuelSurchargePct: number;
  odaSurcharge: Money;
  minCharge: Money;
}

interface RateCardRow {
  carrier_id: string;
  from_zone: string;
  to_zone: string;
  from_grams: number;
  to_grams: number;
  base_rate: unknown;
  per_kg_rate: unknown;
  fuel_surcharge_pct: unknown;
  oda_surcharge: unknown;
  min_charge: unknown;
}

const unserviceable = (reason: string): FreightQuote => ({
  serviceable: false,
  amount: null,
  carrierCode: null,
  etaDays: null,
  reason,
});

@Injectable()
export class FreightService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly serviceability: ServiceabilityService,
  ) {}

  /**
   * Price every lane in three statements, whatever the length of the array.
   *
   * `quote()` is a one-element call into this, so a single quote and a batched
   * one cannot drift apart. The integration test asserts they agree; the reason
   * they agree is that there is only one implementation of the arithmetic.
   */
  async quoteBatch(requests: readonly FreightQuoteRequest[]): Promise<Map<string, FreightQuote>> {
    const out = new Map<string, FreightQuote>();
    if (requests.length === 0) return out;

    const destinations = requests.map((r) => r.toPincode);
    const [zones, services, cards] = await Promise.all([
      this.serviceability.zonesFor([...requests.map((r) => r.fromPincode), ...destinations]),
      this.serviceability.outboundServicesFor(destinations),
      this.activeCards(),
    ]);

    for (const request of requests) {
      const key = freightLaneKey(request);
      // Two identical lanes in one batch are one computation, not two.
      if (!out.has(key)) out.set(key, this.priceOne(request, zones, services, cards));
    }
    return out;
  }

  async quote(request: FreightQuoteRequest): Promise<FreightQuote> {
    const quotes = await this.quoteBatch([request]);
    // The key is derived from the same request, so the lookup always hits.
    return quotes.get(freightLaneKey(request)) ?? unserviceable(this.notDeliverable(request));
  }

  /**
   * "Ships in 24 h" / "Ships in 48 h", and nothing else in the string.
   *
   * PHASE_05 Task 3 lists dispatch commitment as a filter and Task 4 puts it in
   * the offers grid, immediately beside `Supply Point A · Gurugram`. That label
   * is the entire budget of location detail a buyer is allowed — so this string
   * may not name the origin city, the hub, the carrier or a vendor lead time,
   * and it may not vary in a way that lets a buyer tell two anonymous supply
   * points apart. A duration bucket satisfies all of that: two supply points in
   * the same city produce the identical string.
   *
   * The bucket comes from the lane, not from a vendor SLA. Vendor lead time
   * lives in `vendor` and is deliberately not reached for: it varies per vendor,
   * which is exactly the correlation the anonymity model forbids.
   */
  async dispatchEstimate(fromPincode: string, toPincode: string): Promise<DispatchEstimate> {
    // A representative boxed laptop. Dispatch speed is a property of the lane,
    // not of the consignment, so the weight here only has to find a rate card.
    const quote = await this.quote({ fromPincode, toPincode, weightGrams: 2500, units: 1 });
    if (!quote.serviceable) return { label: 'Not deliverable to this PIN code' };
    return { label: quote.etaDays <= 1 ? 'Ships in 24 h' : 'Ships in 48 h' };
  }

  // -------------------------------------------------------------------------

  private priceOne(
    request: FreightQuoteRequest,
    zones: Map<string, { zone: string }>,
    services: Map<string, CarrierService[]>,
    cards: readonly RateCard[],
  ): FreightQuote {
    const destination = zones.get(request.toPincode);
    if (!destination) {
      // Unknown to India Post's list: a typo far more often than a real address,
      // and the buyer is the only person who can fix it.
      return unserviceable(
        `We don't recognise PIN code ${request.toPincode}. Check the six digits and try again.`,
      );
    }

    // From here on the reason text never mentions the origin — see notDeliverable.
    const origin = zones.get(request.fromPincode);
    if (!origin) return unserviceable(this.notDeliverable(request));

    const available = services.get(request.toPincode) ?? [];
    if (available.length === 0) {
      return unserviceable(
        `We don't deliver to ${request.toPincode} yet — our current service area is Delhi NCR.`,
      );
    }

    const totalGrams = request.weightGrams * request.units;
    const candidates: Array<{ amount: Money; carrierCode: string; etaDays: number }> = [];
    let laneHasACard = false;

    for (const service of available) {
      for (const card of cards) {
        if (card.carrierId !== service.carrierId) continue;
        if (card.fromZone !== origin.zone || card.toZone !== destination.zone) continue;
        laneHasACard = true;
        // The band is closed at both ends on purpose. Two cards that both claim
        // exactly 5.00 kg cannot produce a wrong answer, because the selection
        // below is a minimum — whereas a half-open band ops mis-enters leaves a
        // gram of weight with no price at all, and that is a lost sale.
        if (totalGrams < card.fromGrams || totalGrams > card.toGrams) continue;
        candidates.push({
          amount: this.priceCard(card, totalGrams, service.isOda),
          carrierCode: service.carrierCode,
          // The slower end of the band. Under-promising a delivery date is a
          // choice; over-promising one is a representation we have to defend.
          etaDays: service.transitDaysMax,
        });
      }
    }

    if (candidates.length === 0) {
      if (laneHasACard) {
        return unserviceable(
          `A consignment this heavy is beyond our parcel rates. Ask for a bulk quote and we will price it as freight.`,
        );
      }
      return unserviceable(this.notDeliverable(request));
    }

    // Cheapest wins, ties broken by speed and then by carrier code. Every term
    // is a property of the lane and never of the source: a tie-break on carrier
    // id, row order or insertion time would make the quote correlate with
    // something vendor-shaped, which PHASE_05 Task 4 rules out for the offers
    // sort and which is no more acceptable one column to the left.
    candidates.sort(
      (a, b) =>
        (a.amount.lt(b.amount) ? -1 : a.amount.gt(b.amount) ? 1 : 0) ||
        a.etaDays - b.etaDays ||
        a.carrierCode.localeCompare(b.carrierCode),
    );

    const best = candidates[0]!;
    return {
      serviceable: true,
      amount: best.amount,
      carrierCode: best.carrierCode,
      etaDays: best.etaDays,
    };
  }

  /**
   * The one message used whenever the origin is what failed.
   *
   * It names the destination and stops. An unknown origin pincode and a lane
   * with no rate card both mean "this supply point cannot reach you" — and
   * saying which supply point, or where it is, or that a different row on the
   * same page could, hands the buyer a way to tell two anonymous supply points
   * apart by their geography. `_CONTEXT.md` §"Vendor anonymity display rule"
   * counts an error message as a customer-facing response, and it is right to.
   */
  private notDeliverable(request: FreightQuoteRequest): string {
    return `We can't deliver this item to ${request.toPincode} yet. Try another PIN code, or ask us to source it for you.`;
  }

  /**
   * base + per-kg + fuel %, plus ODA where it applies, floored at the minimum.
   *
   * Integer paise throughout: `Money.fromRatio(perKgRate, grams, 1000)` is the
   * per-kilogram charge without a float ever existing. VR-126 is not negotiable
   * in a number that ends up on an invoice.
   *
   * `insurance_pct` is deliberately not applied. It is a percentage of declared
   * value, this call has no declared value, and inventing one would put a wrong
   * number into a published price. Insurance is priced when a shipment is booked
   * against a real consignment value (Phase 8).
   */
  private priceCard(card: RateCard, totalGrams: number, isOda: boolean): Money {
    const perKg = Money.fromRatio(card.perKgRate, BigInt(totalGrams), 1000n);
    let amount = card.baseRate.add(perKg);
    if (card.fuelSurchargePct > 0) {
      amount = amount.add(Money.percentOf(amount, card.fuelSurchargePct));
    }
    if (isOda) amount = amount.add(card.odaSurcharge);
    return Money.max(amount, card.minCharge);
  }

  /**
   * Every card in force on today's IST business date.
   *
   * The weight bounds are converted to integer grams in Postgres, where NUMERIC
   * arithmetic is exact. `Number(weight_from_kg) * 1000` in JavaScript gives
   * 50.000000000000007 for a 0.05 kg band, and a boundary comparison off by a
   * floating-point epsilon is the kind of bug that only appears on the one order
   * sitting exactly on a slab edge.
   */
  private async activeCards(): Promise<RateCard[]> {
    // VR-160: effective dating is a business window, reckoned on the IST date.
    // A card effective from the 1st is live at midnight in Delhi, not at 05:30.
    const today = this.clock.todayInIst();
    const rows = await this.prisma.$queryRaw<RateCardRow[]>`
      SELECT carrier_id,
             from_zone,
             to_zone,
             (weight_from_kg * 1000)::int AS from_grams,
             (weight_to_kg   * 1000)::int AS to_grams,
             base_rate,
             per_kg_rate,
             fuel_surcharge_pct,
             oda_surcharge,
             min_charge
        FROM logistics.carrier_rate_card
       WHERE effective_from <= ${today}::date
         AND (effective_to IS NULL OR effective_to > ${today}::date)`;

    return rows.map((r) => ({
      carrierId: r.carrier_id,
      fromZone: r.from_zone,
      toZone: r.to_zone,
      fromGrams: r.from_grams,
      toGrams: r.to_grams,
      // Every monetary column goes through moneyFromDb. Prisma hands back a
      // Decimal, and `Number()` on one of these is the float bug VR-126 exists
      // to stop. The columns are NOT NULL, hence the assertions.
      baseRate: moneyFromDb(r.base_rate as string)!,
      perKgRate: moneyFromDb(r.per_kg_rate as string)!,
      // A rate, not an amount — NUMERIC(5,2), and Number is the right conversion
      // for it. The same call one column over would be a defect.
      fuelSurchargePct: Number(r.fuel_surcharge_pct),
      odaSurcharge: moneyFromDb(r.oda_surcharge as string)!,
      minCharge: moneyFromDb(r.min_charge as string)!,
    }));
  }
}
