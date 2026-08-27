/**
 * The PUBLIC barrel for `vendor`.
 *
 * Re-export only: the service interface, the concrete service token, the module,
 * this module's event payload types, and any DTO that is genuinely part of the
 * contract. Never a repository, never an entity, never an internal DTO.
 *
 * Anything added here becomes something another module may depend on, so adding
 * to this file is an architectural decision, not a convenience.
 */
export {
  type IVendorService,
  type VendorReviewCaptures,
  VendorService,
} from './vendor.service';
export { VendorModule } from './vendor.module';

// Onboarding step promotion. `kyc` owns the stepper and the transaction; the
// five `vendor.*` tables four of its steps land in are owned here.
export { VendorPromotionService } from './internal/promotion.service';
