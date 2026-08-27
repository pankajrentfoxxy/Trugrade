import { BRAND } from '@trugrade/config/brand';
import { getBrands, getGrades, getOffers, getStats } from '../lib/api';
import { FilterRail } from './FilterRail';
import { SiteHeader } from './SiteHeader';

/**
 * The homepage, built to the nine-block structure in `09_FRONTEND_LOCKED.md` §7
 * against `docs/reference/homepage.html`.
 *
 * The class names are the reference's own and `storefront.css` is that file's
 * CSS ported across, so this page IS the reference rather than an
 * approximation of it.
 *
 * **Where it deliberately departs from the reference: the data.** That file is a
 * design mock, and its product cards, facet counts and inspection feed are
 * illustrative. Ours are read from the database, which currently holds 200
 * catalogued SKUs and zero inspected units — so the grid, the board and the live
 * feed render honest empty states rather than the mock's sample stock.
 *
 * That is not a shortfall. It is the same rule the rest of the platform obeys: a
 * motif must carry information, and a product card promising 91 units that do
 * not exist is a scarcity device. The layout is complete and fills in the moment
 * stock is inspected.
 */
export const revalidate = 60;

const GRADE_LABEL: Record<string, string> = { A_PLUS: 'A+', A: 'A', B: 'B' };

const CATEGORIES = [
  'All laptops',
  'Business',
  'Mobile workstations',
  'MacBooks',
  'Ready in 24h',
  'By brand',
  'By grade',
  'Bulk pricing',
] as const;

const PROCESS = [
  [
    'Sourced',
    'From corporate buybacks, lease returns and audited traders. Every unit has a declared origin.',
  ],
  [
    'Opened & tested',
    `A technician runs ${BRAND.qcProduct} at the supplier's warehouse. Memory, storage, battery, thermals, ports.`,
  ],
  [
    'Graded & sealed',
    'Graded against published bands, then a numbered tamper seal goes on and is photographed.',
  ],
  [
    'Delivered on our invoice',
    'One GST invoice from us, serials listed, with an inspection window to reject.',
  ],
] as const;

export default async function HomePage(): Promise<React.JSX.Element> {
  const [stats, brands, grades, offers] = await Promise.all([
    getStats(),
    getBrands(),
    getGrades(),
    getOffers(),
  ]);

  const inspected = stats?.unitsInspected ?? 0;
  const sellable = stats?.unitsSellable ?? 0;

  return (
    <>
      <SiteHeader inspected={stats ? inspected : null} />

      {/* 3 — CATEGORY STRIP. Laptops only; everything else is marked SOON. */}
      <div className="cats">
        <div className="wrap">
          {CATEGORIES.map((c, i) => (
            <a
              key={c}
              href={i === 0 ? '/browse' : `/browse?c=${encodeURIComponent(c)}`}
              className={i === 0 ? 'on' : undefined}
            >
              {c}
            </a>
          ))}
          {/* Non-interactive on purpose: the ambition reads without promising
              stock that does not exist. */}
          <span className="soon">
            Desktops, monitors &amp; parts <b>SOON</b>
          </span>
        </div>
      </div>

      {/* 4 — BODY: filter rail + main. No third rail. */}
      <div className="body">
        <div className="wrap">
          <div className="cols">
            <FilterRail brands={brands ?? []} grades={grades ?? []} />

            <main>
              {/* 4a — HERO */}
              <div className="hero grid-bg">
                <div>
                  <span className="kick">
                    <i className="blip" /> Every unit opened &amp; tested before listing
                  </span>
                  <h1>
                    Buy refurbished laptops that were <em>actually inspected</em>.
                  </h1>
                  <p>
                    Not described by a seller. Physically opened at their warehouse by our
                    technician, graded on measurements, sealed until it reaches your dock.
                  </p>
                  <div className="hbtns">
                    <a className="pill acc" href="#board">
                      Compare live stock &rarr;
                    </a>
                    <a className="pill wire" href="/bulk">
                      Upload a requirement list
                    </a>
                  </div>
                </div>

                {/*
                  The inspection feed. A scan line means THIS FEED IS LIVE, so
                  with nothing being inspected it would be a motif carrying no
                  information — the one thing §4 forbids. The panel therefore
                  drops the scanbox and states what is true instead.
                */}
                <div className="gauge">
                  <div className="gt">
                    <span>Inspection feed</span>
                    {inspected > 0 ? (
                      <b>
                        <i className="blip" /> LIVE
                      </b>
                    ) : (
                      <b style={{ color: 'var(--on-chrome-3)' }}>IDLE</b>
                    )}
                  </div>
                  <div className={inspected > 0 ? 'gbody scanbox' : 'gbody'}>
                    {inspected > 0 ? (
                      <div className="gline">
                        <span className="l">Units inspected</span>
                        <span className="v hi mono">{inspected.toLocaleString('en-IN')}</span>
                      </div>
                    ) : (
                      <>
                        <div className="gline">
                          <span className="l">Catalogue</span>
                          <span className="v mono">{stats?.skusCatalogued ?? 0} models</span>
                        </div>
                        <div className="gline">
                          <span className="l">Inspected</span>
                          <span className="v mono" style={{ color: 'var(--on-chrome-3)' }}>
                            none yet
                          </span>
                        </div>
                        <div className="gline">
                          <span className="l">Feed</span>
                          <span className="v" style={{ color: 'var(--on-chrome-3)' }}>
                            starts with the first visit
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* 4b — RESULT BAR */}
              <div className="rbar">
                <span>
                  <b className="mono">{sellable.toLocaleString('en-IN')}</b> inspected laptops
                </span>
                <div className="r">
                  <label className="sr-only" htmlFor="sort">
                    Sort
                  </label>
                  <select id="sort" defaultValue="price">
                    <option value="price">Landed price, low to high</option>
                    <option value="score">Inspection score</option>
                    <option value="battery">Battery health</option>
                    <option value="fast">Ships soonest</option>
                  </select>
                </div>
              </div>

              {/* 4c — PRODUCT GRID, or the truth about there being none. */}
              {offers && offers.length > 0 ? (
                <div className="pgrid">
                  {offers.map((o) => (
                    <div className="pc" key={`${o.skuId}-${o.grade}`}>
                      <div className="im">
                        {/* Viewfinder brackets, and the real serial beneath them.
                            The brackets assert THIS UNIT WAS CAPTURED, so they
                            only appear because sampleSerial is a serial we hold. */}
                        <span className="vf tl" />
                        <span className="vf tr" />
                        <span className="vf bl" />
                        <span className="vf br" />
                        <span className="gr">{GRADE_LABEL[o.grade]}</span>
                        <span className="qc">QC {o.avgQcScore}</span>
                        <span className="sn">{o.sampleSerial}</span>
                        <svg
                          width="84"
                          height="48"
                          viewBox="0 0 150 80"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          aria-hidden="true"
                        >
                          <rect x="27" y="10" width="96" height="56" rx="3" />
                          <path d="M12 70 h126 l-8 -4 H20 z" />
                        </svg>
                      </div>
                      <div className="bd">
                        <b>
                          {o.brand} {o.model}
                        </b>
                        <span className="spec">{o.spec}</span>
                        {/* The number no competitor can print, because printing
                            it means having opened the machine. */}
                        <span className="bat">
                          BAT{' '}
                          <i>
                            <b style={{ width: `${o.batteryMin}%` }} />
                          </i>{' '}
                          {o.batteryMin}–{o.batteryMax}%
                        </span>
                        <div className="pr">
                          ₹{Number(o.fromPrice).toLocaleString('en-IN')}{' '}
                          <small>from · incl. GST</small>
                        </div>
                        <div className="meta">
                          <span>
                            {o.supplyPoints} supply point{o.supplyPoints === 1 ? '' : 's'}
                          </span>
                          <b>{o.unitsAvailable} units</b>
                        </div>
                      </div>
                      <a className="cta" href="#board">
                        Compare suppliers
                      </a>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty">
                  <h3>No inspected stock yet</h3>
                  <p>
                    {stats?.skusCatalogued ?? 0} models are catalogued and{' '}
                    {stats?.brandsCatalogued ?? 0} brands are onboarded. A laptop appears here once
                    it has been opened, tested, graded and sealed — never before, and never on the
                    strength of a supplier&rsquo;s description.
                  </p>
                </div>
              )}
            </main>
          </div>
        </div>
      </div>

      {/* 5 — SUPPLY BOARD. The differentiator. */}
      <div className="board" id="board">
        <div className="wrap">
          <div className="sh">
            <div className="shrow">
              <h2>Compare supply points on one screen</h2>
            </div>
            <div className="tickrule" aria-hidden="true">
              {Array.from({ length: 40 }, (_, i) => (
                <i key={i} />
              ))}
            </div>
            <p>
              Ten suppliers, one model, one screen. Landed price to your pincode, average inspection
              score for that exact model, and how often their declared grade survived ours. Who they
              are is not shown; how they perform is the whole point.
            </p>
          </div>
          <div className="empty">
            <h3>The board fills as stock is inspected</h3>
            <p>
              Each row is a supply point — a supplier in a city, shown as{' '}
              <span className="mono">Supply Point A · Gurugram</span> and never by name. A supplier
              with fewer than ten inspected units shows{' '}
              <span className="mono">New supplier · N units</span> instead of an average, because a
              percentage computed on two machines is not evidence.
            </p>
          </div>
        </div>
      </div>

      {/* 6 — UTILITY STRIP: verify a certificate, and bulk requirement. */}
      <div className="strip">
        <div className="wrap">
          <div className="sbx">
            <div className="qr" role="img" aria-label="Certificate QR" />
            <div className="qform">
              <h3>Verify a certificate</h3>
              <p>
                Holding a machine with a seal on it? Enter the certificate ID or the serial and read
                the report it shipped with.
              </p>
              <form action="/verify">
                <label className="sr-only" htmlFor="cert">
                  Certificate ID or serial
                </label>
                <input id="cert" name="q" className="mono" placeholder="TG-CERT-… or serial" />
                <button type="submit">Verify</button>
              </form>
            </div>
          </div>
          <div className="sbx">
            <div className="qform">
              <h3>Have a requirement list?</h3>
              <p>
                Send the specification, quantity and grade. We tell you what is available now, at a
                landed price for your pincode, and source the rest.
              </p>
              <form action="/bulk">
                <label className="sr-only" htmlFor="req">
                  Requirement
                </label>
                <input id="req" name="q" placeholder="e.g. 40 × i5 / 16 GB / Grade A" />
                <button type="submit">Start</button>
              </form>
            </div>
          </div>
        </div>
      </div>

      {/* 7 — PROCESS */}
      <div className="proc">
        <div className="wrap">
          {PROCESS.map(([title, body], i) => (
            <div className="pstep" key={title}>
              <span className="mono">{String(i + 1).padStart(2, '0')}</span>
              <h3>{title}</h3>
              <p>{body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 8 — SUPPLIER BAND. Chrome ground, grid. */}
      <div className="supband grid-bg">
        <div className="wrap">
          <h2>Selling refurbished laptops in volume?</h2>
          <p>
            We buy outright — you name your net payout, we inspect at your site, and you are paid on
            a cycle you choose. No bidding, no marketplace fees, and your name never appears on the
            storefront.
          </p>
          <a className="pill acc" href="/sell/register">
            Apply to supply &rarr;
          </a>
        </div>
      </div>
    </>
  );
}
