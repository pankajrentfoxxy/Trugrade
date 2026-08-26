/**
 * The PUBLIC barrel for `listing`.
 *
 * Re-export only: the service interface, the concrete service token, the module,
 * this module's event payload types, and any DTO that is genuinely part of the
 * contract. Never a repository, never an entity, never an internal DTO.
 *
 * Anything added here becomes something another module may depend on, so adding
 * to this file is an architectural decision, not a convenience.
 *
 * `ListingRow` is here because ordering, QC and procurement all need the whole
 * listing, and it carries `unitPrice` — the buyer-facing price. That is fine for
 * a module; it is never fine for a vendor response, which is why the vendor
 * views are separate types rather than a parameter on the same one.
 */
export {
  type IListingService,
  ListingService,
  type VendorListingView,
  type VendorUnitView,
  type VendorImageView,
  type AddUnitsOutcome,
  type ListingAvailability,
  type PublicOffer,
  type ListingRow,
  type ListingStatus,
  type UnitRow,
  type TierPriceRow,
  type CreateDraftInput,
  type UpdateDraftInput,
  type ListingFilter,
  type Page,
} from './listing.service';
export { ListingModule } from './listing.module';
