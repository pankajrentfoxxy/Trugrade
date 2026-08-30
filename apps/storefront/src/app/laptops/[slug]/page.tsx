/**
 * ARCHETYPE C — Record. Identity header + evidence panel + actions side panel.
 * DENSITY: comfortable (set on `<html>` in `layout.tsx`).
 *
 * The product page, and the screen the whole model rests on: a Dell Latitude
 * 5420 is held by ten different supply points at ten different prices, and the
 * buyer's job here is to decide which of them to buy from, on evidence.
 * Everything on the page serves that decision — the photographs say what the
 * grade looks like, the specification says what the machine is, the board says
 * what each source costs landed and how each has performed, and the serial list
 * says which exact machines are behind the row they picked.
 *
 * **The whole of the state is in the URL** — grade, delivery pincode, and the
 * selected supply point. A buyer must be able to send a colleague a link that
 * reproduces exactly what they saw, and on this screen "exactly what they saw"
 * includes the pincode the prices were landed to.
 *
 * Two things are deliberately absent and their absence is the design:
 *
 *   - **No price is shown until a pincode is given.** The landed price is our
 *     price + GST + freight to a real destination; quoting a lower "from" figure
 *     and revealing the freight at checkout is drip pricing, which the CCPA Dark
 *     Patterns Guidelines 2023 name outright. Inventing a pincode to avoid the
 *     empty state would be worse: a delivered price to somewhere the buyer never
 *     named. `/search` made the same call, and the two screens agree.
 *   - **No countdown, no "only 3 left", no scarcity of any kind.** Palwal holds
 *     three units and the board says three units.
 */
import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { GradeBadge, RecordHeader, RepresentativeImage, SidePanel } from '@trugrade/ui';
import { BRAND } from '@trugrade/config/brand';
import type { Grade } from '@trugrade/contracts';
import { getOfferBoard, getSkuDetail, type OfferBoard, type SkuDetail } from '../../../lib/api';
import { CategoryStrip } from '../../CategoryStrip';
import { Board } from './Board';
import { UnitList } from './UnitList';

/** The prices are landed to the reader's pincode, so nothing here is cacheable. */
export const dynamic = 'force-dynamic';

const RUPEES = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const GRADE_LABEL: Record<string, string> = { A_PLUS: 'A+', A: 'A', B: 'B' };
const GRADES = new Set(['A_PLUS', 'A', 'B']);

type Params = { slug: string };
type Search = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined): string | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<Search>;
}): Promise<Metadata> {
  const { slug } = await params;
  const grade = first((await searchParams).grade);
  const sku = await getSkuDetail(slug, grade && GRADES.has(grade) ? grade : 'A');
  if (!sku) return { title: 'Laptop' };
  return {
    title: `${sku.brandName} ${sku.modelName}`,
    description: `Inspected ${sku.brandName} ${sku.modelName} — ${specLine(sku)}. Compare every supply point on landed price, inspection score and measured battery health.`,
  };
}

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<Search>;
}): Promise<React.JSX.Element> {
  const { slug } = await params;
  const query = await searchParams;

  const askedGrade = first(query.grade);
  const grade = askedGrade && GRADES.has(askedGrade) ? askedGrade : undefined;
  // A malformed pincode is not a pincode. It is dropped rather than sent, so the
  // page asks again instead of showing the API's validation error as the answer.
  const askedPin = first(query.pin);
  const pincode = askedPin && /^[1-9][0-9]{5}$/.test(askedPin) ? askedPin : null;

  // Both halves at once: what the machine IS (catalog) and what is FOR SALE
  // (listing + qc + logistics). Two endpoints because they are two modules'
  // facts, and one join across them would be a third definition of a SKU.
  const [board, sku] = await Promise.all([
    getOfferBoard(slug, { pincode: pincode ?? undefined, grade }),
    getSkuDetail(slug, grade ?? 'A'),
  ]);

  // Nothing catalogued under that id. A 404 rather than an empty shell: the URL
  // is wrong, and a page that renders chrome around nothing says otherwise.
  if (!sku) notFound();

  if (board === null) {
    return (
      <>
        <CategoryStrip query="" />
        <div className="body">
          <div className="wrap">
            <div className="empty err">
              <h3>We could not load the supply points for this machine</h3>
              <p>
                The catalogue answered and the stock did not. Nothing is wrong with what you asked
                for — this is our problem, not yours. Reload the page; if it keeps happening the
                stock is still there and{' '}
                <a className="ulink" href="/help">
                  our team can pull it for you
                </a>
                .
              </p>
              <p className="retry">
                <a className="pill acc" href={href(slug, query)}>
                  Try again
                </a>
              </p>
            </div>
          </div>
        </div>
      </>
    );
  }

  const shown = board.grades.find((g) => g.grade === board.grade);
  const selected = selectedOffer(board, first(query.sp), first(query.city));
  const regular = board.offers.filter((o) => o.valuationMethod === 'REGULAR');
  const margin = board.offers.filter((o) => o.valuationMethod === 'MARGIN');

  return (
    <>
      <CategoryStrip query="" />

      <div className="body">
        <div className="wrap">
          <RecordHeader
            title={`${sku.brandName} ${sku.modelName}`}
            subtitle={specLine(sku)}
            status={<GradeBadge grade={board.grade as Grade} />}
            identifiers={[
              { label: 'SKU', value: sku.skuCode },
              { label: 'HSN', value: sku.hsnCode },
              {
                label: 'Sealed units',
                value: `${board.unitsAvailable} at Grade ${GRADE_LABEL[board.grade] ?? board.grade}`,
              },
              {
                label: 'Supply points',
                value: `${board.supplyPoints}`,
              },
              {
                // Named for what it is. This is our selling price at the cheapest
                // supply point, before GST and before freight — the board below
                // is where a landed figure lives, and the two must not be read
                // as the same number.
                label: 'From, before tax and delivery',
                value: shown ? `₹${RUPEES.format(Number(shown.fromPrice))}` : 'Not priced',
              },
            ]}
          />

          <div className="rec">
            <main className="evid">
              {/* --- CONDITION, AT THIS GRADE ------------------------------- */}
              <section aria-labelledby="cond">
                <div className="sh">
                  <div className="shrow">
                    <h2 id="cond">What Grade {GRADE_LABEL[board.grade] ?? board.grade} looks like</h2>
                    <span className="sub">Photographed against the published grade bands</span>
                  </div>
                  <div className="tickrule" aria-hidden="true">
                    {Array.from({ length: 31 }, (_, i) => (
                      <i key={i} />
                    ))}
                  </div>
                </div>

                {/* The grade selector. Links, not a widget: the grade is URL
                    state, and a colleague opening the link sees this grade. */}
                <div className="gsel" role="group" aria-label="Inspected grade">
                  {board.grades.map((g) => {
                    const on = g.grade === board.grade;
                    return (
                      <Link
                        key={g.grade}
                        className={on ? 'chipf on' : 'chipf'}
                        aria-current={on ? 'true' : undefined}
                        href={
                          href(slug, {
                            ...query,
                            grade: g.grade,
                            // A supply point selected at one grade holds nothing
                            // at another, so the selection is dropped rather
                            // than carried into a row that does not exist.
                            sp: undefined,
                            city: undefined,
                          }) as Route
                        }
                      >
                        Grade {GRADE_LABEL[g.grade] ?? g.grade}
                        <span className="c mono">
                          {g.unitsAvailable} unit{g.unitsAvailable === 1 ? '' : 's'} ·{' '}
                          {g.supplyPoints} supply point{g.supplyPoints === 1 ? '' : 's'}
                        </span>
                      </Link>
                    );
                  })}
                </div>

                <Gallery sku={sku} grade={board.grade} hasUnits={board.offers.length > 0} />
              </section>

              {/* --- THE DECLARED SPECIFICATION ----------------------------- */}
              <section aria-labelledby="spec">
                <div className="sh">
                  <div className="shrow">
                    <h2 id="spec">Specification</h2>
                    <span className="sub">
                      As catalogued, and checked against what the tool detected at inspection
                    </span>
                  </div>
                </div>
                <div className="tbl">
                  <dl className="specs">
                    {specRows(sku).map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd className="mono">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </section>

            </main>

            {/* --- THE ACTIONS PANEL --------------------------------------- */}
            <div className="sidep" id="deliver">
              <SidePanel
                title="Deliver to"
                description="Freight and the GST split both depend on where this is going, so the prices follow your pincode."
                footnote={
                  <>
                    We are the seller of record. One invoice from {BRAND.legalEntity}, with every
                    serial on it, and a 48-hour window to inspect and reject after delivery.
                  </>
                }
              >
                {/* A plain GET form: the pincode is URL state, and this works
                    with no JavaScript at all. */}
                <form className="pinform" action={`/laptops/${encodeURIComponent(slug)}`} method="get">
                  {board.grade && <input type="hidden" name="grade" value={board.grade} />}
                  {/* The grade and the selected supply point survive a change of
                      destination: changing where it ships to is not a reason to
                      lose the row the buyer was reading. Both halves of the
                      supply-point key travel, for the reason the chips give. */}
                  {selected && (
                    <>
                      <input type="hidden" name="sp" value={selected.supplyPointCode} />
                      <input type="hidden" name="city" value={selected.city} />
                    </>
                  )}
                  <label htmlFor="pin">Delivery pincode</label>
                  <div className="pinrow">
                    <input
                      id="pin"
                      name="pin"
                      className="mono"
                      inputMode="numeric"
                      pattern="[1-9][0-9]{5}"
                      maxLength={6}
                      defaultValue={board.pincode ?? ''}
                      placeholder="110001"
                      aria-describedby="pinhelp"
                    />
                    <button type="submit" className={board.pincode ? 'sel gh' : 'sel'}>
                      {board.pincode ? 'Update' : 'Show landed prices'}
                    </button>
                  </div>
                  <p id="pinhelp" className="fnote">
                    {askedPin && pincode === null
                      ? 'That is not a pincode. Six digits, and the first one is never 0 — for example 110001.'
                      : /*
                          The transit band is printed only when a lane was
                          actually priced. `etaDays` is 0 when none was, and a
                          "0 days" delivery promise is a number we did not
                          measure rendering as one we did.
                        */
                        board.delivery.kind === 'DELIVERABLE' && board.delivery.etaDays > 0
                        ? `Prices below include GST and freight to ${board.pincode}. Carrier transit is ${board.delivery.etaDays} day${board.delivery.etaDays === 1 ? '' : 's'} once dispatched.`
                        : 'Six digits. We quote the real freight for the lane, not an average.'}
                  </p>
                </form>

                <dl className="facts">
                  <div>
                    <dt>Sealed units at this grade</dt>
                    <dd className="mono">{board.unitsAvailable}</dd>
                  </div>
                  <div>
                    <dt>Supply points holding it</dt>
                    <dd className="mono">{board.supplyPoints}</dd>
                  </div>
                  <div>
                    <dt>GST</dt>
                    <dd className="mono">
                      18% · HSN {sku.hsnCode}
                      {/*
                        Which heads the tax lands under is read off a priced row,
                        never guessed. With no row, an absent `isInterState` is
                        falsy and would print "CGST + SGST" for a Delhi delivery
                        that is inter-state — a missing value rendering as a
                        confident wrong one.
                      */}
                      {board.offers[0] && (
                        <span className="denom">
                          {' '}
                          {board.offers[0].isInterState ? 'IGST' : 'CGST + SGST'}
                        </span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Warranty</dt>
                    <dd className="mono">
                      {board.offers.length > 0 ? (
                        <>
                          {Math.min(...board.offers.map((o) => o.totalWarrantyMonths))}–
                          {Math.max(...board.offers.map((o) => o.totalWarrantyMonths))} months
                          <span className="denom"> total, from us, per supply point</span>
                        </>
                      ) : (
                        <span className="notmeasured">Shown per supply point</span>
                      )}
                    </dd>
                  </div>
                </dl>
              </SidePanel>

              <div className="tbl why">
                <div className="tbh">
                  <b>Why these numbers exist</b>
                </div>
                <div className="whybody">
                  <p>
                    Every unit was opened at the supplier&rsquo;s warehouse by our technician,
                    measured with {BRAND.qcProduct}, graded against the published bands and sealed.
                    The score and the battery figure are readings, not descriptions.
                  </p>
                  <p>
                    <b>Grade accuracy</b> is how often a source&rsquo;s declared grade survived our
                    inspection, over every unit we have inspected from them — the denominator is
                    printed with it, always.
                  </p>
                  <p>
                    You are buying from {BRAND.legalEntity} — who supplies a machine is our
                    business and how they perform is yours, which is why the board shows the second
                    and never the first.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/*
        The board is full width, exactly as it is in
        `docs/reference/homepage.html`. Ten supply points against ten columns do
        not fit inside the evidence column of a two-column record, and a
        comparison table whose Add button sits off the right-hand edge behind a
        scrollbar is not a comparison table.
      */}
      <div className="board">
        <div className="wrap">
                {/* --- THE BOARD ---------------------------------------------- */}
                <section aria-labelledby="board" id="board">
                  <div className="sh">
                    <div className="shrow">
                      <h2 id="board">Compare supply points</h2>
                      <span className="sub">
                        One model, every source holding it, side by side
                      </span>
                    </div>
                    <div className="tickrule" aria-hidden="true">
                      {Array.from({ length: 31 }, (_, i) => (
                        <i key={i} />
                      ))}
                    </div>
                  </div>

                  <div className="tbl">
                    <div className="tbh">
                      <b>
                        {sku.brandName} {sku.modelName}
                      </b>
                      <span className="m">
                        {specLine(sku)} · Grade {GRADE_LABEL[board.grade] ?? board.grade}
                      </span>
                      <div className="r">
                        <span className="chipf on">
                          {board.pincode ? `Landed to ${board.pincode}` : 'No pincode yet'}
                        </span>
                        <span className="chipf">
                          {board.supplyPoints} supply point{board.supplyPoints === 1 ? '' : 's'}
                        </span>
                      </div>
                    </div>

                    {board.delivery.kind === 'NONE' ? (
                      <div className="empty">
                        <h3>
                          {board.supplyPoints} supply point{board.supplyPoints === 1 ? '' : 's'} hold
                          this machine at Grade {GRADE_LABEL[board.grade] ?? board.grade}
                        </h3>
                        <p>
                          A landed price is our price plus GST plus freight to your dock, and we will
                          not quote you one figure and add to it later. Tell us where it is going and
                          every row below fills in — the price, the inspection score, how often that
                          source&rsquo;s declared grade survived ours, and what is in stock.
                        </p>
                        <p className="retry">
                          <a className="ulink" href="#deliver">
                            Enter a delivery pincode
                          </a>
                        </p>
                      </div>
                    ) : board.delivery.kind === 'UNSERVICEABLE' ? (
                      <div className="empty err">
                        <h3>We cannot deliver to {board.pincode} yet</h3>
                        <p>{board.delivery.reason}</p>
                        <p className="retry">
                          <a className="ulink" href="#deliver">
                            Try another pincode
                          </a>{' '}
                          or{' '}
                          <a className="ulink" href={`/bulk?pin=${board.pincode ?? ''}`}>
                            ask us to quote this lane
                          </a>
                          .
                        </p>
                      </div>
                    ) : board.offers.length === 0 ? (
                      <div className="empty">
                        <h3>Nothing sealed at this grade right now</h3>
                        <p>
                          Every unit at Grade {GRADE_LABEL[board.grade] ?? board.grade} has been sold,
                          or its inspection certificate has expired and it is out of the window until
                          it is re-tested. The other grades above still have stock.
                        </p>
                      </div>
                    ) : (
                      <>
                        {regular.length > 0 && (
                          <Board
                            rows={regular}
                            pool="REGULAR"
                            caption={`${regular.length} supply point${regular.length === 1 ? '' : 's'} offering ${sku.brandName} ${sku.modelName} at Grade ${GRADE_LABEL[board.grade] ?? board.grade}, sorted by landed price, lowest first. Prices include GST and freight to ${board.pincode}.`}
                          />
                        )}
                        {margin.length > 0 && (
                          <Board
                            rows={margin}
                            pool="MARGIN"
                            caption={`${margin.length} supply point${margin.length === 1 ? '' : 's'} offering the same machine under the margin scheme, sorted by landed price, lowest first. Prices include GST and freight to ${board.pincode}.`}
                          />
                        )}
                        <div className="tnote">
                          <b>The cheapest row is not the best-inspected one.</b> The board is sorted
                          by landed price because that is the question a price comparison answers —
                          the inspection score and the grade accuracy beside it are the other half,
                          and they do not move in the same direction. A source below{' '}
                          <span className="mono">10</span> inspected units shows how many it has
                          instead of an average: a percentage computed on three machines would be our
                          claim, not theirs. You can still buy it.
                          {board.unpricedSupplyPoints > 0 && (
                            <>
                              {' '}
                              <b className="mono">{board.unpricedSupplyPoints}</b> further supply
                              point
                              {board.unpricedSupplyPoints === 1 ? '' : 's'} hold this machine on a
                              lane we could not price to {board.pincode}, so{' '}
                              {board.unpricedSupplyPoints === 1 ? 'it is' : 'they are'} not shown
                              rather than shown at a price that is missing its freight.
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </section>

                {/* --- THE SERIALS BEHIND ONE ROW ----------------------------- */}
                {board.offers.length > 0 && (
                  <section aria-labelledby="units">
                    <div className="sh">
                      <div className="shrow">
                        <h2 id="units">The actual machines</h2>
                        <span className="sub">
                          Every serial on offer, with its inspection report — before you buy, no
                          account needed
                        </span>
                      </div>
                    </div>

                    {/* The supply point is keyed on code AND city. "Supply Point F"
                        is one source in Noida and a different one in Faridabad,
                        and a link carrying only the letter would land on whichever
                        came first. */}
                    <div className="gsel" role="group" aria-label="Supply point">
                      {board.offers.map((o) => {
                        const on =
                          selected?.supplyPointCode === o.supplyPointCode &&
                          selected?.city === o.city;
                        return (
                          <Link
                            key={`${o.supplyPointCode}-${o.city}`}
                            className={on ? 'chipf on' : 'chipf'}
                            aria-current={on ? 'true' : undefined}
                            // Both halves of the key travel. "Supply Point F" is
                            // one source in Noida and a different one in
                            // Faridabad, and a link carrying only the letter
                            // would land on whichever came first.
                            href={
                              `${href(slug, { ...query, sp: o.supplyPointCode, city: o.city })}#units` as Route
                            }
                          >
                            {o.label}
                            <span className="c mono">
                              {o.unitsAvailable} unit{o.unitsAvailable === 1 ? '' : 's'}
                            </span>
                          </Link>
                        );
                      })}
                    </div>

                    {selected ? (
                      <UnitList units={selected.units} label={selected.label} />
                    ) : (
                      <div className="empty">
                        <h3>Pick a supply point to see its serials</h3>
                        <p>
                          Each one lists the machines it actually holds, and each serial opens the
                          inspection report that machine was sealed with — the photographs, the twelve
                          area results, the detected hardware and the wipe certificate.
                        </p>
                      </div>
                    )}
                  </section>
                )}
        </div>
      </div>
    </>
  );
}

/* ==========================================================================
 * Pieces
 * ======================================================================== */

/**
 * The condition photographs for the selected grade.
 *
 * `RepresentativeImage` carries the mandatory caption and cannot be made to drop
 * it — that is the component's whole reason for existing. It also widens the
 * caption when the photograph came from a broader anchor than this SKU, because
 * a model-level shot is a photograph of a *different machine* and showing it
 * unlabelled is the r.7(2) misrepresentation.
 *
 * When nothing resolved, ONE placeholder is rendered rather than six identical
 * ones. Six copies of "we have not photographed this yet" is the same sentence
 * six times, and the reader stops reading it after the first.
 */
function Gallery({
  sku,
  grade,
  hasUnits,
}: {
  sku: SkuDetail;
  grade: string;
  /** No offers, no serial list — so no anchor to send the reader to. */
  hasUnits: boolean;
}): React.JSX.Element {
  const resolved = sku.images;
  const held = resolved?.images ?? [];
  const label = GRADE_LABEL[grade] ?? grade;
  const passportHref = hasUnits ? '#units' : undefined;

  // Nothing catalogued for this grade. ONE placeholder, not one per view — six
  // copies of the same sentence is the same sentence six times, and the reader
  // stops after the first.
  if (held.length === 0) {
    return (
      <div className="gal one">
        <RepresentativeImage
          grade={grade as Grade}
          match="PLACEHOLDER"
          alt={`No photograph of Grade ${label} condition for the ${sku.brandName} ${sku.modelName}`}
          passportHref={passportHref}
        />
        <p className="fnote">
          {resolved?.placeholderReason ??
            `No condition photographs are catalogued for Grade ${label} on this model.`}{' '}
          {hasUnits
            ? 'Every unit’s own inspection photographs are on its passport, below, before you buy.'
            : 'Every unit’s own inspection photographs are on its passport, reachable before you buy.'}
        </p>
      </div>
    );
  }

  // The real photographs, at last.
  //
  // This block used to be unconditionally the placeholder above, on the grounds
  // — written in a comment here — that "nothing serves an S3 key to a browser
  // and the dev bucket holds zero objects". Both halves stopped being true when
  // the image pipeline landed: `catalog` replaces the key with an opaque
  // encrypted object token, `GET /api/objects/:token` serves the bytes, and the
  // store holds an object for every catalogued frame. So the page was showing a
  // placeholder over a library that was working.
  //
  // Every frame goes through `RepresentativeImage`, which is what stops any of
  // them being presented as the machine the buyer will receive. The caption
  // repeats, and that is the component's contract rather than an oversight — see
  // the note on a one-caption gallery in the build ledger.
  return (
    <>
      <div className="gal">
        {held.map((image) => (
          <RepresentativeImage
            key={image.id}
            src={image.url}
            alt={image.altText}
            grade={grade as Grade}
            match={resolved?.match ?? 'SKU'}
            passportHref={passportHref}
          />
        ))}
      </div>
      <p className="fnote">
        <b className="mono">{held.length}</b> condition photograph
        {held.length === 1 ? '' : 's'} for Grade {label}
        {/* `match`, not `isGeneric`: the two differ, and the difference is the
            whole claim. MODEL means another machine of the same model; SERIES
            means a different model entirely, and calling both "this range"
            under-states the second. */}
        {resolved?.match === 'MODEL'
          ? ' — of this model rather than of this exact configuration'
          : resolved?.match === 'SERIES'
            ? ' — of this range rather than of this model'
            : ''}
        .{' '}
        {hasUnits
          ? 'Every unit’s own inspection photographs are on its passport, below, before you buy.'
          : 'Every unit’s own inspection photographs are on its passport, reachable before you buy.'}
      </p>
    </>
  );
}

/* ==========================================================================
 * Pure helpers
 * ======================================================================== */

function specLine(sku: SkuDetail): string {
  return [
    sku.cpuModel,
    `${sku.ramGb} GB`,
    `${sku.storageGb} GB ${sku.storageType.replace('_', ' ')}`,
    `${sku.screenSizeIn}"`,
  ].join(' · ');
}

function specRows(sku: SkuDetail): Array<[string, string]> {
  return [
    ['Processor', `${sku.cpuBrand} ${sku.cpuModel} · ${sku.cpuGeneration} gen`],
    ['Memory', `${sku.ramGb} GB`],
    ['Storage', `${sku.storageGb} GB ${sku.storageType.replace('_', ' ')}`],
    ['Graphics', sku.gpuModel ? `${sku.gpuType} · ${sku.gpuModel}` : sku.gpuType],
    [
      'Screen',
      `${sku.screenSizeIn}" ${sku.resolution}${sku.isTouch ? ' · touch' : ''}`,
    ],
    ['Operating system', sku.osSupported],
    ['Series', `${sku.brandName} ${sku.seriesName}`],
    ['SKU code', sku.skuCode],
    ['HSN', sku.hsnCode],
  ];
}

/** `(code, city)`, always — see the note beside the supply-point chips. */
function selectedOffer(
  board: OfferBoard,
  code: string | null,
  city: string | null,
): OfferBoard['offers'][number] | null {
  if (!code || !city) return null;
  return board.offers.find((o) => o.supplyPointCode === code && o.city === city) ?? null;
}

function href(slug: string, query: Search): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    const v = Array.isArray(value) ? value[0] : value;
    if (v !== undefined && v !== '') qs.append(key, v);
  }
  const s = qs.toString();
  return `/laptops/${encodeURIComponent(slug)}${s ? `?${s}` : ''}`;
}
