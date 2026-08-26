import { Injectable } from '@nestjs/common';
import { skuNormalizedKey, validateRow, type SkuKeyParts } from '@trugrade/contracts';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ClockPort } from '../../../shared/clock';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../../shared/errors/domain-errors';
import { SkuRepository } from './sku.repository';
import { SkuImportService } from './sku-import.service';
import { CatalogChangeLogService } from './catalog-change-log.service';

/**
 * A vendor will always have a machine that is not in the catalog.
 *
 * The important behaviour is what happens *before* they submit: most requests
 * are a SKU that already exists under a slightly different name, and a queue
 * full of duplicates is a queue nobody works. So the same normalised key that
 * guarantees dedupe on write is used here to find near matches on read, and the
 * vendor is shown them first.
 *
 * The `RESOLVED_NEW` / `RESOLVED_MAPPED` distinction on the stored row is not
 * bookkeeping: it tells us whether search needs improving. A queue that is
 * mostly MAPPED means vendors could not find what was already there.
 */

export interface SkuRequestDraft {
  vendorOrgId: string;
  rawBrand: string;
  rawModel: string;
  rawConfig: string;
  specUrl?: string | null;
  photoKey?: string | null;
  /** Parsed configuration, when the wizard captured it in fields. */
  spec?: {
    cpuFamily?: string;
    cpuModel?: string;
    ramGb: number;
    storageGb: number;
    storageType: string;
    screenSizeIn?: number;
    resolution?: string;
    gpuType?: string;
    osSupported?: string;
    isTouch?: boolean;
  };
}

/** One pending request, as the ops worklist shows it. */
export interface SkuRequestQueueRow {
  id: string;
  vendorOrgId: string;
  rawBrand: string;
  rawModel: string;
  rawConfig: string;
  createdAt: Date;
  ageHours: number;
}

export interface NearMatch {
  skuId: string;
  skuCode: string;
  label: string;
  /** 0–1. 1.0 means the normalised keys are identical — it IS this SKU. */
  similarity: number;
  exact: boolean;
}

@Injectable()
export class SkuRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly skus: SkuRepository,
    private readonly importer: SkuImportService,
    private readonly changeLog: CatalogChangeLogService,
  ) {}

  /**
   * Near matches for what the vendor typed, computed **before** submission.
   *
   * Two passes, because they catch different mistakes. The exact key catches a
   * machine described differently ("NVMe" vs "NVME_SSD"); trigram similarity on
   * brand and model catches a typo ("Latitide 5420") that the key would never
   * match because the key is built from the typo.
   */
  async nearMatches(draft: SkuRequestDraft, limit = 5): Promise<NearMatch[]> {
    const found = new Map<string, NearMatch>();

    if (draft.spec) {
      const parts: SkuKeyParts = {
        brand: draft.rawBrand,
        model: draft.rawModel,
        cpuFamily: draft.spec.cpuFamily ?? null,
        cpuModel: draft.spec.cpuModel ?? null,
        ramGb: draft.spec.ramGb,
        storageGb: draft.spec.storageGb,
        storageType: draft.spec.storageType,
        screenSizeIn: draft.spec.screenSizeIn ?? null,
        screenResolution: draft.spec.resolution ?? null,
        gpu: draft.spec.gpuType ?? null,
        os: draft.spec.osSupported ?? null,
        isTouch: draft.spec.isTouch ?? false,
      };
      const exact = await this.skus.findByKey(skuNormalizedKey(parts));
      if (exact) {
        found.set(exact.id, {
          skuId: exact.id,
          skuCode: exact.skuCode,
          label: `${exact.brandName} ${exact.modelName} · ${exact.cpuModel} · ${exact.ramGb} GB · ${exact.storageGb} GB`,
          similarity: 1,
          exact: true,
        });
      }
    }

    // Trigram on the names. pg_trgm is installed and the GIN indexes were added
    // with the Phase 2 migration for exactly this query.
    const fuzzy = await this.prisma.$queryRaw<
      Array<{
        id: string;
        sku_code: string;
        brand_name: string;
        model_name: string;
        cpu_model: string;
        ram_gb: number;
        storage_gb: number;
        sim: number;
      }>
    >`
      SELECT s.id, s.sku_code, b.name AS brand_name, m.name AS model_name,
             s.cpu_model, s.ram_gb, s.storage_gb,
             GREATEST(similarity(m.name, ${draft.rawModel}::text),
                      similarity(b.name || ' ' || m.name,
                                 ${`${draft.rawBrand} ${draft.rawModel}`}::text)) AS sim
      FROM catalog.sku s
      JOIN catalog.model  m  ON m.id  = s.model_id
      JOIN catalog.series se ON se.id = m.series_id
      JOIN catalog.brand  b  ON b.id  = se.brand_id
      WHERE s.is_active
        -- Parenthesised on purpose: pg_trgm's % and || sit at the same
        -- precedence level, so concatenation followed by % resolved to text
        -- and the OR then had a non-boolean argument.
        AND ((m.name % ${draft.rawModel}::text)
             OR ((b.name || ' ' || m.name) % ${`${draft.rawBrand} ${draft.rawModel}`}::text))
      ORDER BY sim DESC
      LIMIT ${limit}`;

    for (const r of fuzzy) {
      if (found.has(r.id)) continue;
      found.set(r.id, {
        skuId: r.id,
        skuCode: r.sku_code,
        label: `${r.brand_name} ${r.model_name} · ${r.cpu_model} · ${r.ram_gb} GB · ${r.storage_gb} GB`,
        similarity: Math.round(Number(r.sim) * 100) / 100,
        exact: false,
      });
    }

    return [...found.values()].sort((a, b) => b.similarity - a.similarity).slice(0, limit);
  }

  /**
   * Submit. The vendor may submit even when near matches exist — they may
   * genuinely have a variant we do not carry, and blocking them would be the
   * marketplace-support-email failure mode this queue exists to replace.
   */
  async submit(draft: SkuRequestDraft): Promise<{ id: string; nearMatches: NearMatch[] }> {
    if (!draft.rawBrand.trim() || !draft.rawModel.trim()) {
      throw new ValidationError('Tell us the brand and model you are trying to list.', {
        rawModel: 'Required.',
      });
    }

    const nearMatches = await this.nearMatches(draft);

    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO catalog.sku_request
        (vendor_org_id, raw_brand, raw_model, raw_config, spec_url, photo_key, status)
      VALUES (${draft.vendorOrgId}::uuid, ${draft.rawBrand.trim()}, ${draft.rawModel.trim()},
              ${draft.rawConfig}, ${draft.specUrl ?? null}, ${draft.photoKey ?? null}, 'PENDING')
      RETURNING id`;

    return { id: rows[0]!.id, nearMatches };
  }

  /**
   * Ops maps a request onto a SKU that already existed.
   *
   * Recorded as RESOLVED_MAPPED rather than RESOLVED_NEW, because the ratio
   * between them is the signal that catalog search is failing vendors.
   */
  async mapToExisting(input: {
    requestId: string;
    skuId: string;
    resolvedBy: string;
  }): Promise<void> {
    const sku = await this.skus.findById(input.skuId);
    if (!sku) throw new NotFoundError('SKU');

    const n = await this.prisma.$executeRaw`
      UPDATE catalog.sku_request
         SET status = 'RESOLVED_MAPPED',
             resolved_sku_id = ${input.skuId}::uuid,
             resolved_by = ${input.resolvedBy}::uuid,
             resolved_at = ${this.clock.now()}
       WHERE id = ${input.requestId}::uuid AND status = 'PENDING'`;

    if (n === 0) {
      // Either it does not exist or someone already decided it. Both are worth
      // saying out loud rather than reporting a silent success.
      throw new ConflictError('That request has already been decided.');
    }

    // A merge is a catalog decision with a vendor on the other end of it, so it
    // belongs in the same log as an edit to the SKU itself. Anchored on the SKU
    // rather than the request: "everything that ever happened to this SKU" is
    // the question the log gets asked, and a request id answers none of it.
    await this.changeLog.record({
      entityType: 'sku',
      entityId: input.skuId,
      action: 'MERGE',
      field: 'sku_request',
      newValue: input.requestId,
      reason: `SKU request ${input.requestId} mapped onto ${sku.skuCode}`,
      actorId: input.resolvedBy,
    });
  }

  /**
   * Ops approves: the machine really is new, so the SKU gets created.
   *
   * The specification comes from the reviewer, not from the request — the vendor
   * submitted free text ("i5 16gb 512 ssd"), and a parser confident enough to
   * turn that into a master-catalog row is a parser confident enough to be
   * wrong about a machine every later listing inherits.
   *
   * It goes through the importer's `upsert` rather than an INSERT of its own, so
   * the normalised key, the canonicalisation of "NVMe" and the change log entry
   * are byte-for-byte what the CSV path produces. That also means approval is
   * *idempotent on the key*: if the reviewer types a specification we already
   * carry, the answer is the existing SKU and the request is recorded as MAPPED
   * rather than NEW — which is the honest label, and the RESOLVED_NEW /
   * RESOLVED_MAPPED ratio is the signal that catalog search is failing vendors.
   */
  async approve(input: {
    requestId: string;
    spec: Record<string, string>;
    resolvedBy: string;
  }): Promise<{ skuId: string; outcome: 'created' | 'merged' }> {
    // The same validator the CSV importer runs, on the same column names. A
    // second one here would be a second opinion about what a valid machine is.
    const parsed = validateRow(input.spec, 1);
    if (!parsed.value) {
      // Every problem in one message rather than one field error per column.
      // `validateRow` reports free text keyed to a CSV column name, which is not
      // a form field id, and inventing `spec.0`, `spec.1` would give the console
      // keys it cannot attach to anything — a form that highlights nothing is
      // worse than a sentence that names all four mistakes.
      throw new ValidationError(parsed.errors.join(' '), { spec: parsed.errors[0]! });
    }

    const { id, outcome } = await this.importer.upsert(
      parsed.value,
      input.resolvedBy,
      `SKU request ${input.requestId} approved`,
    );

    const n = await this.prisma.$executeRaw`
      UPDATE catalog.sku_request
         SET status = ${outcome === 'created' ? 'RESOLVED_NEW' : 'RESOLVED_MAPPED'},
             resolved_sku_id = ${id}::uuid,
             resolved_by = ${input.resolvedBy}::uuid,
             resolved_at = ${this.clock.now()}
       WHERE id = ${input.requestId}::uuid AND status = 'PENDING'`;
    if (n === 0) throw new ConflictError('That request has already been decided.');

    return { skuId: id, outcome };
  }

  async reject(input: { requestId: string; resolvedBy: string; reason: string }): Promise<void> {
    if (!input.reason.trim()) {
      throw new ValidationError(
        'Give a reason. The vendor sees it, and "rejected" tells them nothing they can act on.',
        { reason: 'Required.' },
      );
    }
    const n = await this.prisma.$executeRaw`
      UPDATE catalog.sku_request
         SET status = 'REJECTED',
             resolved_by = ${input.resolvedBy}::uuid,
             resolved_at = ${this.clock.now()}
       WHERE id = ${input.requestId}::uuid AND status = 'PENDING'`;
    if (n === 0) throw new ConflictError('That request has already been decided.');

    // A rejection changes no row in the catalog, which is exactly why it has to
    // be logged: the reason is what the vendor is owed, and `sku_request` has no
    // column to keep it in — the row records who decided and when, and drops the
    // only part that explains the decision.
    //
    // entity_type is 'sku' because `chk_change_log_entity` has no 'sku_request'
    // value and widening a CHECK is a migration this lane does not own. entity_id
    // is therefore a request id here and sku_id is explicitly null, so the
    // "everything that happened to this SKU" query cannot pick it up by accident.
    await this.changeLog.record({
      entityType: 'sku',
      entityId: input.requestId,
      action: 'UPDATE',
      field: 'sku_request',
      newValue: 'REJECTED',
      reason: input.reason.trim(),
      actorId: input.resolvedBy,
      skuId: null,
    });
  }

  /**
   * The worklist as the review screen needs it: each request with the SKUs it
   * most likely already is.
   *
   * The candidates are recomputed on read rather than stored with the request,
   * because the catalog moves underneath the queue — a request that had no match
   * on Monday matches exactly the SKU somebody imported on Tuesday, and a
   * snapshot taken at submission would show the reviewer the stale answer and
   * invite them to create the duplicate.
   *
   * ponytail: one trigram query per request, so the default page of 25 is 25
   * round trips against a GIN index. It is an ops screen with a single-digit
   * queue on a normal day; if the queue is ever long enough for this to hurt,
   * the fix is one lateral join, not a cache.
   */
  async reviewQueue(limit = 25): Promise<Array<SkuRequestQueueRow & { nearMatches: NearMatch[] }>> {
    const rows = await this.queue(limit);
    return Promise.all(
      rows.map(async (r) => ({
        ...r,
        nearMatches: await this.nearMatches({
          vendorOrgId: r.vendorOrgId,
          rawBrand: r.rawBrand,
          rawModel: r.rawModel,
          rawConfig: r.rawConfig,
        }),
      })),
    );
  }

  /** The ops worklist, oldest first — the SLA is measured from submission. */
  async queue(limit = 100): Promise<SkuRequestQueueRow[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        vendor_org_id: string;
        raw_brand: string;
        raw_model: string;
        raw_config: string;
        created_at: Date;
      }>
    >`
      SELECT id, vendor_org_id, raw_brand, raw_model, raw_config, created_at
      FROM catalog.sku_request
      WHERE status = 'PENDING'
      ORDER BY created_at
      LIMIT ${limit}`;

    const now = this.clock.nowMs();
    return rows.map((r) => ({
      id: r.id,
      vendorOrgId: r.vendor_org_id,
      rawBrand: r.raw_brand,
      rawModel: r.raw_model,
      rawConfig: r.raw_config,
      createdAt: r.created_at,
      ageHours: Math.round(((now - r.created_at.getTime()) / 3_600_000) * 10) / 10,
    }));
  }
}
