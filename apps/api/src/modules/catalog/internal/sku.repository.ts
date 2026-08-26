import { Injectable } from '@nestjs/common';
import { skuNormalizedKey, type SkuKeyParts } from '@trugrade/contracts';
import { PrismaService } from '../../../shared/db/prisma.service';

/**
 * Reading and writing SKUs.
 *
 * Two things are the repository's job and nothing else's:
 *
 *   1. **Computing the key.** Every write path goes through `keyFor()`, which
 *      calls the one shared generator. A second implementation that agrees today
 *      drifts tomorrow, and the UNIQUE constraint cannot catch that — it accepts
 *      the duplicate, because the two keys genuinely differ.
 *   2. **Converting at the boundary.** `screen_size_inch` is NUMERIC(4,1), so
 *      Prisma hands back a `Decimal`. Arithmetic on it silently yields NaN, and
 *      `NaN > tolerance` is false — which turned the QC screen-size check into a
 *      no-op that passed for every machine. Nothing above this layer should ever
 *      see a Decimal.
 */

export interface SkuRow {
  id: string;
  modelId: string;
  skuCode: string;
  normalizedKey: string;
  cpuBrand: string;
  cpuFamily: string;
  cpuModel: string;
  cpuGeneration: string;
  ramGb: number;
  storageGb: number;
  storageType: string;
  gpuType: string;
  gpuModel: string | null;
  screenSizeIn: number;
  resolution: string;
  isTouch: boolean;
  osSupported: string;
  hsnCode: string;
  isActive: boolean;
  brandName: string;
  seriesName: string;
  modelName: string;
}

/** What a caller supplies to create a SKU. The key is never supplied. */
export interface SkuDraft {
  modelId: string;
  cpuBrand: string;
  cpuFamily: string;
  cpuModel: string;
  cpuGeneration: string;
  ramGb: number;
  storageGb: number;
  storageType: string;
  gpuType: string;
  gpuModel?: string | null;
  screenSizeIn: number;
  resolution: string;
  isTouch?: boolean;
  osSupported: string;
  hsnCode?: string;
}

interface RawSku {
  id: string;
  model_id: string;
  sku_code: string;
  normalized_key: string;
  cpu_brand: string;
  cpu_family: string;
  cpu_model: string;
  cpu_generation: string;
  ram_gb: number;
  storage_gb: number;
  storage_type: string;
  gpu_type: string;
  gpu_model: string | null;
  screen_size_inch: unknown;
  resolution: string;
  is_touch: boolean;
  os_supported: string;
  hsn_code: string;
  is_active: boolean;
  brand_name: string;
  series_name: string;
  model_name: string;
}

function toRow(r: RawSku): SkuRow {
  return {
    id: r.id,
    modelId: r.model_id,
    skuCode: r.sku_code,
    normalizedKey: r.normalized_key,
    cpuBrand: r.cpu_brand,
    cpuFamily: r.cpu_family,
    cpuModel: r.cpu_model,
    cpuGeneration: r.cpu_generation,
    ramGb: r.ram_gb,
    storageGb: r.storage_gb,
    storageType: r.storage_type,
    gpuType: r.gpu_type,
    gpuModel: r.gpu_model,
    // The conversion that stops a Decimal reaching the comparison layer.
    screenSizeIn: Number(r.screen_size_inch),
    resolution: r.resolution,
    isTouch: r.is_touch,
    osSupported: r.os_supported,
    hsnCode: r.hsn_code,
    isActive: r.is_active,
    brandName: r.brand_name,
    seriesName: r.series_name,
    modelName: r.model_name,
  };
}

@Injectable()
export class SkuRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The key, from the catalog names plus the configuration.
   *
   * Brand and model come from the tree rather than from the caller, so a request
   * that names them differently cannot produce a different key for the same
   * machine — which is exactly the divergence Task 2 exists to prevent.
   */
  async keyFor(draft: SkuDraft): Promise<string> {
    const [names] = await this.prisma.$queryRaw<Array<{ brand: string; model: string }>>`
      SELECT b.name AS brand, m.name AS model
      FROM catalog.model m
      JOIN catalog.series se ON se.id = m.series_id
      JOIN catalog.brand  b  ON b.id  = se.brand_id
      WHERE m.id = ${draft.modelId}::uuid`;
    if (!names) throw new Error(`No model ${draft.modelId}`);

    const parts: SkuKeyParts = {
      brand: names.brand,
      model: names.model,
      cpuFamily: draft.cpuFamily,
      cpuModel: draft.cpuModel,
      ramGb: draft.ramGb,
      storageGb: draft.storageGb,
      storageType: draft.storageType,
      screenSizeIn: draft.screenSizeIn,
      screenResolution: draft.resolution,
      gpu: draft.gpuType,
      os: draft.osSupported,
      isTouch: draft.isTouch ?? false,
    };
    return skuNormalizedKey(parts);
  }

  async findByKey(normalizedKey: string): Promise<SkuRow | null> {
    const rows = await this.prisma.$queryRaw<RawSku[]>`
      SELECT s.id, s.model_id, s.sku_code, s.normalized_key,
             s.cpu_brand, s.cpu_family, s.cpu_model, s.cpu_generation,
             s.ram_gb, s.storage_gb, s.storage_type, s.gpu_type, s.gpu_model,
             s.screen_size_inch, s.resolution, s.is_touch, s.os_supported,
             s.hsn_code, s.is_active,
             b.name AS brand_name, se.name AS series_name, m.name AS model_name
      FROM catalog.sku s
      JOIN catalog.model  m  ON m.id  = s.model_id
      JOIN catalog.series se ON se.id = m.series_id
      JOIN catalog.brand  b  ON b.id  = se.brand_id
      WHERE s.normalized_key = ${normalizedKey}`;
    return rows[0] ? toRow(rows[0]) : null;
  }

  async findById(id: string): Promise<SkuRow | null> {
    const rows = await this.prisma.$queryRaw<RawSku[]>`
      SELECT s.id, s.model_id, s.sku_code, s.normalized_key,
             s.cpu_brand, s.cpu_family, s.cpu_model, s.cpu_generation,
             s.ram_gb, s.storage_gb, s.storage_type, s.gpu_type, s.gpu_model,
             s.screen_size_inch, s.resolution, s.is_touch, s.os_supported,
             s.hsn_code, s.is_active,
             b.name AS brand_name, se.name AS series_name, m.name AS model_name
      FROM catalog.sku s
      JOIN catalog.model  m  ON m.id  = s.model_id
      JOIN catalog.series se ON se.id = m.series_id
      JOIN catalog.brand  b  ON b.id  = se.brand_id
      WHERE s.id = ${id}::uuid`;
    return rows[0] ? toRow(rows[0]) : null;
  }
}
