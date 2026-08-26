import { z } from 'zod';
import { pincodeSchema, type Money } from '@trugrade/contracts';

/**
 * The freight contract: what a caller may ask, and what it gets back.
 *
 * These types live in `dto/` rather than beside `ILogisticsService` for a boring
 * reason — `internal/freight.service.ts` needs them too, and importing them from
 * `logistics.service.ts` would make the module's root and its internals import
 * each other at runtime. A leaf file that neither imports is the cheap fix.
 */

/**
 * A single lane, priced for a whole consignment.
 *
 * `weightGrams` is **per unit** and `units` multiplies it. The offers grid asks
 * for "three of these to 122001", and a caller that has to pre-multiply is a
 * caller that will eventually forget to.
 */
export const freightQuoteRequestSchema = z.object({
  fromPincode: pincodeSchema,
  toPincode: pincodeSchema,
  /** A boxed laptop is ~2 500 g. The ceiling is a sanity bound, not a policy. */
  weightGrams: z.number().int().positive().max(150_000),
  units: z.number().int().positive().max(500),
});

export type FreightQuoteRequest = z.infer<typeof freightQuoteRequestSchema>;

/**
 * The offers grid prices every supply point on a SKU at once. Ten is the number
 * PHASE_05 names; fifty is the point at which somebody is using this as a bulk
 * pricing API and should be told to say so.
 */
export const freightQuoteBatchSchema = z.array(freightQuoteRequestSchema).min(1).max(50);

/**
 * A freight quote, as a discriminated union — and this shape is the whole point.
 *
 * PHASE_05 Task 5 puts freight inside the landed price a buyer sees on the
 * product page. **A zero that really means "we could not price this lane" is a
 * price misrepresentation under CP e-Comm r.6(5)**, and it is the failure mode a
 * `{ amount: Money; serviceable: boolean }` struct invites: the caller reads
 * `amount` first, gets `Money.ZERO`, and ships a landed price missing its
 * freight.
 *
 * So the unserviceable arm carries `amount: null`. `landedPrice({ freight })`
 * will not take a null, which turns "forgot to check `serviceable`" from a wrong
 * number on a live product page into a compile error.
 */
export type FreightQuote =
  | {
      serviceable: true;
      /** Freight for the whole consignment, exclusive of GST. */
      amount: Money;
      carrierCode: string;
      /** The slower end of the carrier's transit band. See `FreightService`. */
      etaDays: number;
      reason?: undefined;
    }
  | {
      serviceable: false;
      amount: null;
      carrierCode: null;
      etaDays: null;
      /**
       * A sentence a buyer can act on — and one that never names the origin.
       * See the anonymity note on `FreightService.reasonFor`.
       */
      reason: string;
    };

/**
 * The key `quoteFreightBatch` returns its Map under.
 *
 * Exported because a Map whose key format the caller has to guess is a Map the
 * caller will guess wrong. Every field of the request is in the key: two supply
 * points in the same pincode quoting different quantities are two answers, not
 * one.
 */
export function freightLaneKey(r: FreightQuoteRequest): string {
  return `${r.fromPincode}:${r.toPincode}:${r.weightGrams}:${r.units}`;
}

/**
 * What the product page's "Dispatch" column renders.
 *
 * One string and nothing else, deliberately — see `dispatchEstimate` on
 * `ILogisticsService` for why there is no city, no hub and no carrier in here.
 */
export interface DispatchEstimate {
  label: string;
}
