import { Injectable } from '@nestjs/common';

/**
 * The public interface of the `logistics` module.
 *
 * This interface is the future network contract (02_ARCHITECTURE.md §1.1 rule 4).
 * When `logistics` is extracted into its own service the folder moves, the in-process
 * bus becomes SQS and the direct call becomes an HTTP client — and this interface
 * does not change. That is the whole point of writing it down now.
 *
 * Owns: hubs, carriers, serviceability, riders, vehicles, shipments, shipment units, tracking, pickup/delivery tasks, routing rules, rate cards, route plans, route stops, delivery attempts, custody events
 *
 * Other modules reach this through `src/modules/logistics` (the barrel) and nothing
 * else. `internal/`, `entities/` and `dto/` are private, and the
 * `no-cross-module-import` lint rule makes that an error rather than a wish.
 */
export interface ILogisticsService {
  /** Liveness of this module's own dependencies, surfaced on /health. */
  selfCheck(): Promise<{ ok: boolean; detail?: string }>;
}

@Injectable()
export class LogisticsService implements ILogisticsService {
  async selfCheck(): Promise<{ ok: boolean; detail?: string }> {
    return { ok: true };
  }
}
