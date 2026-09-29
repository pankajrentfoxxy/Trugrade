/**
 * Which state(s) a PIN code's first two digits belong to, per India Post's
 * allocation. Static and well known; used only to notice when a delivery
 * address names a state its PIN cannot be in, before a courier is booked.
 *
 * Prefixes not listed (army postal service, malformed input) resolve to
 * `null`, which means "cannot say" — never "wrong".
 */
const PIN_REGIONS: ReadonlyArray<readonly [number, number, readonly string[]]> = [
  [11, 11, ['Delhi']],
  [12, 13, ['Haryana']],
  [14, 15, ['Punjab']],
  [16, 16, ['Punjab', 'Chandigarh']],
  [17, 17, ['Himachal Pradesh']],
  [18, 19, ['Jammu and Kashmir', 'Ladakh']],
  [20, 28, ['Uttar Pradesh', 'Uttarakhand']],
  [30, 34, ['Rajasthan']],
  [36, 39, ['Gujarat', 'Dadra and Nagar Haveli and Daman and Diu']],
  [40, 44, ['Maharashtra', 'Goa']],
  [45, 48, ['Madhya Pradesh']],
  [49, 49, ['Chhattisgarh']],
  [50, 53, ['Telangana', 'Andhra Pradesh']],
  [56, 59, ['Karnataka']],
  [60, 64, ['Tamil Nadu', 'Puducherry']],
  [67, 69, ['Kerala', 'Lakshadweep']],
  [70, 74, ['West Bengal', 'Sikkim', 'Andaman and Nicobar Islands']],
  [75, 77, ['Odisha']],
  [78, 78, ['Assam']],
  [79, 79, ['Arunachal Pradesh', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Tripura']],
  [80, 85, ['Bihar', 'Jharkhand']],
];

export function statesForPincode(pincode: string): readonly string[] | null {
  if (!/^\d{6}$/.test(pincode)) return null;
  const prefix = Number(pincode.slice(0, 2));
  const hit = PIN_REGIONS.find(([from, to]) => prefix >= from && prefix <= to);
  return hit ? hit[2] : null;
}

const normalise = (s: string): string =>
  s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The states the PIN belongs to, when the named state is not one of them.
 * `null` when they agree, or when the PIN's region is not known — an unknown
 * is not a mismatch.
 */
export function pincodeStateMismatch(pincode: string, state: string): readonly string[] | null {
  const regions = statesForPincode(pincode);
  if (!regions) return null;
  const named = normalise(state);
  if (!named) return null;
  const agrees = regions.some((r) => {
    const region = normalise(r);
    return named === region || named.includes(region) || region.includes(named);
  });
  return agrees ? null : regions;
}
