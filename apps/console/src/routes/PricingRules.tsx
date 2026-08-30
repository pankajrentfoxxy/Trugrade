import * as React from 'react';
import type { Grade } from '@trugrade/contracts';
import {
  DataBoard,
  EmptyState,
  GradeBadge,
  Skeleton,
  StatusPill,
  type Column,
} from '@trugrade/ui';
import { Board, Datum, NotMeasured, PageHeader, Section } from '../lib/controls';
import { useResource } from '../lib/useResource';

/**
 * ARCHETYPE B — Board. The rules, in the order the resolver walks them.
 * DENSITY: compact (admin), set on the app root by the shell.
 *
 * What we keep between what a vendor is paid and what a buyer pays.
 *
 * ## The one thing this screen is for
 *
 * `procurement.margin_rule` resolves **first match wins**, and overlap is
 * normal rather than exceptional: a `0-25,000` band that does not care about
 * grade sits above a Grade B rule that does not care about price, so a Grade B
 * machine at 20,000 satisfies both. Until now nothing said which one applied.
 * A margin quietly becoming whichever row sorted first is the failure this
 * board exists to make impossible, so the rules are listed in resolution order
 * and every collision names its winner in words.
 *
 * ## No number on this screen is computed here
 *
 * Every rupee comes from the API, and the API reads it off a row rather than
 * re-deriving it. The margin a rule is achieving is `unit_price` minus
 * `vendor_ask_price` on the stock it is pricing — the money we actually charge
 * and actually pay. A recomputed figure would show what the rule SAYS, and the
 * gap between what it says and what is on the row is the only thing here worth
 * looking at. This repo has already had to fix a `landedPrice` with two
 * implementations and a TDS rate that would have read 0 divided by gross.
 *
 * ## Colour
 *
 * A target margin is a SETTING and reads as ink. The margin actually being
 * achieved is a MEASURED value and is the only amber on the board, which is one
 * of the accent's three legitimate meanings. Grades are neutral. Nothing here is
 * a PASS or a FAIL, so nothing here is green or red — an unreachable rule is a
 * mistake in the ruleset, not a verdict, and wears the outlined warn chip.
 */

interface Overlap {
  ruleId: string;
  priority: number;
  /** True when THIS rule is the one the resolver returns. */
  wins: boolean;
  sharedScope: string[];
}

interface LiveTotals {
  listings: number;
  units: number;
  vendorPayout: string;
  sellingPrice: string;
  margin: string;
  /** Of the vendor payout — the same denominator `target_margin_pct` uses. */
  marginPctOfPayout: number;
}

interface MarginRule {
  id: string;
  priority: number;
  order: number;
  scope: {
    category: string | null;
    brandId: string | null;
    brandName: string | null;
    grade: Grade | null;
    valueFrom: string | null;
    valueTo: string | null;
  };
  targetMarginPct: number;
  floorMarginPct: number;
  /** Always null: there is no ceiling column on the table. */
  ceilingMarginPct: null;
  warrantyTopUpMonths: number;
  reservePctByGrade: Partial<Record<Grade, number>>;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  inForceToday: boolean;
  approvedBy: string | null;
  overlaps: Overlap[];
  unreachableBecause: string[];
  live: LiveTotals | null;
}

interface PricingRules {
  asAt: string;
  rules: MarginRule[];
  platform: {
    warrantyMinTotalMonths: number | null;
    roundingStepInr: number | null;
    guardrailLowerMultiple: number | null;
    guardrailUpperMultiple: number | null;
    qcVisitFeeInr: string | null;
    qcVisitFeeWaivedAbove: number | null;
    qcFeeBearer: string | null;
    minMarginAbsoluteInr: number;
  };
  reserve: { warranties: number; withReserveAmount: number };
  attribution: { unitsWithRetailPrice: number; unitsWithRuleRecorded: number };
  priceBook: { tableExists: boolean };
  unmatched: { listings: number; units: number };
}

/** A decimal string from the API. Never parsed, never arithmetic'd — formatted. */
const RUPEES = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const rupees = (amount: string): string => `₹${RUPEES.format(Number(amount))}`;

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** A number, so mono and tabular. Every one of these is read against another row. */
function Num({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <span className="font-mono tnum">{children}</span>;
}

/**
 * What a rule matches on, with "any" said out loud.
 *
 * A blank cell where a predicate is NULL would read as an unfinished rule. NULL
 * on this table means "don't care", which is the opposite of missing — it is the
 * broadest possible scope, and the reason a catch-all can swallow everything
 * below it.
 */
function Scope({ rule }: { rule: MarginRule }): React.JSX.Element {
  const { scope } = rule;
  const wide =
    scope.grade === null &&
    scope.category === null &&
    scope.brandId === null &&
    scope.valueFrom === null &&
    scope.valueTo === null;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        {scope.grade === null ? (
          <span className="text-body-sm text-ink">Any grade</span>
        ) : (
          <GradeBadge grade={scope.grade} />
        )}
        {scope.brandId !== null && (
          <span className="text-body-sm text-ink">{scope.brandName ?? 'Unknown brand'}</span>
        )}
        {scope.category !== null && (
          <span className="text-body-sm text-ink">
            {scope.category.replaceAll('_', ' ').toLowerCase()}
          </span>
        )}
      </div>
      {scope.valueFrom === null && scope.valueTo === null ? (
        <span className="text-body-sm text-ink-3">Any payout</span>
      ) : (
        <span className="text-body-sm text-ink-3">
          {/* Half-open, and said so: ops entering 0-25,000 and 25,000-50,000
              gets exactly one match at 25,000, and which side it falls on is a
              real question somebody will ask. */}
          Payout{' '}
          <Num>{scope.valueFrom === null ? 'any' : rupees(scope.valueFrom)}</Num>
          {scope.valueTo !== null && (
            <>
              {' '}
              up to but not including <Num>{rupees(scope.valueTo)}</Num>
            </>
          )}
        </span>
      )}
      {wide && <span className="text-body-sm text-ink-4">Every machine, at any price.</span>}
    </div>
  );
}

/**
 * The percentages, with the denominator every one of them is a percentage OF.
 *
 * `target_margin_pct` is applied to the vendor's payout, not to the selling
 * price — `Money.percentOf(vendorNetPayout, pct)` — and the commission a vendor
 * is quoted is over the selling price. The two are different numbers for the
 * same rule, and a percentage without its denominator is how they get read as a
 * contradiction.
 */
function Margins({ rule, minAbsolute }: { rule: MarginRule; minAbsolute: number }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-body-sm text-ink">
        Target <Num>{rule.targetMarginPct}%</Num> of payout
      </span>
      <span className="text-body-sm text-ink-3">
        Floor <Num>{rule.floorMarginPct}%</Num>, or <Num>{rupees(String(minAbsolute))}</Num> —
        whichever is more
      </span>
      {/* Not "0%". There is no ceiling column on the table at all, and a rule
          with no ceiling is not a rule that caps margin at nothing. */}
      <NotMeasured
        why="procurement.margin_rule has no ceiling column. 03_UX_SPEC §3C.2 describes one; the schema does not have it."
        label="No ceiling"
      />
    </div>
  );
}

/**
 * The warranty half of the rule, and the half of that which does nothing.
 *
 * `reserve_pct_by_grade` is per PLATFORM-BACKED MONTH, not a flat percentage:
 * `priceFromNetPayout` multiplies it by the months we are funding. A vendor
 * offering nothing on a Grade B machine therefore reserves 4% x 6 months = 24%
 * of the payout — which is the largest single component of the price after the
 * margin itself, and it is worth reading as the multiplication it is.
 */
function Warranty({ rule, consumed }: { rule: MarginRule; consumed: boolean }): React.JSX.Element {
  const bands = Object.entries(rule.reservePctByGrade) as Array<[Grade, number]>;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-body-sm text-ink">
        Top up <Num>{rule.warrantyTopUpMonths}</Num>{' '}
        {rule.warrantyTopUpMonths === 1 ? 'month' : 'months'}
      </span>
      {bands.length === 0 ? (
        <NotMeasured why="This rule carries no reserve bands" label="No reserve set" />
      ) : (
        <span className="text-body-sm text-ink-3">
          Reserve{' '}
          {bands.map(([grade, pct], i) => (
            <React.Fragment key={grade}>
              {i > 0 && ' · '}
              {grade.replace('_PLUS', '+')} <Num>{pct}%</Num>
            </React.Fragment>
          ))}{' '}
          per month we fund
        </span>
      )}
      {bands.length > 0 && !consumed && (
        <span className="text-body-sm text-ink-4">
          Priced in, never held — see below.
        </span>
      )}
    </div>
  );
}

/**
 * Which rule wins, said as a sentence rather than implied by row order.
 *
 * Row order IS the answer, and that is exactly why it cannot be the only place
 * the answer lives: a board somebody re-sorts by margin would silently start
 * lying. So the precedence travels in the cell.
 */
function Precedence({ rule }: { rule: MarginRule }): React.JSX.Element {
  const lostTo = rule.overlaps.filter((o) => !o.wins);
  const wonOver = rule.overlaps.filter((o) => o.wins);

  if (rule.unreachableBecause.length > 0) {
    return (
      <div className="flex flex-col gap-2">
        {/* Not red: a rule the resolver can never reach is a mistake in the
            ruleset, not a verdict on a machine. Green and red are PASS and FAIL. */}
        <StatusPill tone="warn" label="Never applies" />
        {rule.unreachableBecause.map((why) => (
          <span key={why} className="max-w-sm text-body-sm text-ink-2">
            {why}
          </span>
        ))}
      </div>
    );
  }

  if (!rule.isActive) {
    // Not "nothing else matches this". A switched-off rule is excluded from the
    // resolver's WHERE, so it collides with nothing — and reporting that as a
    // clean, uncontested scope would read as a rule that is doing its job alone.
    return (
      <span className="max-w-sm text-body-sm text-ink-3">
        Switched off, so the engine never reaches it. Turning it back on may put it in front of
        another rule.
      </span>
    );
  }

  if (rule.overlaps.length === 0) {
    return <span className="text-body-sm text-ink-3">Nothing else matches what this matches.</span>;
  }

  return (
    <div className="flex flex-col gap-2">
      {lostTo.length > 0 && (
        <span className="max-w-sm text-body-sm text-ink">
          Overruled by{' '}
          {lostTo.map((o, i) => (
            <React.Fragment key={o.ruleId}>
              {i > 0 && ', '}
              priority <Num>{o.priority}</Num> on {o.sharedScope.join(' with ')}
            </React.Fragment>
          ))}
          .
        </span>
      )}
      {wonOver.length > 0 && (
        <span className="max-w-sm text-body-sm text-ink-3">
          Takes precedence over{' '}
          {wonOver.map((o, i) => (
            <React.Fragment key={o.ruleId}>
              {i > 0 && ', '}
              priority <Num>{o.priority}</Num>
            </React.Fragment>
          ))}
          .
        </span>
      )}
    </div>
  );
}

/**
 * What the rule is on today, in money already on the rows.
 *
 * Amber, because this is the one measured value on the board. Every percentage
 * carries its denominator: the margin is a percentage of the payout, and the
 * payout is printed beside it.
 */
function Live({ rule }: { rule: MarginRule }): React.JSX.Element {
  if (!rule.live) {
    return (
      <NotMeasured
        why="No live stock resolves to this rule today"
        label="Pricing nothing"
      />
    );
  }
  const { live } = rule;
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-data tnum text-acc-ink">
        {live.marginPctOfPayout}%
      </span>
      <span className="text-body-sm text-ink-2">
        <Num>{rupees(live.margin)}</Num> on <Num>{rupees(live.vendorPayout)}</Num> of payout
      </span>
      {/* The rule's own target, printed next to what is actually being achieved.
          Not a difference computed here — two figures the API gave, side by
          side, so a rule whose stock was priced by something else is readable
          rather than inferable. */}
      <span className="text-body-sm text-ink-3">
        this rule targets <Num>{rule.targetMarginPct}%</Num>
      </span>
      <span className="text-body-sm text-ink-3">
        {plural(live.units, 'machine', 'machines')} across{' '}
        {plural(live.listings, 'listing', 'listings')}
      </span>
    </div>
  );
}

function State({ rule, asAt }: { rule: MarginRule; asAt: string }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      {/* In force is the ordinary case and wears neutral: five amber chips on a
          board whose one measured value is also amber leaves nothing standing
          out. The exception is what needs marking, and it is not a verdict, so
          it is the outlined warn chip rather than red. */}
      {rule.inForceToday ? (
        <StatusPill tone="neutral" label="In force" />
      ) : (
        <StatusPill tone="warn" label={rule.isActive ? 'Not yet in force' : 'Switched off'} />
      )}
      <span className="text-body-sm text-ink-3">
        From <Num>{rule.effectiveFrom}</Num>
        {rule.effectiveTo === null ? ', no end date' : <> to <Num>{rule.effectiveTo}</Num></>}
      </span>
      {!rule.inForceToday && rule.isActive && (
        <span className="text-body-sm text-ink-4">Today is {asAt}.</span>
      )}
    </div>
  );
}

export function PricingRulesRoute(): React.JSX.Element {
  const { data, error } = useResource<PricingRules>(
    '/api/admin/pricing/margin-rules',
    'The margin rules did not load',
  );

  const columns = React.useMemo<ReadonlyArray<Column<MarginRule>>>(
    () => [
      {
        key: 'order',
        header: 'Order',
        cell: (rule) => (
          <div className="flex flex-col gap-1">
            <span className="font-mono text-data tnum text-ink">{rule.order}</span>
            <span className="whitespace-nowrap text-body-sm text-ink-3">
              priority <Num>{rule.priority}</Num>
            </span>
          </div>
        ),
      },
      { key: 'scope', header: 'Applies to', cell: (rule) => <Scope rule={rule} /> },
      {
        key: 'margin',
        header: 'Margin',
        cell: (rule) => (
          <Margins rule={rule} minAbsolute={data?.platform.minMarginAbsoluteInr ?? 0} />
        ),
      },
      {
        key: 'warranty',
        header: 'Warranty',
        cell: (rule) => (
          <Warranty rule={rule} consumed={(data?.reserve.withReserveAmount ?? 0) > 0} />
        ),
      },
      { key: 'precedence', header: 'Precedence', cell: (rule) => <Precedence rule={rule} /> },
      {
        key: 'state',
        header: 'In force',
        cell: (rule) => <State rule={rule} asAt={data?.asAt ?? ''} />,
      },
      { key: 'live', header: 'Achieving now', cell: (rule) => <Live rule={rule} /> },
    ],
    [data],
  );

  if (error) {
    return (
      <EmptyState
        title="The margin rules did not load"
        body={`${error}. Nothing has been changed — reload to try again.`}
      />
    );
  }
  if (!data) return <Skeleton lines={10} />;

  if (data.rules.length === 0) {
    return (
      <div className="tg-stack">
        <PageHeader title="Margin rules">What we keep between a vendor&rsquo;s payout and a buyer&rsquo;s price.</PageHeader>
        <EmptyState
          title="No margin rule exists"
          body={
            <>
              <span className="block">
                There is no platform default to fall back on. `PricingService` fails closed: a
                machine no rule covers cannot be priced at all, and the vendor is told their listing
                could not go live rather than being given a guessed margin.
              </span>
              <span className="mt-3 block text-ink-3">
                Rules are seeded by <span className="font-mono">prisma/seed/margin-rules.ts</span>.
                No route in the product creates one.
              </span>
            </>
          }
        />
      </div>
    );
  }

  const unreachable = data.rules.filter((r) => r.unreachableBecause.length > 0).length;
  // Rules, not overlap edges — a rule overruled by three earlier ones is one
  // rule with a precedence to read, not three collisions. The unreachable ones
  // are counted on their own line and would otherwise appear twice.
  const collisions = data.rules.filter(
    (r) => r.unreachableBecause.length === 0 && r.overlaps.some((o) => !o.wins),
  ).length;
  const reserveHeld = data.reserve.withReserveAmount > 0;
  const attributed = data.attribution.unitsWithRuleRecorded;

  return (
    <div className="tg-stack">
      <PageHeader title="Margin rules">
        What we keep between what a vendor is paid and what a buyer pays. Listed in the order the
        pricing engine walks them: <strong>the first rule whose every condition holds wins</strong>,
        and the rest are never consulted.
      </PageHeader>

      <p className="max-w-prose text-body-sm text-ink-2">
        {collisions === 0 ? (
          <>No two rules can match the same machine.</>
        ) : (
          <>
            <span className="font-mono tnum text-ink">{collisions}</span>{' '}
            {collisions === 1 ? 'rule is' : 'rules are'} overruled by an earlier one on part of
            {collisions === 1 ? ' its' : ' their'} scope — which is normal, and is why the
            Precedence column says which applies.
          </>
        )}
        {unreachable > 0 && (
          <>
            {' '}
            <span className="font-mono tnum text-ink">{unreachable}</span>{' '}
            {unreachable === 1 ? 'rule can' : 'rules can'} never be reached at all.
          </>
        )}{' '}
        Effective dates are read on the IST business date, which today is{' '}
        <span className="font-mono tnum">{data.asAt}</span>.
      </p>

      <Board>
        <DataBoard
          caption="Margin rules in the order the pricing engine resolves them, first match wins."
          columns={columns}
          rows={data.rules}
          rowKey={(rule) => rule.id}
        />
      </Board>

      {data.unmatched.units > 0 && (
        <p className="max-w-prose text-body-sm text-fail">
          <span className="font-mono tnum">{data.unmatched.units}</span> live machines match no rule
          at all. Pricing fails closed, so nothing was sold at a guessed margin — but these listings
          cannot be repriced until a rule covers them.
        </p>
      )}

      <Section
        title="What is set outside these rules"
        subtitle="Every price is a rule plus these. They are platform-wide, they are not on any rule, and ops cannot see them anywhere else."
      >
        <div className="grid gap-x-7 sm:grid-cols-2 lg:grid-cols-3">
          <Datum label="Minimum total warranty">
            {data.platform.warrantyMinTotalMonths === null ? (
              <NotMeasured why="platform.warranty_min_total_months is not configured" />
            ) : (
              <>
                <Num>{data.platform.warrantyMinTotalMonths}</Num> months, whatever the vendor offers
              </>
            )}
          </Datum>
          <Datum label="Price rounding">
            {data.platform.roundingStepInr === null || data.platform.roundingStepInr === 0 ? (
              // The key is deliberately absent and the pricer treats it as 0.
              // "0" in this slot would read as a rounding step of zero rupees,
              // which is a different and meaningless claim.
              <NotMeasured
                why="price.rounding_step_inr is not set, so the engine leaves prices unrounded. Seeding the key starts rounding with no deploy."
                label="Prices are not rounded"
              />
            ) : (
              <>
                Up to the nearest <Num>{rupees(String(data.platform.roundingStepInr))}</Num>
              </>
            )}
          </Datum>
          <Datum label="Absolute margin floor">
            <Num>{rupees(String(data.platform.minMarginAbsoluteInr))}</Num> per machine — a default
            in code, not a config key
          </Datum>
          <Datum label="Inspection fee">
            {data.platform.qcVisitFeeInr === null ? (
              <NotMeasured why="qc.visit_fee_inr is not configured" />
            ) : (
              <>
                <Num>{rupees(data.platform.qcVisitFeeInr)}</Num> per visit, borne by{' '}
                {data.platform.qcFeeBearer === 'TRUETECH' ? 'us' : 'the vendor'}
                {data.platform.qcVisitFeeWaivedAbove !== null && (
                  <>
                    , waived above <Num>{data.platform.qcVisitFeeWaivedAbove}</Num> machines
                  </>
                )}
              </>
            )}
          </Datum>
          <Datum label="Low-price guardrail">
            {data.platform.guardrailLowerMultiple === null ? (
              <NotMeasured why="price.guardrail_lower_multiple is not configured" />
            ) : (
              <>
                Flag below <Num>{data.platform.guardrailLowerMultiple}x</Num> the 30-day median for
                the same SKU and grade
              </>
            )}
          </Datum>
          <Datum label="High-price guardrail">
            {/* Configured at 3.0 in the baseline migration and read by no file in
                the API. A knob that moves nothing must not sit beside one that
                works looking like its pair. */}
            <NotMeasured
              why="price.guardrail_upper_multiple is set to 3.0 in the schema and no code reads it. Only the lower side is checked."
              label={
                data.platform.guardrailUpperMultiple === null
                  ? 'Not configured'
                  : `Set to ${data.platform.guardrailUpperMultiple}x, and nothing reads it`
              }
            />
          </Datum>
        </div>
      </Section>

      <Section
        title="Three things this screen cannot tell you, and why"
        subtitle="Each one is a gap in the product rather than in the screen. They are stated here because a margin table that quietly omitted them would be the more misleading version."
      >
        <ul className="flex flex-col gap-5">
          <li>
            <h3 className="text-body-sm font-semibold text-ink">
              The warranty reserve is priced in and never held
            </h3>
            <p className="mt-1 max-w-prose text-body-sm text-ink-2">
              Every rule carries a reserve percentage and every price includes it — a Grade B
              machine with a vendor offering nothing reserves{' '}
              <Num>4%</Num> &times; <Num>6</Num> months of the payout. But{' '}
              <span className="font-mono">platform.warranty.reserve_amount</span> is{' '}
              {reserveHeld ? (
                <>
                  set on <Num>{data.reserve.withReserveAmount}</Num> of{' '}
                  <Num>{data.reserve.warranties}</Num> warranty terms.
                </>
              ) : (
                <>
                  <strong>null on all {data.reserve.warranties} warranty terms</strong> — nothing
                  writes it. The buyer has paid for the reserve; no ledger holds it. So the
                  percentage above is a component of a price, not a fund with money in it, and this
                  screen must not be read as saying money has been set aside.
                </>
              )}
            </p>
          </li>
          <li>
            <h3 className="text-body-sm font-semibold text-ink">
              &ldquo;Achieving now&rdquo; is today&rsquo;s resolution, not history
            </h3>
            <p className="mt-1 max-w-prose text-body-sm text-ink-2">
              <span className="font-mono">listing.unit.margin_rule_id</span> records which rule
              priced a serial, and the pricing engine writes it. It is set on{' '}
              <Num>{attributed}</Num> of <Num>{data.attribution.unitsWithRetailPrice}</Num> priced
              machines
              {attributed === 0 ? (
                <>
                  {' '}
                  — none — because the current stock was written by the seed rather than run through
                  the engine. The totals on the board are therefore what each rule{' '}
                  <strong>would</strong> price today, re-resolved against today&rsquo;s rules. Where
                  a rule has changed since, the machine was priced by something else.
                </>
              ) : (
                <>. Machines without it are attributed by re-resolving against today&rsquo;s rules.</>
              )}
            </p>
          </li>
          <li>
            <h3 className="text-body-sm font-semibold text-ink">
              {data.priceBook.tableExists
                ? 'Price books exist and are not shown here'
                : 'There are no price books'}
            </h3>
            <p className="mt-1 max-w-prose text-body-sm text-ink-2">
              {data.priceBook.tableExists ? (
                <>
                  <span className="font-mono">procurement.price_book</span> exists in the schema and
                  this board does not read it yet.
                </>
              ) : (
                <>
                  <span className="font-mono">procurement.price_book</span> is not in the schema —
                  no table, no migration, no writer and nothing that would consume one. The two
                  guardrails a price book would carry are already implemented elsewhere and not as a
                  book: the floor is the rule&rsquo;s own floor percentage against a{' '}
                  <Num>{rupees(String(data.platform.minMarginAbsoluteInr))}</Num> absolute, and the
                  market band is a rolling 30-day median of live listings for the same SKU and
                  grade. A screen offering price books would be a screen for a thing that does not
                  exist.
                </>
              )}
            </p>
          </li>
        </ul>
      </Section>

      <Section
        title="Nothing on this screen can be changed here"
        subtitle="Read-only, and not as a first cut — no route in the product writes a margin rule."
      >
        <p className="max-w-prose text-body-sm text-ink-2">
          Rules come from <span className="font-mono">prisma/seed/margin-rules.ts</span>, and{' '}
          <span className="font-mono">approved_by</span> is null on every one because nothing sets
          it. A change here would move the price of new listings only:{' '}
          <span className="font-mono">unit.purchase_price</span> is frozen by a database trigger the
          moment a purchase order names a serial, so what we owe a vendor for stock already
          committed cannot be re-derived by a rule change, in either direction.
        </p>
      </Section>
    </div>
  );
}
