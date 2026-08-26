import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/db/prisma.service';

/**
 * The one place `catalog.catalog_change_log` is written.
 *
 * It exists because the audit found the trail had holes in it: the CSV importer
 * logged every row it touched, while an image upload, an image retirement and a
 * SKU request decision — all of them catalog mutations with a named actor and a
 * consequence a buyer can see — wrote nothing at all. A trail with holes is not
 * a trail; it is a trail plus a story about which parts we chose to keep.
 *
 * So the insert lives here rather than as a private method on whichever service
 * happened to need it first. Three callers writing three near-identical INSERTs
 * is how the `entity_type` of one of them drifts out of `chk_change_log_entity`
 * and starts throwing on a path nobody exercises until an auditor asks.
 *
 * No transaction of its own, deliberately. `PrismaService.db` returns the
 * ambient transaction when there is one, so a caller that logs inside
 * `runInTransaction` gets the log rolled back with the change it describes —
 * which is the only correct behaviour. A change that did not happen must not
 * leave a record saying it did.
 */

/** `chk_change_log_entity`. Read off the live CHECK, not off a phase document. */
export type CatalogEntityType =
  | 'brand'
  | 'series'
  | 'model'
  | 'sku'
  | 'condition_image'
  | 'grade_definition';

/** `chk_change_log_action`. */
export type CatalogChangeAction = 'CREATE' | 'UPDATE' | 'DEPRECATE' | 'MERGE' | 'RETIRE';

export interface CatalogChange {
  entityType: CatalogEntityType;
  entityId: string;
  action: CatalogChangeAction;
  /** Which attribute moved, or `'row'` when the whole row is the change. */
  field: string;
  oldValue?: string | null;
  newValue?: string | null;
  /**
   * Why, in the words of whoever did it. Required, because "what changed" is
   * recoverable from two versions of a row and "why" never is.
   */
  reason: string;
  /** `changed_by` is NOT NULL: an actorless catalog mutation records nothing. */
  actorId: string;
  /**
   * The SKU this change is about, when there is one. Kept alongside `entity_id`
   * because the original column predates `entity_type` and the "everything that
   * ever happened to this SKU" query still reads it.
   */
  skuId?: string | null;
}

@Injectable()
export class CatalogChangeLogService {
  constructor(private readonly prisma: PrismaService) {}

  async record(change: CatalogChange): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO catalog.catalog_change_log
        (entity_type, entity_id, sku_id, action, field, old_value, new_value,
         reason, changed_by)
      VALUES (${change.entityType}, ${change.entityId}::uuid,
              ${change.skuId ?? (change.entityType === 'sku' ? change.entityId : null)}::uuid,
              ${change.action}, ${change.field}, ${change.oldValue ?? null},
              ${change.newValue ?? null}, ${change.reason}, ${change.actorId}::uuid)`;
  }
}
