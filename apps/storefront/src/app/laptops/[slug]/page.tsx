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
import { RepresentativeImage, SidePanel } from '@trugrade/ui';
import { BRAND } from '@trugrade/config/brand';
import type { Grade } from '@trugrade/contracts';
import { getOfferBoard, getSkuDetail, type OfferBoard, type SkuDetail } from '../../../lib/api';
import { CategoryStrip } from '../../CategoryStrip';
import { Board } from './Board';
import { ProductCartScope } from './ProductCartScope';
import { ProductIdentityCard } from './ProductIdentityCard';
import { specLine } from './spec-rows';
import { SupplyPointPicker } from './SupplyPointPicker';

/** The prices are landed to the reader's pincode, so nothing here is cacheable. */
export const dynamic = 'force-dynamic';

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
          <div className="protop">
            <div className="protop-main">
              <ProductIdentityCard
                sku={sku}
                board={board}
                fromPrice={shown?.fromPrice ?? null}
              />

              <section aria-labelledby="cond" className="protop-grade">
                <div className="sh">
                  <div className="shrow">
                    <h2 id="cond">What Grade {GRADE_LABEL[board.grade] ?? board.grade} looks like</h2>
                    <span className="sub">Photographed against the published grade bands</span>
                  </div>
                </div>

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

                <details className="grade-gal-acc">
                  <summary>
                    Condition photographs · Grade {GRADE_LABEL[board.grade] ?? board.grade}
                    {sku.images?.images?.length ? (
                      <span className="grade-gal-count mono">
                        {sku.images.images.length} frame{sku.images.images.length === 1 ? '' : 's'}
                      </span>
                    ) : null}
                  </summary>
                  <div className="grade-gal-acc-body">
                    <Gallery sku={sku} grade={board.grade} hasUnits={board.offers.length > 0} />
                  </div>
                </details>
              </section>

              {/*
                Sits in the left column so it follows the grade accordion instead of
                waiting for the deliver panel column to finish — that panel is taller
                and was leaving a dead band above this section.
              */}
              <section aria-labelledby="board" className="protop-board" id="board">
                <div className="sh">
                  <div className="shrow">
                    <h2 id="board">Compare supply points</h2>
                    <a className="sub ulink" href="#units">
                      Pick a supply point to see its serials
                    </a>
                  </div>
                </div>

                {board.offers.length > 0 && (
                  <SupplyPointPicker
                    offers={board.offers}
                    initialSelected={selected}
                    slug={slug}
                    query={query}
                  />
                )}

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
                    <ProductCartScope>
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
                    </ProductCartScope>
                  )}
                </div>
              </section>
            </div>

            <div className="sidep protop-deliver" id="deliver">
              <SidePanel
                sticky={false}
                title="Deliver to"
                description="Freight and the GST split both depend on where this is going, so the prices follow your pincode."
                footnote={
                  <>
                    We are the seller of record. One invoice from {BRAND.legalEntity}, with every
                    serial on it, and a 48-hour window to inspect and reject after delivery.
                  </>
                }
              >
                <form className="pinform" action={`/laptops/${encodeURIComponent(slug)}`} method="get">
                  {board.grade && <input type="hidden" name="grade" value={board.grade} />}
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
                      : board.delivery.kind === 'DELIVERABLE' && board.delivery.etaDays > 0
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
            </div>
          </div>
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

/**
 * One chip per source on the board. Keyed on code AND city: "Supply Point F"
 * is one source in Noida and a different one in Faridabad, and a link carrying
 * only the letter would land on whichever came first.
 */
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
