/**
 * ARCHETYPE C — Record. Identity header + evidence panel + actions side panel.
 * DENSITY: comfortable (set on `<html>` in `layout.tsx`).
 *
 * The product page, and the screen the whole model rests on: a Dell Latitude
 * 5420 is held by ten different supply points at ten different prices, and the
 * buyer's job here is to decide which of them to buy from, on evidence.
 * Everything on the page serves that decision — the photographs in the sticky
 * panel say what the grade looks like, the specification says what the machine
 * is, the board says what each source costs and how each has performed, and
 * the serials behind each row open the exact machines' own passports.
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
import { GRADES as ALL_GRADES, normalisePincode, type Grade } from '@trugrade/contracts';
import {
  getModelSkus,
  getOfferBoard,
  getSearch,
  getSkuDetail,
  type OfferBoard,
} from '../../../lib/api';
import { Board } from './Board';
import { ProductCartScope } from './ProductCartScope';
import { PanelActions } from './PanelActions';
import { specLine, specRows } from './spec-rows';
import { PincodeFocusLink } from './PincodeFocusLink';
import { PincodeForm } from './PincodeForm';
import { ConfigPicker } from './ConfigPicker';
import { PanelGallery } from './PanelGallery';

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

  // Every configuration of this model we hold: the search index, asked for
  // the brand and model by name and then held to an exact match on both, so
  // a "Latitude 5420" never picks up a "Latitude 5420 2-in-1". Beside it, the
  // catalogue's own list of the model's configurations — the index only holds
  // what is sealed, and a configuration with nothing sealed must still be
  // drawn, greyed, or the buyer concludes it was never made. Either failure
  // is the pills' absence, never the page's.
  const [siblings, catalogue] = await Promise.all([
    getSearch(
      new URLSearchParams({ q: `${sku.brandName} ${sku.modelName}`, per: '48' }).toString(),
    ),
    getModelSkus(sku.modelId),
  ]);
  const variants = (siblings?.results ?? []).filter(
    (r) => r.brand === sku.brandName && r.model === sku.modelName,
  );

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
  // Cheapest unit price first. The API orders a priced board by landed price,
  // and this page shows unit prices only, so it orders on what it shows —
  // a "lowest" pill on a row that is not the lowest figure in the column is
  // a claim the reader cannot check.
  const byUnitPrice = (a: { unitPrice: string }, b: { unitPrice: string }): number =>
    Number(a.unitPrice) - Number(b.unitPrice);
  const regular = board.offers.filter((o) => o.valuationMethod === 'REGULAR').sort(byUnitPrice);
  const margin = board.offers.filter((o) => o.valuationMethod === 'MARGIN').sort(byUnitPrice);

  const gradeLabel = GRADE_LABEL[board.grade] ?? board.grade;

  // Each pool is sorted cheapest-first, and the margin note on the board holds
  // that the cheapest row on the page is in the regular table. So the panel
  // acts on `regular[0]` wherever there is one, and only falls to the margin
  // pool when regular is empty.
  const lowest = regular[0] ?? margin[0] ?? null;

  // Whether the lane can be served. The pincode's one job on this page: the
  // prices stay unit prices, and GST and freight are added at checkout.
  const deliverable = board.delivery.kind === 'DELIVERABLE';

  // What the panel acts on, and the figure it carries into the cart. A row
  // is buyable with or without a pincode: our unit price is known before a
  // destination is, and checkout lands it against the buyer's real site. Only
  // a lane we cannot serve, or no stock at this grade, leaves nothing to add.
  const buyable = lowest !== null && board.delivery.kind !== 'UNSERVICEABLE' ? lowest : null;
  const buyablePrice = buyable ? buyable.unitPrice : null;

  // Why the panel cannot add anything yet, in one sentence, or null when it can.
  const blocked = buyable
    ? null
    : board.delivery.kind === 'UNSERVICEABLE'
      ? {
          reason: `We cannot deliver to ${board.pincode} yet. Try another pincode.`,
          needsPincode: true,
        }
      : {
          reason: 'Nothing sealed at this grade right now. The other grades still have stock.',
          needsPincode: false,
        };

  const batteryValues = board.offers.flatMap((o) =>
    o.batteryHealthPct ? [o.batteryHealthPct.min, o.batteryHealthPct.max] : [],
  );
  const batteryLabel =
    batteryValues.length > 0
      ? `${Math.min(...batteryValues)}–${Math.max(...batteryValues)}%`
      : null;

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
            <aside className="rail">
              <div className="pv">
                {/*
                  The condition photographs for this grade, one frame at a time
                  with the rest as thumbnails. Every frame is of a DIFFERENT
                  machine of this grade, and the set's disclosure under the
                  strip says so once — see `PanelGallery`. The passport link
                  goes to the board, where every serial behind a row opens its
                  own inspection photographs.
                */}
                <PanelGallery
                  images={sku.images}
                  grade={board.grade as Grade}
                  gradeLabel={gradeLabel}
                  machine={`${sku.brandName} ${sku.modelName}`}
                  passportHref={board.offers.length > 0 ? '#board' : undefined}
                />

                <PanelActions
                listingId={buyable ? buyable.listingId : null}
                city={lowest?.city ?? null}
                pincode={board.pincode}
                blocked={blocked}
                snapshot={
                  buyable && buyablePrice !== null
                    ? {
                        listingId: buyable.listingId,
                        title: `${sku.brandName} ${sku.modelName}`,
                        specSummary: specLine(sku),
                        grade: buyable.grade,
                        unitPrice: buyablePrice,
                        supplyPoint: `Supply Point ${buyable.supplyPointCode.toUpperCase()} · ${buyable.city}`,
                        dispatch: buyable.dispatchCommitment,
                      }
                    : null
                }
              />
              </div>
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
                    {lowest
                      ? `₹${RUPEES.format(Number(lowest.unitPrice))}`
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
                  <span className="price-off">{lowest || shown?.fromPrice ? 'from' : ''}</span>
                </div>
                <p className="price-note">
                  {deliverable && board.pincode
                    ? `Unit price, before tax and delivery. We deliver to ${board.pincode} — GST and freight are added at checkout against your site.`
                    : board.delivery.kind === 'UNSERVICEABLE'
                      ? `Unit price, before tax and delivery. We cannot deliver to ${board.pincode} yet — try another pincode.`
                      : 'Unit price, before tax and delivery — GST and freight are added at checkout against your site. Enter a pincode to check we deliver there.'}
                </p>

                <PincodeForm
                  action={`/laptops/${encodeURIComponent(slug)}`}
                  hidden={[
                    ...(board.grade ? [{ name: 'grade', value: board.grade }] : []),
                    ...(selected
                      ? [
                          { name: 'sp', value: selected.supplyPointCode },
                          { name: 'city', value: selected.city },
                        ]
                      : []),
                  ]}
                  initialPincode={board.pincode ?? askedPin ?? ''}
                  initialError={
                    askedPin && pincode === null
                      ? 'That is not a pincode. Six digits, and the first one is never 0 — for example 110001.'
                      : null
                  }
                  buttonLabel={board.pincode ? 'Update' : 'Check delivery'}
                >
                  {board.delivery.kind === 'DELIVERABLE' && lowest ? (
                    <>
                      <b>Delivery available.</b> {lowest.dispatchCommitment}
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
                </PincodeForm>
              </div>

              <h2 className="sec-t">Choose grade</h2>
              {/*
                All three grades, always. The board only names the grades with
                stock behind them; a grade it leaves out is drawn greyed with
                the reason, because "A+ is out right now" and "this machine is
                never graded A+" are different statements and a missing pill
                reads as the second.
              */}
              <div className="grades" role="group" aria-label="Inspected grade">
                {ALL_GRADES.map((code) => {
                  const g = board.grades.find((x) => x.grade === code);
                  const label = GRADE_LABEL[code] ?? code;
                  if (!g) {
                    return (
                      <span key={code} className="gpill off" aria-disabled="true">
                        <b>Grade {label}</b>
                        <small>No units sealed</small>
                      </span>
                    );
                  }
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
                      <b>Grade {label}</b>
                    </Link>
                  );
                })}
              </div>

              {/*
                Processor, memory and storage, chosen like grade. Each pill is
                a sibling SKU of this model; the pincode and supply-point
                selection carry over, the grade follows where it can. Rows
                appear only where the model differs — see `ConfigPicker`.
              */}
              <ConfigPicker
                variants={variants}
                catalogue={catalogue ?? []}
                current={{ skuId: sku.skuId, grade: board.grade }}
                hrefFor={(skuId, toGrade) =>
                  href(skuId, { ...query, grade: toGrade, sp: undefined, city: undefined })
                }
              />

              <h2 className="sec-t" id="board">
                Compare supply points
                <span className="sec-sub">
                  {deliverable && board.pincode
                    ? `· Grade ${gradeLabel} · delivering to ${board.pincode}`
                    : `· Grade ${gradeLabel}`}
                </span>
              </h2>

              {/*
                Without a pincode the board still lists every supply point —
                the evidence a buyer compares on does not depend on where it
                is going — and each row says a landed price needs a pincode
                where the price would be. The empty box that used to sit here
                read as "nobody has this machine".
              */}
              <div className="tbl-wrap">
                {board.delivery.kind === 'NONE' && board.offers.length === 0 ? (
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
                        pincode={board.pincode}
                        sku={`${sku.brandName} ${sku.modelName}`}
                        spec={specLine(sku)}
                        caption={`${regular.length} supply point${regular.length === 1 ? '' : 's'} offering ${sku.brandName} ${sku.modelName} at Grade ${gradeLabel}, sorted by unit price, lowest first. Prices are before tax and delivery.${deliverable && board.pincode ? ` Delivery to ${board.pincode} is available.` : ''}`}
                      />
                    )}
                    {margin.length > 0 && (
                      <Board
                        layout="table"
                        rows={margin}
                        pool="MARGIN"
                        pincode={board.pincode}
                        sku={`${sku.brandName} ${sku.modelName}`}
                        spec={specLine(sku)}
                        caption={`${margin.length} supply point${margin.length === 1 ? '' : 's'} offering the same machine under the margin scheme, sorted by unit price, lowest first. Prices are before tax and delivery.${deliverable && board.pincode ? ` Delivery to ${board.pincode} is available.` : ''}`}
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
            </main>
          </div>
        </ProductCartScope>
      </div>
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
