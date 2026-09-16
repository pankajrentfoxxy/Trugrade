import { Controller, Get, Header, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { RequirePermissions } from '../../shared/auth/guards';
import {
  FinanceExportService,
  REGISTER_KEYS,
  type ExportResult,
} from './internal/finance-export.service';

/**
 * Register exports — Stage 7 §7.1.
 *
 * `finance.export.run` is the only verb the CA seat holds, and the audit row the
 * service writes is the reason it is allowed to. The route is here rather than
 * in `payment` because the registers span payment and procurement and no module
 * owns the combination — the same rule the ops and finance controllers follow.
 */
@Controller('finance/exports')
@RequirePermissions('finance.export.run')
export class ExportController {
  constructor(private readonly exports: FinanceExportService) {}

  /** What can be pulled. A CA opens this before they open anything else. */
  @Get()
  registers(): { registers: readonly string[] } {
    return { registers: REGISTER_KEYS };
  }

  /**
   * The CSV itself.
   *
   * Streamed as a download rather than JSON because the thing a CA does next is
   * open it in Tally or Excel, and `Content-Disposition` is what makes the
   * browser hand them a file instead of a wall of text.
   */
  @Get('run')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async run(
    @Query('register') register: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const result: ExportResult = await this.exports.run({ register, from, to });
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    // The count travels in a header as well as in the audit row, so the console
    // can say "412 rows" without parsing the file it just handed the browser.
    res.setHeader('X-Row-Count', String(result.rowCount));
    return result.csv;
  }
}
