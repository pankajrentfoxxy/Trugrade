import { GRADES, Money, type Grade } from '@trugrade/contracts';

/**
 * Which margin rule wins when two of them can price the same machine.
 *
 * `MarginRuleRepository.resolve` is **first match wins, by `(priority,
 * created_at, id)`**, and every non-NULL predicate on a rule has to hold. That
 * makes overlap the normal case rather than a mistake: the seeded set has a
 * `0-25,000` rule at priority 5 and a Grade B rule at priority 10, and a Grade B
 * machine at 20,000 matches both. One of them decides what we keep between what
 * a vendor is paid and what a buyer pays, and which one it is is currently
 * visible nowhere.
 *
 * So this file answers two questions and nothing else:
 *
 *   1. **Which pairs of rules can both match one machine, and which of the pair
 *      wins?** Exact, and cheap - the predicates are four independent
 *      dimensions, and two rules overlap only if they overlap on all four.
 *   2. **Is a rule unreachable?** Deliberately CONSERVATIVE: it reports a rule
 *      as unreachable only when, for every grade the rule could apply to, some
 *      single earlier rule is at least as general on every other dimension.
 *      That is a sufficient condition, not a necessary one - a rule shadowed
 *      only by the *union* of two earlier rules' value bands is not reported,
 *      and reporting it would need a set cover the screen could not then explain
 *      in a sentence. A false "reachable" leaves an unused rule on screen; a
 *      false "unreachable" tells ops a live rule is dead. Only the second is
 *      dangerous, so the analysis errs the other way.
 *
 * Pure, and it stays pure. Nothing here reads a database, and nothing here
 * computes money - an overlap is a question about predicates, and the rupees are
 * the pricing service's answer.
 */

/** A rule reduced to what decides whether it matches, and when it is in force. */
export interface RuleScope {
  id: string;
  priority: number;
  /** The resolver's second sort key, so the tie-break here is the real one. */
  createdAt: Date;
  category: string | null;
  brandId: string | null;
  grade: Grade | null;
  /** Half-open `[valueFrom, valueTo)`, as the resolver's own query brackets it. */
  valueFrom: Money | null;
  valueTo: Money | null;
  /** `YYYY-MM-DD`. Half-open `[effectiveFrom, effectiveTo)`, again as the query. */
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
}

export interface Overlap {
  /** The other rule in the pair. */
  ruleId: string;
  priority: number;
  /** True when THIS rule is the one the resolver would return. */
  wins: boolean;
  /** The scope the two share, in the words ops would use. */
  sharedScope: string[];
}

export interface RuleAnalysis {
  ruleId: string;
  /** Position in the resolver's own walk order, 1-based. */
  order: number;
  overlaps: Overlap[];
  /** Empty unless the rule is unreachable; one sentence per grade if it is. */
  unreachableBecause: string[];
}

const gradeLabel = (g: Grade): string => g.replace('_PLUS', '+');

/** The resolver's ORDER BY, as a comparator. Nothing else may decide this. */
export function resolutionOrder(a: RuleScope, b: RuleScope): number {
  return (
    a.priority - b.priority ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    a.id.localeCompare(b.id)
  );
}

/** NULL on the rule means "don't care", so it matches anything including NULL. */
const eqOverlap = (a: string | null, b: string | null): boolean =>
  a === null || b === null || a === b;

/** Half-open money intervals, `null` at either end meaning unbounded. */
function bandsIntersect(a: RuleScope, b: RuleScope): boolean {
  const before = (from: Money | null, to: Money | null): boolean =>
    from === null || to === null || from.lt(to);
  return before(b.valueFrom, a.valueTo) && before(a.valueFrom, b.valueTo);
}

/** The same shape on dates. Lexicographic compare is correct for `YYYY-MM-DD`. */
function datesIntersect(a: RuleScope, b: RuleScope): boolean {
  const before = (from: string, to: string | null): boolean => to === null || from < to;
  return before(b.effectiveFrom, a.effectiveTo) && before(a.effectiveFrom, b.effectiveTo);
}

/**
 * Can one machine, on one day, satisfy both rules?
 *
 * An inactive rule overlaps nothing: `is_active` is in the resolver's WHERE, so
 * a switched-off rule cannot be the answer to anything, and listing it as a
 * conflict is noise on the one screen that has to surface the real ones.
 */
export function overlaps(a: RuleScope, b: RuleScope): boolean {
  if (!a.isActive || !b.isActive) return false;
  return (
    eqOverlap(a.category, b.category) &&
    eqOverlap(a.brandId, b.brandId) &&
    eqOverlap(a.grade, b.grade) &&
    bandsIntersect(a, b) &&
    datesIntersect(a, b)
  );
}

/** What the two can both match on, said the way ops would say it. */
function sharedScope(a: RuleScope, b: RuleScope): string[] {
  const shared: string[] = [];
  const grade = a.grade ?? b.grade;
  shared.push(grade === null ? 'any grade' : `Grade ${gradeLabel(grade)}`);

  const category = a.category ?? b.category;
  if (category !== null) shared.push(category.replaceAll('_', ' ').toLowerCase());

  const banded =
    a.valueFrom !== null || a.valueTo !== null || b.valueFrom !== null || b.valueTo !== null;
  if (banded) shared.push('an overlapping payout band');
  return shared;
}

/**
 * Is `earlier` at least as general as `later`, for one concrete grade?
 *
 * "At least as general" on a don't-care dimension means the earlier rule either
 * does not care, or cares about exactly the same value. On the two ranges it
 * means containment, not merely intersection - a rule that overlaps half of
 * another's band leaves the other half reachable.
 */
function dominatesForGrade(earlier: RuleScope, later: RuleScope, grade: Grade): boolean {
  if (!earlier.isActive) return false;
  if (earlier.grade !== null && earlier.grade !== grade) return false;
  if (earlier.category !== null && earlier.category !== later.category) return false;
  if (earlier.brandId !== null && earlier.brandId !== later.brandId) return false;

  const containsBand =
    (earlier.valueFrom === null ||
      (later.valueFrom !== null && !earlier.valueFrom.gt(later.valueFrom))) &&
    (earlier.valueTo === null || (later.valueTo !== null && !later.valueTo.gt(earlier.valueTo)));
  if (!containsBand) return false;

  return (
    earlier.effectiveFrom <= later.effectiveFrom &&
    (earlier.effectiveTo === null ||
      (later.effectiveTo !== null && later.effectiveTo <= earlier.effectiveTo))
  );
}

/**
 * Every rule, in resolution order, with what it collides with and whether the
 * resolver can ever reach it.
 */
export function analyseRules(rules: readonly RuleScope[]): RuleAnalysis[] {
  const ordered = [...rules].sort(resolutionOrder);

  return ordered.map((rule, index) => {
    const overlapping: Overlap[] = ordered
      .filter((other) => other.id !== rule.id && overlaps(rule, other))
      .map((other) => ({
        ruleId: other.id,
        priority: other.priority,
        wins: resolutionOrder(rule, other) < 0,
        sharedScope: sharedScope(rule, other),
      }));

    const earlier = ordered.slice(0, index);
    const grades: readonly Grade[] = rule.grade === null ? GRADES : [rule.grade];
    const covers = grades.map((grade) => ({
      grade,
      by: earlier.find((e) => dominatesForGrade(e, rule, grade)),
    }));

    const covered = covers.filter((c) => c.by !== undefined);
    const unreachableBecause =
      rule.isActive && covered.length === covers.length
        ? covered.map(
            (c) =>
              `Grade ${gradeLabel(c.grade)} is caught first by the rule at priority ${c.by!.priority}, which is at least as broad.`,
          )
        : [];

    return { ruleId: rule.id, order: index + 1, overlaps: overlapping, unreachableBecause };
  });
}
