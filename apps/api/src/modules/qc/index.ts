/**
 * The PUBLIC barrel for `qc`.
 *
 * Re-export only: the service interface, the concrete service token, the module,
 * this module's event payload types, and any DTO that is genuinely part of the
 * contract. Never a repository, never an entity, never an internal DTO.
 *
 * Anything added here becomes something another module may depend on, so adding
 * to this file is an architectural decision, not a convenience.
 */
export { type IQcService, QcService, type SealCheck } from './qc.service';
/**
 * Types only, and they are genuinely part of the contract: `SupplyPointQuality`
 * is what `qualityForSupplyPoints` returns, and a caller cannot type the answer
 * without it. The service that computes them stays private.
 */
export { type SupplyPointQuality, type SupplyPointRef } from './internal/vendor-quality.service';
export { QcModule } from './qc.module';
/**
 * `UnitInspection` is what `inspectionsByReport` returns, and a caller cannot
 * type the answer without it. `QcVerdict` is the enum that names the four
 * outcomes; a caller rendering one has to be able to switch on it exhaustively.
 */
export { type UnitInspection, type QcVerdict } from './qc.service';
