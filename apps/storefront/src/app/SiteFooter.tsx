import type { Route } from 'next';
import Link from 'next/link';
import { BRAND, LEGAL_DISCLOSURE } from '@trugrade/config/brand';

/**
 * Block 9 of `09_FRONTEND_LOCKED.md` §7 — the five-column footer, built against
 * `docs/reference/homepage.html`, whose `.fg` / `.fa` / `.legal` / `.fbot` /
 * `.pays` classes are already in `storefront.css` and were until now unused by
 * any component.
 *
 * ---------------------------------------------------------------------------
 * WHAT CHANGED FROM THE REFERENCE, AND WHY
 * ---------------------------------------------------------------------------
 * **The identifiers.** The reference is a design mock and its legal block holds
 * invented values — a GSTIN, a CIN and a grievance officer called Ravi Menon.
 * The GSTIN here is the real one we invoice under. The CIN, the street address
 * and the officer's name are not decided, and they render as visibly empty
 * fields rather than as plausible strings. A fabricated grievance officer is
 * worse than an absent one: a customer with a real problem would spend their one
 * attempt on it.
 *
 * **The links.** Every href points at a route that exists. The mock's `href="#"`
 * columns included several pages that were never built, and a footer link to a
 * 404 is how a compliance disclosure stops being one.
 *
 * ---------------------------------------------------------------------------
 * WHY THE FOOTER IS WHERE THE r.4(2) BLOCK LIVES
 * ---------------------------------------------------------------------------
 * Rule 4(2) of the Consumer Protection (e-Commerce) Rules, 2020 requires the
 * legal name, the address of the headquarters and branches, website details and
 * contact information to be displayed **prominently**, which in practice means
 * on every page rather than on one page about it. This component is rendered by
 * the root layout, so it is.
 *
 * Every identifier is mono with tabular figures — a GSTIN is a number somebody
 * copies, and 09_FRONTEND_LOCKED.md §3 is explicit that identifying values take
 * the mono face. There is no amber anywhere on it: a footer holds no primary
 * action, no measured value and no active state.
 */

const BUY = [
  ['All laptops', '/search'],
  ['Bulk requirement', '/bulk'],
  ['Verify a certificate', '/qc/verify'],
  ['Your orders', '/account/orders'],
] as const;

const SELL = [
  // T43: `/sell` was a 404 on every page. There is one supplier entry and it
  // is the registration flow; a second label for a route nobody built is not a
  // second door.
  ['Become a supplier', '/sell/register'],
  ['Grading standard', '/legal/grading'],
] as const;

const TRUST = [
  ['Grading standard', '/legal/grading'],
  ['Data wipe standard', '/legal/wipe-standard'],
  ['Warranty', '/legal/warranty'],
  ['Returns and refunds', '/legal/returns-and-refunds'],
  ['Shipping and delivery', '/legal/shipping'],
] as const;

const COMPANY = [
  ['Terms of sale', '/legal/terms'],
  ['Privacy and DPDP', '/legal/privacy'],
  ['Pricing and taxes', '/legal/pricing-and-taxes'],
  ['Cancellation', '/legal/cancellation'],
  ['Grievance redressal', '/legal/grievance'],
  ['All legal documents', '/legal'],
] as const;

function Column({
  heading,
  links,
}: {
  heading: string;
  links: ReadonlyArray<readonly [string, string]>;
}): React.JSX.Element {
  return (
    <div>
      {/*
        T45: this was an `<h5>` — chosen for its size, which is what `.fg h5`
        still supplies. But heading LEVEL is structure, not type scale, and a
        level five under a page whose deepest heading is a two or a three is a
        skipped level on every route the footer renders on: thirty-eight of the
        forty audited failed `heading-order` for this one element and nothing
        else. `<h2>` is the true level — a sibling of the page's own sections —
        and the class carries the appearance unchanged.
      */}
      <h2 className="fgh">{heading}</h2>
      <ul>
        {links.map(([label, href]) => (
          <li key={href + label}>
            <Link href={href as Route}>{label}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A statutory field with no value yet. Visibly empty, never plausible. */
function Pending({ what }: { what: string }): React.JSX.Element {
  return <span className="text-on-chrome-3">[{what} — not yet published]</span>;
}

export function SiteFooter(): React.JSX.Element {
  const office = LEGAL_DISCLOSURE.registeredOffice;
  return (
    <footer>
      <div className="wrap">
        <div className="fg">
          <div className="fa">
            <span className="wm text-[18px] text-on-chrome">
              tru<span className="g">grade</span>
            </span>
            <p>
              India&rsquo;s B2B marketplace for inspected refurbished laptops. Opened, tested, graded
              and sealed before listing.
            </p>
            {/*
              The r.4(2) disclosure itself. `.legal` is already mono in
              `storefront.css`, which is correct — every line of it is an
              identifier or an address.
            */}
            <div className="legal">
              {LEGAL_DISCLOSURE.legalName}
              <br />
              <Pending what="Street address" /> {office.city}, {office.state} {office.pincode}
              <br />
              GSTIN {LEGAL_DISCLOSURE.gstin} &middot; CIN{' '}
              {LEGAL_DISCLOSURE.cin ?? <Pending what="CIN" />}
              <br />
              {LEGAL_DISCLOSURE.grievanceOfficer.designation}:{' '}
              <Pending what="Officer not yet appointed" /> &middot;{' '}
              <a href={`mailto:${LEGAL_DISCLOSURE.grievanceOfficer.email}`}>
                {LEGAL_DISCLOSURE.grievanceOfficer.email}
              </a>
              <br />
              Customer care: {LEGAL_DISCLOSURE.customerCare.email}
              {LEGAL_DISCLOSURE.customerCare.phone ? (
                <> &middot; {LEGAL_DISCLOSURE.customerCare.phone}</>
              ) : null}{' '}
              &middot; {LEGAL_DISCLOSURE.customerCare.hours}
            </div>
          </div>

          <Column heading="Buy" links={BUY} />
          <Column heading="Sell" links={SELL} />
          <Column heading="Trust" links={TRUST} />
          <Column heading="Company" links={COMPANY} />
        </div>

        <div className="fbot">
          {/* No trailing full stop: the legal name already ends in one. */}
          <span>
            &copy; <span className="tnum">2026</span> {LEGAL_DISCLOSURE.legalName} &middot;{' '}
            {BRAND.name} is a brand of {LEGAL_DISCLOSURE.legalName}
          </span>
          {/*
            The payment rails we actually take. Credit terms are switched off
            (`ordering.credit_enabled` is false), so the mock's `NET 30` chip is
            not here — a rail advertised in a footer and refused at checkout is
            the smallest possible lie and still a lie.
          */}
          <div className="pays">
            <span>NEFT</span>
            <span>RTGS</span>
            <span>UPI</span>
            <span>CARDS</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
