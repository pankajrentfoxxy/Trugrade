import Link from 'next/link';
import type { Route } from 'next';
import { cpuDisplayLine } from '@trugrade/contracts';
import type { SearchResult, SkuDetail } from '../../../lib/api';
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
 * **A row appears only where the model differs.** A model held in one memory
 * size gets no Memory row: a single pill is not a choice, and drawing it
 * would say "you could have picked otherwise" about a thing nobody could.
 *
 * **A configuration with nothing sealed is greyed, never dropped.** The
 * search index only holds what is for sale, so it is read beside the
 * catalogue's own list of the model's configurations. "32 GB — no units
 * sealed" tells a buyer the machine exists in 32 GB and we have none today;
 * a missing 32 GB pill tells them it was never made. Same rule the search
 * rail follows for a zero-count brand.
 *
 * Each pill names what the click opens — that SKU's units and supply points
 * at the grade it will land on — so the count under "16 GB" is the count on
 * the board the pill leads to, never a total the board then fails to show.
 */

/** What a catalogue row must carry to be placed on the three dimensions. */
export type CatalogueSku = Pick<
  SkuDetail,
  'skuId' | 'cpuFamily' | 'cpuModel' | 'ramGb' | 'storageGb' | 'storageType'
>;

interface Dimension {
  key: 'cpu' | 'ram' | 'storage';
  label: string;
  of: (r: SearchResult) => string;
  /** The same value, read off the catalogue rather than the index. */
  ofCatalogue: (s: CatalogueSku) => string;
  text: (value: string) => string;
  sort: (a: string, b: string) => number;
}

const numeric = (a: string, b: string): number => Number(a) - Number(b);

const DIMENSIONS: readonly Dimension[] = [
  {
    key: 'cpu',
    label: 'Choose processor',
    of: (r) => r.cpuLine,
    ofCatalogue: (s) => cpuDisplayLine(s),
    text: (v) => v,
    sort: (a, b) => a.localeCompare(b),
  },
  {
    key: 'ram',
    label: 'Choose memory',
    of: (r) => String(r.ramGb),
    ofCatalogue: (s) => String(s.ramGb),
    text: (v) => `${v} GB RAM`,
    sort: numeric,
  },
  {
    key: 'storage',
    label: 'Choose storage',
    of: (r) => `${r.storageGb}|${r.storageType}`,
    ofCatalogue: (s) => `${s.storageGb}|${s.storageType}`,
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
  /**
   * False when the catalogue holds this configuration and no unit is sealed
   * at it anywhere. Such a pill is drawn greyed and is not a link.
   */
  available: boolean;
}

export interface ConfigChoice {
  key: Dimension['key'];
  label: string;
  options: ConfigOption[];
}

/**
 * The rows to draw, from every configuration of the model: the ones the
 * search index holds (sealed, for sale) and the ones only the catalogue holds
 * (declared, nothing sealed). Pure, so the choice of target is testable
 * without a page.
 *
 * The target for a pill is the sibling that changes ONLY that dimension: same
 * grade and same everything else where one exists, otherwise the nearest —
 * same everything else at another grade, then the same value at this grade,
 * then any row carrying the value. A buyer switching memory should not find
 * their processor changed under them when the exact sibling exists.
 */
export function configChoices(
  variants: readonly SearchResult[],
  current: { skuId: string; grade: string },
  catalogue: readonly CatalogueSku[] = [],
): ConfigChoice[] {
  const here =
    variants.find((r) => r.skuId === current.skuId && r.grade === current.grade) ??
    variants.find((r) => r.skuId === current.skuId) ??
    null;
  if (!here) return [];

  return DIMENSIONS.flatMap((d) => {
    const values = [
      ...new Set([...variants.map(d.of), ...catalogue.map(d.ofCatalogue)]),
    ].sort(d.sort);
    if (values.length < 2) return [];

    const others = DIMENSIONS.filter((o) => o.key !== d.key);
    const sameOthers = (r: SearchResult): boolean => others.every((o) => o.of(r) === o.of(here));

    const options = values.map((value): ConfigOption => {
      const carrying = variants.filter((r) => d.of(r) === value);
      const target =
        carrying.find((r) => sameOthers(r) && r.grade === here.grade) ??
        carrying.find(sameOthers) ??
        carrying.find((r) => r.grade === here.grade) ??
        carrying[0] ??
        null;
      if (target === null) {
        // Only the catalogue knows this value. There is no board to open, so
        // the pill names the catalogue row and carries nothing to count.
        const declared = catalogue.find((s) => d.ofCatalogue(s) === value)!;
        return {
          value,
          text: d.text(value),
          skuId: declared.skuId,
          grade: here.grade,
          current: false,
          unitsAvailable: 0,
          supplyPoints: 0,
          available: false,
        };
      }
      return {
        value,
        text: d.text(value),
        skuId: target.skuId,
        grade: target.grade,
        current: d.of(here) === value,
        unitsAvailable: target.unitsAvailable,
        supplyPoints: target.supplyPoints,
        available: true,
      };
    });

    return [{ key: d.key, label: d.label, options }];
  });
}

const GRADE_LABEL: Readonly<Record<string, string>> = { A_PLUS: 'A+', A: 'A', B: 'B' };

export function ConfigPicker({
  variants,
  catalogue,
  current,
  hrefFor,
}: {
  variants: readonly SearchResult[];
  /** Every configuration the catalogue declares for the model, sealed or not. */
  catalogue: readonly CatalogueSku[];
  current: { skuId: string; grade: string };
  /** The page's own URL builder, so the pincode and the rest carry over. */
  hrefFor: (skuId: string, grade: string) => string;
}): React.JSX.Element | null {
  const choices = configChoices(variants, current, catalogue);
  if (choices.length === 0) return null;

  return (
    <>
      {choices.map((choice) => (
        <div key={choice.key} data-testid={`config-${choice.key}`}>
          <h2 className="sec-t">{choice.label}</h2>
          <div className="grades" role="group" aria-label={choice.label.replace('Choose ', '')}>
            {choice.options.map((o) =>
              o.available ? (
                <Link
                  key={o.value}
                  className={o.current ? 'gpill on' : 'gpill'}
                  aria-current={o.current ? 'true' : undefined}
                  href={hrefFor(o.skuId, o.grade) as Route}
                >
                  <b>{o.text}</b>
                  {/* Only said when the click changes grade as well: the exact
                      sibling at this grade does not exist, and a pill that
                      silently moved the buyer to another grade would be a
                      switch they did not make. */}
                  {o.grade !== current.grade ? (
                    <small>Opens at Grade {GRADE_LABEL[o.grade] ?? o.grade}</small>
                  ) : null}
                </Link>
              ) : (
                <span key={o.value} className="gpill off" aria-disabled="true">
                  <b>{o.text}</b>
                  <small>No units sealed</small>
                </span>
              ),
            )}
          </div>
        </div>
      ))}
    </>
  );
}
