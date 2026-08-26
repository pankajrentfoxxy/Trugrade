/**
 * Freight, against the real rate card.
 *
 * The property this file exists to defend is narrow and expensive to get wrong:
 * **an unpriced lane must never look like free freight.** PHASE_05 Task 5 puts
 * `quoteFreight`'s answer inside the landed price on a product page, so a zero
 * that really means "we could not price this" is a price misrepresentation under
 * CP e-Comm r.6(5) — not a rounding issue. A unit test with a stubbed card
 * cannot honestly prove it either: it takes a real rate card, a real
 * serviceability table, and a pincode master that holds places we do not serve
 * as well as places we do.
 *
 * The second property is anonymity. A quote is a customer-facing response, and
 * `_CONTEXT.md` §"Vendor anonymity display rule" counts an error message as one.
 * Every reason string is asserted not to name its origin, because "we can't
 * reach you from Gurugram" tells a buyer where an anonymous supply point is.
 *
 * The module is booted through `LogisticsModule` rather than by hand-wiring the
 * two internal services. Other lanes call this through the barrel, so the seam
 * they use is the seam under test.
 */

import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';
import { ClockPort, FixedClock } from '../../src/shared/clock';
import { AppConfig, ConfigModule } from '../../src/shared/config';
import { PrismaService } from '../../src/shared/db/prisma.service';
import { ValidationError } from '../../src/shared/errors/domain-errors';
import {
  freightLaneKey,
  LogisticsModule,
  LogisticsService,
  type FreightQuote,
  type FreightQuoteRequest,
} from '../../src/modules/logistics';
import { seedLogisticsNcr } from '../../prisma/seed/logistics-ncr';
import {
  closeTestDb,
  migrateTestDatabase,
  seedTestReference,
  testDatabaseUrl,
  testDb,
  truncateAll,
} from '../support/db';

const NOW = new Date('2026-08-26T09:00:00.000Z');

/** Gurugram. The default in `makeAddress`, and so the origin of nearly every lane. */
const ORIGIN = '122015';
/** Connaught Place: inside the daily beat, one transit day. */
const DELHI = '110001';
/** Sonipat: outer NCR, two transit days. */
const SONIPAT = '131001';
/** Palwal: NCR on the map, off the beat — the one lane carrying the ODA surcharge. */
const PALWAL = '121102';
/** Recognised, deliberately unserved. Q11 puts the pilot in NCR only. */
const BENGALURU = '560001';
/** Correctly formatted and not a place. A typo, which deserves a different answer. */
const NOT_A_PINCODE = '999999';

/** Three origins in three different NCR towns — three anonymous supply points. */
const SUPPLY_POINTS = ['122015', '201301', '110020'];

/** A boxed laptop. */
const LAPTOP_G = 2500;

let moduleRef: TestingModule;
let logistics: LogisticsService;
let db: PrismaClient;

const lane = (toPincode: string, over: Partial<FreightQuoteRequest> = {}): FreightQuoteRequest => ({
  fromPincode: ORIGIN,
  toPincode,
  weightGrams: LAPTOP_G,
  units: 1,
  ...over,
});

/** `Money` has no structural equality, so quotes are compared through their wire form. */
const wire = (q: FreightQuote) => ({
  serviceable: q.serviceable,
  amount: q.amount?.toString() ?? null,
  carrierCode: q.carrierCode,
  etaDays: q.etaDays,
  reason: q.reason ?? null,
});

const dispatchLabel = async (fromPincode: string, toPincode: string): Promise<string> =>
  (await logistics.dispatchEstimate({ fromPincode, toPincode })).label;

beforeAll(async () => {
  migrateTestDatabase();
  db = testDb();
  await seedTestReference(db);

  moduleRef = await Test.createTestingModule({ imports: [ConfigModule, LogisticsModule] })
    .overrideProvider(ClockPort)
    .useValue(new FixedClock(NOW))
    .overrideProvider(PrismaService)
    .useFactory({
      factory: (config: AppConfig) => {
        Object.defineProperty(config, 'env', {
          value: { ...config.all, DATABASE_URL: testDatabaseUrl() },
        });
        return new PrismaService(config);
      },
      inject: [AppConfig],
    })
    .compile();

  logistics = moduleRef.get(LogisticsService);
  await moduleRef.get(PrismaService).$connect();
});

afterAll(async () => {
  await moduleRef.get(PrismaService).$disconnect();
  await moduleRef.close();
  await closeTestDb();
});

beforeEach(async () => {
  await truncateAll(db);
  // `truncateAll` empties `pincode_master`, `pincode_serviceability` and
  // `carrier_rate_card`; `carrier` is the one logistics table on its keep list.
  // So the pilot lane is re-seeded per test — which is also the cheapest
  // possible standing proof that the seed is idempotent.
  await seedLogisticsNcr(db);
});

// ---------------------------------------------------------------------------
// A lane we serve
// ---------------------------------------------------------------------------

describe('a serviceable NCR lane', () => {
  it('prices one laptop off the first weight band', async () => {
    const quote = await logistics.quoteFreight(lane(DELHI));

    expect(quote.serviceable).toBe(true);
    // 2.5 kg lands in the 0.01–5.00 kg band: base 149.00, no per-kg component.
    expect(quote.amount?.toString()).toBe('149.00');
    expect(quote.carrierCode).toBe('INHOUSE');
    // The slower end of the carrier's transit band, never the faster one.
    expect(quote.etaDays).toBe(1);
  });

  it('charges per kilogram once the consignment leaves the first band', async () => {
    // 3 × 2.5 kg = 7.5 kg → band 2: 149.00 + 18.00/kg × 7.5 kg = 284.00.
    const quote = await logistics.quoteFreight(lane(DELHI, { units: 3 }));

    expect(quote.serviceable).toBe(true);
    expect(quote.amount?.toString()).toBe('284.00');
  });

  it('floors a thin band at the minimum charge', async () => {
    // 5.1 kg computes 149.00 + 91.80 = 240.80, below the band's 249.00 floor.
    // Without the floor we quote below the cost of sending the van out.
    const quote = await logistics.quoteFreight(lane(DELHI, { weightGrams: 5100 }));

    expect(quote.amount?.toString()).toBe('249.00');
  });

  it('adds the ODA surcharge inside the quote rather than at checkout', async () => {
    // Drip pricing is a named prohibited practice in the CCPA Dark Patterns
    // Guidelines 2023, so an out-of-delivery-area lane has to cost more *here*,
    // in the figure the product page renders — not on the payment screen.
    const beat = await logistics.quoteFreight(lane(DELHI));
    const oda = await logistics.quoteFreight(lane(PALWAL));

    expect(oda.serviceable).toBe(true);
    expect(oda.amount?.toString()).toBe('298.00'); // 149.00 base + 149.00 ODA
    expect(oda.amount!.gt(beat.amount!)).toBe(true);
    expect(oda.etaDays).toBe(2);
  });

  it('never promises a lane sooner than the seeded transit time', async () => {
    // `dispatchEstimate` has two buckets and rounds everything past one day into
    // "Ships in 48 h". A lane seeded at three transit days would therefore be
    // advertised as a two-day delivery — an over-promise, and a representation
    // we would have to defend. This holds the seed to the labels that exist.
    for (const destination of [DELHI, SONIPAT, PALWAL]) {
      const quote = await logistics.quoteFreight(lane(destination));
      const label = await dispatchLabel(ORIGIN, destination);

      expect(quote.serviceable).toBe(true);
      expect(quote.etaDays! * 24).toBeLessThanOrEqual(Number(/(\d+) h/.exec(label)![1]));
    }
  });
});

// ---------------------------------------------------------------------------
// A lane we do not serve — the arm this file is really about
// ---------------------------------------------------------------------------

describe('an unserviceable destination', () => {
  it('returns the serviceable:false arm, never a zero amount', async () => {
    const quote = await logistics.quoteFreight(lane(BENGALURU));

    expect(quote.serviceable).toBe(false);
    // The assertion that matters. `Money.ZERO` here reads downstream as free
    // freight and publishes a landed price short by the whole freight line.
    expect(quote.amount).toBeNull();
    expect(quote.carrierCode).toBeNull();
    expect(quote.etaDays).toBeNull();
    expect(quote.reason).toContain(BENGALURU);
  });

  it('tells a typo apart from a place we do not reach', async () => {
    const typo = await logistics.quoteFreight(lane(NOT_A_PINCODE));
    const real = await logistics.quoteFreight(lane(BENGALURU));

    expect(typo.serviceable).toBe(false);
    expect(real.serviceable).toBe(false);
    // Different sentences, because only one of them describes something the
    // buyer can fix by re-reading what they typed.
    expect(typo.reason).not.toBe(real.reason);
    expect(typo.reason).toMatch(/recognise/i);
    expect(real.reason).toMatch(/NCR/);
  });

  it('refuses a consignment heavier than the parcel card instead of extrapolating', async () => {
    // 50 × 2.5 kg = 125 kg. The card stops at 50 kg, and a parcel rate stretched
    // to a quarter-tonne is a number we would lose money honouring.
    const quote = await logistics.quoteFreight(lane(DELHI, { units: 50 }));

    expect(quote.serviceable).toBe(false);
    expect(quote.amount).toBeNull();
    expect(quote.reason).toMatch(/bulk quote/i);
  });

  it('throws on a malformed request rather than calling it unserviceable', async () => {
    // A five-digit pincode is a caller defect; 560001 is a real place we do not
    // serve yet. Collapsing the two hides a bug behind a business answer.
    await expect(logistics.quoteFreight(lane('12345'))).rejects.toBeInstanceOf(ValidationError);
    await expect(logistics.quoteFreight(lane(DELHI, { units: 0 }))).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('never names the origin in a reason a buyer will read', async () => {
    const quotes: FreightQuote[] = [];
    for (const fromPincode of SUPPLY_POINTS) {
      quotes.push(
        await logistics.quoteFreight({
          fromPincode,
          toPincode: BENGALURU,
          weightGrams: LAPTOP_G,
          units: 1,
        }),
      );
    }

    for (const quote of quotes) {
      for (const origin of SUPPLY_POINTS) expect(quote.reason).not.toContain(origin);
    }
    // And identical across all three, so an offers grid cannot be read as a list
    // of distinct places even by comparing the failures side by side.
    expect(new Set(quotes.map((q) => q.reason)).size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The batch must be the singles
// ---------------------------------------------------------------------------

describe('quoteFreightBatch', () => {
  const REQUESTS: readonly FreightQuoteRequest[] = [
    lane(DELHI),
    lane(DELHI, { units: 3 }),
    lane(SONIPAT),
    lane(PALWAL),
    lane(BENGALURU),
    lane(NOT_A_PINCODE),
    lane(DELHI, { weightGrams: 5100 }),
  ];

  it('returns exactly what N single quoteFreight calls return', async () => {
    const batch = await logistics.quoteFreightBatch(REQUESTS);
    // Sequentially, not `Promise.all`. Seven concurrent quotes is twenty-one
    // concurrent statements against a pool sized for a web request, and a test
    // that intermittently exhausts it teaches the next reader to distrust it.
    const singles: FreightQuote[] = [];
    for (const request of REQUESTS) singles.push(await logistics.quoteFreight(request));

    expect(batch.size).toBe(REQUESTS.length);
    REQUESTS.forEach((request, i) => {
      const key = freightLaneKey(request);
      expect(batch.has(key)).toBe(true);
      expect(wire(batch.get(key)!)).toEqual(wire(singles[i]!));
    });
  });

  it('collapses a lane quoted twice into one answer', async () => {
    // Two supply points can share a pincode. That is one computation and one Map
    // entry — not a silently dropped row.
    const batch = await logistics.quoteFreightBatch([lane(DELHI), lane(DELHI), lane(SONIPAT)]);

    expect(batch.size).toBe(2);
    expect(batch.get(freightLaneKey(lane(DELHI)))!.amount?.toString()).toBe('149.00');
  });

  it('is empty for an empty array and rejects a batch past the ceiling', async () => {
    await expect(logistics.quoteFreightBatch([])).resolves.toEqual(new Map());

    const tooMany = Array.from({ length: 51 }, () => lane(DELHI));
    await expect(logistics.quoteFreightBatch(tooMany)).rejects.toBeInstanceOf(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// The two labels the storefront renders
// ---------------------------------------------------------------------------

describe('the filter-level answers', () => {
  it('isServiceable follows the pilot geography', async () => {
    await expect(logistics.isServiceable(DELHI)).resolves.toBe(true);
    await expect(logistics.isServiceable(PALWAL)).resolves.toBe(true);
    await expect(logistics.isServiceable(BENGALURU)).resolves.toBe(false);
    await expect(logistics.isServiceable(NOT_A_PINCODE)).resolves.toBe(false);
  });

  it('dispatchEstimate buckets the lane and says nothing else', async () => {
    expect(await dispatchLabel(ORIGIN, DELHI)).toBe('Ships in 24 h');
    expect(await dispatchLabel(ORIGIN, SONIPAT)).toBe('Ships in 48 h');
    expect(await dispatchLabel(ORIGIN, BENGALURU)).toBe('Not deliverable to this PIN code');
  });

  it('gives every supply point the same dispatch label for one buyer', async () => {
    // The anonymity constraint the seed is built around: transit time is keyed
    // on the destination, so three supply points in three different NCR towns
    // render one identical string. A label that varied by origin is a location
    // tell, and 02_ARCHITECTURE.md §3 does not distinguish a tell from a name.
    const labels: string[] = [];
    for (const from of SUPPLY_POINTS) labels.push(await dispatchLabel(from, DELHI));

    expect(new Set(labels)).toEqual(new Set(['Ships in 24 h']));
  });
});

// ---------------------------------------------------------------------------
// The seed itself
// ---------------------------------------------------------------------------

describe('the NCR seed', () => {
  it('is idempotent', async () => {
    // Already run once in beforeEach. A second run must insert nothing and must
    // not overwrite a rate ops has tuned: the CLI re-seeds on every `db:reset`.
    const second = await seedLogisticsNcr(db);

    expect(second).toEqual({ pincodes: 0, rateCards: 0, serviceable: 0 });
    const [cards] = await db.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM logistics.carrier_rate_card`;
    expect(Number(cards!.n)).toBe(3);
  });

  it('quotes the in-house carrier and only the in-house carrier, per Q11', async () => {
    // Blue Dart has a carrier row and no serviceability rows. The day one
    // appears, this quote starts naming a carrier we hold no account with.
    const quote = await logistics.quoteFreight(lane(DELHI));

    expect(quote.carrierCode).toBe('INHOUSE');
  });
});
