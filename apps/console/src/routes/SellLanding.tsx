import * as React from 'react';
import { Link } from 'react-router';
import { BRAND, LEGAL_DISCLOSURE } from '@trugrade/config/brand';
import { GRADES, QC_AREAS, VENDOR_NET_PAYOUT } from '@trugrade/contracts';
import { PROFILE_SECTIONS } from './vendor/profile/sections.config';

/**
 * ARCHETYPE A — Landing. Claim, one control, then what is actually true.
 *
 * The public face of the supplier console: what a refurbisher sees at `/`
 * before they have an account. Everything a visitor is told here is read from
 * the contract that enforces it — the payout band is `VENDOR_NET_PAYOUT`, the
 * inspection areas are `QC_AREAS`, the sellable grades are `GRADES`, the
 * registration steps are the same `PROFILE_SECTIONS` the profile hub draws.
 * Change the rule and this page changes with it.
 *
 * **There is not one invented number on this page, and that is deliberate.**
 * The obvious shape for a seller-acquisition page is a counter row — sellers
 * onboarded, units sold, crores paid out — and we have no such figure that
 * comes from the API, so none appear. The same goes for testimonials: quoting
 * a supplier we have not quoted is fabricating a person. What is left is the
 * mechanism, which is the honest thing to sell a refurbisher on anyway.
 *
 * **No photographs, for the same reason.** The stock art in the repo is promo
 * flyers ("40% off", third-party logos) and nothing found on an image search
 * comes with a licence a commercial site can rely on. The visuals here are
 * drawn: an inspection instrument and a payout readout, both rendering the
 * real rules. They are also the only motifs the design system permits on a
 * thing that was never inspected — no viewfinder brackets, no scan line, no
 * barcode, because each of those would assert a capture that never happened.
 *
 * **Light, like the rest of this surface.** The console is light-only
 * (`ConsoleThemeSync`), and its light chrome is a pale cyan brand wash paired
 * with the teal accent. The bands use that chrome; the cards on them are white
 * sheets; and every accent-coloured TEXT is `--acc-ink`, the dark teal cut for
 * light surfaces — raw `--acc` is 2:1 against this chrome and fails. No grid
 * ground either: the design system reserves it for dark panels.
 *
 * One primary action: "Start selling", to /sell/register. The masthead's
 * "Sell on Trugrade" goes to the same place — the storefront's links land on
 * this page rather than on the form, so this is the button that finishes the
 * journey — but it is drawn on the chrome rather than in the accent: two accent
 * buttons on one screen and neither means anything. A supplier who already has
 * an account gets a quiet "Sign in" beside it.
 */

/** Sentence case for an area code, so the page reads as English, not as an enum. */
const areaLabel = (code: string): string =>
  code.charAt(0) + code.slice(1).toLowerCase().replace(/_/g, ' ');

const GRADE_LABEL: Readonly<Record<string, string>> = { A_PLUS: 'A+', A: 'A', B: 'B' };

/** In rupees, grouped the Indian way — `VENDOR_NET_PAYOUT` is the source. */
const inr = (n: number): string => `₹${n.toLocaleString('en-IN')}`;

const two = (i: number): string => String(i + 1).padStart(2, '0');

/**
 * Where each of the twelve areas sits on the drawing, in its viewBox. The
 * order is `QC_AREAS`'s own, so the numbers here match the numbered grid lower
 * on the page — a visitor can move between the two without a key.
 */
const AREA_POINTS: ReadonlyArray<readonly [number, number]> = [
  [34, 262], // chassis — the base's outer shell
  [200, 24], // lid
  [96, 254], // palmrest
  [200, 222], // keyboard
  [200, 254], // trackpad
  [200, 108], // screen
  [200, 194], // hinges
  [370, 226], // ports — the base's right edge
  [304, 254], // battery — under the palmrest
  [336, 254], // storage
  [272, 254], // memory
  [340, 206], // thermals — the vent by the hinge
];

const CTA =
  'inline-flex items-center justify-center rounded-[var(--r)] bg-acc px-6 py-3 text-body font-semibold text-acc-on transition-colors hover:bg-acc-dk focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc';

/* ==========================================================================
 * Chrome
 * ======================================================================== */

function Masthead(): React.JSX.Element {
  return (
    <header className="sticky top-0 z-30 border-b border-chrome-line bg-chrome">
      <div className="mx-auto flex h-[62px] max-w-[var(--maxw)] items-center justify-between gap-4 px-5 md:px-8">
        <Link to="/" className="flex min-w-0 items-center gap-2.5" aria-label={`${BRAND.name} home`}>
          <span
            className="grid h-8 w-8 place-items-center rounded-[var(--r)] bg-acc font-mono text-[15px] font-semibold text-acc-on"
            aria-hidden="true"
          >
            t
          </span>
          <span className="flex flex-col leading-none">
            <span className="text-[17px] font-semibold tracking-[-0.022em] text-on-chrome">
              tru<em className="not-italic text-acc-ink">grade</em>
            </span>
            <span className="mt-1 hidden whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.08em] text-on-chrome-3 sm:inline">
              Supplier Hub
            </span>
          </span>
        </Link>

        <nav className="flex shrink-0 items-center gap-4" aria-label="Supplier">
          {/* The quiet door for somebody who already has an account. */}
          <Link
            to="/login"
            className="whitespace-nowrap text-body-sm font-medium text-on-chrome-2 underline-offset-4 hover:text-on-chrome hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc"
          >
            Sign in
          </Link>
          {/*
            The same destination as the hero's "Start selling", drawn on the
            chrome rather than in the accent: the hero holds this screen's one
            primary action, and two accent buttons on one screen mean nothing.
          */}
          <Link
            to="/sell/register"
            className="whitespace-nowrap rounded-[var(--r)] border border-chrome-line-2 px-4 py-2 text-body-sm font-medium text-on-chrome transition-colors hover:bg-chrome-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc"
          >
            Sell on {BRAND.name}
          </Link>
        </nav>
      </div>
    </header>
  );
}

/* ==========================================================================
 * The inspection instrument — QC_AREAS, drawn
 * ======================================================================== */

/**
 * A laptop with the twelve areas marked on it. It asserts nothing about any
 * unit — no serial, no verdict — only what an inspection covers, which is the
 * true content of `QC_AREAS`. The outcome legend beneath is the design
 * system's colour rule stated out loud: green and red belong to PASS and FAIL,
 * and a value we could not measure is grey, never green.
 */
function InspectionInstrument(): React.JSX.Element {
  const keyRows = [214, 225] as const;
  const keyCols = [70, 100, 130, 160, 190, 220, 250, 280, 310] as const;
  return (
    <figure className="rounded-[var(--r-xl)] border border-rule bg-sheet p-5 shadow-[var(--shadow)] md:p-6">
      <figcaption className="flex items-center justify-between gap-3">
        <span className="font-mono text-label uppercase tracking-[0.1em] text-acc-ink">
          {BRAND.qcProduct} · what an inspection covers
        </span>
        <span className="shrink-0 whitespace-nowrap font-mono text-body-sm tabular-nums text-on-chrome-3">
          {QC_AREAS.length} areas
        </span>
      </figcaption>

      <svg
        viewBox="0 0 400 290"
        role="img"
        aria-label={`A laptop with the ${QC_AREAS.length} inspection areas marked: ${QC_AREAS.map(areaLabel).join(', ')}.`}
        className="mt-4 h-auto w-full"
      >
        {/* Lid and screen */}
        <rect x="70" y="30" width="260" height="160" rx="9" className="fill-sheet-3 stroke-rule" strokeWidth="1.5" />
        <rect x="82" y="42" width="236" height="136" rx="4" className="fill-sheet stroke-rule" strokeWidth="1" />
        {/* Hinge */}
        <rect x="58" y="190" width="284" height="8" rx="2" className="fill-sheet-3 stroke-rule" strokeWidth="1" />
        {/* Base */}
        <rect x="26" y="198" width="348" height="72" rx="8" className="fill-sheet-3 stroke-rule" strokeWidth="1.5" />
        {/* Keyboard */}
        <rect x="58" y="208" width="284" height="28" rx="3" className="fill-sheet stroke-rule" strokeWidth="1" />
        {keyRows.map((y) =>
          keyCols.map((x) => (
            <rect key={`${x}-${y}`} x={x} y={y} width="22" height="7" rx="1.5" className="fill-sheet-3" />
          )),
        )}
        {/* Trackpad */}
        <rect x="160" y="243" width="80" height="20" rx="3" className="fill-sheet stroke-rule" strokeWidth="1" />
        {/* Ports on the right edge */}
        {[206, 220, 234].map((y) => (
          <rect key={y} x="366" y={y} width="10" height="7" rx="1" className="fill-sheet stroke-rule" strokeWidth="1" />
        ))}
        {/* Thermal vent by the hinge */}
        {[300, 310, 320, 330, 340, 350].map((x) => (
          <rect key={`v${x}`} x={x} y="200" width="4" height="6" rx="1" className="fill-ink-4" />
        ))}

        {/* The twelve markers, numbered in QC_AREAS order */}
        {QC_AREAS.map((area, i) => {
          const [cx, cy] = AREA_POINTS[i]!;
          return (
            <g key={area}>
              <circle cx={cx} cy={cy} r="11" className="fill-acc-wash stroke-acc" strokeWidth="1.5" />
              <text
                x={cx}
                y={cy + 3.5}
                textAnchor="middle"
                className="fill-acc-ink font-mono text-[9.5px] font-semibold tabular-nums"
              >
                {two(i)}
              </text>
            </g>
          );
        })}
      </svg>

      <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-rule pt-4 text-body-sm sm:grid-cols-4">
        <li className="flex items-center gap-2 text-on-chrome-2">
          <span className="h-2.5 w-2.5 rounded-full bg-pass" aria-hidden="true" /> Pass
        </li>
        <li className="flex items-center gap-2 text-on-chrome-2">
          <span className="h-2.5 w-2.5 rounded-full bg-warn" aria-hidden="true" /> Warn
        </li>
        <li className="flex items-center gap-2 text-on-chrome-2">
          <span className="h-2.5 w-2.5 rounded-full bg-fail" aria-hidden="true" /> Fail
        </li>
        <li className="flex items-center gap-2 text-on-chrome-3">
          <span className="h-2.5 w-2.5 rounded-full bg-ink-4" aria-hidden="true" /> Not measured
        </li>
      </ul>
    </figure>
  );
}

/**
 * The payout band, which is a real rule with an ID, not a claim. A
 * refurbisher's first question is "what can I put on here", and VR-083 is
 * the answer. The two ends are measured values, so they are the accent.
 */
function PayoutReadout(): React.JSX.Element {
  const min = VENDOR_NET_PAYOUT.min!;
  const max = VENDOR_NET_PAYOUT.max!;
  return (
    <div className="rounded-[var(--r-xl)] border border-rule bg-acc-2 p-5 md:p-6">
      <p className="font-mono text-label uppercase tracking-[0.1em] text-acc-ink">
        Expected payout, per machine
      </p>
      <div className="mt-3 flex items-baseline justify-between gap-4 font-mono tabular-nums">
        <span className="text-h1 font-semibold text-on-chrome">{inr(min)}</span>
        <span className="text-body-sm text-on-chrome-3">to</span>
        <span className="text-h1 font-semibold text-on-chrome">{inr(max)}</span>
      </div>
      <div className="mt-3 h-1.5 w-full rounded-full bg-sheet" aria-hidden="true">
        <div className="h-full w-full rounded-full bg-acc" />
      </div>
      <p className="mt-3 text-body-sm text-on-chrome-2">
        You name the number. Our charge is shown against it before you list, as a percentage of
        the selling price, in its parts.
      </p>
    </div>
  );
}

/* ==========================================================================
 * Sections
 * ======================================================================== */

function Hero(): React.JSX.Element {
  return (
    <section className="border-b border-chrome-line bg-chrome">
      <div className="mx-auto grid max-w-[var(--maxw)] items-center gap-10 px-5 py-14 md:grid-cols-[1.05fr_1fr] md:gap-14 md:px-8 md:py-24">
        <div>
          <p className="inline-flex items-center gap-2 rounded-[var(--r-sm)] border border-rule bg-sheet px-2.5 py-1 font-mono text-label uppercase tracking-[0.12em] text-acc-ink">
            For refurbishers · laptops only
          </p>
          <h1 className="mt-6 text-display-1 text-on-chrome">
            Name the payout you want.{' '}
            <em className="not-italic text-acc-ink">We handle the sale.</em>
          </h1>
          <p className="mt-6 max-w-[50ch] text-body-lg leading-[1.65] text-on-chrome-2">
            You tell us what each machine must earn you. {BRAND.name} prices it, sells it on our
            own invoice, and pays you that amount. No buyer to chase, no bill to raise, no payment
            to wait on — you ship a laptop you have already been priced for.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-5">
            <Link to="/sell/register" className={CTA}>
              Start selling
            </Link>
            <span className="text-body-sm text-on-chrome-3">
              GSTIN, PAN and a bank account. No listing fee.
            </span>
          </div>

          <dl className="mt-12 grid max-w-[560px] grid-cols-3 gap-px overflow-hidden rounded-[var(--r-lg)] border border-rule bg-rule">
            <div className="bg-sheet p-4">
              <dt className="text-body-sm text-on-chrome-3">Grades we sell</dt>
              <dd className="mt-1 whitespace-nowrap font-mono text-h3 font-semibold tabular-nums text-acc-ink sm:text-h2">
                {GRADES.map((g) => GRADE_LABEL[g]).join(' · ')}
              </dd>
            </div>
            <div className="bg-sheet p-4">
              <dt className="text-body-sm text-on-chrome-3">Inspected on</dt>
              <dd className="mt-1 whitespace-nowrap font-mono text-h3 font-semibold tabular-nums text-acc-ink sm:text-h2">
                {QC_AREAS.length}{' '}
                <span className="text-body-sm font-normal text-on-chrome-3">areas</span>
              </dd>
            </div>
            <div className="bg-sheet p-4">
              <dt className="text-body-sm text-on-chrome-3">Listing fee</dt>
              <dd className="mt-1 whitespace-nowrap font-mono text-h3 font-semibold tabular-nums text-acc-ink sm:text-h2">
                ₹0
              </dd>
            </div>
          </dl>
        </div>

        <div className="flex flex-col gap-4">
          <InspectionInstrument />
          <PayoutReadout />
        </div>
      </div>
    </section>
  );
}

/** Line icons, drawn here so the page needs no icon library. */
const Icon = {
  tag: <path d="M3 12l9-9h9v9l-9 9-9-9zm13-6a1 1 0 100 2 1 1 0 000-2z" />,
  invoice: <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3zm3 5h6M9 12h6M9 16h4" />,
  eyeOff: (
    <path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.1A10 10 0 0121 12a10 10 0 01-2.3 3.4M6.6 6.6A10 10 0 003 12a10 10 0 0011.3 6.4" />
  ),
} as const;

const PROPOSITIONS = [
  {
    icon: Icon.tag,
    title: 'You name the payout, not the price',
    body: 'Enter what the machine must earn you. Our charge is shown as a percentage of the selling price before you list, broken into its parts — never revealed later.',
  },
  {
    icon: Icon.invoice,
    title: 'We are the seller, not a marketplace',
    body: `When a customer orders, ${BRAND.name} buys that serial from you and sells it on our own invoice. One buyer, one payment, one set of terms — ours.`,
  },
  {
    icon: Icon.eyeOff,
    title: 'Your name never reaches the customer',
    body: 'Buyers see a supply point and a city. Your business name, GSTIN, address and contacts appear on no screen a customer can reach.',
  },
] as const;

function Propositions(): React.JSX.Element {
  return (
    <section className="bg-ground">
      <div className="mx-auto max-w-[var(--maxw)] px-5 py-16 md:px-8 md:py-24">
        <p className="font-mono text-label uppercase tracking-[0.12em] text-acc-ink">The model</p>
        <h2 className="mt-3 max-w-[24ch] text-display-2 text-ink">
          What selling here actually means
        </h2>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {PROPOSITIONS.map((p) => (
            <article
              key={p.title}
              className="rounded-[var(--r-lg)] border border-rule bg-sheet p-6 shadow-[var(--shadow)] transition-colors hover:border-chrome-line-2"
            >
              <span className="grid h-10 w-10 place-items-center rounded-[var(--r)] bg-acc-wash text-acc-ink">
                <svg
                  viewBox="0 0 24 24"
                  className="h-5 w-5 fill-none stroke-current"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  {p.icon}
                </svg>
              </span>
              <h3 className="mt-5 text-h3 text-ink">{p.title}</h3>
              <p className="mt-3 text-body leading-[1.65] text-ink-2">{p.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function Inspection(): React.JSX.Element {
  return (
    <section className="border-y border-rule bg-sheet">
      <div className="mx-auto grid max-w-[var(--maxw)] gap-10 px-5 py-16 md:grid-cols-[1fr_1.3fr] md:gap-16 md:px-8 md:py-24">
        <div>
          <p className="font-mono text-label uppercase tracking-[0.12em] text-acc-ink">
            {BRAND.qcProduct}
          </p>
          <h2 className="mt-3 text-display-2 text-ink">
            Opened, tested and graded before a customer sees it
          </h2>
          <p className="mt-5 text-body-lg leading-[1.65] text-ink-2">
            A technician inspects each unit against {QC_AREAS.length} areas and seals it. The grade
            and the evidence go on the listing, so a buyer is not taking your word for the
            condition — or ours. A returned machine that matched its certificate is our problem,
            not yours.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-2.5">
            {GRADES.map((g) => (
              <span
                key={g}
                className="rounded-[var(--r-sm)] border border-rule bg-sheet-2 px-3 py-1.5 font-mono text-body font-semibold tabular-nums text-ink"
              >
                {GRADE_LABEL[g]}
              </span>
            ))}
            <span className="text-body-sm text-ink-3">
              all sellable — a grade is a position on a scale, not a verdict.
            </span>
          </div>
          <p className="mt-4 text-body-sm leading-[1.6] text-ink-3">
            An area we could not measure is recorded as{' '}
            <span className="text-ink-4">not measured</span> and caps the grade. It is never
            written down as a pass.
          </p>
        </div>

        <ol className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--r-lg)] border border-rule bg-rule sm:grid-cols-3 lg:grid-cols-4">
          {QC_AREAS.map((area, i) => (
            <li key={area} className="bg-sheet-2 px-4 py-5">
              <span className="font-mono text-label tabular-nums text-acc-ink">{two(i)}</span>
              <p className="mt-1.5 text-body font-medium text-ink">{areaLabel(area)}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

const STEPS = [
  {
    title: 'Register your business',
    body: 'GSTIN and PAN are verified against the government portals. Your bank account is confirmed by a ₹1 penny-drop, so the first payout cannot go to a mistyped number.',
  },
  {
    title: 'We review and approve',
    body: 'A reviewer checks your documents against a deadline we publish to you. Listing opens when you are approved.',
  },
  {
    title: 'List machines with your payout',
    body: 'Enter the serial, the specification and what you expect to receive. Our charge is on screen as you type it.',
  },
  {
    title: 'We inspect, sell and pay you',
    body: 'A technician grades and seals the unit. When it sells we buy it from you, you ship to the customer, and the amount you named is what you are paid.',
  },
] as const;

function HowItWorks(): React.JSX.Element {
  return (
    <section className="bg-ground">
      <div className="mx-auto max-w-[var(--maxw)] px-5 py-16 md:px-8 md:py-24">
        <p className="font-mono text-label uppercase tracking-[0.12em] text-acc-ink">Four steps</p>
        <h2 className="mt-3 text-display-2 text-ink">How to sell on {BRAND.name}</h2>

        <ol className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {STEPS.map((s, i) => (
            <li
              key={s.title}
              className="rounded-[var(--r-lg)] border border-rule bg-sheet p-6 shadow-[var(--shadow)]"
            >
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-full border border-acc bg-acc-wash font-mono text-body-sm font-semibold tabular-nums text-acc-ink">
                  {i + 1}
                </span>
                <span className="h-px flex-1 bg-rule" aria-hidden="true" />
              </div>
              <h3 className="mt-5 text-h3 text-ink">{s.title}</h3>
              <p className="mt-2.5 text-body leading-[1.65] text-ink-2">{s.body}</p>
            </li>
          ))}
        </ol>

        {/*
          The registration steps, named exactly as the form names them. A
          refurbisher deciding whether to start deserves to know what they will
          be asked for before they begin, not one screen at a time.
        */}
        <div className="mt-6 rounded-[var(--r-lg)] border border-rule bg-sheet-2 p-6">
          <h3 className="text-h3 text-ink">What registration asks you for</h3>
          <ul className="mt-4 flex flex-wrap gap-2">
            {PROFILE_SECTIONS.map((s, i) => (
              <li
                key={s.id}
                className="inline-flex items-center gap-2 rounded-[var(--r-sm)] border border-rule bg-sheet px-3 py-1.5 text-body-sm text-ink-2"
              >
                <span className="font-mono text-label tabular-nums text-ink-4">{two(i)}</span>
                {s.title}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-body-sm text-ink-3">
            Stop after any section and come back — nothing is submitted for review until every
            required one is saved.
          </p>
        </div>
      </div>
    </section>
  );
}

/** Four things that are true of every supplier's terms. Not a promise; a description. */
const ASSURANCES = [
  'No listing fee, and nothing charged before a machine sells.',
  'Payouts go only to an account confirmed by penny-drop.',
  'Nothing below Grade B is sold under our name.',
  'Your identity never reaches a customer.',
] as const;

function ClosingCta(): React.JSX.Element {
  return (
    <section className="border-t border-chrome-line bg-chrome">
      <div className="mx-auto grid max-w-[var(--maxw)] items-center gap-10 px-5 py-16 md:grid-cols-[1.2fr_1fr] md:px-8 md:py-24">
        <div>
          <h2 className="text-display-2 text-on-chrome">
            Start selling <em className="not-italic text-acc-ink">today.</em>
          </h2>
          <p className="mt-4 max-w-[52ch] text-body-lg leading-[1.65] text-on-chrome-2">
            {BRAND.tagline} Put your machines in front of businesses buying refurbished laptops at
            volume.
          </p>
          <Link to="/sell/register" className={`${CTA} mt-8`}>
            Start selling
          </Link>
        </div>
        <ul className="grid gap-3">
          {ASSURANCES.map((a) => (
            <li
              key={a}
              className="flex items-start gap-3 rounded-[var(--r)] border border-rule bg-sheet px-4 py-3 text-body text-on-chrome-2"
            >
              <svg
                viewBox="0 0 24 24"
                className="mt-0.5 h-4 w-4 shrink-0 fill-none stroke-acc-ink"
                strokeWidth="2.25"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M5 12.5l4.5 4.5L19 7" />
              </svg>
              {a}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Footer(): React.JSX.Element {
  const { legalName, gstin, cin, registeredOffice: o, website } = LEGAL_DISCLOSURE;
  return (
    <footer className="border-t border-chrome-line bg-chrome">
      <div className="mx-auto grid max-w-[var(--maxw)] gap-8 px-5 py-12 md:grid-cols-4 md:px-8">
        <div>
          <span className="text-[17px] font-semibold tracking-[-0.022em] text-on-chrome">
            tru<em className="not-italic text-acc-ink">grade</em>
          </span>
          <p className="mt-2 font-mono text-[11px] leading-[1.7] text-on-chrome-3">{legalName}</p>
          <a
            href={website}
            className="mt-2 inline-block font-mono text-[12px] text-on-chrome-2 underline underline-offset-4"
          >
            {BRAND.domain}
          </a>
        </div>

        <div>
          <h5 className="font-mono text-[11px] uppercase tracking-[0.08em] text-on-chrome-3">
            Registered office
          </h5>
          <address className="mt-3 font-mono text-[12px] not-italic leading-[1.7] text-on-chrome-2">
            {o.line1}
            <br />
            {o.city}, {o.state} {o.pincode}
            <br />
            {o.country}
          </address>
        </div>

        <div>
          <h5 className="font-mono text-[11px] uppercase tracking-[0.08em] text-on-chrome-3">
            Identifiers
          </h5>
          <dl className="mt-3 font-mono text-[12px] leading-[1.7] text-on-chrome-2">
            <dt className="inline text-on-chrome-3">GSTIN </dt>
            <dd className="inline tabular-nums">{gstin}</dd>
            <br />
            <dt className="inline text-on-chrome-3">CIN </dt>
            {/* Null renders as the gap it is. A plausible placeholder is worse. */}
            <dd className="inline tabular-nums">{cin ?? 'Not yet published'}</dd>
          </dl>
        </div>

        <div>
          <h5 className="font-mono text-[11px] uppercase tracking-[0.08em] text-on-chrome-3">
            Suppliers
          </h5>
          <ul className="mt-3 flex flex-col gap-2 text-body-sm">
            <li>
              <Link to="/sell/register" className="text-on-chrome-2 hover:text-on-chrome">
                Start selling
              </Link>
            </li>
            <li>
              <Link to="/login" className="text-on-chrome-2 hover:text-on-chrome">
                Sign in
              </Link>
            </li>
            <li>
              <a
                href={`mailto:${BRAND.vendors}`}
                className="font-mono text-[12px] text-on-chrome-2 hover:text-on-chrome"
              >
                {BRAND.vendors}
              </a>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-chrome-line">
        <p className="mx-auto max-w-[var(--maxw)] px-5 py-5 font-mono text-[11px] leading-[1.7] text-on-chrome-3 md:px-8">
          {legalName} · GSTIN <span className="tabular-nums">{gstin}</span> · Grievance Officer{' '}
          <a href={`mailto:${BRAND.grievance}`} className="underline underline-offset-4">
            {BRAND.grievance}
          </a>
        </p>
      </div>
    </footer>
  );
}

/* ==========================================================================
 * Page
 * ======================================================================== */

export function SellLanding(): React.JSX.Element {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-ground text-ink-2">
      <Masthead />
      <main id="main" className="flex-1">
        <Hero />
        <Propositions />
        <Inspection />
        <HowItWorks />
        <ClosingCta />
      </main>
      <Footer />
    </div>
  );
}
