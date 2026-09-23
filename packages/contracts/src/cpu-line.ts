/**
 * The one sentence a processor is called in the product.
 *
 * Lives here rather than in the API's search index because two screens must
 * agree on it: search rows carry it as `cpuLine`, and the product page's
 * configuration picker builds it from a catalogue SKU to decide whether "the
 * i7" the buyer can see is the same "the i7" a search row holds. Two copies of
 * this function drift, and the day they do a configuration shows twice or not
 * at all.
 */
export function cpuDisplayLine(r: { cpuFamily: string; cpuModel: string }): string {
  if (/^i[3579]-/.test(r.cpuModel)) return `Intel Core ${r.cpuModel}`;
  if (/^ryzen/i.test(r.cpuModel)) return `AMD ${r.cpuModel}`;
  const isAmd = /ryzen|amd/i.test(r.cpuFamily);
  const brand = isAmd ? 'AMD' : 'Intel';
  return `${brand} ${r.cpuFamily} ${r.cpuModel}`.replace(/\s+/g, ' ').trim();
}
