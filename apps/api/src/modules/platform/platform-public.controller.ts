import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '../../shared/auth/guards';
import { PrismaService } from '../../shared/db/prisma.service';

/**
 * The numbers the public legal pages state — T48, `03_UX_SPEC.md` §3A.8.
 *
 * ## Why this endpoint exists at all
 *
 * `/legal/returns-and-refunds` says how long a buyer has to send a machine back.
 * `/legal/warranty` says how long we cover it. `/legal/grievance` says how fast
 * we answer. Every one of those sentences is a promise a customer can hold us
 * to, and every one of them is enforced somewhere else by a `platform_config`
 * key — `ReturnsService.windowHours`, `WarrantyService`'s
 * `max(vendor + top-up, floor)`, and the r.4(5) clock.
 *
 * A page that compiled those numbers into its own build would be the exact
 * failure `ReturnsService`'s header warns about, one step worse: ops changes the
 * window, the product starts enforcing the new one, and the published document
 * still promises the old one. That is not a stale cache, it is a liability made
 * of prose. So the page reads the same view the enforcement reads, and there is
 * one source for the number.
 *
 * ## Why the values are nullable and there are no defaults
 *
 * `platform.v_current_config` answers "nothing is set" with an absent row, and
 * that comes back as `null` rather than as the seeded figure. A legal page must
 * never *invent* a term: 48 printed because the code assumed 48 is a promise
 * nobody in the business made. The storefront renders an unset key as "Not
 * published" in `--ink-4` and says the term is unstated, which is the same rule
 * the rest of the product follows — a missing value never renders as a passing
 * one.
 *
 * ## Why it is a read of five named keys and not a config API
 *
 * `PlatformAdminController`'s header is explicit that `platform_config` is the
 * live control surface for pricing, QC gates and TDS. Exposing it publicly, even
 * read-only, would put the whole of that surface on an unauthenticated route.
 * These five are named individually because these five are the ones a published
 * document quotes, and adding a sixth should be a deliberate act with a page to
 * justify it.
 */

/** The five keys a legal page is allowed to quote. Nothing else is public. */
const LEGAL_KEYS = [
  'ordering.inspection_window_hours',
  'platform.warranty_top_up_months',
  'platform.warranty_min_total_months',
  'platform.grievance_ack_hours',
  'platform.grievance_redress_days',
] as const;

export interface PublicLegalTerms {
  /** r.7(4) take-back, and the payout-eligibility clock. Null when unset. */
  inspectionWindowHours: number | null;
  /** Months we add on top of whatever the supply point backs. */
  warrantyTopUpMonths: number | null;
  /** The floor we sell regardless of the supply point's term. */
  warrantyMinTotalMonths: number | null;
  /** r.4(5) acknowledgement clock. */
  grievanceAckHours: number | null;
  /** r.4(5) redress clock. */
  grievanceRedressDays: number | null;
}

@Controller('public')
export class PlatformPublicController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('legal-terms')
  @Public()
  @Header('Cache-Control', 'public, max-age=300')
  async legalTerms(): Promise<PublicLegalTerms> {
    const rows = await this.prisma.$queryRaw<Array<{ key: string; value_json: unknown }>>`
      SELECT key, value_json FROM platform.v_current_config
       WHERE key = ANY(${[...LEGAL_KEYS]}::text[])`;
    const by = new Map(rows.map((r) => [r.key, r.value_json]));

    // A key holding a string, an object or NaN is not a number of hours. It
    // comes back null and the page says the term is unpublished, rather than
    // printing whatever JSON happened to be in the row.
    const num = (key: string): number | null => {
      const raw = by.get(key);
      return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
    };

    return {
      inspectionWindowHours: num('ordering.inspection_window_hours'),
      warrantyTopUpMonths: num('platform.warranty_top_up_months'),
      warrantyMinTotalMonths: num('platform.warranty_min_total_months'),
      grievanceAckHours: num('platform.grievance_ack_hours'),
      grievanceRedressDays: num('platform.grievance_redress_days'),
    };
  }
}
