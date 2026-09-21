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
import { RepresentativeImage, RepresentativeImageDisclosure } from '@trugrade/ui';
import { BRAND } from '@trugrade/config/brand';
import { normalisePincode, type Grade } from '@trugrade/contracts';
import { getOfferBoard, getSkuDetail, type OfferBoard, type SkuDetail } from '../../../lib/api';
import { Board } from './Board';
import { ProductCartScope } from './ProductCartScope';
import { PanelActions } from './PanelActions';
import { specLine, specRows } from './spec-rows';
import { PincodeFocusLink } from './PincodeFocusLink';
// import { SupplyPointPicker } from './SupplyPointPicker';

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
  const pincode = askedPin ? normalisePincode(askedPin) : null;

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

  const gradeLabel = GRADE_LABEL[board.grade] ?? board.grade;

  // Each pool is sorted cheapest-first, and the margin note on the board holds
  // that the cheapest row on the page is in the regular table. So the panel
  // acts on `regular[0]` wherever there is one, and only falls to the margin
  // pool when regular is empty.
  const lowest = regular[0] ?? margin[0] ?? null;

  // The headline figure. Before a pincode there is no landed price to quote —
  // see the note at the top of this file on why we do not print one anyway.
  const priced = board.delivery.kind === 'DELIVERABLE' && lowest !== null;

  const batteryValues = board.offers.flatMap((o) =>
    o.batteryHealthPct ? [o.batteryHealthPct.min, o.batteryHealthPct.max] : [],
  );
  const batteryLabel =
    batteryValues.length > 0
      ? `${Math.min(...batteryValues)}–${Math.max(...batteryValues)}%`
      : null;

  const warrantyMonths = board.offers.map((o) => o.totalWarrantyMonths);

  return (
    <>
      <div className="body">
        {/*
          ONE cart scope for the whole record, wrapping both the panel and the
          board. It used to be two — one around each — which gave the page two
          providers that could not see each other's lines, two "View cart"
          docks, and a dock rendered INSIDE the board: `.tbl-wrap` carries
          `contain: paint`, which makes it the containing block for a fixed
          child, so the dock was positioned against the table instead of the
          viewport.
        */}
        <ProductCartScope>
          <div className="wrap pdp">
            {/*
            LEFT — the sticky panel. Identity, the grade plate, and the two
            actions. It stays put while the board and the specification scroll,
            because the decision it carries is the one the rest of the page is
            evidence for.
          */}
            <aside className="pv">
              <div className="pv-img">
                <span className="pv-grade mono">{gradeLabel}</span>
                <span className="pv-seal">Tamper-sealed &middot; photographed</span>
                {/*
                A drawing, deliberately, and not a photograph. Every real frame
                we hold is of a DIFFERENT machine of this grade, and
                `RepresentativeImage` exists to say so in a caption. A caption
                does not survive being shrunk into a product panel, so the
                photographs stay in their own block below where the caption
                reads, and this slot carries no claim at all.
              */}
                <svg viewBox="0 0 150 80" fill="none" aria-hidden="true" className="pv-draw">
                  <rect
                    x="27"
                    y="10"
                    width="96"
                    height="56"
                    rx="3"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                  <path d="M12 70 h126 l-8 -4 H20 z" stroke="currentColor" strokeWidth="2" />
                </svg>
              </div>

              <PanelActions
                listingId={priced && lowest ? lowest.listingId : null}
                city={lowest?.city ?? null}
                snapshot={
                  priced && lowest
                    ? {
                        listingId: lowest.listingId,
                        title: `${sku.brandName} ${sku.modelName}`,
                        specSummary: specLine(sku),
                        grade: lowest.grade,
                        unitPrice: lowest.landedPrice,
                        supplyPoint: `Supply Point ${lowest.supplyPointCode.toUpperCase()} · ${lowest.city}`,
                        dispatch: lowest.dispatchCommitment,
                      }
                    : null
                }
              />

              <p className="pv-trust">
                Sold by <b>{BRAND.legalEntity}</b> &middot; one GST invoice, every serial listed
                &middot; <b>48-hour</b> inspect-and-reject window.
              </p>

              <dl className="pv-facts">
                <div>
                  <dt>Sealed at this grade</dt>
                  <dd className="mono">{board.unitsAvailable}</dd>
                </div>
                <div>
                  <dt>Supply points</dt>
                  <dd className="mono">{board.supplyPoints}</dd>
                </div>
                <div>
                  <dt>GST</dt>
                  <dd className="mono">
                    18%
                    {board.offers[0] && (
                      <span className="denom">
                        {' '}
                        {board.offers[0].isInterState ? 'IGST' : 'CGST+SGST'}
                      </span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Warranty</dt>
                  <dd className="mono">
                    {warrantyMonths.length > 0 ? (
                      <>
                        {Math.min(...warrantyMonths)}
                        {Math.min(...warrantyMonths) === Math.max(...warrantyMonths)
                          ? ''
                          : `–${Math.max(...warrantyMonths)}`}{' '}
                        mo
                      </>
                    ) : (
                      <span className="notmeasured">Per supply point</span>
                    )}
                  </dd>
                </div>
              </dl>
            </aside>

            {/* RIGHT — what the machine is, what it costs landed, and the board. */}
            <main className="det">
              <h1 className="det-title">
                {sku.brandName} {sku.modelName}
              </h1>

              <div className="meta-row">
                <span className="dchip hl">Grade {gradeLabel}</span>
                {batteryLabel ? (
                  <span className="dchip mono">Battery {batteryLabel}</span>
                ) : (
                  <span className="dchip notmeasured">Battery not measured</span>
                )}
                <span className="dchip mono">{sku.cpuModel}</span>
                <span className="dchip mono">{sku.ramGb} GB RAM</span>
                <span className="dchip mono">
                  {sku.storageGb} GB {sku.storageType.replace('_', ' ')}
                </span>
                <span className="dchip mono">
                  {sku.screenSizeIn}&quot; {sku.resolution}
                </span>
              </div>

              <div className="price-blk">
                <div className="price-line">
                  <span className="price-now mono">
                    {priced && lowest
                      ? `₹${RUPEES.format(Number(lowest.landedPrice))}`
                      : shown?.fromPrice
                        ? `₹${RUPEES.format(Number(shown.fromPrice))}`
                        : 'Not priced'}
                  </span>
                  {/*
                  No struck-through "new" price and no percentage off it. We do
                  not hold what this model sold for new, and printing a number
                  we cannot source beside a discount off it is the invented
                  saving the CCPA guidelines name.
                */}
                  <span className="price-off">
                    {priced ? 'lowest landed' : shown?.fromPrice ? 'from' : ''}
                  </span>
                </div>
                <p className="price-note">
                  {priced
                    ? `Includes 18% GST and freight to ${board.pincode}. Every supply point is priced on the board below.`
                    : 'Before tax and delivery. A landed price needs a destination — give us a pincode and every row below fills in.'}
                </p>

                <form
                  className="pin-line"
                  action={`/laptops/${encodeURIComponent(slug)}`}
                  method="get"
                >
                  {board.grade && <input type="hidden" name="grade" value={board.grade} />}
                  {selected && (
                    <>
                      <input type="hidden" name="sp" value={selected.supplyPointCode} />
                      <input type="hidden" name="city" value={selected.city} />
                    </>
                  )}
                  <label className="sr-only" htmlFor="pin">
                    Delivery pincode
                  </label>
                  <input
                    id="pin"
                    name="pin"
                    className="field mono"
                    inputMode="numeric"
                    pattern="[1-9][0-9]{2}[ ]?[0-9]{3}"
                    maxLength={7}
                    defaultValue={board.pincode ?? ''}
                    placeholder="Delivery pincode"
                    aria-describedby="pinhelp"
                  />
                  <button type="submit" className="mini">
                    {board.pincode ? 'Update' : 'Show prices'}
                  </button>
                </form>

                <p id="pinhelp" className="deliver">
                  {askedPin && pincode === null ? (
                    'That is not a pincode. Six digits, and the first one is never 0 — for example 110001.'
                  ) : board.delivery.kind === 'DELIVERABLE' && lowest ? (
                    <>
                      {lowest.dispatchCommitment}
                      {board.delivery.etaDays > 0 ? (
                        <>
                          , then <b>{board.delivery.etaDays}</b> day
                          {board.delivery.etaDays === 1 ? '' : 's'} transit to {board.pincode}
                        </>
                      ) : null}
                      .
                    </>
                  ) : (
                    'Six digits. We quote the real freight for the lane, not an average.'
                  )}
                </p>
              </div>

              <h2 className="sec-t">Choose grade</h2>
              <div className="grades" role="group" aria-label="Inspected grade">
                {board.grades.map((g) => {
                  const on = g.grade === board.grade;
                  return (
                    <Link
                      key={g.grade}
                      className={on ? 'gpill on' : 'gpill'}
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
                      <b>Grade {GRADE_LABEL[g.grade] ?? g.grade}</b>
                      <small className="mono">
                        {g.unitsAvailable} unit{g.unitsAvailable === 1 ? '' : 's'} &middot;{' '}
                        {g.supplyPoints} supply point{g.supplyPoints === 1 ? '' : 's'}
                      </small>
                    </Link>
                  );
                })}
              </div>

              <h2 className="sec-t" id="board">
                Compare supply points
                <span className="sec-sub">
                  {board.pincode
                    ? `· Grade ${gradeLabel} · landed to ${board.pincode}`
                    : `· Grade ${gradeLabel}`}
                </span>
              </h2>

              <div className="tbl-wrap">
                {board.delivery.kind === 'NONE' ? (
                  <div className="empty">
                    <p className="retry">
                      <PincodeFocusLink>Enter a delivery pincode</PincodeFocusLink>
                    </p>
                  </div>
                ) : board.delivery.kind === 'UNSERVICEABLE' ? (
                  <div className="empty err">
                    <h3>We cannot deliver to {board.pincode} yet</h3>
                    <p className="retry">
                      <PincodeFocusLink>Try another pincode</PincodeFocusLink> or{' '}
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
                      Every unit at Grade {gradeLabel} has been sold, or its inspection certificate
                      has expired and it is out of the window until it is re-tested. The other
                      grades above still have stock.
                    </p>
                  </div>
                ) : (
                  <>
                    {regular.length > 0 && (
                      <Board
                        layout="table"
                        rows={regular}
                        pool="REGULAR"
                        sku={`${sku.brandName} ${sku.modelName}`}
                        spec={specLine(sku)}
                        caption={`${regular.length} supply point${regular.length === 1 ? '' : 's'} offering ${sku.brandName} ${sku.modelName} at Grade ${gradeLabel}, sorted by landed price, lowest first. Prices include GST and freight to ${board.pincode}.`}
                      />
                    )}
                    {margin.length > 0 && (
                      <Board
                        layout="table"
                        rows={margin}
                        pool="MARGIN"
                        sku={`${sku.brandName} ${sku.modelName}`}
                        spec={specLine(sku)}
                        caption={`${margin.length} supply point${margin.length === 1 ? '' : 's'} offering the same machine under the margin scheme, sorted by landed price, lowest first. Prices include GST and freight to ${board.pincode}.`}
                      />
                    )}
                  </>
                )}
              </div>

              <details className="acc">
                <summary className="acc-h">
                  Specification
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </summary>
                {/*
                A definition list rather than a table. A `<table>` here has to
                resolve its width against a grid column, and a long mono value
                — `DEL-LAT5420-I51135G7-16-512` — sizes the column from its own
                content and pushes the record sideways on a phone. Rows of
                `dt`/`dd` wrap instead, and this is what the spec block on the
                old identity card already used.
              */}
                <dl className="spec">
                  {specRows(sku).map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd className="mono">{value}</dd>
                    </div>
                  ))}
                </dl>
              </details>

              <details className="acc">
                <summary className="acc-h">
                  Condition photographs &middot; Grade {gradeLabel}
                  {sku.images?.images?.length ? (
                    <span className="acc-count mono">
                      {sku.images.images.length} frame{sku.images.images.length === 1 ? '' : 's'}
                    </span>
                  ) : null}
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </summary>
                <div className="acc-b acc-b-pad">
                  <Gallery sku={sku} grade={board.grade} hasUnits={board.offers.length > 0} />
                </div>
              </details>
            </main>
          </div>
        </ProductCartScope>
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
  // ONE disclosure for the set, above the frames, instead of the same sentence
  // repeated under all six. Each figure still points at it through
  // `aria-describedby`, so a screen reader announces it per image as before.
  const disclosureId = 'grade-frames-disclosure';

  return (
    <>
      <RepresentativeImageDisclosure
        id={disclosureId}
        grade={grade as Grade}
        match={resolved?.match ?? 'SKU'}
        count={held.length}
        passportHref={passportHref}
        className="gal-disclosure"
      />
      <div className="gal">
        {held.map((image) => (
          <RepresentativeImage
            key={image.id}
            src={image.url}
            alt={image.altText}
            grade={grade as Grade}
            match={resolved?.match ?? 'SKU'}
            passportHref={passportHref}
            captionedBy={disclosureId}
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
        .
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
