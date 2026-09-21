import * as React from 'react';
import { Link } from 'react-router';
import { BRAND, LEGAL_DISCLOSURE } from '@trugrade/config/brand';
import { GRADES, QC_AREAS, VENDOR_NET_PAYOUT } from '@trugrade/contracts';
import './sell-landing.css';

/**
 * ARCHETYPE A — Landing. Claim, one control, then what is actually true.
 *
 * The public face of the supplier console: what a refurbisher sees at `/`
 * before they have an account. The design is the approved supplier mock — a
 * cream page with one yellow, whose hero is a conveyor belt: cartons ride in,
 * pass the DeviceSure gate mid-way, and leave stamped with a grade and the
 * seller's named payout. All of it is CSS in `sell-landing.css`; nothing here
 * animates from a script.
 *
 * Every rule the page states is read from the contract that enforces it: the
 * payout band is `VENDOR_NET_PAYOUT`, the inspection areas are `QC_AREAS`, the
 * sellable grades are `GRADES`. Change the rule and this page changes with
 * it. The cartons on the belt are the one illustration: five
 * example machines with example payouts inside that band, marked decorative
 * so no reader takes them for stock.
 *
 * The palette is its own (`--sl-*`, declared for `.sell-landing` in
 * `globals.css`) because this page is a brochure, not a working surface, and
 * the hub's teal chrome is the wrong voice for it. One primary action: "Start
 * selling", to /sell/register; the masthead carries the same link so the
 * storefront's "Sell on Trugrade" finishes its journey here.
 */

/** Sentence case for an area code, so the page reads as English, not as an enum. */
const areaLabel = (code: string): string =>
  code.charAt(0) + code.slice(1).toLowerCase().replace(/_/g, ' ');

const GRADE_LABEL: Readonly<Record<string, string>> = { A_PLUS: 'A+', A: 'A', B: 'B' };

/** In rupees, grouped the Indian way — `VENDOR_NET_PAYOUT` is the source. */
const inr = (n: number): string => `₹${n.toLocaleString('en-IN')}`;

const two = (i: number): string => String(i + 1).padStart(2, '0');

/**
 * The cartons on the belt. Illustration, not inventory: no serial here is a
 * unit we hold, and every payout sits inside `VENDOR_NET_PAYOUT`.
 */
const CARTONS = [
  { model: 'DELL LATITUDE 7420', serial: 'SN 5CG1234XYZ', grade: 'A+', payout: 38_500 },
  { model: 'MACBOOK AIR M1', serial: 'SN C02G84XYPQ', grade: 'A', payout: 44_100 },
  { model: 'ASUS ZENBOOK 14', serial: 'SN L5N0CX00', grade: 'A', payout: 36_500 },
  { model: 'THINKPAD T14', serial: 'SN PF2ABCD1', grade: 'B', payout: 22_900 },
  { model: 'HP ELITEBOOK 840', serial: 'SN 5CD9270XKL', grade: 'A', payout: 31_000 },
] as const;

/* ==========================================================================
 * Chrome
 * ======================================================================== */

function TopBar(): React.JSX.Element {
  return (
    <header className="bar">
      <span className="logo-badge" aria-hidden="true">
        t
      </span>
      <Link to="/" className="logo" aria-label={`${BRAND.name} home`}>
        <b>
          tru<i>grade</i>
        </b>
        <small>SUPPLIER HUB</small>
      </Link>
      <nav className="bar-right" aria-label="Supplier">
        <Link className="signin" to="/login">
          Sign in
        </Link>
        <Link className="cta" to="/sell/register">
          Sell on {BRAND.name}
        </Link>
      </nav>
    </header>
  );
}

/* ==========================================================================
 * Hero + conveyor
 * ======================================================================== */

function Hero(): React.JSX.Element {
  const min = VENDOR_NET_PAYOUT.min!;
  const max = VENDOR_NET_PAYOUT.max!;
  return (
    <section className="hero">
      <div className="hero-inner">
        <span className="kicker">FOR REFURBISHERS · LAPTOPS ONLY</span>
        <h1>
          Name the payout you want. <span>We handle the sale.</span>
        </h1>
        <p className="lede">
          You tell us what each machine must earn you. {BRAND.name} prices it, sells it on{' '}
          <b>our own invoice</b>, and pays you that amount. No buyer to chase, no bill to raise —
          you ship a laptop you have already been priced for.
        </p>
        <div className="hero-cta">
          <Link className="cta big" to="/sell/register">
            Start selling
          </Link>
          <span className="req">GSTIN, PAN and a bank account. No listing fee.</span>
        </div>
        <div className="stats">
          <div className="stat">
            <small>Grades we sell</small>
            <b>{GRADES.map((g) => GRADE_LABEL[g]).join(' · ')}</b>
          </div>
          <div className="stat">
            <small>Inspected on</small>
            <b>
              {QC_AREAS.length} <i>areas</i>
            </b>
          </div>
          <div className="stat">
            <small>Listing fee</small>
            <b>₹0</b>
          </div>
          <div className="stat">
            <small>Payout per machine</small>
            <b>
              {inr(min)} <i>to</i> {inr(max)}
            </b>
          </div>
        </div>
      </div>

      <Conveyor />
    </section>
  );
}

/**
 * Cartons ride in, get scanned mid-way, exit stamped with grade and payout.
 * `aria-hidden`: a screen reader gets the caption underneath, not five
 * decorative serial numbers.
 */
function Conveyor(): React.JSX.Element {
  return (
    <div className="convey" aria-label="Machines moving through DeviceSure inspection to payout">
      <div aria-hidden="true">
        {CARTONS.map((c) => (
          <div className="box" key={c.serial}>
            <span className="pay">{inr(c.payout)}</span>
            <span className="stamp">{c.grade}</span>
            <div className="label">
              <b>{c.model}</b>
              <small>{c.serial}</small>
              <span className="barcode" />
            </div>
          </div>
        ))}
      </div>

      <div className="gate" aria-hidden="true">
        <span className="post l" />
        <span className="post r" />
        <span className="top">
          <span className="dot" />
          <small>
            {BRAND.qcProduct.toUpperCase()} · {QC_AREAS.length} AREAS
          </small>
        </span>
        <i className="beam" />
      </div>

      <div className="belt" aria-hidden="true">
        <i />
      </div>
      <div className="legs" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>
      <p className="convey-note">
        Your machine in → graded &amp; sealed → sold by us → <b>your named payout</b>
      </p>
    </div>
  );
}

/* ==========================================================================
 * The model
 * ======================================================================== */

const Icon = {
  payout: (
    <path d="M12 3v18M7.5 7.5h6.8a2.7 2.7 0 0 1 0 5.4H9.7a2.7 2.7 0 0 0 0 5.4h6.8" />
  ),
  invoice: (
    <>
      <rect x="4" y="3.5" width="16" height="17" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </>
  ),
  eyeOff: (
    <path d="M3 3l18 18M10.6 5.1A9.8 9.8 0 0 1 12 5c6 0 9.5 7 9.5 7a16.6 16.6 0 0 1-3.2 4M6.6 6.6A16 16 0 0 0 2.5 12s3.5 7 9.5 7a9.3 9.3 0 0 0 3.9-.85" />
  ),
} as const;

function TheModel(): React.JSX.Element {
  return (
    <section className="section on-white">
      <div className="sec-inner">
        <p className="sec-kick">The model</p>
        <h2>What selling here actually means</h2>
        <div className="model-grid">
          <div className="mcard">
            <span className="ic">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {Icon.payout}
              </svg>
            </span>
            <h3>You name the payout, not the price</h3>
            <p>
              Enter what the machine must <b>earn you</b>. Our charge shows as a percentage of the
              selling price, in its parts, before you list — never revealed later.
            </p>
          </div>
          <div className="mcard">
            <span className="ic">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {Icon.invoice}
              </svg>
            </span>
            <h3>We are the seller, not a marketplace</h3>
            <p>
              When a customer orders, {BRAND.name} <b>buys that serial from you</b> and sells it on
              our own invoice. One buyer, one payment, one set of terms — ours.
            </p>
          </div>
          <div className="mcard">
            <span className="ic">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {Icon.eyeOff}
              </svg>
            </span>
            <h3>Your name never reaches the customer</h3>
            <p>
              Buyers see a supply point and a city. Your business name, GSTIN, address and
              contacts appear on <b>no screen a customer can reach</b>.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ==========================================================================
 * DeviceSure
 * ======================================================================== */

const GRADE_CLASS: Readonly<Record<string, string>> = { A_PLUS: 'gc1', A: 'gc2', B: 'gc3' };

function Inspection(): React.JSX.Element {
  return (
    <section className="section">
      <div className="sec-inner ds">
        <div className="ds-copy">
          <p className="sec-kick">{BRAND.qcProduct}</p>
          <h2>Opened, tested and graded before a customer sees it</h2>
          <p>
            A technician inspects each unit against <b>{QC_AREAS.length} areas</b> and seals it.
            The grade and the evidence go on the listing — a buyer isn&rsquo;t taking your word for
            the condition, or ours. A returned machine that matched its certificate is{' '}
            <b>our problem, not yours</b>.
          </p>
          <div className="gradeline">
            {GRADES.map((g) => (
              <span key={g} className={`gc ${GRADE_CLASS[g] ?? 'gc3'}`}>
                {GRADE_LABEL[g]}
              </span>
            ))}
          </div>
          <p className="ds-note">
            All sellable — a grade is a position on a scale, not a verdict. An area we
            couldn&rsquo;t measure is recorded as <i>not measured</i> and caps the grade; it is
            never written down as a pass.
          </p>
        </div>
        <div className="areas" aria-label={`The ${QC_AREAS.length} inspection areas`}>
          {QC_AREAS.map((area, i) => (
            <div className="area" key={area}>
              <small>{two(i)}</small>
              <b>{areaLabel(area)}</b>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ==========================================================================
 * How to sell
 * ======================================================================== */

const STEPS = [
  {
    title: 'Register your business',
    body: (
      <>
        GSTIN and PAN verified against the portals; your bank confirmed by a{' '}
        <b>₹1 penny-drop</b>.
      </>
    ),
  },
  {
    title: 'We review and approve',
    body: 'Documents checked against a deadline we publish to you. Listing opens on approval.',
  },
  {
    title: 'List with your payout',
    body: 'Serial, specification, and what you expect to receive — our charge is on screen as you type.',
  },
  {
    title: 'We inspect, sell and pay',
    body: 'Graded and sealed; when it sells we buy it from you, you ship, and your named amount is paid.',
  },
] as const;

function HowToSell(): React.JSX.Element {
  return (
    <section className="section on-white" id="start">
      <div className="sec-inner">
        <p className="sec-kick">Four steps</p>
        <h2>How to sell on {BRAND.name}</h2>
        <ol className="hsteps">
          {STEPS.map((s, i) => (
            <li className="hstep" key={s.title}>
              <div className="hs-top">
                <span className="num">{two(i)}</span>
                <span className="hline" aria-hidden="true">
                  <i />
                </span>
              </div>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ==========================================================================
 * Closing
 * ======================================================================== */

/** Four things that are true of every supplier's terms. Not a promise; a description. */
const ASSURANCES = [
  { lead: 'No listing fee', rest: 'nothing charged before a machine sells.' },
  { lead: 'Penny-drop payouts', rest: 'money goes only to a confirmed account.' },
  { lead: 'Grade B is the floor', rest: 'nothing below it is sold under our name.' },
  { lead: 'You stay invisible', rest: 'your identity never reaches a customer.' },
] as const;

function Closing(): React.JSX.Element {
  return (
    <section className="section close-band">
      <div className="sec-inner">
        <h2>
          Start selling <span>today.</span>
        </h2>
        <p className="lede">
          {BRAND.tagline} Put your machines in front of businesses buying refurbished laptops at
          volume.
        </p>
        <ul className="assure">
          {ASSURANCES.map((a) => (
            <li className="as" key={a.lead}>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="m5 12.5 4.5 4.5L19 7.5" />
              </svg>
              <span>
                <b>{a.lead}</b> — {a.rest}
              </span>
            </li>
          ))}
        </ul>
        <Link className="cta big" to="/sell/register">
          Start selling
        </Link>
      </div>
    </section>
  );
}

/** The disclosures a public page of an Indian company carries. Null renders as the gap it is. */
function Legal(): React.JSX.Element {
  const { legalName, gstin, cin, registeredOffice: o } = LEGAL_DISCLOSURE;
  return (
    <footer className="legal">
      <p>
        {legalName} · {o.line1}, {o.city}, {o.state} {o.pincode} · GSTIN {gstin} · CIN{' '}
        {cin ?? 'not yet published'} · Grievance Officer{' '}
        <a href={`mailto:${BRAND.grievance}`}>{BRAND.grievance}</a> · Suppliers{' '}
        <a href={`mailto:${BRAND.vendors}`}>{BRAND.vendors}</a>
      </p>
    </footer>
  );
}

/* ==========================================================================
 * Page
 * ======================================================================== */

export function SellLanding(): React.JSX.Element {
  return (
    <div className="sell-landing">
      <TopBar />
      <main id="main">
        <Hero />
        <TheModel />
        <Inspection />
        <HowToSell />
        <Closing />
      </main>
      <Legal />
    </div>
  );
}
