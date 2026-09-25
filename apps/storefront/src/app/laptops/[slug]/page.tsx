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
  getOfferBoard,
  getSearch,
  getSkuDetail,
  type OfferBoard,
} from '../../../lib/api';
import { Board } from './Board';
import { ProductCartScope } from './ProductCartScope';
import { PanelActions } from './PanelActions';
import { specLine } from './spec-rows';
import { PincodeFocusLink } from './PincodeFocusLink';
import { PincodeForm } from './PincodeForm';
import { ConfigPicker } from './ConfigPicker';
import { PanelGallery } from './PanelGallery';
import { ReviewsSection } from './ReviewsSection';
import { PRODUCT_RATING, Stars } from './product-rating';
import { FullSpecifications } from './FullSpecifications';
import { QASection } from './QASection';
import { RelatedProducts } from './RelatedProducts';

/** The prices are landed to the reader's pincode, so nothing here is cacheable. */
export const dynamic = 'force-dynamic';

const RUPEES = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/**
 * The struck-through figure beside the price is the model's launch price as
 * the catalogue records it, and nothing else. When the catalogue has none, no
 * figure is struck and no saving is claimed: a reference price that is not
 * sourced is the invented saving the CCPA Dark Patterns Guidelines name, and
 * the site's own rule is that a number comes from the API or does not appear.
 * Null too when the launch price is not above our price — a "saving" of 0% or
 * less is not one.
 */
function savingAgainstNew(
  price: number,
  msrpNewInr: string | null,
): { was: number; offPct: number } | null {
  const was = msrpNewInr === null ? NaN : Number(msrpNewInr);
  if (!Number.isFinite(was) || was <= price) return null;
  return { was, offPct: Math.round(((was - price) / was) * 100) };
}

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

  // Every configuration of this model that is for sale: the search index,
  // asked for the brand and model by name and then held to an exact match on
  // both, so a "Latitude 5420" never picks up a "Latitude 5420 2-in-1". The
  // index holds only what is sealed, which is exactly the set the switches
  // should offer — a configuration with nothing sealed at any grade is not
  // drawn. A failed read is the pills' absence, never the page's.
  const siblings = await getSearch(
    new URLSearchParams({ q: `${sku.brandName} ${sku.modelName}`, per: '48' }).toString(),
  );
  const variants = (siblings?.results ?? []).filter(
    (r) => r.brand === sku.brandName && r.model === sku.modelName,
  );

  if (board === null) {
    return (
      <>
        <div className="body pdpbody">
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
      <div className="body pdpbody">
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
          <main className="wrap pdp">
            {/*
            The split pane: LEFT is the pinned panel — the photographs, the
            grade plate, the two actions — at six tenths of the width. RIGHT
            is the record's head: title, price, switches, pincode and the
            specification. The page scrolls as one page; nothing scrolls
            inside a box. The rail is sticky inside a row as tall as that
            record column, so the photograph holds still while it is read.
            The board and everything after it come under both, full width.
            See `.pdp-top` in the stylesheet.
          */}
            <div className="pdp-top">
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
              </div>
            </aside>

            {/* RIGHT — what the machine is, what it costs, and the switches. */}
            <div className="det">
              {/*
                The title, and the same headline rating "Ratings and reviews"
                gives further down, on the same line where there is room. It
                is a link to that section rather than a second, disconnected
                number — one placeholder figure for the page (see
                `PRODUCT_RATING` in `product-rating.tsx`), not two.
              */}
              <div className="det-head">
                <h1 className="det-title">
                  {sku.brandName} {sku.modelName}
                </h1>
                <a className="det-rating" href="#rev-h">
                  <Stars rating={PRODUCT_RATING.average} />
                  <span className="mono">{PRODUCT_RATING.average.toFixed(1)}</span>
                  <span>
                    (<span className="mono">{PRODUCT_RATING.count}</span> ratings)
                  </span>
                </a>
              </div>

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
                {/*
                  A seventh chip in the row's own shape — not a "5 more"
                  overflow badge off to the side — pointing straight at
                  "Full specifications" further down the record, since that
                  is where the rest of the declared spec actually lives now.
                  "More…", not the section's own title repeated: it reads as
                  the row's own overflow rather than a duplicate heading.
                */}
                <a className="dchip dchip-more" href="#fullspec-h">
                  More…
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M12 5v14M5 12l7 7 7-7" />
                  </svg>
                </a>
              </div>

              <div className="mt-5">
                {(() => {
                  const price = lowest
                    ? Number(lowest.unitPrice)
                    : shown?.fromPrice
                      ? Number(shown.fromPrice)
                      : null;
                  if (price === null) {
                    return (
                      <div className="price-line">
                        <span className="price-now mono">Not priced</span>
                      </div>
                    );
                  }
                  // Struck only from the catalogue's launch price. See
                  // `savingAgainstNew`: no source, no strike, no percentage.
                  const saving = savingAgainstNew(price, sku.msrpNewInr);
                  return (
                    <div className="price-line">
                      <span className="price-now mono">₹{RUPEES.format(price)}</span>
                      {saving ? (
                        <>
                          <s
                            className="price-was mono"
                            aria-label={`Launch price ₹${RUPEES.format(saving.was)}`}
                          >
                            ₹{RUPEES.format(saving.was)}
                          </s>
                          <span className="price-off">
                            <span className="mono tnum">{saving.offPct}%</span> off
                          </span>
                        </>
                      ) : null}
                      
                    </div>
                  );
                })()}
                {/* Tax and freight are said once, under the pincode box below,
                    where the destination that decides them is entered. */}
              </div>

              <h2 className="sec-t">Choose grade</h2>
              {/*
                All three grades, always, and every one of them a live link.
                The processor, memory and storage rows below are drawn for the
                grade chosen here, so a grade chip is the way into that grade's
                stock even when THIS configuration has none at it: the link
                then opens the model's nearest configuration that is sealed at
                that grade — cheapest first, the index's own order — and the
                rows below show what that grade holds. Only when the whole
                model has nothing at a grade does the chip open this same
                configuration there, where the board says so in words.
              */}
              <div className="grades" role="group" aria-label="Inspected grade">
                {ALL_GRADES.map((code) => {
                  const label = GRADE_LABEL[code] ?? code;
                  const on = code === board.grade;
                  const heldHere = board.grades.some((x) => x.grade === code);
                  const sibling = heldHere ? null : (variants.find((r) => r.grade === code) ?? null);
                  return (
                    <Link
                      key={code}
                      className={on ? 'gpill on' : 'gpill'}
                      aria-current={on ? 'true' : undefined}
                      href={
                        href(sibling ? sibling.skuId : slug, {
                          ...query,
                          grade: code,
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
                current={{ skuId: sku.skuId, grade: board.grade }}
                hrefFor={(skuId, toGrade) =>
                  href(skuId, { ...query, grade: toGrade, sp: undefined, city: undefined })
                }
              />

              {/*
                The pincode comes right after the grade/config switches: a
                buyer settles what they want first, then where it is going.
                The declared specification used to sit here too, as a short
                accordion, but it now duplicates the "Full specifications"
                section further down the record — one place for it, not two.
                The form carries the grade and supply point so the answer
                lands on the same configuration.
              */}
              <h2 className="sec-t">Check delivery</h2>
              <div className="pin-blk">
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

              {/*
                The two actions, last in the record column, under the
                delivery check. Stuck to the window's bottom edge while the
                column runs past it, so they are on screen for the whole time
                the record is being read, and in their own place at the foot
                of the column once it fits. See `.det-cta`.
              */}
              <div className="det-cta">
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
            </div>
            </div>

            {/*
              UNDER BOTH — the board, the reviews and the questions, across
              the full width below the split pane. The board carries ten
              columns; at full width it shows them at once, which is what a
              comparison needs. The photograph holds still only while the
              record beside it scrolls; once the reader reaches the board the
              whole page moves — there is nothing left beside it to hold for.
            */}
            <section className="pdp-evidence" aria-label="Supply points">
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

              <FullSpecifications />
              <ReviewsSection />
              <RelatedProducts brandName={sku.brandName} modelName={sku.modelName} />
              <QASection />
            </section>

          </main>
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
