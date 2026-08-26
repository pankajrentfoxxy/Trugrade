/**
 * The anonymity guarantee (Phase 5 Task 1).
 *
 * We are the merchant of record: we buy from the vendor and sell on our own
 * invoice. That is what makes vendor anonymity lawful here — CP e-Comm Rule 5
 * binds marketplaces, and we fall under Rules 4 and 7 instead. But "lawful"
 * only describes the model; the model is only real if no vendor identifier
 * actually reaches a buyer.
 *
 * The phase brief is blunt about how that fails: **never `return listing`, and
 * never an `@Exclude()` blacklist** — a blacklist fails open the moment someone
 * adds a column. So the controller builds every customer-facing response from an
 * explicit allow-list, and the functions here are the second layer: a sweep that
 * reads the *serialised* payload and looks for identity at any depth, including
 * inside an untyped `metadata` blob where no type system would catch it.
 */

// ---------------------------------------------------------------------------
// What must never reach a buyer
// ---------------------------------------------------------------------------

/**
 * Everything a seeded vendor is, in the forms it could leak in.
 *
 * Tests pass the real seeded values rather than patterns, because the leaks that
 * matter are the specific ones: this vendor's GSTIN in this response, not "a
 * string shaped like a GSTIN".
 */
export interface VendorIdentity {
  readonly orgId: string;
  readonly legalName: string;
  readonly tradeName?: string;
  readonly gstin?: string;
  readonly pan?: string;
  readonly addressLines?: readonly string[];
  readonly phones?: readonly string[];
  readonly emails?: readonly string[];
  /** A URL-safe form that shows up in S3 keys and PDF filenames. */
  readonly slug?: string;
}

export interface IdentityLeak {
  /** Which part of the vendor's identity was found. */
  readonly field: string;
  /** The value that leaked, so the failure message is actionable. */
  readonly value: string;
  /** A window of the payload around the hit. */
  readonly context: string;
}

/**
 * A needle shorter than this produces false positives that train people to
 * ignore the sweep — a two-letter trade name matches inside half the payload.
 * Short identifiers still need covering; they need covering by the allow-list at
 * the controller, which is the layer that cannot false-positive.
 */
const MIN_NEEDLE_LENGTH = 4;

function needles(v: VendorIdentity): Array<{ field: string; value: string }> {
  const out: Array<{ field: string; value: string }> = [];
  const push = (field: string, value?: string) => {
    if (value && value.trim().length >= MIN_NEEDLE_LENGTH) {
      out.push({ field, value: value.trim() });
    }
  };
  push('orgId', v.orgId);
  push('legalName', v.legalName);
  push('tradeName', v.tradeName);
  push('gstin', v.gstin);
  push('pan', v.pan);
  push('slug', v.slug);
  v.addressLines?.forEach((a, i) => push(`addressLines[${i}]`, a));
  v.phones?.forEach((p, i) => {
    push(`phones[${i}]`, p);
    // A number formatted differently is the same number, so compare on digits.
    // Both forms matter: a payload may carry the full "919810011122" or the bare
    // ten-digit subscriber number, and in India the second is the common one.
    const digits = p.replace(/\D/g, '');
    push(`phones[${i}].digits`, digits);
    if (digits.length > 10) push(`phones[${i}].local`, digits.slice(-10));
  });
  v.emails?.forEach((e, i) => push(`emails[${i}]`, e));
  return out;
}

/**
 * Search a serialised payload for any part of a vendor's identity.
 *
 * Deliberately operates on the JSON string rather than on typed properties.
 * Walking typed fields proves only that the fields you thought of are clean; a
 * leak through a `metadata` blob, an error message echoing an internal entity,
 * an S3 key containing a vendor slug, or a PDF filename is exactly what this is
 * for (IDN-080…IDN-094).
 */
export function findVendorIdentityLeaks(
  payload: unknown,
  vendor: VendorIdentity,
): IdentityLeak[] {
  const json = typeof payload === 'string' ? payload : JSON.stringify(payload ?? null);
  const haystack = json.toLowerCase();
  const leaks: IdentityLeak[] = [];

  for (const { field, value } of needles(vendor)) {
    const at = haystack.indexOf(value.toLowerCase());
    if (at !== -1) {
      leaks.push({
        field,
        value,
        context: json.slice(Math.max(0, at - 60), at + value.length + 60),
      });
    }
  }
  return leaks;
}

/** Throwing form, so a test reads as an assertion rather than as bookkeeping. */
export function assertNoVendorIdentity(payload: unknown, vendor: VendorIdentity): void {
  const leaks = findVendorIdentityLeaks(payload, vendor);
  if (leaks.length > 0) {
    throw new Error(
      `Vendor identity leaked into a customer-facing payload:\n` +
        leaks.map((l) => `  ${l.field} = ${JSON.stringify(l.value)}\n    …${l.context}…`).join('\n'),
    );
  }
}

/**
 * Keys that must not appear in a customer payload whatever their value.
 *
 * This is a *diagnostic*, not the guarantee — the guarantee is the allow-list at
 * the controller. It catches the case where a field is present but happens to be
 * null in the fixture, which the value sweep above cannot see.
 */
export const FORBIDDEN_CUSTOMER_KEYS: readonly string[] = Object.freeze([
  'vendorOrgId',
  'vendor_org_id',
  'vendorName',
  'vendorLegalName',
  'vendorTradeName',
  'vendorGstin',
  'gstin',
  'pan',
  'vendorPan',
  'vendorAddress',
  'vendorPhone',
  'vendorEmail',
  'vendorTier',
  'vendorContact',
  // The vendor's number and our margin. Both are ours, neither is the buyer's.
  'vendorAskPrice',
  'vendor_ask_price',
  'purchasePrice',
  'purchase_price',
  'marginPct',
  'marginAmount',
  'floorMarginPct',
  'targetMarginPct',
  // Task 4: the customer is told the TOTAL warranty, never the split, because
  // the split is a commercial arrangement between us and the vendor.
  'vendorWarrantyMonths',
  'vendor_warranty_months',
  'platformBackedMonths',
  'vendorBackedMonths',
]);

export function findForbiddenKeys(payload: unknown): string[] {
  const found = new Set<string>();
  const forbidden = new Set(FORBIDDEN_CUSTOMER_KEYS.map((k) => k.toLowerCase()));
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        if (forbidden.has(k.toLowerCase())) found.add(k);
        walk(v);
      }
    }
  };
  walk(payload);
  return [...found].sort();
}

// ---------------------------------------------------------------------------
// The label a buyer actually sees
// ---------------------------------------------------------------------------

/**
 * `Supply Point A · Gurugram`.
 *
 * The city is deliberately included and everything finer than the city is
 * deliberately not: a buyer needs to reason about freight and dispatch time, and
 * a city gives them that without narrowing the source to a building.
 */
export function supplyPointLabel(code: string, city: string): string {
  return `Supply Point ${code.trim().toUpperCase()} · ${city.trim()}`;
}

// ---------------------------------------------------------------------------
// A sort order that does not leak
// ---------------------------------------------------------------------------

/** FNV-1a. Small, stable across processes, and not seeded by anything vendor-shaped. */
function stableHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export interface SortableOffer {
  /** Landed price in paise. Compared as bigint: money is never a float. */
  readonly landedPaise: bigint;
  readonly dispatchHours: number;
  /** The unit or supply-point row id. Used only as a tie-break. */
  readonly id: string;
}

/**
 * Landed price ascending, then dispatch speed, then a stable hash of the id.
 *
 * The third key is the one that matters for anonymity. Ten supply points quoting
 * the same price is the common case for a popular SKU, and any tie-break
 * correlated with vendor identity — row id order, creation time, vendor UUID —
 * publishes a stable ranking of vendors that a competitor can watch over time.
 * Hashing the *unit* id gives an order that is deterministic (so pagination is
 * stable and the page does not reshuffle under the reader) while carrying no
 * information about who the vendor is or how long they have been onboarded.
 */
export function compareOffers(a: SortableOffer, b: SortableOffer): number {
  if (a.landedPaise !== b.landedPaise) return a.landedPaise < b.landedPaise ? -1 : 1;
  if (a.dispatchHours !== b.dispatchHours) return a.dispatchHours - b.dispatchHours;
  const ha = stableHash(a.id);
  const hb = stableHash(b.id);
  if (ha !== hb) return ha - hb;
  // Two ids hashing equal is vanishingly rare, but a comparator must be total or
  // the sort is not deterministic — which would defeat the whole point.
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Small samples do not get a headline number
// ---------------------------------------------------------------------------

export type QualityHeadline =
  | { kind: 'SCORE'; avgQcScore: number; gradeAccuracyPct: number; unitsInspected: number }
  | { kind: 'NEW_SUPPLIER'; unitsInspected: number; label: string };

/**
 * Below the sample threshold a supply point shows "New supplier · 3 units
 * inspected" instead of an average.
 *
 * Returned as a discriminated union rather than as nullable numbers so a caller
 * physically cannot render a percentage that is not there. Under CP e-Comm
 * r.7(2) a 100% accuracy badge computed on two machines is *our*
 * misrepresentation, not the vendor's, and the CCPA Misleading Advertisements
 * Guidelines 2022 exist to catch exactly that claim — so the type system is the
 * right place to make it impossible.
 */
export function qualityHeadline(input: {
  unitsInspected: number;
  avgQcScore: number | null;
  gradeAccuracyPct: number | null;
  minSampleForHeadline: number;
}): QualityHeadline {
  const { unitsInspected, avgQcScore, gradeAccuracyPct, minSampleForHeadline } = input;
  if (
    unitsInspected < minSampleForHeadline ||
    avgQcScore === null ||
    gradeAccuracyPct === null
  ) {
    return {
      kind: 'NEW_SUPPLIER',
      unitsInspected,
      label: `New supplier · ${unitsInspected} unit${unitsInspected === 1 ? '' : 's'} inspected`,
    };
  }
  return { kind: 'SCORE', avgQcScore, gradeAccuracyPct, unitsInspected };
}
