import type { PrismaClient } from '@prisma/client';

/**
 * The NCR pilot lane: the pincodes we recognise, the pincodes we deliver to,
 * and what the in-house team charges to get there.
 *
 * Q11 answers the geography question — **NCR only, in-house delivery** — and
 * this file is that answer expressed as rows. It is deliberately *not* a
 * national dataset: `FreightService` distinguishes "we don't recognise this PIN
 * code" (a typo, which the buyer can fix) from "we don't deliver there yet" (a
 * true statement about our service area), and it can only tell the two apart if
 * `identity.pincode_master` holds places we do not serve as well as places we
 * do. Hence the five non-NCR rows at the bottom of PINCODES with no
 * serviceability row against them.
 *
 * **On writing `identity.pincode_master` from a logistics seed.** Nothing else
 * seeds it, `logistics.pincode_serviceability` has a hard foreign key into it,
 * and the freight quote is meaningless without it — so the rows live here until
 * the real India Post extract (~19 000 rows) has a home of its own in
 * `reference.ts`. The seam that matters is the one between *modules at runtime*,
 * and a seed script is neither.
 *
 * Everything here is idempotent — `truncateAll` empties `pincode_master`,
 * `pincode_serviceability` and `carrier_rate_card` between integration tests, so
 * the suite re-runs this function far more often than the CLI does.
 */

type Zone = 'NORTH' | 'SOUTH' | 'EAST' | 'WEST' | 'NE' | 'CENTRAL';

interface Pincode {
  pincode: string;
  district: string;
  state: string;
  /** GST state code. Haryana is '06', Delhi '07' — the same two digits the invoice carries. */
  stateCode: string;
  zone: Zone;
  isMetro: boolean;
  isNcr: boolean;
  /**
   * Absent means we do not deliver there — no `pincode_serviceability` row is
   * written and `quoteFreight` returns its unserviceable arm.
   *
   * `transitMax` is keyed on the **destination only**, never on the origin, and
   * that is a constraint rather than a simplification: `dispatchEstimate`
   * renders it as "Ships in 24 h" beside "Supply Point A · Gurugram", so two
   * anonymous supply points quoting the same buyer must produce the identical
   * string. A per-origin transit time here would let a buyer tell them apart by
   * their geography, which is what 02_ARCHITECTURE.md §3 exists to prevent.
   */
  service?: { transitMin: number; transitMax: number; isOda: boolean };
}

/** Inside the daily beat: the van goes out and comes back. */
const NEXT_DAY = { transitMin: 1, transitMax: 1, isOda: false };
/** Outer NCR — one hop further out, still our own vehicle. */
const TWO_DAY = { transitMin: 1, transitMax: 2, isOda: false };
/**
 * NCR on the map, off the daily beat — it waits for the alternate-day run.
 * Carries the ODA surcharge on the card.
 *
 * `transitMax` stops at 2 deliberately. `FreightService.dispatchEstimate` has
 * exactly two buckets, "Ships in 24 h" and "Ships in 48 h", so a lane seeded at
 * three days would render as a 48-hour promise we have no intention of keeping —
 * and a delivery estimate is a representation we would have to defend. If a real
 * lane ever needs three days, the fix is a third bucket on the label, never a
 * transit time quietly rounded down to fit the two that exist.
 */
const ODA = { transitMin: 2, transitMax: 2, isOda: true };

/** The three states the NCR spans. Written once so the table below stays a table. */
const NCR_STATES = { '06': 'Haryana', '07': 'Delhi', '09': 'Uttar Pradesh' } as const;

/**
 * Every NCR pincode sits in India Post's NORTH zone; `is_ncr` is what promotes
 * it to the `'NCR'` freight zone that the in-house rate card is priced against.
 * `is_metro` follows the state — Delhi is a metro, Gurugram and Noida are not.
 */
const ncr = (
  pincode: string,
  district: string,
  stateCode: keyof typeof NCR_STATES,
  service: Pincode['service'],
): Pincode => ({
  pincode,
  district,
  state: NCR_STATES[stateCode],
  stateCode,
  zone: 'NORTH',
  isMetro: stateCode === '07',
  isNcr: true,
  service,
});

/** Recognised, deliberately unserved: no `service`, so no serviceability row. */
const outside = (
  pincode: string,
  district: string,
  state: string,
  stateCode: string,
  zone: Zone,
  isMetro = false,
): Pincode => ({ pincode, district, state, stateCode, zone, isMetro, isNcr: false });

const PINCODES: readonly Pincode[] = [
  ncr('110001', 'New Delhi', '07', NEXT_DAY),
  ncr('110020', 'South East Delhi', '07', NEXT_DAY),
  ncr('110092', 'East Delhi', '07', NEXT_DAY),

  // 122015 is the default pincode in `makeAddress`, so it is the origin nearly
  // every integration test quotes from. It has to be here, and it has to price.
  ncr('122001', 'Gurugram', '06', NEXT_DAY),
  ncr('122015', 'Gurugram', '06', NEXT_DAY),
  ncr('122018', 'Gurugram', '06', NEXT_DAY),
  ncr('121001', 'Faridabad', '06', NEXT_DAY),
  ncr('131001', 'Sonipat', '06', TWO_DAY),
  ncr('121102', 'Palwal', '06', ODA),

  ncr('201301', 'Gautam Buddha Nagar', '09', NEXT_DAY),
  ncr('201309', 'Gautam Buddha Nagar', '09', NEXT_DAY),
  ncr('201310', 'Gautam Buddha Nagar', '09', NEXT_DAY),
  ncr('201001', 'Ghaziabad', '09', TWO_DAY),
  ncr('250001', 'Meerut', '09', ODA),

  // Without these rows a Bengaluru buyer is told their PIN code does not exist,
  // which is both false and unactionable. 799001 in particular is the example
  // `FreightService` names when it explains why an unserviceable lane is not the
  // same thing as a typo.
  outside('400001', 'Mumbai', 'Maharashtra', '27', 'WEST', true),
  outside('411001', 'Pune', 'Maharashtra', '27', 'WEST'),
  outside('560001', 'Bengaluru Urban', 'Karnataka', '29', 'SOUTH', true),
  outside('700001', 'Kolkata', 'West Bengal', '19', 'EAST', true),
  outside('799001', 'West Tripura', 'Tripura', '16', 'NE'),
];

/**
 * The in-house contract card, NCR → NCR.
 *
 * `ServiceabilityService` maps any `is_ncr` pincode to the zone `'NCR'` rather
 * than to `'NORTH'`, so these rows price the pilot and nothing else. A
 * NORTH→NORTH card would also quote Chandigarh→Lucknow, where we have no riders
 * and no way to honour the number.
 *
 * Bands are closed at both ends and touch on the boundary on purpose —
 * `FreightService` takes the cheapest match, so a consignment landing exactly on
 * a slab edge gets a price rather than falling through a gap between two cards.
 *
 * `fuel_surcharge_pct` is zero and stays zero for INHOUSE. A fuel surcharge is a
 * pass-through of somebody else's invoice line; we own the vans, there is no
 * such line, and inventing one would put an unearned number inside a published
 * landed price. `insurance_pct` is zero for a related reason — it is a
 * percentage of declared value, and a freight quote has no declared value.
 *
 * IDs are fixed and the insert is ON CONFLICT DO NOTHING, for the reason
 * `margin-rules.ts` gives: re-running the seed must never stomp a rate ops has
 * tuned. A re-cut card is a new row with its own `effective_from` and an
 * `effective_to` on the row it replaces — never an UPDATE.
 */
const RATE_CARDS = [
  {
    id: '7a1c0001-0000-4000-8000-000000000001',
    fromKg: '0.01',
    toKg: '5.00',
    base: '149.00',
    perKg: '0.00',
    minCharge: '149.00',
  },
  {
    id: '7a1c0001-0000-4000-8000-000000000002',
    fromKg: '5.00',
    toKg: '15.00',
    base: '149.00',
    perKg: '18.00',
    minCharge: '249.00',
  },
  {
    // Above 50 kg there is no card at all, and the quote says "ask for a bulk
    // quote" rather than guessing. A parcel rate extrapolated to half a tonne is
    // a number we would lose money honouring.
    id: '7a1c0001-0000-4000-8000-000000000003',
    fromKg: '15.00',
    toKg: '50.00',
    base: '249.00',
    perKg: '14.00',
    minCharge: '549.00',
  },
] as const;

/** Flat, per consignment, on the lanes flagged `is_oda`. */
const ODA_SURCHARGE = '149.00';

/**
 * Far enough back to be in force whatever date a test's `FixedClock` names.
 * Effective dating is something ops exercises when a rate changes; it is not
 * something a seed should make every unrelated test fight.
 */
const EFFECTIVE_FROM = '2020-01-01';

export interface LogisticsNcrCounts {
  pincodes: number;
  rateCards: number;
  serviceable: number;
}

export async function seedLogisticsNcr(
  prisma: PrismaClient,
  log: (msg: string) => void = () => undefined,
): Promise<LogisticsNcrCounts> {
  // The three carriers come from the baseline migration and `truncateAll`
  // preserves that table, so this is a no-op on every run but the pathological
  // one. It is here so the two lookups below cannot quietly insert nothing
  // because the carrier row went missing.
  await prisma.$executeRaw`
    INSERT INTO logistics.carrier (code, name, adapter_key, supports_leg, priority)
    VALUES ('INHOUSE', 'TrueTech in-house team', 'inhouse',
            ARRAY['INBOUND','OUTBOUND','RETURN'], 10)
    ON CONFLICT (code) DO NOTHING`;

  let pincodes = 0;
  for (const p of PINCODES) {
    pincodes += await prisma.$executeRaw`
      INSERT INTO identity.pincode_master
        (pincode, district, state, state_code, zone, is_metro, is_ncr)
      VALUES (${p.pincode}, ${p.district}, ${p.state}, ${p.stateCode},
              ${p.zone}, ${p.isMetro}, ${p.isNcr})
      ON CONFLICT (pincode) DO NOTHING`;
  }

  let rateCards = 0;
  for (const c of RATE_CARDS) {
    rateCards += await prisma.$executeRaw`
      INSERT INTO logistics.carrier_rate_card
        (id, carrier_id, from_zone, to_zone, weight_from_kg, weight_to_kg,
         base_rate, per_kg_rate, fuel_surcharge_pct, oda_surcharge, insurance_pct,
         min_charge, effective_from)
      SELECT ${c.id}::uuid, id, 'NCR', 'NCR',
             ${c.fromKg}::numeric, ${c.toKg}::numeric,
             ${c.base}::numeric, ${c.perKg}::numeric, 0,
             ${ODA_SURCHARGE}::numeric, 0,
             ${c.minCharge}::numeric, ${EFFECTIVE_FROM}::date
        FROM logistics.carrier
       WHERE code = 'INHOUSE'
      ON CONFLICT (id) DO NOTHING`;
  }

  // BOTH rather than DELIVERY: the rider who drops a machine in Noida collects
  // the next one, and `pickup_task` reads the same table. No Blue Dart rows are
  // written — Q11 puts the pilot on in-house delivery, and a Blue Dart lane here
  // would quote a buyer a carrier we hold no account with.
  let serviceable = 0;
  for (const p of PINCODES) {
    if (!p.service) continue;
    serviceable += await prisma.$executeRaw`
      INSERT INTO logistics.pincode_serviceability
        (pincode, carrier_id, service_type, transit_days_min, transit_days_max, is_oda)
      SELECT ${p.pincode}, id, 'BOTH',
             ${p.service.transitMin}, ${p.service.transitMax}, ${p.service.isOda}
        FROM logistics.carrier
       WHERE code = 'INHOUSE'
      ON CONFLICT (pincode, carrier_id, service_type) DO NOTHING`;
  }

  log(
    `  NCR logistics: ${pincodes} pincode(s), ${rateCards} rate card(s), ` +
      `${serviceable} serviceable lane(s)`,
  );
  return { pincodes, rateCards, serviceable };
}

export const NCR_PINCODE_COUNT = PINCODES.length;
export const NCR_SERVICEABLE_COUNT = PINCODES.filter((p) => p.service).length;
