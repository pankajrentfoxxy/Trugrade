import type { Route } from 'next';
import Link from 'next/link';
import { BRAND, formatRegisteredOffice, LEGAL_DISCLOSURE } from '@trugrade/config/brand';
import type { GradeDefinition, LegalTerms } from '../../lib/api';

/**
 * The ten documents `03_UX_SPEC.md` §3A.8 requires, and the one rule that
 * governs every sentence in them.
 *
 * ---------------------------------------------------------------------------
 * A LEGAL PAGE IS THE DOCUMENT A CUSTOMER HOLDS US TO
 * ---------------------------------------------------------------------------
 * So every number here is either read from the thing that enforces it, or it is
 * not printed. There is no third option and in particular there is no
 * "reasonable default": a page promising a 30-day return while `ReturnsService`
 * enforces 48 hours has not made a typo, it has created a liability out of
 * prose, and the customer wins that argument.
 *
 * Three numbers on these pages come from live reads and none of them is retyped:
 *
 *   - the inspection window, the warranty top-up and the warranty floor, and the
 *     two r.4(5) grievance clocks, from `/public/legal-terms` — which reads
 *     `platform.v_current_config`, the same view `ReturnsService.windowHours`
 *     and `WarrantyService` read;
 *   - the grade floors, from `/public/grades` — which reads
 *     `catalog.grade_definition`, the rows the Phase 4 QC engine grades against.
 *
 * When either read fails or a key is unset the page prints `Not published`, in
 * `--ink-4`, and says the term is unstated. `A missing value never renders as a
 * passing one` is a design rule everywhere in this product; on a legal page it
 * is also the difference between an incomplete document and a false one.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE PRODUCT DOES NOT YET DO THE THING, THE PAGE DOES NOT CLAIM IT
 * ---------------------------------------------------------------------------
 * Several sentences below are deliberately smaller than the spec's ambition,
 * and each says so out loud rather than describing an intention in the present
 * tense. There is no carrier tracking, because `logistics.shipment` has no
 * writer. There is no self-serve order cancellation, because no endpoint offers
 * one. There is no evidence upload on a return, because the only upload route
 * writes KYC documents. There is no e-invoice, because `tax.einvoice_enabled` is
 * false. Writing any of those as though they worked would be the same defect as
 * a wrong number, expressed in a longer sentence.
 *
 * `UNSET` marks the values that are genuinely not decided yet — a grievance
 * officer's name, a postal address, a jurisdiction. Those render as a visibly
 * empty field. A fabricated grievance officer is worse than an absent one,
 * because a customer with a real problem would spend their one attempt on it.
 */

/* ==========================================================================
 * The small pieces every document is built from
 * ======================================================================== */

/**
 * A number, in mono with tabular figures — 09_FRONTEND_LOCKED.md §3.
 *
 * `null` is the whole reason this is a component rather than a template
 * literal. Hours, months, percentages and cycle caps all arrive nullable from
 * config or from the grade rows, and every one of them must render as an
 * absence rather than as a zero or as a remembered default.
 */
export function N({
  value,
  unit,
  absent = 'Not published',
}: {
  value: number | string | null;
  unit?: string;
  absent?: string;
}): React.JSX.Element {
  if (value === null) return <span className="lg-absent">{absent}</span>;
  return (
    <span className="tnum">
      {value}
      {unit ? <span className="lg-unit">&nbsp;{unit}</span> : null}
    </span>
  );
}

/**
 * A value that does not exist yet and must look like it does not exist.
 *
 * r.4(2) asks for the entity's address and r.4(5) for a named officer. Neither
 * has been decided, and the honest rendering of an undecided statutory field is
 * a visibly empty one — not a plausible placeholder somebody would try to use.
 */
export function Unset({ what }: { what: string }): React.JSX.Element {
  return (
    <span className="lg-pending tnum">{what} — not yet published</span>
  );
}

/** An internal cross-reference. Legal documents refer to each other constantly. */
function Ref({ to, children }: { to: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <Link href={to as Route}>{children}</Link>
  );
}

/** A definition list — the shape most of these documents actually want. */
function Facts({
  rows,
}: {
  rows: ReadonlyArray<readonly [string, React.ReactNode]>;
}): React.JSX.Element {
  return (
    <dl className="lg-kv">
      {rows.map(([term, value]) => (
        <div key={term}>
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A plain bulleted list. Used for coverage, exclusions and reason codes. */
function List({ items }: { items: ReadonlyArray<React.ReactNode> }): React.JSX.Element {
  return (
    <ul className="lg-list">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

/** A quoted statutory or contractual sentence, reproduced exactly. */
function Verbatim({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <p className="lg-verbatim">{children}</p>
  );
}

/* ==========================================================================
 * The document shape
 * ======================================================================== */

export interface LegalSection {
  /** The anchor. A clause somebody needs to cite must have a URL of its own. */
  id: string;
  heading: string;
  body: React.ReactNode;
}

export interface LegalDocument {
  slug: string;
  title: string;
  /** One sentence, for the index and for `<meta name="description">`. */
  summary: string;
  /**
   * The statute the document answers to, for the header pill — only where
   * there is one. The pill otherwise carries the title.
   */
  kicker?: string;
  /**
   * The version of the text below.
   *
   * It lives here, beside the words, and not in `platform_config` — a version is
   * a fact about a document, and a number in a database cannot know that a
   * paragraph changed. Editing the prose and the version in one commit is the
   * only arrangement in which the two cannot drift. See the module note in
   * `page.tsx` for what `03_UX_SPEC.md` line 727 additionally asks for and what
   * is not built.
   */
  version: string;
  /** ISO date. Bumped with the version, in the same edit. */
  updated: string;
  /**
   * Line 727 names three documents whose changes are re-consented at next
   * login. The flag records which three; **nothing re-consents them yet**, and
   * the page says so rather than implying a mechanism.
   */
  reconsentOnChange: boolean;
  sections: readonly LegalSection[];
}

export const LEGAL_SLUGS = [
  'terms',
  'privacy',
  'grievance',
  'returns-and-refunds',
  'warranty',
  'grading',
  'wipe-standard',
  'shipping',
  'cancellation',
  'pricing-and-taxes',
] as const;

export type LegalSlug = (typeof LEGAL_SLUGS)[number];

/**
 * Every document was first published on this date, so it is one constant rather
 * than ten copies of the same string waiting to disagree with each other.
 * A document that changes takes its own date and its own version.
 */
const FIRST_PUBLISHED = '2026-08-31';

/* ==========================================================================
 * The documents
 * ======================================================================== */

/**
 * Build all ten against the live enforcement values.
 *
 * `terms` and `grades` are nullable because the API can be down, and a legal
 * page that 500s is worse than one that says a figure is unavailable. Every
 * consumer of a null renders an absence.
 */
export function buildDocuments(
  terms: LegalTerms | null,
  grades: readonly GradeDefinition[] | null,
): readonly LegalDocument[] {
  const window = terms?.inspectionWindowHours ?? null;
  const topUp = terms?.warrantyTopUpMonths ?? null;
  const floor = terms?.warrantyMinTotalMonths ?? null;
  const ackHours = terms?.grievanceAckHours ?? null;
  const redressDays = terms?.grievanceRedressDays ?? null;

  return [
    terms_(window),
    privacy(),
    grievance(ackHours, redressDays),
    returnsAndRefunds(window),
    warranty(topUp, floor),
    grading(grades),
    wipeStandard(),
    shipping(),
    cancellation(window),
    pricingAndTaxes(),
  ];
}

/* -------------------------------------------------------------------------- */

function whoYouContractWith(): React.JSX.Element {
  return (
    <>
      <p>
        {BRAND.name} is a brand of {LEGAL_DISCLOSURE.legalName}. Whatever you buy on this
        marketplace, the seller is {LEGAL_DISCLOSURE.legalName} — not a supplier, not an agent, and
        not a third party we introduced you to. There is one seller, one contract and one invoice.
      </p>
      <Facts
        rows={[
          ['Legal name', LEGAL_DISCLOSURE.legalName],
          ['Brand', `${BRAND.name} · ${LEGAL_DISCLOSURE.website}`],
          ['GSTIN', <span className="tnum">{LEGAL_DISCLOSURE.gstin}</span>],
          [
            'CIN',
            LEGAL_DISCLOSURE.cin ? (
              <span className="tnum">{LEGAL_DISCLOSURE.cin}</span>
            ) : (
              <Unset what="CIN" />
            ),
          ],
          [
            'Registered office',
            <span className="tnum">{formatRegisteredOffice()}</span>,
          ],
          [
            'Branches',
            LEGAL_DISCLOSURE.branches.length === 0 ? (
              <span className="dim">
                None. We operate from the registered office; stock is held by suppliers and never by
                us.
              </span>
            ) : (
              LEGAL_DISCLOSURE.branches.map((b) => `${b.city}, ${b.state} ${b.pincode}`).join(' · ')
            ),
          ],
          [
            'Customer care',
            <>
              <a
                href={`mailto:${LEGAL_DISCLOSURE.customerCare.email}`}
              >
                {LEGAL_DISCLOSURE.customerCare.email}
              </a>
              {LEGAL_DISCLOSURE.customerCare.phone ? (
                <a className="tnum lg-gap" href={`tel:${LEGAL_DISCLOSURE.customerCare.phone}`}>
                  {formatMobile(LEGAL_DISCLOSURE.customerCare.phone)}
                </a>
              ) : (
                <span className="lg-gap">
                  <Unset what="Telephone" />
                </span>
              )}
              <span className="lg-gap dim">{LEGAL_DISCLOSURE.customerCare.hours}</span>
            </>,
          ],
        ]}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */

function terms_(window: number | null): LegalDocument {
  return {
    slug: 'terms',
    title: 'Terms of sale',
    summary:
      'Who you are contracting with, what we sell, how an order is formed, and which of these documents governs what.',
    version: 'v1.0',
    updated: FIRST_PUBLISHED,
    reconsentOnChange: true,
    sections: [
      {
        id: 'seller',
        heading: 'Who you are contracting with',
        body: whoYouContractWith(),
      },
      {
        id: 'model',
        heading: 'We are the seller, and we hold no stock',
        body: (
          <>
            <p>
              We operate as principal and merchant of record on a back-to-back basis. We do not hold
              inventory. At the moment you order a particular machine we buy that serial from the
              supplier who holds it and sell it to you on our own invoice; the machine then ships
              directly from the supplier&rsquo;s premises to your delivery address. One physical
              movement, two supplies, and the one you are party to is ours.
            </p>
            <p>
              This is not a formality. It decides who answers when something is wrong. You have no
              contract with the supplier, you are never asked to pursue one, and no obligation we owe
              you under these documents is delegated to one.
            </p>
          </>
        ),
      },
      {
        id: 'supply-points',
        heading: 'Supply points are not named',
        body: (
          <>
            <p>
              Suppliers appear throughout the site as supply points — <em>Supply Point A —
              Gurugram</em> — with a city and a track record, and never by name. We do not disclose
              which business holds a machine, before or after you buy it. Their identity is not
              withheld from you to your disadvantage: because we are the seller, it is not a fact you
              need in order to enforce anything.
            </p>
            <p>
              The city is real and it is on the invoice, because the place a machine ships from
              determines the tax treatment and your delivery time.
            </p>
          </>
        ),
      },
      {
        id: 'who-can-buy',
        heading: 'Who can buy',
        body: (
          <>
            <p>
              {BRAND.name} sells to businesses. An account requires a registered organisation with a
              valid GSTIN, and orders are placed by named users under that organisation with the
              permissions it grants them. We do not sell to consumers, and nothing here is offered on
              consumer terms.
            </p>
            <List
              items={[
                'Your GSTIN is verified against the GST portal before your account is approved, and the legal name it returns is the name on your invoices.',
                'Where your organisation requires an internal approval before an order is confirmed, that approval is part of the order — an order rejected by your own approver is cancelled and no contract is formed.',
                'Payment is in advance. Credit terms are not currently offered on this platform.',
              ]}
            />
          </>
        ),
      },
      {
        id: 'what-we-sell',
        heading: 'What we sell',
        body: (
          <>
            <p>
              Refurbished laptops, and only refurbished laptops. Desktops, monitors and parts are
              marked as coming and are not sold today. Every machine is a specific, individually
              identified unit — a serial or service tag — that has been physically opened, tested and
              graded before it was listed. You are buying that unit, not a model number.
            </p>
            <p>
              What the grade means is defined objectively and measurably in{' '}
              <Ref to="/legal/grading">the grading standard</Ref>, which is the document that governs
              any disagreement about condition.
            </p>
          </>
        ),
      },
      {
        id: 'order',
        heading: 'How an order is formed',
        body: (
          <>
            <List
              items={[
                'Adding a machine to your cart reserves nothing. Starting checkout holds the specific serials for a short period so that two buyers cannot be sold the same machine.',
                'If your organisation requires an approval, the stock is held while that approval is outstanding and released if it lapses.',
                'A contract is formed when we confirm the order after payment, not when you submit it. Until then we may decline it — for example where a machine failed a re-check between listing and sale.',
                'Your order may be split into several consignments where the machines are held at different supply points, or where they fall into different tax valuation channels. See the shipping and tax documents below.',
              ]}
            />
            <p>
              The exact hold periods are shown on the checkout screen itself, counted down by our
              server rather than by your browser, and{' '}
              <Ref to="/legal/cancellation">the cancellation policy</Ref> says what happens if you
              abandon a checkout or an approval lapses.
            </p>
          </>
        ),
      },
      {
        id: 'remedies',
        heading: 'What you can do if something is wrong',
        body: (
          <>
            <p>
              Three separate remedies, in the order they become available. They do not replace your
              rights in law; they are what we undertake to do.
            </p>
            <List
              items={[
                <>
                  <strong>On arrival</strong> — an inspection window of{' '}
                  <N value={window} unit="hours" /> from delivery, during which you may send a
                  machine back for any of six stated reasons. See{' '}
                  <Ref to="/legal/returns-and-refunds">returns and refunds</Ref>.
                </>,
                <>
                  <strong>After that window</strong> — warranty cover, which we
                  provide ourselves for its whole term. See{' '}
                  <Ref to="/legal/warranty">the warranty</Ref>.
                </>,
                <>
                  <strong>At any time</strong> — the grievance procedure, with a
                  named officer and published response times. See{' '}
                  <Ref to="/legal/grievance">grievance redressal</Ref>.
                </>,
              ]}
            />
          </>
        ),
      },
      {
        id: 'versions',
        heading: 'Changes to these terms',
        body: (
          <>
            <p>
              This document carries a version number and a date, both shown at the top of the page.
              When it changes we publish it here under a new version number and a new date. We do not
              change a published document silently.
            </p>
            <p>
              We are building a mechanism that asks existing customers to accept a changed version at
              their next sign-in. It is not running yet, and this page does not pretend otherwise —
              until it is, the version and date above are how you can tell whether the document you
              read last month is the document in force today.
            </p>
          </>
        ),
      },
      {
        id: 'law',
        heading: 'Governing law',
        body: (
          <>
            <p>
              These terms are governed by the laws of India.
            </p>
            <p>
              The forum for disputes and any arbitration clause have not been settled and are not
              stated here. We will not assert a jurisdiction we have not published.
            </p>
            <p>
              <Unset what="Jurisdiction and dispute resolution" />
            </p>
          </>
        ),
      },
    ],
  };
}

/* -------------------------------------------------------------------------- */

function privacy(): LegalDocument {
  return {
    slug: 'privacy',
    title: 'Privacy and DPDP notice',
    summary:
      'What personal data we process, the itemised purposes you consent to, how to withdraw consent, and how to reach us about it.',
    version: 'v1.0',
    updated: FIRST_PUBLISHED,
    reconsentOnChange: false,
    sections: [
      {
        id: 'fiduciary',
        heading: 'Who processes your data',
        body: (
          <>
            <p>
              {LEGAL_DISCLOSURE.legalName} is the Data Fiduciary for the personal data described
              below, under the Digital Personal Data Protection Act, 2023. Most of what we hold is
              organisation data rather than personal data; this notice is about the part that is
              personal — the people who register, order, approve and receive.
            </p>
            <Facts
              rows={[
                ['Data Fiduciary', LEGAL_DISCLOSURE.legalName],
                [
                  'Contact for data questions',
                  <a
                        href={`mailto:${LEGAL_DISCLOSURE.grievanceOfficer.email}`}
                  >
                    {LEGAL_DISCLOSURE.grievanceOfficer.email}
                  </a>,
                ],
                ['Consent Manager', <Unset what="DPDP Consent Manager registration" />],
              ]}
            />
          </>
        ),
      },
      {
        id: 'what',
        heading: 'What we collect',
        body: (
          <List
            items={[
              'Identity of the organisation: legal name, GSTIN, PAN, and where applicable CIN, LLPIN or Udyam registration. These are verified against the issuing authority, and the result of that verification is stored.',
              'People: the name, work email and mobile number of each user on your account, and which permissions they hold.',
              'Addresses: your billing address and each delivery address, including pincode, which determines serviceability, delivery estimate and the tax treatment of your order.',
              'Documents you upload during onboarding, and the verification decisions made on them.',
              'Bank details, for suppliers only, including the account-holder name returned by a penny-drop verification.',
              'What you did here: orders, approvals, returns, warranty claims, tickets, and the audit trail of who changed what.',
            ]}
          />
        ),
      },
      {
        id: 'purposes',
        heading: 'The purposes you consent to, itemised',
        body: (
          <>
            <p>
              Consent under the DPDP Act is purpose-specific. Blanket consent is not consent, so we
              record each of these separately and you may hold some and not others. These are the
              exact six purposes the platform recognises.
            </p>
            <List
              items={[
                <>
                  <strong>Verifying who you are</strong> — checking your GSTIN,
                  PAN and documents against the issuing authorities so that an account can be
                  approved.
                </>,
                <>
                  <strong>Messages about your transactions</strong> — order
                  confirmations, delivery notifications, invoices, return and claim updates.
                </>,
                <>
                  <strong>Marketing</strong> — stock alerts, offers and
                  newsletters.
                </>,
                <>
                  <strong>WhatsApp</strong> — receiving any of the above on
                  WhatsApp rather than only by email.
                </>,
                <>
                  <strong>Credit assessment</strong> — where credit terms are
                  requested. Credit is not offered today, so this purpose is not currently used.
                </>,
                <>
                  <strong>Sharing with logistics providers</strong> — passing a
                  recipient name, address and phone number to whoever carries the machine to you.
                </>,
              ]}
            />
          </>
        ),
      },
      {
        id: 'withdrawal',
        heading: 'Withdrawing consent',
        body: (
          <>
            <p>
              You may withdraw any of the consents above. Write to the address in{' '}
              <Ref to="/legal/grievance">grievance redressal</Ref> naming the purpose you are
              withdrawing.
            </p>
            <p>
              Two things about withdrawal that are worth being plain about. First, withdrawing a
              consent does not delete the record that you once gave it — that record is the evidence
              that we had a lawful basis at the time, and it is kept, stamped with the moment you
              withdrew. Second, withdrawal is one-way: we cannot un-withdraw a consent, so restoring
              it means giving it again.
            </p>
            <p>
              Messages about a transaction you have entered into are not sent on the basis of consent
              and do not stop when you withdraw one. If you have ordered a machine, we will tell you
              when it ships whether or not you have opted out of marketing. Only marketing and
              digests respect these flags.
            </p>
          </>
        ),
      },
      {
        id: 'sharing',
        heading: 'Who else sees it',
        body: (
          <List
            items={[
              'Verification providers, in order to check a GSTIN, PAN, bank account or address against the source. We send them the identifier being checked and nothing else.',
              'The logistics provider carrying your order, where you have consented to that sharing — the recipient, the address and a phone number.',
              'Our payment and accounting infrastructure, for the invoice and the money.',
              'Government, where a statute or a lawful order requires it.',
              'Suppliers see none of your data. A supplier is told which serial to ship and where, and that is the extent of it; they are not told who you are, and you are not told who they are.',
            ]}
          />
        ),
      },
      {
        id: 'retention',
        heading: 'How long we keep it',
        body: (
          <>
            <p>
              Tax records — invoices and the transaction data behind them — are retained for the
              period the GST law requires, which is presently six years from the due date of the
              annual return for the relevant year. Consent records are retained for as long as the
              account exists, because a consent artefact that can be deleted is not evidence of
              consent.
            </p>
            <p>
              A full retention schedule for everything else — onboarding documents, verification
              responses, audit logs — has not been settled and is not published here. We will not
              publish a period we are not yet enforcing.
            </p>
            <p>
              <Unset what="General retention schedule" />
            </p>
          </>
        ),
      },
      {
        id: 'rights',
        heading: 'Your rights',
        body: (
          <>
            <p>
              Under the DPDP Act you may ask for a summary of the personal data we hold about you and
              how it is processed; ask us to correct or complete it; ask us to erase it where we no
              longer need it for the purpose it was collected for or to meet a legal obligation; and
              nominate someone to exercise these rights if you cannot.
            </p>
            <p>
              Requests go to the grievance officer, and are answered on the timescales published in{' '}
              <Ref to="/legal/grievance">grievance redressal</Ref>.
            </p>
          </>
        ),
      },
    ],
  };
}

/* -------------------------------------------------------------------------- */

function grievance(ackHours: number | null, redressDays: number | null): LegalDocument {
  const officer = LEGAL_DISCLOSURE.grievanceOfficer;
  return {
    slug: 'grievance',
    title: 'Grievance redressal',
    kicker: 'Rule 4(5) · Consumer Protection (e-Commerce) Rules 2020',
    summary:
      'The grievance officer required by Rule 4(5) of the Consumer Protection (e-Commerce) Rules 2020, and the times we answer in.',
    version: 'v1.0',
    updated: FIRST_PUBLISHED,
    reconsentOnChange: false,
    // Not the shared `Facts` and `List` pieces: the officer block, the two
    // clocks as large figures and the numbered steps are the design's own
    // shapes for this document (storefront.css, "T48 — /legal/**").
    sections: [
      {
        id: 'officer',
        heading: 'The grievance officer',
        body: (
          <>
            <p>
              Rule 4(5) of the Consumer Protection (e-Commerce) Rules, 2020 requires us to appoint a
              grievance officer resident in India and to publish their name, designation and contact
              details.
            </p>
            <p className="lg-note">
              <b>The appointment has not been made yet.</b> We are not going to print a name here
              before there is a person behind it &mdash; a customer with a problem would spend their
              attempt on it. Until then, the email below is monitored and anything sent to it is
              treated as a grievance under this policy, on the times further down.
            </p>
            <dl className="lg-kv">
              <div>
                <dt>Name</dt>
                <dd>
                  <span className="lg-pending tnum">Officer name &mdash; not yet published</span>
                </dd>
              </div>
              <div>
                <dt>Designation</dt>
                <dd>{officer.designation}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd className="tnum">
                  <a href={`mailto:${officer.email}`}>{officer.email}</a>
                </dd>
              </div>
              <div>
                <dt>Telephone</dt>
                <dd className="tnum">
                  {officer.phone ? (
                    <a href={`tel:${officer.phone}`}>{formatMobile(officer.phone)}</a>
                  ) : (
                    <span className="lg-pending">Telephone &mdash; not yet published</span>
                  )}
                </dd>
              </div>
              <div>
                <dt>Address</dt>
                <dd>{officer.address}</dd>
              </div>
            </dl>
          </>
        ),
      },
      {
        id: 'times',
        heading: 'How quickly we answer',
        body: (
          <>
            <dl className="lg-sla">
              <div>
                <dt>Acknowledgement</dt>
                <dd>
                  <Clock value={ackHours} unit="hours" />
                  <span>of receipt</span>
                </dd>
              </div>
              <div>
                <dt>Resolution</dt>
                <dd>
                  <Clock value={redressDays} unit="days" />
                  <span>of receipt</span>
                </dd>
              </div>
            </dl>
            <p className="dim">
              Both figures are read from the platform&rsquo;s own configuration when this page
              renders &mdash; what is published here is what the business is set up to do, not a
              number typed into a document once.
            </p>
          </>
        ),
      },
      {
        id: 'how',
        heading: 'How to raise one',
        body: (
          <>
            <ol className="lg-steps">
              <li>
                <span className="lg-num tnum" aria-hidden>
                  01
                </span>
                <div>
                  <b>Email the address above</b>
                  <p>
                    Include your order number, and the serial number of the machine if the grievance
                    is about a particular one &mdash; every machine we sell has one, and it is on
                    your invoice.
                  </p>
                </div>
              </li>
              <li>
                <span className="lg-num tnum" aria-hidden>
                  02
                </span>
                <div>
                  <b>Tell us what you want to happen</b>
                  <p>
                    A return, a replacement, a refund, a correction to a record, an explanation.
                  </p>
                </div>
              </li>
              <li>
                <span className="lg-num tnum" aria-hidden>
                  03
                </span>
                <div>
                  <b>No prior return or claim needed</b>
                  <p>
                    A grievance is not an escalation of those &mdash; it is a separate route, and it
                    is always open.
                  </p>
                </div>
              </li>
            </ol>
            <p className="lg-note">
              Machine arrived in the wrong condition? The faster route is usually the inspection
              window in <Ref to="/legal/returns-and-refunds">returns and refunds</Ref> &mdash; a
              decision made against a published standard rather than a conversation.
            </p>
          </>
        ),
      },
      {
        id: 'escalation',
        heading: 'If we do not resolve it',
        body: (
          <p>
            You may take a consumer complaint to the National Consumer Helpline or file it on the
            e-Daakhil portal operated by the Department of Consumer Affairs. Nothing in this policy
            limits that, and using our procedure first is <b>not</b> a condition of it.
          </p>
        ),
      },
    ],
  };
}

/**
 * One of the r.4(5) clocks as the design's large figure. `null` renders as an
 * absence in the muted ink, never as a zero — the config key being unset is a
 * fact the page must show, not paper over.
 */
function Clock({ value, unit }: { value: number | null; unit: string }): React.JSX.Element {
  if (value === null) return <b className="lg-clock lg-absent">Not published</b>;
  return (
    <b className="lg-clock tnum">
      {value} <i>{unit}</i>
    </b>
  );
}

/** `+91XXXXXXXXXX`, the normalised form config holds, printed the way people read it. */
function formatMobile(e164: string): string {
  const m = /^\+91(\d{5})(\d{5})$/.exec(e164);
  return m ? `+91 ${m[1]} ${m[2]}` : e164;
}

/* -------------------------------------------------------------------------- */

function returnsAndRefunds(window: number | null): LegalDocument {
  return {
    slug: 'returns-and-refunds',
    title: 'Returns and refunds',
    summary:
      'The inspection window on arrival, the six reasons a machine can go back, and why the obligation is ours.',
    version: 'v1.0',
    updated: FIRST_PUBLISHED,
    reconsentOnChange: true,
    sections: [
      {
        id: 'window',
        heading: 'The inspection window',
        body: (
          <>
            <p>
              You have <N value={window} unit="hours" /> from delivery to inspect every machine on an
              order and send back any that should not have been sent. The window opens when delivery
              is recorded against the consignment and it is counted by our server, on our clock, at
              both ends — your account shows the exact instant it closes and how many whole hours
              remain, so that a laptop with the wrong date on it cannot cost you a remedy you are
              owed or promise you one you are not.
            </p>
            <p>
              It is a window, not a countdown. We do not use the time remaining to hurry you, and a
              machine returned in the last hour is treated exactly as one returned in the first.
            </p>
            <p>
              The same number decides when we pay the supplier. A supply point&rsquo;s money does not
              become eligible for payout until your window on that machine has closed, which is why
              there is one figure here and not two.
            </p>
          </>
        ),
      },
      {
        id: 'ours',
        heading: 'The obligation is ours, and it is not delegable',
        body: (
          <>
            <p>
              Rule 7(4) of the Consumer Protection (e-Commerce) Rules, 2020 requires the seller to
              take back goods that are defective, deficient, or that do not match the description
              advertised. We are the seller on every order — see{' '}
              <Ref to="/legal/terms#model">the terms</Ref> — so that obligation is ours. We do not
              pass it to the supply point that shipped the machine, we do not condition it on the
              supply point agreeing, and there is nobody else for you to chase.
            </p>
            <p>
              Whatever we recover from a supplier afterwards is our business and not yours. It never
              appears in your return, and it never delays it.
            </p>
          </>
        ),
      },
      {
        id: 'reasons',
        heading: 'The six reasons',
        body: (
          <>
            <p>
              A return is raised against a specific machine, by serial, for one of these reasons.
              They are the same six the return form offers.
            </p>
            <List
              items={[
                <>
                  <strong>Not as described</strong> — the machine does not meet
                  the grade it was sold as. That grade is defined measurably in{' '}
                  <Ref to="/legal/grading">the grading standard</Ref>, so this is a comparison rather
                  than an opinion.
                </>,
                <>
                  <strong>Physical damage</strong> — damage that was not there
                  when we inspected and sealed it.
                </>,
                <>
                  <strong>Functional failure</strong> — the machine does not
                  work on arrival.
                </>,
                <>
                  <strong>Wrong model or specification</strong> — you were sent
                  something other than what you bought.
                </>,
                <>
                  <strong>Seal broken on arrival</strong> — see below.
                </>,
                <>
                  <strong>Short shipment</strong> — a machine on the consignment
                  did not arrive.
                </>,
              ]}
            />
          </>
        ),
      },
      {
        id: 'seal',
        heading: 'A broken seal opens a return by itself',
        body: (
          <>
            <p>
              Every machine leaves inspection under a numbered tamper seal that is photographed
              before it ships. When you receive a consignment you are asked to check each seal
              against its code. If you record a seal as broken, missing, or carrying a code that does
              not match, a return is opened on that machine immediately and automatically — one tap
              at the door, not a support call afterwards.
            </p>
            <p>
              A broken seal is a custody failure between the supply point and your door. It is
              deliberately a reason of its own rather than a kind of transit damage, because it
              decides who bears the loss, and that is ours to establish rather than yours to argue.
            </p>
          </>
        ),
      },
      {
        id: 'evidence',
        heading: 'What we ask you for',
        body: (
          <>
            <p>
              Two photographs for physical damage, and one photograph of the seal for a broken-seal
              claim. The other four reasons need none.
            </p>
            <p>
              There is presently no way to attach a photograph to the return form itself, so we ask
              for them by email after you raise it, and the return records how many are still
              outstanding. <strong>A return is never refused for want of a
              photograph you had no way to send us.</strong> When the form can take attachments this
              becomes a requirement at the point of raising, and the numbers above do not change.
            </p>
          </>
        ),
      },
      {
        id: 'what-happens',
        heading: 'What happens next',
        body: (
          <>
            <List
              items={[
                'One open return per machine. Raising a second while one is live is not possible, and a return that was rejected previously does not prevent a later one on the same machine.',
                'We collect the machine. Collection is at our cost, from the site it was delivered to.',
                'A return ends in one of four ways: refunded, replaced with an equivalent machine, returned to you because we did not accept it, or cancelled by you.',
                'A rejection always says which finding it turns on — the measurement or the photograph from the original inspection that contradicts the claim — rather than simply declining it.',
              ]}
            />
            <p>
              The route and timing of a refund to your account are not yet published. We would rather
              leave that blank than name a number of working days we are not yet in a position to
              hold to.
            </p>
            <p>
              <Unset what="Refund route and timing" />
            </p>
          </>
        ),
      },
      {
        id: 'after',
        heading: 'After the window closes',
        body: (
          <p>
            The machine is still covered. Once the inspection window has closed your remedy becomes a
            warranty claim rather than a return, on the term set out in{' '}
            <Ref to="/legal/warranty">the warranty</Ref>. A window that has closed is never the end of
            the conversation, and your account will route you to the claim rather than simply telling
            you that you are late.
          </p>
        ),
      },
    ],
  };
}

/* -------------------------------------------------------------------------- */

function warranty(topUp: number | null, floor: number | null): LegalDocument {
  return {
    slug: 'warranty',
    title: 'Warranty',
    summary:
      'How long each machine is covered, what is covered, and why you never need to know who stands behind which part of the term.',
    version: 'v1.0',
    updated: FIRST_PUBLISHED,
    reconsentOnChange: false,
    sections: [
      {
        id: 'warrantor',
        heading: 'We are the warrantor, for the whole term',
        body: (
          <>
            <p>
              {LEGAL_DISCLOSURE.legalName} provides the warranty on every machine sold here, for
              every day of its term. There is one warrantor and it is us.
            </p>
            <p>
              Internally, part of a term may be backed by the supply point the machine came from and
              part funded by us. That split is ours to manage and it is deliberately not on your
              warranty record — there is no field on it naming a provider, because there is no
              circumstance in which you would need one. A claim in the first month and a claim in the
              last month go to the same place and are settled the same way. If we recover the cost
              from a supplier afterwards, that happens after you have your machine back.
            </p>
          </>
        ),
      },
      {
        id: 'term',
        heading: 'How long',
        body: (
          <>
            <p>
              The term on a machine is the greater of two figures: what its supply point backs plus
              the months we add on top, or the floor we sell regardless.
            </p>
            <Facts
              rows={[
                ['Our top-up', <N value={topUp} unit="months" />],
                ['Minimum total term', <N value={floor} unit="months" />],
                [
                  'The term you get',
                  <span>
                    the greater of (supply point&rsquo;s months + top-up) and the minimum
                  </span>,
                ],
              ]}
            />
            <p>
              The floor is why a machine from a supply point that backs nothing is still covered.
              &ldquo;We have not agreed a top-up here&rdquo; is our problem and it never reaches you
              as &ldquo;no warranty&rdquo;. The exact term for a machine you own is on its record in
              your account, as one number, with the dates it runs between.
            </p>
          </>
        ),
      },
      {
        id: 'start',
        heading: 'When it starts',
        body: (
          <p>
            Cover begins on the day the machine is delivered to you, reckoned on the Indian calendar
            — not when you paid, and not when it left the supply point. A term that ran while the
            laptop was on a lorry would be a term we sold you and did not give you. Whether a machine
            is in warranty on a given day is decided by our server against that calendar, and your
            account shows the answer rather than asking your browser to work it out.
          </p>
        ),
      },
      {
        id: 'covers',
        heading: 'What is covered',
        body: (
          <>
            <List
              items={[
                'Any fault in the twelve areas we inspected, found within the term.',
                'Repair, part replacement or a replacement machine — our choice, at our cost.',
                'Collection from your site and return, both ways.',
              ]}
            />
            <p>
              The twelve areas are the ones on the inspection report for that serial, which you can
              open from the machine&rsquo;s record. A warranty that covered fewer things than we
              measured would be an odd document.
            </p>
          </>
        ),
      },
      {
        id: 'excludes',
        heading: 'What is not covered',
        body: (
          <List
            items={[
              'Accidental damage, liquid ingress and cosmetic wear after delivery.',
              'Consumables, and software you installed.',
              'A machine opened or repaired by anyone else — this breaks the seal we applied.',
            ]}
          />
        ),
      },
      {
        id: 'claims',
        heading: 'Making a claim',
        body: (
          <>
            <List
              items={[
                'Raise it from the machine’s record in your account. You need the serial, a description of the fault, and a site for collection.',
                'A claim is checked against the original inspection report for that serial. A fault in an area we measured as good is not automatically refused — the divergence is looked at, because our measurement can be the thing that was wrong.',
                'A refusal always names the finding it contradicts. We do not decline a claim without saying what it is we are relying on.',
                'A machine that is out of warranty is told so with the exact expiry date, and offered paid repair instead of simply being turned away.',
              ]}
            />
          </>
        ),
      },
    ],
  };
}

/* -------------------------------------------------------------------------- */

/**
 * `/legal/grading` — the r.7(5) liability document.
 *
 * Every threshold in the table is a live read of `catalog.grade_definition`,
 * the rows the QC engine grades against. Nothing here is retyped, which is the
 * only arrangement in which the published definition and the enforced one
 * cannot come apart.
 *
 * **Nothing on this page colours one grade worse than another.** A+, A and B are
 * all sellable and the palette rule is explicit that green and red mean PASS and
 * FAIL, not a position on a scale. The table is neutral ink throughout, and the
 * only amber on it is on the measured floors, which is what amber is for.
 */
function grading(grades: readonly GradeDefinition[] | null): LegalDocument {
  const table =
    grades === null || grades.length === 0 ? (
      <p className="lg-empty">
        The grade definitions could not be read just now, so they are not shown. This page prints the
        thresholds the inspection engine actually enforces or it prints nothing — a remembered table
        would be the one thing on this document that could be wrong.
      </p>
    ) : (
      // `.lg-table` scrolls a wide table inside its own container rather than
      // widening the document, and gives the grade its row header.
      <div className="lg-table">
        <table>
          <thead>
            <tr>
              <th scope="col">
                Grade
              </th>
              <th scope="col">
                Battery health, at least
              </th>
              <th scope="col">
                Charge cycles, at most
              </th>
              <th scope="col">
                Cosmetic score, at least
              </th>
              <th scope="col">
                Screen defects
              </th>
            </tr>
          </thead>
          <tbody>
            {grades.map((g) => (
              <tr key={g.grade}>
                <th scope="row">
                  {g.displayName}
                  <small>{g.customerDescription}</small>
                </th>
                <td>
                  <N value={g.minBatteryHealthPct} unit="%" absent="Not set" />
                </td>
                <td>
                  <N value={g.maxCycleCount} unit="cycles" absent="Not capped" />
                </td>
                <td>
                  <N value={g.minCosmeticScore} unit="/ 100" absent="Not set" />
                </td>
                <td>
                  {g.screenDefectsAllowed ? 'Permitted within the stated limits' : 'None permitted'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="dim">
          In effect since{' '}
          <span className="tnum">{grades[0]?.effectiveFrom ?? '—'}</span>. Read from the
          grade definitions the inspection engine uses, at the moment this page was rendered.
        </p>
      </div>
    );

  return {
    slug: 'grading',
    title: 'Grading standard',
    summary:
      'The objective definition of A+, A and B against measured inspection outputs — the standard any disagreement about condition is settled against.',
    version: 'v1.0',
    updated: FIRST_PUBLISHED,
    reconsentOnChange: true,
    sections: [
      {
        id: 'purpose',
        heading: 'What this document is',
        body: (
          <>
            <p>
              Rule 7(5) of the Consumer Protection (e-Commerce) Rules, 2020 requires a seller to
              ensure that the advertisement of goods is consistent with their actual characteristics.
              A grade is the shortest description we publish and it is the one most likely to be
              relied on, so this page defines each grade against measurements rather than adjectives.
            </p>
            <p>
              This is the standard a disagreement is settled against. If a machine does not meet the
              thresholds below for the grade it was sold as, it is not as described, and{' '}
              <Ref to="/legal/returns-and-refunds#reasons">that is a return</Ref>.
            </p>
          </>
        ),
      },
      {
        id: 'neutral',
        heading: 'Every grade here is sellable',
        body: (
          <p>
            A+, A and B are positions on a scale of cosmetic condition and battery life. They are not
            verdicts. Every machine we list has passed inspection, whatever its grade; a B is not a
            machine that failed, it is a machine with visible wear and an honest description of it.
            We do not list anything below B. Buy the grade that suits what the machine is for.
          </p>
        ),
      },
      {
        id: 'thresholds',
        heading: 'The thresholds',
        body: (
          <>
            <p>
              A machine is assigned the highest grade whose thresholds it meets on all counts. Every
              figure below is a measurement taken during inspection, not an assessment.
            </p>
            {table}
          </>
        ),
      },
      {
        id: 'how-measured',
        heading: 'How each figure is measured',
        body: (
          <List
            items={[
              'Battery health is the measured full-charge capacity as a percentage of the design capacity, read from the battery controller — not estimated from the machine’s age.',
              'Charge cycles are read from the same controller. A cell with high health and a very high cycle count is close to a decline you would notice, which is why the cap exists alongside the health floor.',
              'The cosmetic score is scored against a fixed schedule of surfaces and defect types — the count and length of scratches, the count and depth of dents, edge wear — rather than being a technician’s overall impression. The permitted defects for each grade are part of the definition and are held with the row above.',
              'Screen defects are treated separately from the cosmetic score, because a dead pixel is not a scratch and averaging the two would let one hide the other.',
            ]}
          />
        ),
      },
      {
        id: 'inspected-not-declared',
        heading: 'The grade is ours, not the supplier’s',
        body: (
          <p>
            A supplier declares a grade when they list a machine. That declaration is not what you
            see. Every grade shown anywhere on this site — on a product card, in a filter count, on
            an invoice — is the grade our inspection assigned after the machine was opened and
            measured. Where the two disagree, the inspected grade is what the machine is listed and
            sold as, and the difference is a matter between us and the supplier.
          </p>
        ),
      },
      {
        id: 'versioning',
        heading: 'Versions and effective dates',
        body: (
          <p>
            Grade definitions are effective-dated. A machine is graded against the definition in
            force on the day it was inspected, and its inspection report records which one that was.
            Changing the thresholds does not retrospectively re-grade machines already sold. If we
            change this standard we publish it here under a new version and a new date.
          </p>
        ),
      },
    ],
  };
}

/* -------------------------------------------------------------------------- */

function wipeStandard(): LegalDocument {
  return {
    slug: 'wipe-standard',
    title: 'Data wipe standard',
    summary:
      'What the inspection pipeline certifies about the erasure of a machine’s storage, and what it does not.',
    version: 'v1.0',
    updated: FIRST_PUBLISHED,
    reconsentOnChange: false,
    sections: [
      {
        id: 'standard',
        heading: 'The standard',
        body: (
          <>
            <p>
              Storage media are erased to <strong>NIST SP 800-88 Rev. 1,
              Purge</strong>, and the erasure is verified after it runs. Where the erasure completed
              and verified, a certificate is issued against the machine&rsquo;s serial and recorded
              with the inspection report.
            </p>
            <Facts
              rows={[
                ['Standard', <span className="tnum">NIST SP 800-88 Rev. 1 — Purge</span>],
                ['Passes', <N value={1} unit="pass" />],
                [
                  'Verification',
                  <span>
                    Recorded as a result on the certificate, not assumed from completion
                  </span>,
                ],
                [
                  'Integrity',
                  <span>
                    Each certificate carries a <span className="tnum">SHA-256</span> digest,
                    so a certificate that was altered after issue can be told from one that was not
                  </span>,
                ],
              ]}
            />
            <p>
              Purge, not Clear: the method is chosen to defeat a laboratory recovery attempt rather
              than only a software one. The media stay in the machine — we do not destroy or remove
              drives, so there is no certificate of destruction and this is not that document.
            </p>
          </>
        ),
      },
      {
        id: 'absent',
        heading: 'Not every machine has a certificate',
        body: (
          <>
            <p>
              Some machines in the catalogue have no wipe certificate. Where one is absent, the
              machine&rsquo;s inspection record says so in plain words and shows no tick. Do not read
              a blank as a pass.
            </p>
            <p>
              If a certificate matters for a particular purchase — and for most corporate buyers it
              does — check the record for the serial before you order, or ask us. We would rather
              tell you a machine has not been certified than issue you a certificate for a run that
              did not happen.
            </p>
          </>
        ),
      },
      {
        id: 'what-we-do-not-certify',
        heading: 'What we do not certify',
        body: (
          <>
            <List
              items={[
                'What was on the machine before it reached the supply point. Suppliers give us an undertaking that every machine is wiped to a recognised standard before it leaves them and that they can produce their own erasure report for any serial we ask about. That is their undertaking; the certificate we issue covers the erasure we performed and verified.',
                'Anything about a machine after it leaves us. Once you have it, what is written to it is yours.',
                'Data on media we did not touch — an external drive, a memory card left in a reader. The certificate names the machine’s serial and covers its internal storage.',
              ]}
            />
            <p>
              Every certificate is tied to one serial. It is not a statement about a batch, a model
              or a supplier, and it cannot be read as one.
            </p>
          </>
        ),
      },
    ],
  };
}

/* -------------------------------------------------------------------------- */

function shipping(): LegalDocument {
  return {
    slug: 'shipping',
    title: 'Shipping and delivery',
    summary:
      'How an order is split, how it moves, what is recorded at handover, and what we do not yet offer.',
    version: 'v1.0',
    updated: FIRST_PUBLISHED,
    reconsentOnChange: false,
    sections: [
      {
        id: 'movement',
        heading: 'One movement, one seller',
        body: (
          <p>
            A machine goes directly from the supply point that holds it to your delivery address.
            There is one physical movement and there are two supplies: the supplier sells to us, and
            we sell to you. You are party to the second. The goods never pass through premises of
            ours, which is why the city on your invoice is a supply point&rsquo;s and not a
            warehouse of ours.
          </p>
        ),
      },
      {
        id: 'consignments',
        heading: 'How an order is split',
        body: (
          <>
            <p>
              An order becomes one or more consignments, split on two things:
            </p>
            <List
              items={[
                'The supply point holding each machine. Machines at different supply points cannot travel together.',
                'The tax valuation channel each machine falls into. Machines in different channels cannot share an invoice at all — see the pricing and taxes document.',
              ]}
            />
            <p>
              Each consignment is delivered and tracked on its own, and each has its own inspection
              window opening from its own delivery.
            </p>
          </>
        ),
      },
      {
        id: 'handover',
        heading: 'At handover',
        body: (
          <>
            <p>
              Every machine arrives under a numbered tamper seal that was photographed at inspection.
              Check each seal against its printed code before you sign for the consignment. Your
              account has the seal codes for the machines on it.
            </p>
            <p>
              Recording a seal as broken or mismatched opens a return on that machine immediately —
              see <Ref to="/legal/returns-and-refunds#seal">returns and refunds</Ref>. Delivery is
              also the instant that starts your inspection window and your warranty term, so it is
              recorded once, by us, against the consignment.
            </p>
          </>
        ),
      },
      {
        id: 'freight',
        heading: 'Freight and documentation',
        body: (
          <List
            items={[
              'Freight is charged on the invoice and forms part of the taxable value of the supply. It is shown as its own line before you pay, and it depends on the delivery pincode.',
              'Where a consignment’s value requires one, an e-way bill is generated. The threshold is strictly more than ₹50,000 — a consignment of exactly ₹50,000.00 does not need one.',
              'Serviceability and an estimated delivery time are shown against your pincode before you order. We would rather tell you a pincode is not served than take an order we cannot deliver.',
            ]}
          />
        ),
      },
      {
        id: 'not-yet',
        heading: 'What we do not offer yet',
        body: (
          <>
            <p>
              We do not issue carrier tracking numbers, and there is no live tracking map. Delivery is
              recorded against your order when it happens and you are notified then. We are not going
              to describe a tracking experience that does not exist.
            </p>
            <p>
              Committed delivery times by lane have not been published either. Your order shows an
              estimate against your pincode; that estimate is an estimate, and we do not currently
              publish a guaranteed window.
            </p>
            <p>
              <Unset what="Committed delivery times" />
            </p>
          </>
        ),
      },
    ],
  };
}

/* -------------------------------------------------------------------------- */

function cancellation(window: number | null): LegalDocument {
  return {
    slug: 'cancellation',
    title: 'Cancellation',
    summary:
      'What you can cancel and when — before checkout completes, while an approval is outstanding, and after an order is confirmed.',
    version: 'v1.0',
    updated: FIRST_PUBLISHED,
    reconsentOnChange: false,
    sections: [
      {
        id: 'before',
        heading: 'Before you confirm',
        body: (
          <>
            <p>
              Starting a checkout holds the specific machines in your cart for a short period so
              nobody else is sold them while you are paying. The hold is shown on the checkout screen
              and counted by our server. Abandoning the checkout releases the machines back to the
              catalogue immediately; letting the hold lapse does the same thing a little later.
              Nothing is owed either way and no order exists.
            </p>
            <p>
              Where your organisation requires an internal approval, the machines are held while it is
              outstanding, for a longer period. Stock cannot be held indefinitely waiting for a
              manager, so if the approval is not given the hold lapses and the machines return to the
              catalogue. If your approver rejects it, the order is cancelled in full at that point and
              no contract is formed.
            </p>
          </>
        ),
      },
      {
        id: 'after',
        heading: 'After the order is confirmed',
        body: (
          <>
            <p>
              There is no self-serve cancellation once an order is confirmed. That is a genuine gap
              rather than a policy: no such control exists on the site today, and we are not going to
              write a clause describing a button you cannot press. Write to customer care with your
              order number and we will deal with it by hand.
            </p>
            <p>
              A confirmed order is one we have already bought the machines for from the supply point,
              which is why cancellation after that point is a conversation rather than a click.
            </p>
          </>
        ),
      },
      {
        id: 'after-delivery',
        heading: 'After delivery, cancellation is a return',
        body: (
          <p>
            Once a machine has been delivered, the route is the inspection window rather than a
            cancellation: <N value={window} unit="hours" /> from delivery to send it back for any of
            six stated reasons, and{' '}
            <Ref to="/legal/returns-and-refunds">returns and refunds</Ref> sets out how. We do not
            offer an open change-of-mind return outside that window, and we do not claim to.
          </p>
        ),
      },
      {
        id: 'money',
        heading: 'Money',
        body: (
          <>
            <p>
              Orders are prepaid. Credit terms are not offered on this platform today, so a
              cancellation is always a question of returning money you have already paid rather than
              of cancelling an amount you owe.
            </p>
            <p>
              The route and timing of that return are not yet published, for the same reason they are
              not published on the returns page.
            </p>
            <p>
              <Unset what="Refund route and timing" />
            </p>
          </>
        ),
      },
    ],
  };
}

/* -------------------------------------------------------------------------- */

/**
 * `/legal/pricing-and-taxes`.
 *
 * The margin-scheme section is the one that had to be written against
 * `marginTaxableValue` and `resolveTaxSplit` rather than from memory of how
 * Rule 32(5) usually works. Two details are easy to state differently from the
 * code and both matter: the margin is computed **per serial and never pooled**,
 * and a loss-making serial contributes **zero rather than a negative**. Restate
 * either one loosely and the document describes a different tax computation
 * from the one the invoice was built by.
 */
function pricingAndTaxes(): LegalDocument {
  return {
    slug: 'pricing-and-taxes',
    title: 'Pricing and taxes',
    summary:
      'How a landed price is built, which tax head applies, and how the margin scheme changes the input tax credit available to you.',
    version: 'v1.0',
    updated: FIRST_PUBLISHED,
    reconsentOnChange: false,
    sections: [
      {
        id: 'price',
        heading: 'What a price includes',
        body: (
          <>
            <p>
              Prices are per machine and are exclusive of GST unless a page says otherwise. The
              landed price of an order is the unit price for each serial, plus freight, plus tax, and
              it depends on where you are taking delivery — so a price is only complete once a
              delivery pincode is known.
            </p>
            <Facts
              rows={[
                ['Our GSTIN', <span className="tnum">{LEGAL_DISCLOSURE.gstin}</span>],
                [
                  'GST rate',
                  <>
                    <N value={18} unit="%" /> on HSN{' '}
                    <span className="tnum">8471</span>, under Notification 1/2017-Central
                    Tax (Rate), Schedule III
                  </>,
                ],
                ['E-invoicing', <Unset what="IRN and QR generation" />],
              ]}
            />
          </>
        ),
      },
      {
        id: 'place-of-supply',
        heading: 'Which tax head applies',
        body: (
          <>
            <p>
              For our supply to you, the place of supply is where the movement of the goods
              terminates — that is,{' '}
              <strong>your delivery address, not your billing address</strong>.
              A buyer registered in one state taking delivery at a site in another is an inter-state
              supply, and the invoice carries IGST accordingly.
            </p>
            <List
              items={[
                <>
                  Delivery in the same state as our registration —{' '}
                  <span className="tnum">CGST + SGST</span>, half the rate each.
                </>,
                <>
                  Delivery anywhere else — <span className="tnum">IGST</span> at the full
                  rate.
                </>,
                <>
                  Delivery in a Union Territory — the state half is styled{' '}
                  <span className="tnum">UTGST</span>. The rate and the arithmetic are
                  identical.
                </>,
              ]}
            />
            <p>
              Where the tax is split in half, the second half is computed as the total minus the
              first rather than by taking the half-rate twice. That is not pedantry: rounding a half
              twice loses a paisa on every odd total, and across a long order it produces an invoice
              whose heads do not add up to its tax.
            </p>
          </>
        ),
      },
      {
        id: 'two-channels',
        heading: 'Two valuation channels, never on one invoice',
        body: (
          <>
            <p>
              Every machine is bought by us in one of two ways, and this is fixed for that machine
              from the moment we buy it. It cannot be changed afterwards.
            </p>
            <List
              items={[
                <>
                  <strong>Regular</strong> — we bought the machine from a
                  GST-registered supplier who charged us tax, and we claimed that credit. Tax on your
                  invoice is charged on the full value of the supply.
                </>,
                <>
                  <strong>Margin</strong> — the machine was bought under the
                  second-hand goods margin scheme, and no input tax credit was availed on its
                  purchase. Tax on your invoice is charged on our margin only.
                </>,
              ]}
            />
            <p>
              The two cannot appear on the same invoice, so a cart holding both is split into
              separate sub-orders and you receive an invoice for each. This is visible before you pay
              rather than discovered afterwards, and every machine on the site is labelled with its
              channel before you add it to a cart.
            </p>
          </>
        ),
      },
      {
        id: 'itc',
        heading: 'How the margin scheme affects your input tax credit',
        body: (
          <>
            <p>
              This is the part that changes what a machine actually costs your business, so it is
              worth reading before you compare two prices.
            </p>
            <p>
              On a <strong>regular</strong> line, tax is charged on the whole
              taxable value and you may claim that tax as input credit in the ordinary way, subject to
              your own eligibility.
            </p>
            <p>
              On a <strong>margin</strong> line, the taxable value is determined
              under Rule 32(5) of the CGST Rules, 2017: it is the difference between what we sold the
              machine for and what we paid for it. That difference is computed{' '}
              <strong>for each serial individually and is never pooled</strong>{' '}
              across a line or an invoice — the scheme requires the margin to be attributable to a
              specific unit. Where we sold a machine for less than we paid, that serial contributes a
              taxable value of zero; it never goes negative and never reduces the tax on another
              serial.
            </p>
            <p>
              Because no credit was availed on the purchase,{' '}
              <strong>no input tax credit is available to you on a margin
              line</strong>. The tax charged is smaller, and so is the credit — which for a
              GST-registered buyer usually means a margin machine costs more in net terms than its
              headline price suggests next to a regular one. Both numbers are on the price breakdown
              before you add anything to a cart, and the invoice states it on its face:
            </p>
            <Verbatim>
              &ldquo;Value determined under Rule 32(5) of the CGST Rules, 2017. No input tax credit
              availed on purchase.&rdquo;
            </Verbatim>
          </>
        ),
      },
      {
        id: 'invoice',
        heading: 'Your invoice',
        body: (
          <>
            <List
              items={[
                'One invoice per sub-order, issued by us. Every serial on it is listed individually.',
                'Invoice numbers are allocated in a gapless per-series sequence scoped to the financial year.',
                'Freight is part of the taxable value rather than a tax-free addition.',
                'We do not currently generate an Invoice Reference Number or the associated QR code. When e-invoicing is switched on, invoices will carry both.',
              ]}
            />
          </>
        ),
      },
      {
        id: 'suppliers',
        heading: 'For suppliers',
        body: (
          <p>
            Where tax is deductible at source on payments we make to a supplier, it is deducted at
            the applicable rate once that supplier&rsquo;s payments cross the statutory threshold for
            the financial year, and at the higher rate where we do not hold a valid PAN. The
            deduction and the threshold are shown on the supplier&rsquo;s own payables screen against
            each payment, rather than appearing as a difference at the end of the year.
          </p>
        ),
      },
    ],
  };
}
