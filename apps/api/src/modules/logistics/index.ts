/**
 * The PUBLIC barrel for `logistics`.
 *
 * Re-export only: the service interface, the concrete service token, the module,
 * this module's event payload types, and any DTO that is genuinely part of the
 * contract. Never a repository, never an entity, never an internal DTO.
 *
 * Anything added here becomes something another module may depend on, so adding
 * to this file is an architectural decision, not a convenience.
 */
export { type ILogisticsService, LogisticsService } from './logistics.service';
export { LogisticsModule } from './logistics.module';

/**
 * The freight contract. `FreightQuote` is a discriminated union and must stay
 * one: it is what stops a caller reading `amount` without having checked
 * `serviceable`, and therefore what stops an unpriced lane from being published
 * as free freight inside a landed price.
 *
 * `freightLaneKey` is exported because `quoteFreightBatch` returns a Map keyed by
 * it, and a key format the caller has to guess is a key the caller guesses wrong.
 */
export {
  freightLaneKey,
  freightQuoteRequestSchema,
  type DispatchEstimate,
  type FreightQuote,
  type FreightQuoteRequest,
} from './dto/freight.dto';
