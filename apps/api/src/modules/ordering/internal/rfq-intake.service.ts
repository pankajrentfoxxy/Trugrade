import { Injectable } from '@nestjs/common';
import { isBlankCsvRow, parseCsv, type Grade, type Money } from '@trugrade/contracts';
import { ClockPort } from '../../../shared/clock';
import { RequestContextService } from '../../../shared/db/org-scope';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ForbiddenError, ValidationError } from '../../../shared/errors/domain-errors';
import { ListingService } from '../../listing';
import { PlatformService } from '../../platform';
import {
  REQUIREMENT_COLUMNS,
  requirementRowSchema,
  type RequirementRowDto,
} from '../dto/ordering.dto';
import { CatalogLookup } from './catalog-lookup';

/**
 * Bulk requirement intake — PHASE_05 Task 7.
 *
 * A procurement head has a spreadsheet, not a search query. This turns that
 * spreadsheet into two things: requirements we can already fill, and a lead for
 * the ones we cannot.
 *
 * **NO VENDOR SEES ANY OF THIS, EVER.** That is not a privacy nicety, it is the
 * business model. We are the merchant of record: we buy from vendors and sell on
 * our own invoice, so sourcing against a customer's requirement is *our* job.
 * Circulating a buyer's requirement list to vendors for quotes would make this a
 * marketplace — which changes who the seller is, which changes whose invoice the
 * buyer gets, which changes the anonymity model, CP e-Comm Rule 5's application
 * and the GST treatment all at once. `ordering.rfq_quote` exists in the schema
 * from the earlier marketplace design and **nothing in this module writes to
 * it.** If a vendor-facing quote path ever appears, it is a business decision
 * taken deliberately and not a feature somebody added to the intake.
 *
 * Full RFQ — negotiation, revisions, award — is deferred. The intake is not,
 * because the intake is how a spreadsheet becomes a conversation.
 */

/** A requirement we can name a catalogue machine for. */
export interface MatchedRequirement {
  /** 1-based line in the buyer's own file, so they can find it in their editor. */
  line: number;
  rfqId: string;
  /** `ordering.rfq.rfq_number` — what the buyer and our sales desk quote at each other. */
  reference: string;
  skuId: string;
  title: string;
  specSummary: string;
  qtyRequested: number;
  /**
   * Sellable units of this model right now, across every dispatch point and
   * every grade.
   *
   * Across grades because grade is a fact about a listing, not about a SKU, and
   * the listing module answers per SKU — asking it to break down by grade would
   * be a new method on somebody else's barrel for a number the sales
   * conversation refines anyway. The figure is honest about what it counts,
   * which a "12 available" with no denominator would not be.
   */
  unitsAvailableNow: number;
  grade: Grade | null;
  neededBy: string | null;
}

/** A requirement we could not put a catalogue machine against. This is the lead. */
export interface UnmatchedRequirement {
  line: number;
  model: string;
  quantity: number;
  grade: Grade | null;
  deliveryPincode: string;
  neededBy: string | null;
  reason: string;
}

export interface RequirementIntakeResult {
  matched: MatchedRequirement[];
  unmatched: UnmatchedRequirement[];
  /** Rows that did not validate, keyed by the line number in the buyer's file. */
  rejected: Array<{ line: number; errors: Record<string, string> }>;
  /**
   * The internal work item raised for the unmatched rows, quoted back so the
   * buyer has a reference before anybody calls them. `null` when everything
   * matched and there was nothing for the sales desk to pick up.
   */
  salesLeadReference: string | null;
}

/** Header aliases people actually type. The template's own names are the canonical set. */
const HEADER_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  model: 'model',
  model_or_spec: 'model',
  specification: 'model',
  spec: 'model',
  qty: 'quantity',
  quantity: 'quantity',
  grade: 'grade',
  target_price: 'target_price',
  target: 'target_price',
  budget: 'target_price',
  pincode: 'delivery_pincode',
  delivery_pincode: 'delivery_pincode',
  needed_by: 'needed_by',
  required_by: 'needed_by',
});

function canonHeader(h: string): string | undefined {
  return HEADER_ALIASES[
    h
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_')
  ];
}

@Injectable()
export class RfqIntakeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly ctx: RequestContextService,
    private readonly listings: ListingService,
    private readonly platform: PlatformService,
    private readonly catalog: CatalogLookup,
  ) {}

  /**
   * Parse an uploaded requirement list.
   *
   * `parseCsv` is the RFC 4180 parser the SKU importer already uses: quoted
   * fields, embedded commas and a UTF-8 BOM are normal in a file Excel wrote,
   * and a `split(',')` breaks on the first model name containing a comma. One
   * parser, no new dependency.
   *
   * A row that fails validation is **reported, never guessed at**, and the good
   * rows still go through — an intake that refuses a 200-row file because line
   * 173 has a typo is an intake nobody uses twice.
   */
  fromCsv(csv: string): {
    rows: Array<{ line: number; value: RequirementRowDto }>;
    rejected: RequirementIntakeResult['rejected'];
  } {
    const grid = parseCsv(csv);
    const header = grid[0];
    if (!header) {
      throw new ValidationError('That file has no rows in it.', { csv: 'The file is empty.' });
    }

    const columns = header.map(canonHeader);
    for (const required of ['model', 'quantity', 'delivery_pincode'] as const) {
      if (!columns.includes(required)) {
        throw new ValidationError(
          `That file has no "${required}" column. The expected header is: ${REQUIREMENT_COLUMNS.join(', ')}.`,
          { csv: `Missing column: ${required}.` },
        );
      }
    }

    const rows: Array<{ line: number; value: RequirementRowDto }> = [];
    const rejected: RequirementIntakeResult['rejected'] = [];

    for (let i = 1; i < grid.length; i++) {
      // 1-based and counting the header, because that is the number the person
      // sees in the left-hand gutter of their own spreadsheet.
      const line = i + 1;
      const cells = grid[i]!;
      // Skipped here rather than filtered out of the grid, so `line` stays the
      // number in the person's own spreadsheet. A blank row between requirements
      // is ordinary formatting, not an error to report back at them.
      if (isBlankCsvRow(cells)) continue;
      const raw: Record<string, string> = {};
      columns.forEach((name, col) => {
        if (name) raw[name] = cells[col] ?? '';
      });

      const parsed = requirementRowSchema.safeParse({
        model: raw['model'],
        quantity: raw['quantity'],
        grade: raw['grade'],
        targetPrice: raw['target_price'],
        deliveryPincode: raw['delivery_pincode'],
        neededBy: raw['needed_by'],
      });

      if (parsed.success) rows.push({ line, value: parsed.data });
      else {
        rejected.push({
          line,
          errors: Object.fromEntries(
            parsed.error.issues.map((issue) => [issue.path.join('.') || '_', issue.message]),
          ),
        });
      }
    }

    if (rows.length === 0 && rejected.length === 0) {
      throw new ValidationError('That file has a header and no requirements under it.', {
        csv: 'No requirement rows found.',
      });
    }
    return { rows, rejected };
  }

  /**
   * Match every requirement, record the ones we can price, and raise one lead
   * for the rest.
   *
   * One lead for the whole file rather than one per unmatched row: the sales
   * desk is answering a *requirement*, and five tickets for one spreadsheet is
   * five people calling the same buyer.
   */
  async intake(
    rows: ReadonlyArray<{ line: number; value: RequirementRowDto }>,
    rejected: RequirementIntakeResult['rejected'] = [],
  ): Promise<RequirementIntakeResult> {
    const p = this.ctx.requirePrincipal();
    if (!p.orgId || p.orgType !== 'BUYER') {
      throw new ForbiddenError('A requirement list belongs to a buyer account.', {
        reason: 'not_a_buyer_principal',
      });
    }

    // One call for the whole file. Stock is listing's fact, counted through
    // `v_sellable_unit`, and a per-row query would ask the same question N times
    // for a file where most rows are the same handful of models.
    const stockBySku = await this.listings.countSellableBySku();

    const matched: MatchedRequirement[] = [];
    const unmatched: UnmatchedRequirement[] = [];

    for (const { line, value } of rows) {
      const hit = await this.catalog.bestMatch(value.model);
      if (!hit) {
        unmatched.push({
          line,
          model: value.model,
          quantity: value.quantity,
          grade: value.grade ?? null,
          deliveryPincode: value.deliveryPincode,
          neededBy: value.neededBy ?? null,
          reason: 'No machine in our catalogue matches this description.',
        });
        continue;
      }

      const rfq = await this.record(p.orgId, hit.skuId, value);
      matched.push({
        line,
        rfqId: rfq.id,
        reference: rfq.reference,
        skuId: hit.skuId,
        title: hit.title,
        specSummary: hit.specSummary,
        qtyRequested: value.quantity,
        unitsAvailableNow: stockBySku.get(hit.skuId) ?? 0,
        grade: value.grade ?? null,
        neededBy: value.neededBy ?? null,
      });
    }

    const salesLeadReference =
      unmatched.length === 0
        ? null
        : (
            await this.platform.openInternalLead({
              orgId: p.orgId,
              category: 'BULK_REQUIREMENT',
              subject: `Bulk requirement · ${unmatched.length} line${unmatched.length === 1 ? '' : 's'} we do not stock`,
              // The parsed rows, attached. The unmatched ones are the work; the
              // matched ones are the context that stops the desk phoning a buyer
              // to ask what else was on the list.
              detail: {
                unmatched,
                rejected,
                alreadyQuotable: matched.map((m) => ({
                  line: m.line,
                  reference: m.reference,
                  title: m.title,
                  qtyRequested: m.qtyRequested,
                  unitsAvailableNow: m.unitsAvailableNow,
                })),
              },
            })
          ).reference;

    return { matched, unmatched, rejected, salesLeadReference };
  }

  /**
   * One requirement, on the record.
   *
   * `ordering.rfq.sku_id` is NOT NULL, which is why only matched rows land here
   * and unmatched ones become a lead instead — a requirement with no catalogue
   * machine behind it has nothing to be an RFQ *for*.
   *
   * ponytail: the reference is the month plus eight hex characters rather than a
   * gapless counter, matching how `platform.ticket` numbers itself. Nothing
   * reconciles RFQ numbers — unlike invoice numbers, which VR-146 requires to be
   * gapless and which take an advisory lock for it. The UNIQUE on the column is
   * the backstop and a collision is a retry, not a corruption.
   */
  private async record(
    buyerOrgId: string,
    skuId: string,
    row: RequirementRowDto,
  ): Promise<{ id: string; reference: string }> {
    const suffix = Math.floor(Math.random() * 0xffff_ffff)
      .toString(16)
      .toUpperCase()
      .padStart(8, '0');

    // A requirement stays open for a fortnight, or until the day it is needed if
    // that is further out — expiring a requirement before the buyer needs it is
    // how a lead goes cold while somebody is still waiting for a call back.
    const fortnight = this.clock.plusDays(14);
    const neededBy = row.neededBy ? new Date(`${row.neededBy}T00:00:00.000Z`) : null;
    const expiresAt = neededBy && neededBy > fortnight ? neededBy : fortnight;

    const target: Money | undefined = row.targetPrice;

    const rows = await this.prisma.$queryRaw<Array<{ id: string; rfq_number: string }>>`
      INSERT INTO ordering.rfq
        (rfq_number, buyer_org_id, sku_id, grade, qty, target_price,
         delivery_pincode, needed_by, status, expires_at)
      VALUES ('RFQ-' || to_char(now(), 'YYYYMM') || '-' || ${suffix},
              ${buyerOrgId}::uuid, ${skuId}::uuid,
              ${row.grade ?? null}::grade_type, ${row.quantity},
              ${target ? target.toString() : null}::numeric,
              ${row.deliveryPincode}, ${row.neededBy ?? null}::date,
              'OPEN', ${expiresAt})
      RETURNING id, rfq_number`;

    return { id: rows[0]!.id, reference: rows[0]!.rfq_number };
  }
}
