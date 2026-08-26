import { Injectable } from '@nestjs/common';
import { skuNormalizedKey, type SkuKeyParts } from '@trugrade/contracts';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ClockPort } from '../../../shared/clock';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../../shared/errors/domain-errors';
import { SkuRepository } from './sku.repository';

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
  }

  /** The ops worklist, oldest first — the SLA is measured from submission. */
  async queue(limit = 100): Promise<
    Array<{
      id: string;
      vendorOrgId: string;
      rawBrand: string;
      rawModel: string;
      rawConfig: string;
      createdAt: Date;
      ageHours: number;
    }>
  > {
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
