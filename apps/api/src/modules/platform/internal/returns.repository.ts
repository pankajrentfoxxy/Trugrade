import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/db/prisma.service';

/**
 * Every read and write of `platform.return_request` — T24.
 *
 * The table had **zero rows and no writer anywhere in `src`** before this file,
 * which is why three things about it had never been tested: its `reason_code`
 * CHECK did not carry the spec's "seal broken on arrival", nothing stopped two
 * open returns on one machine, and there was no index on the column every query
 * here filters by. The migration alongside this task closes all three.
 *
 * **Org scoping lives here, in the WHERE clause, and nowhere above it.**
 * `return_request.buyer_org_id` is the column that says whose, and there is no
 * method on this class that reads a return without one — so there is nothing for
 * a service to forget. A return belonging to another organisation is simply not
 * returned, which is what lets the service answer 404 rather than 403 without
 * having to know it was refused.
 *
 * Every query touches exactly one module schema. The fuse between "what this org
 * owns" and "what returns exist" is made in TypeScript one layer up, against the
 * unit ids `ordering` has already confirmed the caller bought.
 */

export interface ReturnRow {
  id: string;
  returnNumber: string;
  orderLineUnitId: string;
  reasonCode: string;
  description: string | null;
  evidenceKeys: string[];
  status: string;
  raisedAt: Date;
  resolution: string | null;
}

export interface RaiseReturnInput {
  returnNumber: string;
  orderLineUnitId: string;
  buyerOrgId: string;
  reasonCode: string;
  description: string;
  evidenceKeys: readonly string[];
}

interface RawReturn {
  id: string;
  return_number: string;
  order_line_unit_id: string;
  reason_code: string;
  description: string | null;
  evidence_keys: string[];
  status: string;
  raised_at: Date;
  resolution: string | null;
}

/**
 * The columns, named once.
 *
 * `approved_by` and nothing else is deliberately absent: it is one of our own
 * staff, and a buyer-reachable payload that carried it would name a person on
 * our side of a dispute. It is not selected rather than being dropped later,
 * for the same reason every other shape in this module is an allow-list.
 */
const COLUMNS = `id, return_number, order_line_unit_id, reason_code, description,
                 evidence_keys, status, raised_at, resolution`;

const toReturn = (r: RawReturn): ReturnRow => ({
  id: r.id,
  returnNumber: r.return_number,
  orderLineUnitId: r.order_line_unit_id,
  reasonCode: r.reason_code,
  description: r.description,
  evidenceKeys: r.evidence_keys ?? [],
  status: r.status,
  raisedAt: r.raised_at,
  resolution: r.resolution,
});

/**
 * The statuses that mean this return is finished with.
 *
 * The same list as `uq_return_open_per_unit`'s predicate, and that is the point:
 * the index decides whether a second return may be raised on a machine, and a
 * service that disagreed with it would refuse requests the database would have
 * accepted, or promise ones it will reject with a constraint violation.
 */
export const CLOSED_RETURN_STATUSES = [
  'REJECTED',
  'CANCELLED',
  'REFUNDED',
  'REPLACED',
  'RETURNED_TO_BUYER',
] as const;

@Injectable()
export class ReturnsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Every return this organisation has raised, newest first. */
  async forOrg(orgId: string): Promise<ReturnRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<RawReturn[]>(
      `SELECT ${COLUMNS} FROM platform.return_request
        WHERE buyer_org_id = $1::uuid
        ORDER BY raised_at DESC`,
      orgId,
    );
    return rows.map(toReturn);
  }

  /** One return, by its number, scoped. A miss is a miss — never a refusal. */
  async forOrgByNumber(orgId: string, returnNumber: string): Promise<ReturnRow | null> {
    const rows = await this.prisma.$queryRawUnsafe<RawReturn[]>(
      `SELECT ${COLUMNS} FROM platform.return_request
        WHERE buyer_org_id = $1::uuid AND return_number = $2`,
      orgId,
      returnNumber,
    );
    return rows[0] ? toReturn(rows[0]) : null;
  }

  /**
   * The live returns on a set of machines, keyed by `order_line_unit_id`.
   *
   * Used both to tell the buyer their machine already has a return open and to
   * keep the automatic broken-seal discrepancy from raising a second one. Only
   * the live ones: a return rejected last month must not block a new one.
   */
  async openByOrderLineUnit(
    orgId: string,
    orderLineUnitIds: readonly string[],
  ): Promise<Map<string, ReturnRow>> {
    if (orderLineUnitIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRawUnsafe<RawReturn[]>(
      `SELECT ${COLUMNS} FROM platform.return_request
        WHERE buyer_org_id = $1::uuid
          AND order_line_unit_id = ANY($2::uuid[])
          AND status <> ALL($3::text[])`,
      orgId,
      [...orderLineUnitIds],
      [...CLOSED_RETURN_STATUSES],
    );
    return new Map(rows.map((r) => [r.order_line_unit_id, toReturn(r)]));
  }

  /**
   * Raise one.
   *
   * `RAISED` is the column default and is written explicitly anyway — T23 found
   * `warranty_claim.status` defaulting to a value absent from its own CHECK,
   * which nobody had hit because nothing had ever inserted a row. This table was
   * in exactly that position until now.
   */
  async raise(input: RaiseReturnInput): Promise<ReturnRow> {
    const rows = await this.prisma.$queryRawUnsafe<RawReturn[]>(
      `INSERT INTO platform.return_request
              (return_number, order_line_unit_id, buyer_org_id, reason_code,
               description, evidence_keys, status)
       VALUES ($1, $2::uuid, $3::uuid, $4, $5, $6::text[], 'RAISED')
       RETURNING ${COLUMNS}`,
      input.returnNumber,
      input.orderLineUnitId,
      input.buyerOrgId,
      input.reasonCode,
      input.description,
      [...input.evidenceKeys],
    );
    return toReturn(rows[0]!);
  }

  /** `platform.v_current_config`, the same view the warranty term is read from. */
  async config(keys: readonly string[]): Promise<Map<string, unknown>> {
    const rows = await this.prisma.$queryRaw<Array<{ key: string; value_json: unknown }>>`
      SELECT key, value_json FROM platform.v_current_config
       WHERE key = ANY(${[...keys]}::text[])`;
    return new Map(rows.map((r) => [r.key, r.value_json]));
  }
}
