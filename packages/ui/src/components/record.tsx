import * as React from 'react';
import { cn } from '../lib/cn';

/**
 * Archetype C — **Record**: identity header + evidence panel + actions panel.
 *
 * Two thirds of the product is this shape and archetype B, so these are the two
 * that have to be right. A record screen answers "what exactly is this thing"
 * before it offers to do anything to it, which is why the identifiers sit in
 * the header in mono rather than three cards down.
 */

/* ==========================================================================
 * RecordHeader
 * ======================================================================== */

export interface RecordIdentifier {
  /** "Serial", "Order", "GSTIN", "Seal code". Short — it sits above the value. */
  label: string;
  /** The identifier itself. Always mono: it is a value someone will read aloud. */
  value: React.ReactNode;
  /** Where the identifier resolves to, when it is a reference to another record. */
  href?: string;
}

export interface RecordHeaderProps {
  title: string;
  /** Model, configuration, customer name — what the title is not enough to say. */
  subtitle?: React.ReactNode;
  identifiers?: readonly RecordIdentifier[];
  /** A `StatusPill` or `SealChip`. What state this record is in, right now. */
  status?: React.ReactNode;
  /**
   * **One** primary action. Singular on purpose: 09_FRONTEND_LOCKED.md allows
   * one amber control per screen, and a header that takes an array grows a
   * second one within a week.
   */
  action?: React.ReactNode;
  /** Everything else — secondary buttons, an overflow menu. Never amber. */
  secondaryActions?: React.ReactNode;
  className?: string;
}

/**
 * The identity header. Title, the identifiers in mono, the status, one action.
 *
 * `<header>` inside the page, with the title as the `<h1>`: a record page is
 * about one thing and that thing's name is the page's heading. A record screen
 * whose h1 is the section name ("Order detail") and whose real identity is a
 * `<div>` reads, to a screen reader, as a page with no subject.
 */
export function RecordHeader({
  title,
  subtitle,
  identifiers,
  status,
  action,
  secondaryActions,
  className,
}: RecordHeaderProps): React.JSX.Element {
  return (
    <header
      className={cn('flex flex-col gap-4 border-b border-rule pb-5', className)}
      data-testid="record-header"
    >
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-h1 text-ink">{title}</h1>
            {status}
          </div>
          {subtitle ? <p className="text-body-sm text-ink-2">{subtitle}</p> : null}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-3">
          {secondaryActions}
          {action}
        </div>
      </div>

      {identifiers?.length ? (
        <dl className="flex flex-wrap gap-x-7 gap-y-3" data-testid="record-identifiers">
          {identifiers.map((id) => (
            <div key={id.label} className="flex flex-col gap-1">
              <dt className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">
                {id.label}
              </dt>
              <dd className="font-mono text-data tnum text-ink">
                {id.href ? (
                  <a href={id.href} className="underline underline-offset-4">
                    {id.value}
                  </a>
                ) : (
                  id.value
                )}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </header>
  );
}

/* ==========================================================================
 * SidePanel
 * ======================================================================== */

export interface SidePanelProps {
  title: string;
  /** One sentence on what the actions here do, when that is not obvious. */
  description?: React.ReactNode;
  children: React.ReactNode;
  /**
   * A consequence, a deadline, a policy line. Rendered under a rule in
   * `--ink-2`, and read as part of the panel by a screen reader.
   */
  footnote?: React.ReactNode;
  /** Sticky by default — the actions must not scroll away from a long record. */
  sticky?: boolean;
  className?: string;
}

/**
 * The actions panel of a record screen.
 *
 * Actions live in one place and are not sprinkled through the evidence: a
 * "Withdraw listing" button next to the photograph it withdraws is how someone
 * clicks it by accident. The panel is `<aside>` and labelled, so it is one
 * landmark a screen reader can jump to and skip past.
 */
export function SidePanel({
  title,
  description,
  children,
  footnote,
  sticky = true,
  className,
}: SidePanelProps): React.JSX.Element {
  const headingId = React.useId();

  return (
    <aside
      aria-labelledby={headingId}
      className={cn(
        'tg-card flex flex-col gap-4 rounded-lg border border-rule bg-sheet',
        sticky && 'sticky top-5',
        className,
      )}
      data-testid="side-panel"
    >
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="text-h3 text-ink">
          {title}
        </h2>
        {description ? <p className="text-body-sm text-ink-2">{description}</p> : null}
      </div>

      <div className="flex flex-col gap-3">{children}</div>

      {footnote ? (
        <p className="border-t border-rule-2 pt-4 text-body-sm text-ink-2">{footnote}</p>
      ) : null}
    </aside>
  );
}

/* ==========================================================================
 * Timeline
 * ======================================================================== */

export interface TimelineEvent {
  key: string;
  /** What happened, in words a customer would use. Not `ORDER_STATE_CHANGED`. */
  action: React.ReactNode;
  /**
   * Who did it — a person, a vendor, or "Trugrade" for a system action.
   *
   * Required, and not defaulted to "System": an audit line whose actor is a
   * guess is worse than one that admits it does not know, so a caller with no
   * actor passes the words it wants read.
   */
  actor: React.ReactNode;
  /** Already formatted for display: "4 Aug 2026, 18:04". Rendered mono. */
  at: string;
  /** ISO 8601, for the `<time datetime>` a machine reads. */
  dateTime?: string;
  /**
   * Why. Present on anything a human chose to do — a grade correction, a
   * rejection, a cancellation. Absent renders **nothing**: an audit trail that
   * invents "Reason: not specified" reads as a recorded fact.
   */
  reason?: React.ReactNode;
  /** Anything else worth showing: a serial, a document link, an amount. */
  detail?: React.ReactNode;
  /** The current state of the record. Marked, and announced, not just coloured. */
  current?: boolean;
}

export interface TimelineProps {
  events: readonly TimelineEvent[];
  /** Names the list. "Order timeline", "Consent history", "Audit trail". */
  label: string;
  /** Newest first is the default; an audit trail usually reads oldest first. */
  className?: string;
}

/**
 * `order_event`, `audit_log` and consent history, rendered the same way once.
 *
 * An `<ol>`, because the order is the information. The rail is drawn with a
 * border on the list item rather than an absolutely-positioned line, so it
 * grows with the content and cannot fall out of alignment when one event has a
 * three-line reason.
 */
export function Timeline({ events, label, className }: TimelineProps): React.JSX.Element {
  return (
    <ol className={cn('flex flex-col', className)} aria-label={label} data-testid="timeline">
      {events.map((event, i) => {
        const last = i === events.length - 1;
        return (
          <li
            key={event.key}
            // The rail is the list item's own left border, so it stretches with
            // the content. An absolutely-positioned line falls out of alignment
            // the moment one event carries a three-line reason.
            className={cn('relative flex gap-4 pb-5 pl-5 last:pb-0', !last && 'border-l border-rule')}
            data-current={event.current || undefined}
          >
            {/* The marker. On the current event it is amber — an active state,
                the third legitimate use of the accent — and it also carries the
                word "Current", because colour alone says nothing out loud. */}
            <span
              aria-hidden="true"
              className={cn(
                'absolute -left-[5px] top-1 h-2.5 w-2.5 rounded-full border-2 border-sheet',
                event.current ? 'bg-acc' : 'bg-ink-4',
              )}
            />
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-baseline gap-3">
                <span className="text-body-sm font-medium text-ink">{event.action}</span>
                {event.current ? (
                  <span className="font-mono text-label uppercase tracking-[0.13em] text-acc-ink">
                    Current
                  </span>
                ) : null}
              </div>
              <p className="text-body-sm text-ink-2">
                {event.actor}
                <span aria-hidden="true" className="px-2 text-ink-4">
                  ·
                </span>
                <time dateTime={event.dateTime} className="font-mono text-data tnum text-ink-2">
                  {event.at}
                </time>
              </p>
              {event.reason ? (
                <p className="text-body-sm text-ink-2">
                  <span className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">
                    Reason
                  </span>{' '}
                  {event.reason}
                </p>
              ) : null}
              {event.detail ? <div className="text-body-sm text-ink-2">{event.detail}</div> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ==========================================================================
 * AddressCard
 * ======================================================================== */

export interface Address {
  /** "Head office", "Warehouse 2", "Billing — 06AABCT1234C1Z5". */
  label: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  /** Six digits. Mono — it is a code, and it is what a rider reads. */
  pincode: string;
  landmark?: string;
  contactName?: string;
  /** Normalised `+91XXXXXXXXXX`. Mono, and a `tel:` link on a phone. */
  contactMobile?: string;
  /** "Gate 3, ask for the security desk." Free text from the customer. */
  gateInstructions?: string;
  /** "Mon–Sat, 09:30–18:00". A delivery outside these hours is a failed delivery. */
  receivingHours?: string;
  /** For a billing address. Mono, 15 characters. */
  gstin?: string;
}

export interface AddressCardProps {
  address: Address;
  /** A `StatusPill`, "Default", "Primary GSTIN". */
  badge?: React.ReactNode;
  /** Edit, remove, "Deliver here". Rendered in the card's footer. */
  actions?: React.ReactNode;
  /** Renders the card as the chosen one in a group. Marked, not only coloured. */
  selected?: boolean;
  className?: string;
}

/** Rows that are only shown when we actually hold the value. */
const OPTIONAL_ROWS = [
  ['landmark', 'Landmark'],
  ['gateInstructions', 'Gate instructions'],
  ['receivingHours', 'Receiving hours'],
] as const;

/**
 * A delivery or billing address, with everything a dispatch actually needs.
 *
 * The three fields below the postal address are the ones a generic address
 * component drops and a failed delivery then costs us: the landmark, the gate
 * instructions, and the hours the site will accept goods.
 *
 * **A field we do not hold renders as "Not provided" in `--ink-4`, never as a
 * blank line.** A blank line reads as "no special instructions" — which is a
 * claim — where the truth is that nobody was asked.
 */
export function AddressCard({
  address,
  badge,
  actions,
  selected = false,
  className,
}: AddressCardProps): React.JSX.Element {
  const headingId = React.useId();

  return (
    <div
      aria-labelledby={headingId}
      className={cn(
        'tg-card flex flex-col gap-4 rounded-lg border bg-sheet',
        selected ? 'border-acc-dk' : 'border-rule',
        className,
      )}
      data-testid="address-card"
      data-selected={selected || undefined}
    >
      <div className="flex flex-wrap items-center gap-3">
        <h3 id={headingId} className="text-h3 text-ink">
          {address.label}
        </h3>
        {selected ? (
          <span className="font-mono text-label uppercase tracking-[0.13em] text-acc-ink">
            Selected
          </span>
        ) : null}
        {badge}
      </div>

      <address className="not-italic text-body-sm text-ink-2">
        {address.line1}
        {address.line2 ? (
          <>
            <br />
            {address.line2}
          </>
        ) : null}
        <br />
        {address.city}, {address.state}{' '}
        <span className="font-mono text-data tnum text-ink">{address.pincode}</span>
        {address.contactName || address.contactMobile ? (
          <>
            <br />
            {address.contactName}
            {address.contactName && address.contactMobile ? (
              <span aria-hidden="true" className="px-2 text-ink-4">
                ·
              </span>
            ) : null}
            {address.contactMobile ? (
              <a
                href={`tel:${address.contactMobile}`}
                className="font-mono text-data tnum text-ink underline underline-offset-4"
              >
                {address.contactMobile}
              </a>
            ) : null}
          </>
        ) : null}
      </address>

      <dl className="flex flex-col gap-2 border-t border-rule-2 pt-4">
        {address.gstin ? (
          <div className="flex flex-wrap gap-3">
            <dt className="w-40 shrink-0 font-mono text-label uppercase tracking-[0.13em] text-ink-3">
              GSTIN
            </dt>
            <dd className="font-mono text-data tnum text-ink">{address.gstin}</dd>
          </div>
        ) : null}

        {OPTIONAL_ROWS.map(([key, label]) => {
          const value = address[key];
          return (
            <div key={key} className="flex flex-wrap gap-3">
              <dt className="w-40 shrink-0 font-mono text-label uppercase tracking-[0.13em] text-ink-3">
                {label}
              </dt>
              <dd className={cn('text-body-sm', value ? 'text-ink-2' : 'text-ink-4')}>
                {value ?? 'Not provided'}
              </dd>
            </div>
          );
        })}
      </dl>

      {actions ? (
        <div className="flex flex-wrap gap-3 border-t border-rule-2 pt-4">{actions}</div>
      ) : null}
    </div>
  );
}
