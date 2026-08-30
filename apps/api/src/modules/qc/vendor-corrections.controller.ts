import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { money, type Grade } from '@trugrade/contracts';
import { RequirePermissions } from '../../shared/auth/guards';
import { ClockPort } from '../../shared/clock';
import { PrismaService } from '../../shared/db/prisma.service';
import { NotFoundError } from '../../shared/errors/domain-errors';
import { ZodValidationPipe } from '../../shared/http/http';
import {
  GradeCorrectionService,
  type VendorResponse,
} from './internal/grade-correction.service';
import { cfgNum, readConfig } from './internal/tolerance.service';
import {
  VendorCorrectionRepository,
  type VendorCorrectionRow,
} from './internal/vendor-correction.repository';
import {
  uuidSchema,
  vendorCorrectionResponseSchema,
  type VendorCorrectionResponseDto,
} from './dto/qc.dto';

/**
 * The vendor's side of a grade correction — the two days they have to answer.
 *
 * `GradeCorrectionService.respond()` has always implemented all four answers
 * transactionally, and until this file no controller exposed it. So
 * `listing.grade_correction.respond` was granted to three vendor roles and
 * guarded nothing, and every correction ever raised reached its deadline and
 * auto-applied — the vendor was told a machine had been re-graded and given no
 * way to say anything about it. A window you cannot answer inside is not a
 * window; it is a notice period.
 *
 * **This is not the QC console's queue and must never become it.**
 * `GET /api/qc/grade-corrections` spans every vendor by design and resolves a
 * vendor name onto each row. These routes read through
 * `VendorCorrectionRepository`, where the caller's org is a predicate rather than
 * a parameter, and the payload below is assembled field by field — no vendor
 * name (they are the vendor), no `vendor_org_id`, no retail price.
 *
 * **The permissions are the ones the vendor already holds.** Reading corrections
 * on your own machines is reading your own stock, so it is `listing.own.read`;
 * answering one is `listing.grade_correction.respond`, which existed for exactly
 * this and had nothing to guard. Nothing here needs a `qc.*` grant, which
 * matters: the two that were removed from vendor roles are unscoped console
 * permissions, and `qc-console-is-not-vendor-reachable.spec.ts` requires that a
 * vendor token carry no `qc.` permission at all.
 */

/** `platform_config`, effective-dated. The window is theirs; the number is ours. */
const AUTO_APPLY_DAYS_KEY = 'qc.grade_correction_auto_days';

/**
 * One correction as the vendor may see it.
 *
 * **Every time field is computed server-side.** The correction window is a money
 * deadline — when it closes, the corrected grade applies on its own and reprices
 * the machine — and a laptop with a wrong clock must not be able to move it, nor
 * two people see different numbers for the same row.
 *
 * `hoursUntilAutoApply` and `respondByAt` are `null` when the window could not be
 * read from config. **Null is not zero and not "on time".** The screen renders
 * the two differently, because "we cannot tell you how long you have" and "you
 * have no time left" are different sentences and only one of them is ever true.
 */
export interface VendorCorrectionView {
  id: string;
  unitId: string;
  listingId: string | null;
  serialNumber: string;
  skuCode: string;
  gradeDeclared: Grade;
  gradeCorrected: Grade;
  /** The verdict's own message to the vendor, not a code. */
  reason: string;
  /** Their own ask when the correction was raised. Never our selling price. */
  askBefore: string | null;
  vendorNotifiedAt: string;
  respondByAt: string | null;
  /** Negative once the window has closed. Still answerable until it auto-applies. */
  hoursUntilAutoApply: number | null;
  vendorResponse: VendorResponse | null;
  vendorRespondedAt: string | null;
  autoAppliedAt: string | null;
  /**
   * Feeds `qc.vendor_quality.grade_accuracy_pct`, which feeds the supply-point
   * comparison a buyer sees. Shown because it is a real consequence of accepting
   * and the one thing a successful dispute clears.
   */
  countsAgainstAccuracy: boolean;
}

const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());

@Controller('vendor/grade-corrections')
export class VendorCorrectionsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly repo: VendorCorrectionRepository,
    private readonly corrections: GradeCorrectionService,
  ) {}

  @Get()
  @RequirePermissions('listing.own.read')
  async list(): Promise<VendorCorrectionView[]> {
    return this.view(await this.repo.findForVendor());
  }

  @Get(':id')
  @RequirePermissions('listing.own.read')
  async one(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<VendorCorrectionView> {
    const [view] = await this.view(await this.repo.findForVendor(id));
    if (!view) throw new NotFoundError('grade_correction', { correctionId: id });
    return view;
  }

  /**
   * Answer it.
   *
   * **Ownership is established before the service is called**, because
   * `respond()` deliberately takes no principal — it is also the auto-apply job's
   * and the QC manager's path, and putting a session check inside it would make
   * two callers that have no session pass a fake one. So the row is fetched
   * through the org-scoped repository first, and a correction on another vendor's
   * machine is simply not there.
   *
   * The refusal is a 404 rather than a 403 on purpose: a 403 would confirm that
   * the id names a real correction belonging to somebody, which is a fact about a
   * competitor's stock.
   *
   * The answer is re-read through the same scoped query rather than mapped from
   * the service's return, so what the screen shows next is what the database
   * holds — including the auto-apply having won the race for the row.
   */
  @Post(':id/respond')
  @RequirePermissions('listing.grade_correction.respond')
  async respond(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(vendorCorrectionResponseSchema)) body: VendorCorrectionResponseDto,
  ): Promise<VendorCorrectionView> {
    const [mine] = await this.repo.findForVendor(id);
    if (!mine) throw new NotFoundError('grade_correction', { correctionId: id });

    await this.corrections.respond(id, body.response, {
      ...(body.vendorAskPrice ? { vendorAskPrice: body.vendorAskPrice } : {}),
      ...(body.note ? { note: body.note } : {}),
    });

    return this.one(id);
  }

  // -------------------------------------------------------------------------

  private async view(rows: readonly VendorCorrectionRow[]): Promise<VendorCorrectionView[]> {
    if (rows.length === 0) return [];
    const skus = await this.repo.skuCodes(rows.map((r) => r.skuId));
    const windowDays = await this.windowDays();
    const now = this.clock.nowMs();

    return rows.map((r) => {
      const notified = r.vendorNotifiedAt.getTime();
      const deadline = windowDays === null ? null : notified + windowDays * 86_400_000;
      return {
        id: r.id,
        unitId: r.unitId,
        listingId: r.listingId,
        serialNumber: r.serialNumber,
        // Not "Unknown SKU" silently standing in for a model name: the code is
        // how the vendor identifies the machine in their own system, and a SKU
        // that has gone missing is a fact the screen says out loud.
        skuCode: skus.get(r.skuId) ?? '',
        gradeDeclared: r.gradeDeclared,
        gradeCorrected: r.gradeCorrected,
        reason: r.reason,
        askBefore: r.askBefore === null ? null : money(r.askBefore).toJSON(),
        vendorNotifiedAt: r.vendorNotifiedAt.toISOString(),
        respondByAt: deadline === null ? null : new Date(deadline).toISOString(),
        hoursUntilAutoApply:
          deadline === null ? null : Math.round(((deadline - now) / 3_600_000) * 10) / 10,
        vendorResponse: r.vendorResponse as VendorResponse | null,
        vendorRespondedAt: iso(r.vendorRespondedAt),
        autoAppliedAt: iso(r.autoAppliedAt),
        countsAgainstAccuracy: r.countsAgainstAccuracy,
      };
    });
  }

  /**
   * The configured window, or null.
   *
   * `cfgNum` throws a 412 on a key that is missing or not a number, which is the
   * right answer for a job that must not guess and the wrong one for a screen:
   * it would take the whole list down over a deadline column. A window we cannot
   * read is reported as unmeasured — never as a window of zero, which would paint
   * every open correction as out of time.
   */
  private async windowDays(): Promise<number | null> {
    const cfg = await readConfig(this.prisma, [AUTO_APPLY_DAYS_KEY]);
    try {
      return cfgNum(cfg, AUTO_APPLY_DAYS_KEY);
    } catch {
      return null;
    }
  }
}
