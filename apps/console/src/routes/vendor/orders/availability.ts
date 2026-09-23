import { Money } from '@trugrade/contracts';
import type { MoneyString, PoLineGroup } from '../api';

/**
 * The vendor's answer to a purchase order, as a quantity per line.
 *
 * Two screens ask the same question — the board's dialog and the record page —
 * so the rules live here once: what a valid quantity is, when the form is
 * complete, what the vendor is owed for what they typed, and what the one
 * button says. Neither screen restates them.
 *
 * A draft is the raw string from the input, not a number. An empty box is
 * "not answered yet", which is different from "0", and a parsed default would
 * erase that difference.
 */

export type AvailabilityDrafts = ReadonlyMap<string, string>;

/** The key both screens use for a line: SKU + grade, which is what the server keys on. */
export const lineKey = (g: Pick<PoLineGroup, 'skuId' | 'gradeAtPo'>): string =>
  `${g.skuId}:${g.gradeAtPo}`;

export const emptyDrafts = (groups: readonly PoLineGroup[]): Map<string, string> =>
  new Map(groups.map((g) => [lineKey(g), '']));

/**
 * What is wrong with one box, in a sentence — or null when nothing is.
 *
 * An empty box is not an error here: the button below carries "enter every
 * line" until the form is complete, and a red sentence under a box nobody has
 * typed in yet is noise.
 */
export function lineError(raw: string, qty: number): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (!/^\d+$/.test(trimmed)) return 'Enter a whole number of machines.';
  const n = Number(trimmed);
  if (n > qty) {
    return `This line asks for ${qty} ${qty === 1 ? 'machine' : 'machines'}. Enter a quantity between 0 and ${qty}.`;
  }
  return null;
}

/** The quantity a box holds, or null when it is empty or invalid. */
export function lineValue(raw: string, qty: number): number | null {
  if (raw.trim() === '' || lineError(raw, qty) !== null) return null;
  return Number(raw.trim());
}

export function draftsComplete(
  groups: readonly PoLineGroup[],
  drafts: AvailabilityDrafts,
): boolean {
  return (
    groups.length > 0 &&
    groups.every((g) => lineValue(drafts.get(lineKey(g)) ?? '', g.qty) !== null)
  );
}

export interface AvailabilityTally {
  /** Machines the vendor said they can supply, across every answered line. */
  confirmed: number;
  /** Machines the purchase order asked for. */
  asked: number;
}

export function tally(
  groups: readonly PoLineGroup[],
  drafts: AvailabilityDrafts,
): AvailabilityTally {
  let confirmed = 0;
  let asked = 0;
  for (const g of groups) {
    asked += g.qty;
    confirmed += lineValue(drafts.get(lineKey(g)) ?? '', g.qty) ?? 0;
  }
  return { confirmed, asked };
}

/** What the vendor is owed for the quantities typed so far. Unanswered lines count nothing. */
export function owedFor(groups: readonly PoLineGroup[], drafts: AvailabilityDrafts): Money {
  return Money.sum(
    groups.map((g) =>
      Money.parse(g.unitPrice).times(lineValue(drafts.get(lineKey(g)) ?? '', g.qty) ?? 0),
    ),
  );
}

/** The TDS on that figure, at the rate the purchase order was raised with. */
export function tdsOn(owed: Money, tdsRatePct: number): Money {
  return Money.percentOf(owed, tdsRatePct);
}

export function submitLabel(groups: readonly PoLineGroup[], drafts: AvailabilityDrafts): string {
  if (!draftsComplete(groups, drafts)) return 'Update availability';
  const { confirmed, asked } = tally(groups, drafts);
  if (confirmed === 0) return 'Confirm nothing is available';
  if (confirmed === asked) return `Confirm all ${asked} available`;
  return `Confirm ${confirmed} of ${asked} available`;
}

export function toPayload(
  groups: readonly PoLineGroup[],
  drafts: AvailabilityDrafts,
): Array<{ skuId: string; grade: string; qtyAvailable: number }> {
  return groups.map((g) => ({
    skuId: g.skuId,
    grade: g.gradeAtPo,
    qtyAvailable: lineValue(drafts.get(lineKey(g)) ?? '', g.qty) ?? 0,
  }));
}

export const asMoneyString = (m: Money): MoneyString => m.toString() as MoneyString;
