/**
 * The PUBLIC barrel for `platform`.
 *
 * Re-export only: the service interface, the concrete service token, the module,
 * this module's event payload types, and any DTO that is genuinely part of the
 * contract. Never a repository, never an entity, never an internal DTO.
 *
 * Anything added here becomes something another module may depend on, so adding
 * to this file is an architectural decision, not a convenience.
 */
export {
  type IPlatformService,
  PlatformService,
  type OpenWarrantyUnit,
} from './platform.service';
export { PlatformModule } from './platform.module';
