import { Injectable } from '@nestjs/common';

/**
 * The public interface of the `vendor` module.
 *
 * This interface is the future network contract (02_ARCHITECTURE.md §1.1 rule 4).
 * When `vendor` is extracted into its own service the folder moves, the in-process
 * bus becomes SQS and the direct call becomes an HTTP client — and this interface
 * does not change. That is the whole point of writing it down now.
 *
 * Owns: vendor profiles, capability, facilities, hours, certifications, payout preferences, sourcing declarations
 *
 * Other modules reach this through `src/modules/vendor` (the barrel) and nothing
 * else. `internal/`, `entities/` and `dto/` are private, and the
 * `no-cross-module-import` lint rule makes that an error rather than a wish.
 */
export interface IVendorService {
  /** Liveness of this module's own dependencies, surfaced on /health. */
  selfCheck(): Promise<{ ok: boolean; detail?: string }>;
}

@Injectable()
export class VendorService implements IVendorService {
  async selfCheck(): Promise<{ ok: boolean; detail?: string }> {
    return { ok: true };
  }
}
