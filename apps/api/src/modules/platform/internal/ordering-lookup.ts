import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { OrderingService, type OwnedUnit } from '../../ordering';

/**
 * Platform's handle on ordering, resolved late.
 *
 * The import above is the public barrel, which is the only legal way one module
 * reaches another. The **module graph** already runs the other way:
 * `OrderingModule` imports `PlatformModule`, because `platform.ticket` is where
 * an unmatched bulk requirement goes and because delivery opens warranty cover.
 * Declaring `OrderingModule` in platform's `imports` as well would close that
 * into a cycle, and Nest cannot instantiate one without `forwardRef` on both
 * sides.
 *
 * So the instance is fetched from the container on first use instead, with
 * `strict: false`. This mirrors `CatalogLookup` in ordering exactly — same
 * problem, same shape — and the two are the only places in the codebase that
 * need it.
 *
 * **Why platform asks at all.** Ownership of a serial is four tables in
 * ordering's schema and a state machine ordering owns. Every after-sale screen
 * starts with "which machines are this organisation's", and a warranty query
 * that reconstructed that join would pin the definition of "yours" outside the
 * module that decides it — and be wrong the first time an order is cancelled
 * after allocation.
 */
@Injectable()
export class OrderingLookup {
  private ordering?: OrderingService;

  constructor(private readonly moduleRef: ModuleRef) {}

  private get service(): OrderingService {
    return (this.ordering ??= this.moduleRef.get(OrderingService, { strict: false }));
  }

  /** Every machine the signed-in organisation owns. Scoped by ordering, not here. */
  ownedUnits(): Promise<OwnedUnit[]> {
    return this.service.ownedUnits();
  }

  /** The same, narrowed to one order. Empty when the order is not this org's. */
  ownedUnitsForOrder(orderNumber: string): Promise<OwnedUnit[]> {
    return this.service.ownedUnitsForOrder(orderNumber);
  }
}
