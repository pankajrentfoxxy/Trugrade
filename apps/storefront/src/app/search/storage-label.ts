/**
 * Storage type, as a buyer reads it.
 *
 * The database stores the interface (`NVME_SSD`, `SATA_SSD`) because that is
 * what the inspection records; a spec line that says `NVME_SSD` is a column
 * name leaking onto a product page. Two of these maps already existed, in
 * `SearchResultCard` and `ProductIdentityCard`, and a third copy is how they
 * start disagreeing — so this is the one.
 *
 * An unmapped value falls back to itself with the underscores spaced out: a new
 * storage type reads awkwardly rather than rendering blank.
 */
const STORAGE_SHORT: Record<string, string> = {
  NVME_SSD: 'SSD',
  SATA_SSD: 'SSD',
  EMMC: 'eMMC',
  HDD: 'HDD',
};

export function storageShortLabel(storageType: string | undefined): string | null {
  if (!storageType) return null;
  return STORAGE_SHORT[storageType] ?? storageType.replace(/_/g, ' ');
}
