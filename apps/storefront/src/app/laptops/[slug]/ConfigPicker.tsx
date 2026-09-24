import Link from 'next/link';
import type { Route } from 'next';
import type { SearchResult } from '../../../lib/api';
import { storageShortLabel } from '../../search/storage-label';

/**
 * Processor, memory and storage, chosen the way grade is chosen.
 *
 * A Latitude 5420 is not one machine: it is an i5 with 8 GB and an i7 with
 * 16 GB, and each is its own SKU with its own board. The grade pills above
 * the board switch between grades of one SKU; these rows switch between the
 * SKUs of one model, so a buyer who landed on the 8 GB one reaches the 16 GB
 * one in a click, with the pincode and grade they already chose carried over.
 *
 * **A pill is drawn only where there is something to open AT THIS GRADE.**
 * The rows are built from the search index rows for the grade the page is
 * on, so the switches answer "what else can I have at Grade A+" and nothing
 * else. A configuration sealed only at another grade is not drawn: the
 * grade row above is where a buyer changes grade, and a processor pill that
 * quietly moved them to Grade A would be a switch they did not throw. A
 * configuration nobody has sealed anywhere is not drawn either.
 *
 * **Every row is drawn, even with one pill.** A grade with a single sealed
 * build still gets its processor, memory and storage rows, each holding the
 * one pill, lit: that is the honest answer to "what can I have at this
 * grade" — this, only this — and three rows that vanished on switching to
 * A+ read as the page breaking, not as the stock narrowing.
 */

interface Dimension {
  key: 'cpu' | 'ram' | 'storage';
  label: string;
  of: (r: SearchResult) => string;
  text: (value: string) => string;
  sort: (a: string, b: string) => number;
}

const numeric = (a: string, b: string): number => Number(a) - Number(b);

const DIMENSIONS: readonly Dimension[] = [
  {
    key: 'cpu',
    label: 'Choose processor',
    of: (r) => r.cpuLine,
    text: (v) => v,
    sort: (a, b) => a.localeCompare(b),
  },
  {
    key: 'ram',
    label: 'Choose memory',
    of: (r) => String(r.ramGb),
    text: (v) => `${v} GB RAM`,
    sort: numeric,
  },
  {
    key: 'storage',
    label: 'Choose storage',
    of: (r) => `${r.storageGb}|${r.storageType}`,
    text: (v) => {
      const [gb, type] = v.split('|');
      const short = storageShortLabel(type);
      return short ? `${gb} GB ${short}` : `${gb} GB`;
    },
    sort: (a, b) => numeric(a.split('|')[0]!, b.split('|')[0]!),
  },
];

export interface ConfigOption {
  value: string;
  text: string;
  /** The SKU and grade the pill opens. */
  skuId: string;
  grade: string;
  current: boolean;
  unitsAvailable: number;
  supplyPoints: number;
}

export interface ConfigChoice {
  key: Dimension['key'];
  label: string;
  options: ConfigOption[];
}

/**
 * The rows to draw, from the configurations of the model the search index
 * holds AT THE CURRENT GRADE — sealed, for sale, at this grade. Pure, so the
 * choice of target is testable without a page.
 *
 * The target for a pill is the sibling that changes ONLY that dimension —
 * same everything else, at this grade — where one exists, otherwise any row
 * at this grade carrying the value. A buyer switching memory should not find
 * their processor changed under them when the exact sibling exists. The
 * grade never changes under them: every row considered is at this grade.
 */
export function configChoices(
  variants: readonly SearchResult[],
  current: { skuId: string; grade: string },
): ConfigChoice[] {
  const atGrade = variants.filter((r) => r.grade === current.grade);
  // The page's own configuration, for "same everything else". Read from any
  // grade when this one has no row for it, so the comparison still has a
  // reference even when the page's SKU is out at this grade.
  const here =
    atGrade.find((r) => r.skuId === current.skuId) ??
    variants.find((r) => r.skuId === current.skuId) ??
    null;
  if (!here) return [];

  return DIMENSIONS.flatMap((d) => {
    const values = [...new Set(atGrade.map(d.of))].sort(d.sort);
    // Nothing sealed at this grade at all: no rows, not rows of nothing.
    if (values.length === 0) return [];

    const others = DIMENSIONS.filter((o) => o.key !== d.key);
    const sameOthers = (r: SearchResult): boolean => others.every((o) => o.of(r) === o.of(here));

    const options = values.map((value): ConfigOption => {
      const carrying = atGrade.filter((r) => d.of(r) === value);
      // `values` came from `atGrade`, so at least one row carries the value.
      const target = carrying.find(sameOthers) ?? carrying[0]!;
      return {
        value,
        text: d.text(value),
        skuId: target.skuId,
        grade: target.grade,
        current: d.of(here) === value,
        unitsAvailable: target.unitsAvailable,
        supplyPoints: target.supplyPoints,
      };
    });

    return [{ key: d.key, label: d.label, options }];
  });
}

export function ConfigPicker({
  variants,
  current,
  hrefFor,
}: {
  variants: readonly SearchResult[];
  current: { skuId: string; grade: string };
  /** The page's own URL builder, so the pincode and the rest carry over. */
  hrefFor: (skuId: string, grade: string) => string;
}): React.JSX.Element | null {
  const choices = configChoices(variants, current);
  if (choices.length === 0) return null;

  return (
    <>
      {choices.map((choice) => (
        <div key={choice.key} data-testid={`config-${choice.key}`}>
          <h2 className="sec-t">{choice.label}</h2>
          <div className="grades" role="group" aria-label={choice.label.replace('Choose ', '')}>
            {choice.options.map((o) => (
              <Link
                key={o.value}
                className={o.current ? 'gpill on' : 'gpill'}
                aria-current={o.current ? 'true' : undefined}
                href={hrefFor(o.skuId, o.grade) as Route}
              >
                <b>{o.text}</b>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
