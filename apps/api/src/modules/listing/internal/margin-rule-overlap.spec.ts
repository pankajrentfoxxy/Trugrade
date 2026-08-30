import { Money, type Grade } from '@trugrade/contracts';
import { analyseRules, overlaps, resolutionOrder, type RuleScope } from './margin-rule-overlap';

/**
 * The five rules in `prisma/seed/margin-rules.ts`, as the resolver sees them.
 *
 * Real values, not invented ones: this is what is in `procurement.margin_rule`
 * today, and the two claims the seed makes in its own comments - that the
 * grade rules cover every current grade, and that the catch-all at priority 100
 * "never fires today" - are exactly what this file is here to check rather than
 * take on trust.
 */
const DAY = new Date('2020-01-01T00:00:00Z');

function rule(over: Partial<RuleScope> & { id: string; priority: number }): RuleScope {
  return {
    createdAt: DAY,
    category: null,
    brandId: null,
    grade: null,
    valueFrom: null,
    valueTo: null,
    effectiveFrom: '2020-01-01',
    effectiveTo: null,
    isActive: true,
    ...over,
  };
}

const SEEDED: RuleScope[] = [
  rule({ id: 'r5', priority: 5, valueFrom: Money.rupees(0), valueTo: Money.rupees(25_000) }),
  rule({ id: 'r10', priority: 10, grade: 'B' }),
  rule({ id: 'r20', priority: 20, grade: 'A' }),
  rule({ id: 'r30', priority: 30, grade: 'A_PLUS' }),
  rule({ id: 'r100', priority: 100 }),
];

const byId = (id: string): RuleScope => SEEDED.find((r) => r.id === id)!;
const analysisFor = (id: string) => analyseRules(SEEDED).find((a) => a.ruleId === id)!;

describe('two margin rules that can price the same machine', () => {
  it('sees the collision the seeded set actually has', () => {
    // A Grade B machine at 20,000 satisfies both the cheap-machine band and the
    // Grade B rule. This is the case the screen exists for.
    expect(overlaps(byId('r5'), byId('r10'))).toBe(true);
  });

  it('gives the win to the lower priority, which is what the resolver does', () => {
    const cheap = analysisFor('r5');
    const gradeB = analysisFor('r10');

    expect(cheap.overlaps.find((o) => o.ruleId === 'r10')?.wins).toBe(true);
    expect(gradeB.overlaps.find((o) => o.ruleId === 'r5')?.wins).toBe(false);
  });

  it('does not call two rules on different grades a collision', () => {
    expect(overlaps(byId('r10'), byId('r20'))).toBe(false);
  });

  it('does not call disjoint payout bands a collision', () => {
    const cheap = rule({ id: 'a', priority: 1, valueFrom: Money.rupees(0), valueTo: Money.rupees(25_000) });
    const dear = rule({ id: 'b', priority: 2, valueFrom: Money.rupees(25_000), valueTo: null });
    // Half-open, so 25,000 belongs to exactly one of them. A closed range would
    // double-match on the boundary and an exclusive one would drop through it.
    expect(overlaps(cheap, dear)).toBe(false);
  });

  it('does not call a switched-off rule a collision', () => {
    const off = { ...byId('r10'), isActive: false };
    expect(overlaps(byId('r5'), off)).toBe(false);
  });

  it('does not call two rules in different effective windows a collision', () => {
    const last = rule({ id: 'a', priority: 1, effectiveFrom: '2020-01-01', effectiveTo: '2026-01-01' });
    const next = rule({ id: 'b', priority: 2, effectiveFrom: '2026-01-01' });
    expect(overlaps(last, next)).toBe(false);
  });

  it('walks the rules in the resolver order, not the order they were given', () => {
    const order = analyseRules([...SEEDED].reverse()).map((a) => a.ruleId);
    expect(order).toEqual(['r5', 'r10', 'r20', 'r30', 'r100']);
  });

  it('breaks a priority tie the way the resolver does, on created_at then id', () => {
    const older = rule({ id: 'zzz', priority: 7, createdAt: new Date('2020-01-01') });
    const newer = rule({ id: 'aaa', priority: 7, createdAt: new Date('2021-01-01') });
    expect(resolutionOrder(older, newer)).toBeLessThan(0);
  });
});

describe('a rule the resolver can never reach', () => {
  it('reports the seeded catch-all as unreachable, and names what catches each grade', () => {
    // The seed says so in a comment. This is the assertion behind the comment:
    // the three grade rules together cover the whole enum, so nothing gets past
    // them to priority 100.
    const catchAll = analysisFor('r100');
    expect(catchAll.unreachableBecause).toHaveLength(3);
    expect(catchAll.unreachableBecause.join(' ')).toContain('priority 10');
    expect(catchAll.unreachableBecause.join(' ')).toContain('priority 20');
    expect(catchAll.unreachableBecause.join(' ')).toContain('priority 30');
  });

  it('leaves every rule that can still fire alone', () => {
    for (const id of ['r5', 'r10', 'r20', 'r30']) {
      expect(analysisFor(id).unreachableBecause).toEqual([]);
    }
  });

  it('will not call a rule dead because an earlier one covers only part of its band', () => {
    // The earlier rule stops at 25,000 and the later one runs to infinity, so
    // every machine above 25,000 still reaches the later rule. Containment, not
    // intersection, is what dominance requires.
    const partial: RuleScope[] = [
      rule({ id: 'a', priority: 1, valueFrom: Money.rupees(0), valueTo: Money.rupees(25_000) }),
      rule({ id: 'b', priority: 2 }),
    ];
    expect(analyseRules(partial).find((x) => x.ruleId === 'b')!.unreachableBecause).toEqual([]);
  });

  it('will not call a rule dead because an earlier one expires first', () => {
    const expiring: RuleScope[] = [
      rule({ id: 'a', priority: 1, effectiveTo: '2027-01-01' }),
      rule({ id: 'b', priority: 2 }),
    ];
    expect(analyseRules(expiring).find((x) => x.ruleId === 'b')!.unreachableBecause).toEqual([]);
  });

  it('will not call a rule dead because a SWITCHED-OFF earlier rule covers it', () => {
    const off: RuleScope[] = [
      rule({ id: 'a', priority: 1, isActive: false }),
      rule({ id: 'b', priority: 2 }),
    ];
    expect(analyseRules(off).find((x) => x.ruleId === 'b')!.unreachableBecause).toEqual([]);
  });

  it('reports a rule genuinely shadowed by one broader earlier rule', () => {
    const shadowed: RuleScope[] = [
      rule({ id: 'a', priority: 1 }),
      rule({ id: 'b', priority: 2, grade: 'B' as Grade }),
    ];
    expect(analyseRules(shadowed).find((x) => x.ruleId === 'b')!.unreachableBecause).toHaveLength(1);
  });
});
