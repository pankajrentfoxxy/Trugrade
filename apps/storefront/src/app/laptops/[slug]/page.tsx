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
import { PRODUCT_RATING } from './product-rating';
import { FullSpecifications } from './FullSpecifications';
import { QASection } from './QASection';
import { RelatedProducts } from './RelatedProducts';
import { BRAND } from '@trugrade/config/brand';
import { OFFER } from '../../../lib/offer';
import { deliveryByLabel } from '../../../lib/delivery-date';
import { storageShortLabel } from '../../search/storage-label';
import { ClockIcon, ReturnIcon, ShieldIcon, TagIcon, TruckIcon } from './det-icons';

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
/** What a grade looks like, in the words the grade pill's heading uses. */
const GRADE_MEANING: Record<string, string> = {
  A_PLUS: 'Near-new, no visible marks',
  A: 'Minor signs of use',
  B: 'Visible signs of use',
};

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

/**
 * More than five supply points read best as columns, one per supply point,
 * with the facts down the left; five or fewer stay one row per supply point.
 */
const COMPARE_FROM = 6;
const boardLayout = (count: number): 'compare' | 'table' =>
  count >= COMPARE_FROM ? 'compare' : 'table';

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
                <Link className="ulink" href="/legal/grievance">
                  our team can pull it for you
                </Link>
                .
              </p>
              <p className="retry">
                <Link className="pill acc" href={href(slug, query) as Route}>
                  Try again
                </Link>
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
          reason: 'Nothing on sale at this grade right now. The other grades still have stock.',
          needsPincode: false,
        };

  const shortStorage = storageShortLabel(sku.storageType);
  const storageLabel = `${sku.storageGb} GB${shortStorage ? ` ${shortStorage}` : ''}`;

  // The dispatch time of what the panel sells, from the search index's row
  // for this configuration at this grade, and the lane's transit from the
  // board: their sum is the date. Either missing, and no date is drawn.
  const indexRow = variants.find((r) => r.skuId === sku.skuId && r.grade === board.grade) ?? null;
  const shipHours = indexRow?.shipHours ?? null;
  // "Intel Core i5-1035G4" from the index where it has the row; the bare
  // model number from the catalogue otherwise.
  const cpuName = indexRow?.cpuLine ?? sku.cpuModel;
  const deliveryDate =
    board.delivery.kind === 'DELIVERABLE'
      ? deliveryByLabel(shipHours, board.delivery.etaDays)
      : null;

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
                The record's head, top to bottom: brand and series, the model,
                its configuration in one line, then the rating and the stock.
                The rating is the same placeholder figure "Ratings and reviews"
                gives further down (`PRODUCT_RATING`), and a link to it.
              */}
              <p className="det-kicker">
                {sku.brandName}
                {sku.seriesName ? <> &middot; {sku.seriesName}</> : null}
              </p>
              <h1 className="det-title">
                {sku.brandName} {sku.modelName}
              </h1>
              <p className="det-spec">
                {cpuName} &middot; {sku.ramGb} GB RAM &middot; {storageLabel} &middot;{' '}
                {sku.screenSizeIn}&quot; {sku.resolution}
              </p>
              <p className="det-meta">
                <a className="det-rate" href="#rev-h">
                  <span className="mono">{PRODUCT_RATING.average.toFixed(1)}</span> &#9733;
                </a>
                <span>
                  <span className="mono">{PRODUCT_RATING.count}</span> ratings
                </span>
                {shown ? (
                  <>
                    <span className="det-dot" aria-hidden="true" />
                    <span>
                      <span className="mono">{shown.unitsAvailable}</span> sealed unit
                      {shown.unitsAvailable === 1 ? '' : 's'} in stock
                    </span>
                  </>
                ) : null}
              </p>

              <div className="det-price">
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
                {/* The board's own words: the figure is our unit price, and
                    GST and freight are added at checkout. Never "inclusive". */}
                <p className="price-note">
                  Before GST &middot; tax and freight added at checkout against your pincode
                </p>
                <ul className="det-offers">
                  <li>
                    <TagIcon />
                    <span>
                      <b>Fleet week:</b> {OFFER.volumeDetail}
                    </span>
                  </li>
                  <li>
                    <TagIcon />
                    <span>
                      <b>First order:</b> {OFFER.firstOrderDetail}{' '}
                      <code className="det-code">{OFFER.code}</code>
                    </span>
                  </li>
                </ul>
              </div>

              <div className="det-sec">
                <h2 className="sec-t">
                  Grade<span className="sec-val">: Grade {gradeLabel} &mdash; {GRADE_MEANING[board.grade] ?? ''}</span>
                </h2>
                {/*
                  All three grades, always, and every one of them a live link.
                  The rows below are drawn for the grade chosen here, so a grade
                  pill is the way into that grade's stock even when THIS
                  configuration has none at it: the link then opens the model's
                  nearest configuration sealed at that grade — cheapest first,
                  the index's own order. Only when the whole model has nothing at
                  a grade does the pill open this same configuration there, where
                  the board says so in words.
                */}
                <div className="grades" role="group" aria-label="Inspected grade">
                  {ALL_GRADES.map((code) => {
                    const label = GRADE_LABEL[code] ?? code;
                    const on = code === board.grade;
                    const held = board.grades.find((x) => x.grade === code) ?? null;
                    const sibling = held ? null : (variants.find((r) => r.grade === code) ?? null);
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
                  Memory, storage and processor, chosen like grade. Each pill is
                  a sibling SKU of this model; the pincode carries over, the
                  grade follows where it can — see `ConfigPicker`.
                */}
                <ConfigPicker
                  variants={variants}
                  current={{ skuId: sku.skuId, grade: board.grade }}
                  gradeLabel={gradeLabel}
                  hrefFor={(skuId, toGrade) =>
                    href(skuId, { ...query, grade: toGrade, sp: undefined, city: undefined })
                  }
                />
              </div>

              {/*
                The pincode, once the buyer has settled what they want. The form
                carries the grade and supply point so the answer lands on the
                same configuration. With a lane we serve, the line under it is
                the date: the dispatch time plus the lane's transit.
              */}
              <div className="det-sec">
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
                    buttonLabel="Check"
                  >
                    {board.delivery.kind === 'DELIVERABLE' && lowest ? (
                      <span className="det-deliver">
                        <TruckIcon />
                        <span>
                          {deliveryDate ? (
                            <>
                              Delivery by <b>{deliveryDate}</b> to {board.pincode}
                            </>
                          ) : (
                            <>Delivery available to {board.pincode}</>
                          )}
                          {shipHours !== null ? (
                            <>
                              {' '}
                              &middot; ships in <span className="mono">{shipHours}</span> h
                            </>
                          ) : null}
                        </span>
                      </span>
                    ) : board.delivery.kind === 'UNSERVICEABLE' ? (
                      <>
                        We cannot deliver to <b>{board.pincode}</b> yet. Try another pincode.
                      </>
                    ) : (
                      'Six digits. We quote the real freight for the lane, not an average.'
                    )}
                  </PincodeForm>
                </div>
              </div>

              {/*
                What the machine is, in five lines, from the catalogue and the
                board — nothing here is written for the page. A battery the
                board has not measured says so rather than being left out.
              */}
              <div className="det-sec">
                <h2 className="sec-t">Highlights</h2>
                <ul className="det-hl">
                  <li>
                    {cpuName} &middot; {sku.ramGb} GB RAM &middot; {storageLabel}
                  </li>
                  <li>
                    {sku.screenSizeIn}&quot; {sku.isTouch ? 'touchscreen' : 'display'}, {sku.resolution}
                  </li>
                  {sku.osSupported ? <li>{sku.osSupported}</li> : null}
                  <li>
                    {batteryLabel ? (
                      <>
                        Battery health <span className="mono">{batteryLabel}</span> of original,
                        measured per unit
                      </>
                    ) : (
                      <span className="notmeasured">Battery health not measured yet</span>
                    )}
                  </li>
                  <li>
                    Grade {gradeLabel} &mdash; {(GRADE_MEANING[board.grade] ?? '').toLowerCase()}
                  </li>
                </ul>
              </div>

              <div className="det-sec">
                <ul className="det-trust">
                  <li>
                    <ShieldIcon />
                    <b>12-area inspection</b>
                    <span>sealed after testing</span>
                  </li>
                  {lowest ? (
                    <li>
                      <ClockIcon />
                      <b>
                        <span className="mono">{lowest.totalWarrantyMonths}</span>-month warranty
                      </b>
                      <span>from {BRAND.name}</span>
                    </li>
                  ) : null}
                  <li>
                    <ReturnIcon />
                    <b>48-hour reject</b>
                    <span>inspect on arrival</span>
                  </li>
                </ul>
                <p className="det-sold">
                  Sold by <b>{BRAND.legalEntity}</b> on one GST invoice
                  {lowest ? (
                    <>
                      {' '}
                      &middot; ships from <b>{lowest.city}</b>
                    </>
                  ) : null}
                </p>
              </div>

              {/*
                "All details" sits right under the delivery check, closed by
                default — a buyer who wants the full declared spec asks for
                it there, before the purchase actions rather than after them,
                so it never has to be scrolled past to reach "Add to cart".
              */}
              <FullSpecifications />

              {/*
                The two purchase actions, under the delivery check and the
                collapsed spec panel. Stuck to the window's bottom edge while
                the column runs past it, so they are on screen for the whole
                time the record is being read, and in their own place at the
                foot of the decision once it fits. See `.det-cta`.
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
                      <Link className="ulink" href={`/bulk?pin=${board.pincode ?? ''}`}>
                        ask us to quote this lane
                      </Link>
                      .
                    </p>
                  </div>
                ) : board.offers.length === 0 ? (
                  <div className="empty">
                    <h3>Nothing on sale at this grade right now</h3>
                    <p>
                      Every machine at Grade {gradeLabel} has been sold or is reserved for an order
                      being inspected. The other grades above still have stock.
                    </p>
                  </div>
                ) : (
                  <>
                    {regular.length > 0 && (
                      <Board
                        layout={boardLayout(regular.length)}
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
                        layout={boardLayout(margin.length)}
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
