import { Controller, Get, Query } from '@nestjs/common';
import type { BoardEnvelope, BoardQuery } from '@trugrade/contracts';
import { RequirePermissions } from '../../shared/auth/guards';
import {
  InspectionBoardService,
  type InspectionRow,
  type TechnicianLoad,
} from './internal/inspection-board.service';

/**
 * Supply › Inspections — Stage 9.
 *
 * Read-only. Assigning a technician is `POST /qc/visits/:visitId/schedule`,
 * which already exists and already runs `SchedulingService`'s six checks —
 * facility hours, holiday calendar, zone, tool certification, availability, day
 * capacity and licence seat. A second assignment path here would be a second
 * place for those checks to be forgotten.
 */
@Controller('qc/inspections')
export class InspectionsController {
  constructor(private readonly board: InspectionBoardService) {}

  @Get()
  @RequirePermissions('qc.visit.read')
  visits(@Query() query: Record<string, string>): Promise<BoardEnvelope<InspectionRow>> {
    const facet: Record<string, string> = {};
    for (const [key, value] of Object.entries(query)) {
      if (key.startsWith('facet.') && value) facet[key.slice(6)] = value;
    }
    const page = Number(query.page);
    const per = Number(query.per);
    const parsed: BoardQuery = {
      ...(query.view ? { view: query.view } : {}),
      ...(query.q ? { q: query.q } : {}),
      ...(Number.isFinite(page) && page > 0 ? { page } : {}),
      ...(Number.isFinite(per) && per > 0 ? { per } : {}),
      facet,
    };
    return this.board.visits(parsed);
  }

  /**
   * Technician load for the next fortnight.
   *
   * Behind `qc.visit.schedule` rather than `qc.visit.read`: this is the
   * assignment decision's data, and who is busy on which day is a roster fact
   * that a read-only QC seat has no call to see.
   */
  @Get('workload')
  @RequirePermissions('qc.visit.schedule')
  workload(): Promise<TechnicianLoad[]> {
    return this.board.workload();
  }
}
