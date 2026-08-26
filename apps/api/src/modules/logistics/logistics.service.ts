import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { pincodeSchema } from '@trugrade/contracts';
import { ZodValidationPipe } from '../../shared/http/http';
import {
  freightQuoteBatchSchema,
  freightQuoteRequestSchema,
  type DispatchEstimate,
  type FreightQuote,
  type FreightQuoteRequest,
} from './dto/freight.dto';
import { FreightService } from './internal/freight.service';
import { ServiceabilityService } from './internal/serviceability.service';

/**
 * The public interface of the `logistics` module.
 *
 * This interface is the future network contract (02_ARCHITECTURE.md §1.1 rule 4).
 * When `logistics` is extracted into its own service the folder moves, the
 * in-process bus becomes SQS and the direct call becomes an HTTP client — and
 * this interface does not change. That is the whole point of writing it down now,
 * and it is why every argument below is re-validated by a zod schema even though
 * TypeScript already typed it: on the day the caller is on the other side of a
 * socket, the types are gone and the schemas are all that is left.
 *
 * Owns: hubs, carriers, serviceability, riders, vehicles, shipments, shipment units, tracking, pickup/delivery tasks, routing rules, rate cards, route plans, route stops, delivery attempts, custody events
 *
 * Other modules reach this through `src/modules/logistics` (the barrel) and
 * nothing else. `internal/`, `entities/` and `dto/` are private, and the
 * `no-cross-module-import` lint rule makes that an error rather than a wish.
 */
export interface ILogisticsService {
  /** Liveness of this module's own dependencies, surfaced on /health. */
  selfCheck(): Promise<{ ok: boolean; detail?: string }>;

  /**
   * Freight for one lane, for the whole consignment, exclusive of GST.
   *
   * **Never throws for an address we cannot reach, and never returns a zero that
   * means "we could not price it".** PHASE_05 Task 5 puts this number inside the
   * landed price on a product page, so an unpriced lane that reads as free
   * freight is a price misrepresentation. The unserviceable arm of `FreightQuote`
   * carries `amount: null` and a sentence the buyer can act on.
   *
   * It *does* throw `ValidationError` on a malformed pincode or a non-integer
   * weight. That distinction is the useful one: a five-digit pincode is a caller
   * defect, whereas 799001 is a real place we do not serve yet.
   */
  quoteFreight(request: FreightQuoteRequest): Promise<FreightQuote>;

  /**
   * The same answer for many lanes, in a fixed number of statements.
   *
   * The offers grid prices ten supply points against one delivery pincode and
   * has a 500 ms p95 to hit (PHASE_05 Task 4). Ten calls to `quoteFreight` is
   * thirty statements; this is three. Key the returned Map with `freightLaneKey`.
   */
  quoteFreightBatch(
    requests: readonly FreightQuoteRequest[],
  ): Promise<Map<string, FreightQuote>>;

  /** Can any active carrier deliver here at all? The filter-level question. */
  isServiceable(pincode: string): Promise<boolean>;

  /**
   * The dispatch label for the offers grid — "Ships in 24 h" / "Ships in 48 h".
   *
   * Anonymised by construction: the string carries a duration and nothing else,
   * so it cannot reveal the origin city, the carrier or the vendor behind a
   * supply point. See `FreightService.dispatchEstimate`.
   */
  dispatchEstimate(input: {
    fromPincode: string;
    toPincode: string;
  }): Promise<DispatchEstimate>;
}

/**
 * Validation lives here, at the module's edge, and not in `internal/`.
 *
 * `ZodValidationPipe` is reused rather than re-implemented so a bad pincode
 * produces the identical field-keyed 422 whether it arrived through a controller
 * or through another module — one error shape, one place it is decided.
 */
const dispatchEstimateSchema = z.object({
  fromPincode: pincodeSchema,
  toPincode: pincodeSchema,
});

const parseQuote = new ZodValidationPipe(freightQuoteRequestSchema);
const parseBatch = new ZodValidationPipe(freightQuoteBatchSchema);
const parsePincode = new ZodValidationPipe(pincodeSchema);
const parseDispatch = new ZodValidationPipe(dispatchEstimateSchema);

@Injectable()
export class LogisticsService implements ILogisticsService {
  constructor(
    private readonly freight: FreightService,
    private readonly serviceability: ServiceabilityService,
  ) {}

  async selfCheck(): Promise<{ ok: boolean; detail?: string }> {
    return { ok: true };
  }

  async quoteFreight(request: FreightQuoteRequest): Promise<FreightQuote> {
    return this.freight.quote(parseQuote.transform(request) as FreightQuoteRequest);
  }

  async quoteFreightBatch(
    requests: readonly FreightQuoteRequest[],
  ): Promise<Map<string, FreightQuote>> {
    if (requests.length === 0) return new Map();
    return this.freight.quoteBatch(parseBatch.transform(requests) as FreightQuoteRequest[]);
  }

  async isServiceable(pincode: string): Promise<boolean> {
    return this.serviceability.isServiceable(parsePincode.transform(pincode) as string);
  }

  async dispatchEstimate(input: {
    fromPincode: string;
    toPincode: string;
  }): Promise<DispatchEstimate> {
    const { fromPincode, toPincode } = parseDispatch.transform(input) as {
      fromPincode: string;
      toPincode: string;
    };
    return this.freight.dispatchEstimate(fromPincode, toPincode);
  }
}
