import type { Route } from 'next';
import Link from 'next/link';
import { BRAND, LEGAL_DISCLOSURE } from '@trugrade/config/brand';
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
  if (value === null) return <span className="text-ink-4">{absent}</span>;
  return (
    <span className="tnum text-ink">
      {value}
      {unit ? <span className="text-ink-4">&nbsp;{unit}</span> : null}
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
    <span className="tnum rounded-xs border border-dashed border-rule px-2 py-[1px] text-ink-4">
      {what} — not yet published
    </span>
  );
}

/** An internal cross-reference. Legal documents refer to each other constantly. */
function Ref({ to, children }: { to: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <Link
      href={to as Route}
      className="text-ink underline decoration-rule underline-offset-4 hover:decoration-acc"
    >
      {children}
    </Link>
  );
}

/** A definition list — the shape most of these documents actually want. */
function Facts({
  rows,
}: {
  rows: ReadonlyArray<readonly [string, React.ReactNode]>;
}): React.JSX.Element {
  return (
    <dl className="mt-4 grid grid-cols-1 gap-x-5 gap-y-3 sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)]">
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-body-sm text-ink-3">{term}</dt>
          <dd className="text-body text-ink-2">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A plain bulleted list. Used for coverage, exclusions and reason codes. */
function List({ items }: { items: ReadonlyArray<React.ReactNode> }): React.JSX.Element {
  return (
    <ul className="mt-3 flex flex-col gap-2">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3 text-body text-ink-2">
          <span aria-hidden className="mt-[9px] h-px w-3 shrink-0 bg-rule" />
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** A quoted statutory or contractual sentence, reproduced exactly. */
function Verbatim({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <p className="mt-4 border-l-2 border-rule bg-sheet-2 px-4 py-3 text-body-sm text-ink-2">
      {children}
    </p>
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
      <p className="text-body text-ink-2">
        {BRAND.name} is a brand of {LEGAL_DISCLOSURE.legalName}. Whatever you buy on this
        marketplace, the seller is {LEGAL_DISCLOSURE.legalName} — not a supplier, not an agent, and
        not a third party we introduced you to. There is one seller, one contract and one invoice.
      </p>
      <Facts
        rows={[
          ['Legal name', LEGAL_DISCLOSURE.legalName],
          ['Brand', `${BRAND.name} · ${LEGAL_DISCLOSURE.website}`],
          ['GSTIN', <span className="tnum text-ink">{LEGAL_DISCLOSURE.gstin}</span>],
          [
            'CIN',
            LEGAL_DISCLOSURE.cin ? (
              <span className="tnum text-ink">{LEGAL_DISCLOSURE.cin}</span>
            ) : (
              <Unset what="CIN" />
            ),
          ],
          [
            'Registered office',
            <>
              <Unset what="Street address" />
              <span className="tnum ml-2 text-ink-2">
                {LEGAL_DISCLOSURE.registeredOffice.city}, {LEGAL_DISCLOSURE.registeredOffice.state}{' '}
                {LEGAL_DISCLOSURE.registeredOffice.pincode}
              </span>
            </>,
          ],
          [
            'Branches',
            LEGAL_DISCLOSURE.branches.length === 0 ? (
              <span className="text-ink-3">
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
                className="text-ink underline decoration-rule underline-offset-4 hover:decoration-acc"
                href={`mailto:${LEGAL_DISCLOSURE.customerCare.email}`}
              >
                {LEGAL_DISCLOSURE.customerCare.email}
              </a>
              {LEGAL_DISCLOSURE.customerCare.phone ? (
                <span className="tnum ml-2 text-ink">{LEGAL_DISCLOSURE.customerCare.phone}</span>
              ) : (
                <span className="ml-2">
                  <Unset what="Telephone" />
                </span>
              )}
              <span className="ml-2 text-ink-3">{LEGAL_DISCLOSURE.customerCare.hours}</span>
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
            <p className="text-body text-ink-2">
              We operate as principal and merchant of record on a back-to-back basis. We do not hold
              inventory. At the moment you order a particular machine we buy that serial from the
              supplier who holds it and sell it to you on our own invoice; the machine then ships
              directly from the supplier&rsquo;s premises to your delivery address. One physical
              movement, two supplies, and the one you are party to is ours.
            </p>
            <p className="mt-4 text-body text-ink-2">
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
            <p className="text-body text-ink-2">
              Suppliers appear throughout the site as supply points — <em>Supply Point A —
              Gurugram</em> — with a city and a track record, and never by name. We do not disclose
              which business holds a machine, before or after you buy it. Their identity is not
              withheld from you to your disadvantage: because we are the seller, it is not a fact you
              need in order to enforce anything.
            </p>
            <p className="mt-4 text-body text-ink-2">
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
            <p className="text-body text-ink-2">
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
            <p className="text-body text-ink-2">
              Refurbished laptops, and only refurbished laptops. Desktops, monitors and parts are
              marked as coming and are not sold today. Every machine is a specific, individually
              identified unit — a serial or service tag — that has been physically opened, tested and
              graded before it was listed. You are buying that unit, not a model number.
            </p>
            <p className="mt-4 text-body text-ink-2">
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
            <p className="mt-4 text-body text-ink-2">
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
            <p className="text-body text-ink-2">
              Three separate remedies, in the order they become available. They do not replace your
              rights in law; they are what we undertake to do.
            </p>
            <List
              items={[
                <>
                  <strong className="text-ink">On arrival</strong> — an inspection window of{' '}
                  <N value={window} unit="hours" /> from delivery, during which you may send a
                  machine back for any of six stated reasons. See{' '}
                  <Ref to="/legal/returns-and-refunds">returns and refunds</Ref>.
                </>,
                <>
                  <strong className="text-ink">After that window</strong> — warranty cover, which we
                  provide ourselves for its whole term. See{' '}
                  <Ref to="/legal/warranty">the warranty</Ref>.
                </>,
                <>
                  <strong className="text-ink">At any time</strong> — the grievance procedure, with a
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
            <p className="text-body text-ink-2">
              This document carries a version number and a date, both shown at the top of the page.
              When it changes we publish it here under a new version number and a new date. We do not
              change a published document silently.
            </p>
            <p className="mt-4 text-body text-ink-2">
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
            <p className="text-body text-ink-2">
              These terms are governed by the laws of India.
            </p>
            <p className="mt-4 text-body text-ink-2">
              The forum for disputes and any arbitration clause have not been settled and are not
              stated here. We will not assert a jurisdiction we have not published.
            </p>
            <p className="mt-3">
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
            <p className="text-body text-ink-2">
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
                    className="text-ink underline decoration-rule underline-offset-4 hover:decoration-acc"
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
            <p className="text-body text-ink-2">
              Consent under the DPDP Act is purpose-specific. Blanket consent is not consent, so we
              record each of these separately and you may hold some and not others. These are the
              exact six purposes the platform recognises.
            </p>
            <List
              items={[
                <>
                  <strong className="text-ink">Verifying who you are</strong> — checking your GSTIN,
                  PAN and documents against the issuing authorities so that an account can be
                  approved.
                </>,
                <>
                  <strong className="text-ink">Messages about your transactions</strong> — order
                  confirmations, delivery notifications, invoices, return and claim updates.
                </>,
                <>
                  <strong className="text-ink">Marketing</strong> — stock alerts, offers and
                  newsletters.
                </>,
                <>
                  <strong className="text-ink">WhatsApp</strong> — receiving any of the above on
                  WhatsApp rather than only by email.
                </>,
                <>
                  <strong className="text-ink">Credit assessment</strong> — where credit terms are
                  requested. Credit is not offered today, so this purpose is not currently used.
                </>,
                <>
                  <strong className="text-ink">Sharing with logistics providers</strong> — passing a
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
            <p className="text-body text-ink-2">
              You may withdraw any of the consents above. Write to the address in{' '}
              <Ref to="/legal/grievance">grievance redressal</Ref> naming the purpose you are
              withdrawing.
            </p>
            <p className="mt-4 text-body text-ink-2">
              Two things about withdrawal that are worth being plain about. First, withdrawing a
              consent does not delete the record that you once gave it — that record is the evidence
              that we had a lawful basis at the time, and it is kept, stamped with the moment you
              withdrew. Second, withdrawal is one-way: we cannot un-withdraw a consent, so restoring
              it means giving it again.
            </p>
            <p className="mt-4 text-body text-ink-2">
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
            <p className="text-body text-ink-2">
              Tax records — invoices and the transaction data behind them — are retained for the
              period the GST law requires, which is presently six years from the due date of the
              annual return for the relevant year. Consent records are retained for as long as the
              account exists, because a consent artefact that can be deleted is not evidence of
              consent.
            </p>
            <p className="mt-4 text-body text-ink-2">
              A full retention schedule for everything else — onboarding documents, verification
              responses, audit logs — has not been settled and is not published here. We will not
              publish a period we are not yet enforcing.
            </p>
            <p className="mt-3">
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
            <p className="text-body text-ink-2">
              Under the DPDP Act you may ask for a summary of the personal data we hold about you and
              how it is processed; ask us to correct or complete it; ask us to erase it where we no
              longer need it for the purpose it was collected for or to meet a legal obligation; and
              nominate someone to exercise these rights if you cannot.
            </p>
            <p className="mt-4 text-body text-ink-2">
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
  return {
    slug: 'grievance',
    title: 'Grievance redressal',
    summary:
      'The grievance officer required by Rule 4(5) of the Consumer Protection (e-Commerce) Rules 2020, and the times we answer in.',
    version: 'v1.0',
    updated: FIRST_PUBLISHED,
    reconsentOnChange: false,
    sections: [
      {
        id: 'officer',
        heading: 'The grievance officer',
        body: (
          <>
            <p className="text-body text-ink-2">
              Rule 4(5) of the Consumer Protection (e-Commerce) Rules, 2020 requires us to appoint a
              grievance officer resident in India and to publish their name, designation and contact
              details. The appointment has not been made. We are not going to print a name here
              before there is a person behind it, because a customer with a problem would spend their
              attempt on it.
            </p>
            <Facts
              rows={[
                ['Name', <Unset what="Officer name" />],
                ['Designation', LEGAL_DISCLOSURE.grievanceOfficer.designation],
                [
                  'Email',
                  <a
                    className="text-ink underline decoration-rule underline-offset-4 hover:decoration-acc"
                    href={`mailto:${LEGAL_DISCLOSURE.grievanceOfficer.email}`}
                  >
                    {LEGAL_DISCLOSURE.grievanceOfficer.email}
                  </a>,
                ],
                [
                  'Telephone',
                  LEGAL_DISCLOSURE.grievanceOfficer.phone ? (
                    <span className="tnum text-ink">{LEGAL_DISCLOSURE.grievanceOfficer.phone}</span>
                  ) : (
                    <Unset what="Telephone" />
                  ),
                ],
                ['Address', <Unset what="Postal address" />],
              ]}
            />
            <p className="mt-5 text-body text-ink-2">
              Until the appointment is made, the email address above is monitored and a grievance
              sent to it is treated as a grievance under this policy, on the times below.
            </p>
          </>
        ),
      },
      {
        id: 'times',
        heading: 'How quickly we answer',
        body: (
          <>
            <Facts
              rows={[
                [
                  'Acknowledgement',
                  <>
                    Within <N value={ackHours} unit="hours" /> of receipt
                  </>,
                ],
                [
                  'Resolution',
                  <>
                    Within <N value={redressDays} unit="days" /> of receipt
                  </>,
                ],
              ]}
            />
            <p className="mt-5 text-body text-ink-2">
              Both figures are read from the platform&rsquo;s own configuration when this page is
              rendered, so what is published here is what the business is set up to do rather than a
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
            <List
              items={[
                'Email the address above. Include your order number, and the serial number of the machine if the grievance is about a particular one — every machine we sell has one and it is on your invoice.',
                'Tell us what you want to happen. A return, a replacement, a refund, a correction to a record, an explanation.',
                'You do not need to have raised a return or a claim first. A grievance is not an escalation of those; it is a separate route and it is always open.',
              ]}
            />
            <p className="mt-4 text-body text-ink-2">
              If your complaint is about a specific machine arriving in the wrong condition, the
              faster route is usually the inspection window in{' '}
              <Ref to="/legal/returns-and-refunds">returns and refunds</Ref>, which is a decision we
              make against a published standard rather than a conversation.
            </p>
          </>
        ),
      },
      {
        id: 'escalation',
        heading: 'If we do not resolve it',
        body: (
          <p className="text-body text-ink-2">
            You may take a consumer complaint to the National Consumer Helpline or file it on the
            e-Daakhil portal operated by the Department of Consumer Affairs. Nothing in this policy
            limits that, and using our procedure first is not a condition of it.
          </p>
        ),
      },
    ],
  };
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
            <p className="text-body text-ink-2">
              You have <N value={window} unit="hours" /> from delivery to inspect every machine on an
              order and send back any that should not have been sent. The window opens when delivery
              is recorded against the consignment and it is counted by our server, on our clock, at
              both ends — your account shows the exact instant it closes and how many whole hours
              remain, so that a laptop with the wrong date on it cannot cost you a remedy you are
              owed or promise you one you are not.
            </p>
            <p className="mt-4 text-body text-ink-2">
              It is a window, not a countdown. We do not use the time remaining to hurry you, and a
              machine returned in the last hour is treated exactly as one returned in the first.
            </p>
            <p className="mt-4 text-body text-ink-2">
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
            <p className="text-body text-ink-2">
              Rule 7(4) of the Consumer Protection (e-Commerce) Rules, 2020 requires the seller to
              take back goods that are defective, deficient, or that do not match the description
              advertised. We are the seller on every order — see{' '}
              <Ref to="/legal/terms#model">the terms</Ref> — so that obligation is ours. We do not
              pass it to the supply point that shipped the machine, we do not condition it on the
              supply point agreeing, and there is nobody else for you to chase.
            </p>
            <p className="mt-4 text-body text-ink-2">
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
            <p className="text-body text-ink-2">
              A return is raised against a specific machine, by serial, for one of these reasons.
              They are the same six the return form offers.
            </p>
            <List
              items={[
                <>
                  <strong className="text-ink">Not as described</strong> — the machine does not meet
                  the grade it was sold as. That grade is defined measurably in{' '}
                  <Ref to="/legal/grading">the grading standard</Ref>, so this is a comparison rather
                  than an opinion.
                </>,
                <>
                  <strong className="text-ink">Physical damage</strong> — damage that was not there
                  when we inspected and sealed it.
                </>,
                <>
                  <strong className="text-ink">Functional failure</strong> — the machine does not
                  work on arrival.
                </>,
                <>
                  <strong className="text-ink">Wrong model or specification</strong> — you were sent
                  something other than what you bought.
                </>,
                <>
                  <strong className="text-ink">Seal broken on arrival</strong> — see below.
                </>,
                <>
                  <strong className="text-ink">Short shipment</strong> — a machine on the consignment
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
            <p className="text-body text-ink-2">
              Every machine leaves inspection under a numbered tamper seal that is photographed
              before it ships. When you receive a consignment you are asked to check each seal
              against its code. If you record a seal as broken, missing, or carrying a code that does
              not match, a return is opened on that machine immediately and automatically — one tap
              at the door, not a support call afterwards.
            </p>
            <p className="mt-4 text-body text-ink-2">
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
            <p className="text-body text-ink-2">
              Two photographs for physical damage, and one photograph of the seal for a broken-seal
              claim. The other four reasons need none.
            </p>
            <p className="mt-4 text-body text-ink-2">
              There is presently no way to attach a photograph to the return form itself, so we ask
              for them by email after you raise it, and the return records how many are still
              outstanding. <strong className="text-ink">A return is never refused for want of a
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
            <p className="mt-4 text-body text-ink-2">
              The route and timing of a refund to your account are not yet published. We would rather
              leave that blank than name a number of working days we are not yet in a position to
              hold to.
            </p>
            <p className="mt-3">
              <Unset what="Refund route and timing" />
            </p>
          </>
        ),
      },
      {
        id: 'after',
        heading: 'After the window closes',
        body: (
          <p className="text-body text-ink-2">
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
            <p className="text-body text-ink-2">
              {LEGAL_DISCLOSURE.legalName} provides the warranty on every machine sold here, for
              every day of its term. There is one warrantor and it is us.
            </p>
            <p className="mt-4 text-body text-ink-2">
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
            <p className="text-body text-ink-2">
              The term on a machine is the greater of two figures: what its supply point backs plus
              the months we add on top, or the floor we sell regardless.
            </p>
            <Facts
              rows={[
                ['Our top-up', <N value={topUp} unit="months" />],
                ['Minimum total term', <N value={floor} unit="months" />],
                [
                  'The term you get',
                  <span className="text-ink-2">
                    the greater of (supply point&rsquo;s months + top-up) and the minimum
                  </span>,
                ],
              ]}
            />
            <p className="mt-5 text-body text-ink-2">
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
          <p className="text-body text-ink-2">
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
            <p className="mt-4 text-body text-ink-2">
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
      <p className="mt-4 rounded border border-dashed border-rule px-4 py-5 text-body text-ink-3">
        The grade definitions could not be read just now, so they are not shown. This page prints the
        thresholds the inspection engine actually enforces or it prints nothing — a remembered table
        would be the one thing on this document that could be wrong.
      </p>
    ) : (
      // `legaltbl` re-settles the global data-board table for a row-header
      // layout — see the block at the end of `storefront.css`. `overflow-x-auto`
      // keeps a wide table scrolling inside its own container rather than
      // widening the document.
      <div className="legaltbl mt-4 overflow-x-auto">
        <table className="w-full border-collapse text-body-sm">
          <thead>
            <tr className="border-b border-rule text-left">
              <th scope="col" className="py-3 pr-4 font-medium text-ink-3">
                Grade
              </th>
              <th scope="col" className="py-3 pr-4 font-medium text-ink-3">
                Battery health, at least
              </th>
              <th scope="col" className="py-3 pr-4 font-medium text-ink-3">
                Charge cycles, at most
              </th>
              <th scope="col" className="py-3 pr-4 font-medium text-ink-3">
                Cosmetic score, at least
              </th>
              <th scope="col" className="py-3 font-medium text-ink-3">
                Screen defects
              </th>
            </tr>
          </thead>
          <tbody>
            {grades.map((g) => (
              <tr key={g.grade} className="border-b border-rule-2 align-top">
                <th scope="row" className="py-4 pr-4 text-left font-semibold text-ink">
                  {g.displayName}
                  <span className="mt-1 block max-w-[38ch] text-body-sm font-normal text-ink-3">
                    {g.customerDescription}
                  </span>
                </th>
                <td className="py-4 pr-4">
                  <N value={g.minBatteryHealthPct} unit="%" absent="Not set" />
                </td>
                <td className="py-4 pr-4">
                  <N value={g.maxCycleCount} unit="cycles" absent="Not capped" />
                </td>
                <td className="py-4 pr-4">
                  <N value={g.minCosmeticScore} unit="/ 100" absent="Not set" />
                </td>
                <td className="py-4 text-ink-2">
                  {g.screenDefectsAllowed ? 'Permitted within the stated limits' : 'None permitted'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-body-sm text-ink-3">
          In effect since{' '}
          <span className="tnum text-ink-2">{grades[0]?.effectiveFrom ?? '—'}</span>. Read from the
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
            <p className="text-body text-ink-2">
              Rule 7(5) of the Consumer Protection (e-Commerce) Rules, 2020 requires a seller to
              ensure that the advertisement of goods is consistent with their actual characteristics.
              A grade is the shortest description we publish and it is the one most likely to be
              relied on, so this page defines each grade against measurements rather than adjectives.
            </p>
            <p className="mt-4 text-body text-ink-2">
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
          <p className="text-body text-ink-2">
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
            <p className="text-body text-ink-2">
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
          <p className="text-body text-ink-2">
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
          <p className="text-body text-ink-2">
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
            <p className="text-body text-ink-2">
              Storage media are erased to <strong className="text-ink">NIST SP 800-88 Rev. 1,
              Purge</strong>, and the erasure is verified after it runs. Where the erasure completed
              and verified, a certificate is issued against the machine&rsquo;s serial and recorded
              with the inspection report.
            </p>
            <Facts
              rows={[
                ['Standard', <span className="tnum text-ink">NIST SP 800-88 Rev. 1 — Purge</span>],
                ['Passes', <N value={1} unit="pass" />],
                [
                  'Verification',
                  <span className="text-ink-2">
                    Recorded as a result on the certificate, not assumed from completion
                  </span>,
                ],
                [
                  'Integrity',
                  <span className="text-ink-2">
                    Each certificate carries a <span className="tnum text-ink">SHA-256</span> digest,
                    so a certificate that was altered after issue can be told from one that was not
                  </span>,
                ],
              ]}
            />
            <p className="mt-5 text-body text-ink-2">
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
            <p className="text-body text-ink-2">
              Some machines in the catalogue have no wipe certificate. Where one is absent, the
              machine&rsquo;s inspection record says so in plain words and shows no tick. Do not read
              a blank as a pass.
            </p>
            <p className="mt-4 text-body text-ink-2">
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
            <p className="mt-4 text-body text-ink-2">
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
          <p className="text-body text-ink-2">
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
            <p className="text-body text-ink-2">
              An order becomes one or more consignments, split on two things:
            </p>
            <List
              items={[
                'The supply point holding each machine. Machines at different supply points cannot travel together.',
                'The tax valuation channel each machine falls into. Machines in different channels cannot share an invoice at all — see the pricing and taxes document.',
              ]}
            />
            <p className="mt-4 text-body text-ink-2">
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
            <p className="text-body text-ink-2">
              Every machine arrives under a numbered tamper seal that was photographed at inspection.
              Check each seal against its printed code before you sign for the consignment. Your
              account has the seal codes for the machines on it.
            </p>
            <p className="mt-4 text-body text-ink-2">
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
            <p className="text-body text-ink-2">
              We do not issue carrier tracking numbers, and there is no live tracking map. Delivery is
              recorded against your order when it happens and you are notified then. We are not going
              to describe a tracking experience that does not exist.
            </p>
            <p className="mt-4 text-body text-ink-2">
              Committed delivery times by lane have not been published either. Your order shows an
              estimate against your pincode; that estimate is an estimate, and we do not currently
              publish a guaranteed window.
            </p>
            <p className="mt-3">
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
            <p className="text-body text-ink-2">
              Starting a checkout holds the specific machines in your cart for a short period so
              nobody else is sold them while you are paying. The hold is shown on the checkout screen
              and counted by our server. Abandoning the checkout releases the machines back to the
              catalogue immediately; letting the hold lapse does the same thing a little later.
              Nothing is owed either way and no order exists.
            </p>
            <p className="mt-4 text-body text-ink-2">
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
            <p className="text-body text-ink-2">
              There is no self-serve cancellation once an order is confirmed. That is a genuine gap
              rather than a policy: no such control exists on the site today, and we are not going to
              write a clause describing a button you cannot press. Write to customer care with your
              order number and we will deal with it by hand.
            </p>
            <p className="mt-4 text-body text-ink-2">
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
          <p className="text-body text-ink-2">
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
            <p className="text-body text-ink-2">
              Orders are prepaid. Credit terms are not offered on this platform today, so a
              cancellation is always a question of returning money you have already paid rather than
              of cancelling an amount you owe.
            </p>
            <p className="mt-4 text-body text-ink-2">
              The route and timing of that return are not yet published, for the same reason they are
              not published on the returns page.
            </p>
            <p className="mt-3">
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
            <p className="text-body text-ink-2">
              Prices are per machine and are exclusive of GST unless a page says otherwise. The
              landed price of an order is the unit price for each serial, plus freight, plus tax, and
              it depends on where you are taking delivery — so a price is only complete once a
              delivery pincode is known.
            </p>
            <Facts
              rows={[
                ['Our GSTIN', <span className="tnum text-ink">{LEGAL_DISCLOSURE.gstin}</span>],
                [
                  'GST rate',
                  <>
                    <N value={18} unit="%" /> on HSN{' '}
                    <span className="tnum text-ink-2">8471</span>, under Notification 1/2017-Central
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
            <p className="text-body text-ink-2">
              For our supply to you, the place of supply is where the movement of the goods
              terminates — that is,{' '}
              <strong className="text-ink">your delivery address, not your billing address</strong>.
              A buyer registered in one state taking delivery at a site in another is an inter-state
              supply, and the invoice carries IGST accordingly.
            </p>
            <List
              items={[
                <>
                  Delivery in the same state as our registration —{' '}
                  <span className="tnum text-ink-2">CGST + SGST</span>, half the rate each.
                </>,
                <>
                  Delivery anywhere else — <span className="tnum text-ink-2">IGST</span> at the full
                  rate.
                </>,
                <>
                  Delivery in a Union Territory — the state half is styled{' '}
                  <span className="tnum text-ink-2">UTGST</span>. The rate and the arithmetic are
                  identical.
                </>,
              ]}
            />
            <p className="mt-4 text-body text-ink-2">
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
            <p className="text-body text-ink-2">
              Every machine is bought by us in one of two ways, and this is fixed for that machine
              from the moment we buy it. It cannot be changed afterwards.
            </p>
            <List
              items={[
                <>
                  <strong className="text-ink">Regular</strong> — we bought the machine from a
                  GST-registered supplier who charged us tax, and we claimed that credit. Tax on your
                  invoice is charged on the full value of the supply.
                </>,
                <>
                  <strong className="text-ink">Margin</strong> — the machine was bought under the
                  second-hand goods margin scheme, and no input tax credit was availed on its
                  purchase. Tax on your invoice is charged on our margin only.
                </>,
              ]}
            />
            <p className="mt-4 text-body text-ink-2">
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
            <p className="text-body text-ink-2">
              This is the part that changes what a machine actually costs your business, so it is
              worth reading before you compare two prices.
            </p>
            <p className="mt-4 text-body text-ink-2">
              On a <strong className="text-ink">regular</strong> line, tax is charged on the whole
              taxable value and you may claim that tax as input credit in the ordinary way, subject to
              your own eligibility.
            </p>
            <p className="mt-4 text-body text-ink-2">
              On a <strong className="text-ink">margin</strong> line, the taxable value is determined
              under Rule 32(5) of the CGST Rules, 2017: it is the difference between what we sold the
              machine for and what we paid for it. That difference is computed{' '}
              <strong className="text-ink">for each serial individually and is never pooled</strong>{' '}
              across a line or an invoice — the scheme requires the margin to be attributable to a
              specific unit. Where we sold a machine for less than we paid, that serial contributes a
              taxable value of zero; it never goes negative and never reduces the tax on another
              serial.
            </p>
            <p className="mt-4 text-body text-ink-2">
              Because no credit was availed on the purchase,{' '}
              <strong className="text-ink">no input tax credit is available to you on a margin
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
          <p className="text-body text-ink-2">
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
