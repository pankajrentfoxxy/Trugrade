import { Controller, Get, Query } from '@nestjs/common';
import type { BoardEnvelope, BoardQuery } from '@trugrade/contracts';
import { RequirePermissions } from '../../shared/auth/guards';
import {
  FinanceBoardService,
  type PayableRow,
  type PayoutRunRow,
} from './internal/finance-board.service';

/**
 * The finance boards.
 *
 * Read-only. Every act that moves money — creating a run, approving it,
 * releasing it, confirming a UTR — is on `PayoutController`, behind its own
 * permission and its own maker-checker. A board is for deciding what to do, not
 * for doing it.
 */
@Controller('ops/finance')
export class FinanceBoardsController {
  constructor(private readonly boards: FinanceBoardService) {}

  @Get('payables')
  @RequirePermissions('procurement.payable.read_any')
  payables(@Query() query: Record<string, string>): Promise<BoardEnvelope<PayableRow>> {
    return this.boards.payables(parse(query));
  }

  @Get('payout-runs')
  @RequirePermissions('procurement.po.read_any')
  payoutRuns(@Query() query: Record<string, string>): Promise<BoardEnvelope<PayoutRunRow>> {
    return this.boards.payoutRuns(parse(query));
  }
}

function parse(query: Record<string, string>): BoardQuery {
  const facet: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (key.startsWith('facet.') && value) facet[key.slice(6)] = value;
  }
  const page = Number(query.page);
  const per = Number(query.per);
  return {
    ...(query.view ? { view: query.view } : {}),
    ...(query.q ? { q: query.q } : {}),
    ...(query.sort ? { sort: query.sort } : {}),
    ...(query.dir === 'asc' || query.dir === 'desc' ? { dir: query.dir } : {}),
    ...(Number.isFinite(page) && page > 0 ? { page } : {}),
    ...(Number.isFinite(per) && per > 0 ? { per } : {}),
    facet,
  };
}
