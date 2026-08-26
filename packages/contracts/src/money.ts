/**
 * Money. VR-126: every monetary column is NUMERIC(14,2) and there is no float
 * anywhere in the money path — not in `payment/**`, not in `procurement/**`, not
 * in a helper that "just" formats a total.
 *
 * The representation is an integer count of paise held in a bigint. That makes
 * addition exact, keeps the Postgres NUMERIC round-trip lossless, and makes the
 * rounding rule (VR-127: half-up to 2 dp at each *line*, then sum the rounded
 * lines) something you have to ask for rather than something that happens to you.
 */

const SCALE = 2n;
const FACTOR = 100n; // 10 ** SCALE

/** NUMERIC(14,2) — 12 integer digits. Anything larger is a bug, not a big order. */
const MAX_PAISE = 999_999_999_999_99n;

export class MoneyError extends Error {}

export class Money {
  private constructor(readonly paise: bigint) {
    if (paise > MAX_PAISE || paise < -MAX_PAISE) {
      throw new MoneyError(`Money out of NUMERIC(14,2) range: ${paise} paise`);
    }
  }

  static readonly ZERO = new Money(0n);

  /** From a decimal string — the only lossless input. `"1234.50"`, `"-9.05"`, `"0"`. */
  static parse(value: string | Money): Money {
    if (value instanceof Money) return value;
    const s = String(value).trim().replace(/,/g, '');
    if (!/^-?\d+(\.\d+)?$/.test(s))
      throw new MoneyError(`Not a decimal amount: ${JSON.stringify(value)}`);
    const negative = s.startsWith('-');
    const [whole = '0', frac = ''] = (negative ? s.slice(1) : s).split('.');
    if (frac.length > 2) {
      throw new MoneyError(
        `${s} has more than 2 decimal places. Round explicitly with Money.fromRatio() — money never silently truncates.`,
      );
    }
    const paise = BigInt(whole) * FACTOR + BigInt(frac.padEnd(2, '0') || '0');
    return new Money(negative ? -paise : paise);
  }

  /** From whole rupees. Convenience for config values and test fixtures. */
  static rupees(n: number | bigint): Money {
    if (typeof n === 'number' && !Number.isInteger(n)) {
      throw new MoneyError(`Money.rupees() takes whole rupees; got ${n}. Use Money.parse('${n}').`);
    }
    return new Money(BigInt(n) * FACTOR);
  }

  static paiseOf(n: bigint): Money {
    return new Money(n);
  }

  /**
   * The one sanctioned place a ratio becomes money: percentages, tax, margin.
   * Rounds half-up (away from zero on a .5), which is what Indian tax practice and
   * VR-127 expect. `numerator`/`denominator` are integers so the ratio itself is exact.
   */
  static fromRatio(base: Money, numerator: bigint, denominator: bigint): Money {
    if (denominator === 0n) throw new MoneyError('Division by zero in Money.fromRatio');
    const negative = (base.paise < 0n !== numerator < 0n) !== denominator < 0n;
    const abs = (x: bigint) => (x < 0n ? -x : x);
    const n = abs(base.paise) * abs(numerator);
    const d = abs(denominator);
    // half-up: (n + d/2) / d, integer arithmetic only
    const rounded = (n * 2n + d) / (d * 2n);
    return new Money(negative ? -rounded : rounded);
  }

  /** `pct` given as a percentage with up to 4 decimal places, e.g. 18 or 0.1. */
  static percentOf(base: Money, pct: number): Money {
    const scaled = Math.round(pct * 10_000);
    if (Math.abs(scaled / 10_000 - pct) > 1e-9) {
      throw new MoneyError(`Percentage ${pct} has more than 4 decimal places.`);
    }
    return Money.fromRatio(base, BigInt(scaled), 1_000_000n);
  }

  add(other: Money): Money {
    return new Money(this.paise + other.paise);
  }
  sub(other: Money): Money {
    return new Money(this.paise - other.paise);
  }
  /** Multiply by an integer quantity. A non-integer multiplier must go through fromRatio. */
  times(qty: number | bigint): Money {
    if (typeof qty === 'number' && !Number.isInteger(qty)) {
      throw new MoneyError(`Money.times() takes an integer quantity; got ${qty}.`);
    }
    return new Money(this.paise * BigInt(qty));
  }
  negate(): Money {
    return new Money(-this.paise);
  }
  abs(): Money {
    return new Money(this.paise < 0n ? -this.paise : this.paise);
  }

  isZero(): boolean {
    return this.paise === 0n;
  }
  isNegative(): boolean {
    return this.paise < 0n;
  }
  isPositive(): boolean {
    return this.paise > 0n;
  }
  eq(o: Money): boolean {
    return this.paise === o.paise;
  }
  gt(o: Money): boolean {
    return this.paise > o.paise;
  }
  gte(o: Money): boolean {
    return this.paise >= o.paise;
  }
  lt(o: Money): boolean {
    return this.paise < o.paise;
  }
  lte(o: Money): boolean {
    return this.paise <= o.paise;
  }

  static sum(values: readonly Money[]): Money {
    return values.reduce<Money>((a, b) => a.add(b), Money.ZERO);
  }
  static max(a: Money, b: Money): Money {
    return a.gte(b) ? a : b;
  }
  static min(a: Money, b: Money): Money {
    return a.lte(b) ? a : b;
  }

  /** The canonical wire and database form: a fixed-2dp decimal string. */
  toString(): string {
    const neg = this.paise < 0n;
    const abs = neg ? -this.paise : this.paise;
    const whole = abs / FACTOR;
    const frac = (abs % FACTOR).toString().padStart(Number(SCALE), '0');
    return `${neg ? '-' : ''}${whole}.${frac}`;
  }
  toJSON(): string {
    return this.toString();
  }

  /**
   * Indian-format display: ₹12,34,567.89. Lakh/crore grouping, not thousands.
   * `tabular-nums` in the UI is what makes a column of these line up (08 §5).
   */
  format(opts: { symbol?: boolean } = {}): string {
    const { symbol = true } = opts;
    const neg = this.paise < 0n;
    const [whole = '0', frac = '00'] = this.abs().toString().split('.');
    let grouped: string;
    if (whole.length <= 3) {
      grouped = whole;
    } else {
      const last3 = whole.slice(-3);
      const rest = whole.slice(0, -3);
      grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
    }
    return `${neg ? '-' : ''}${symbol ? '₹' : ''}${grouped}.${frac}`;
  }
}

/** Handy alias so signatures read as intent. */
export const money = (v: string | number | Money): Money =>
  v instanceof Money ? v : Money.parse(String(v));
