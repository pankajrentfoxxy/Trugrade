import { Injectable } from '@nestjs/common';

/**
 * The public interface of the `platform` module.
 *
 * This interface is the future network contract (02_ARCHITECTURE.md §1.1 rule 4).
 * When `platform` is extracted into its own service the folder moves, the in-process
 * bus becomes SQS and the direct call becomes an HTTP client — and this interface
 * does not change. That is the whole point of writing it down now.
 *
 * Owns: returns, warranty, warranty claims, tickets, disputes, vendor scorecards, reviews, config, feature flags, notification templates/log, integration log, data-subject requests
 *
 * Other modules reach this through `src/modules/platform` (the barrel) and nothing
 * else. `internal/`, `entities/` and `dto/` are private, and the
 * `no-cross-module-import` lint rule makes that an error rather than a wish.
 */
export interface IPlatformService {
  /** Liveness of this module's own dependencies, surfaced on /health. */
  selfCheck(): Promise<{ ok: boolean; detail?: string }>;
}

@Injectable()
export class PlatformService implements IPlatformService {
  async selfCheck(): Promise<{ ok: boolean; detail?: string }> {
    return { ok: true };
  }
}
