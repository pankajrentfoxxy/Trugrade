/**
 * Resolving which photographs a buyer sees for a given (SKU, grade).
 *
 * The platform owns every buyer-facing image; vendors upload none. That is what
 * makes "just list the model and the serial, we handle the photographs" true,
 * and it removes the stock-photo fraud vector in one move — there is no endpoint
 * for a vendor to attach a flattering picture of a different machine.
 *
 * The trade is that a buyer is shown a *representative* image while we
 * simultaneously vouch for that specific machine's condition under CP e-Comm
 * Rule 7(5). Two things make that honest, and this module is responsible for the
 * first: the image must genuinely represent **the grade being sold**.
 *
 * So there is one rule that everything else here exists to serve:
 *
 *   **The anchor falls back. The grade never does.**
 *
 * Missing a Grade B set for a model does not license showing the Grade A set —
 * that is a misrepresentation of quality under Rule 7(2), and it is the single
 * most tempting shortcut in the whole feature because the images look fine.
 */

import { GRADES, type Grade } from './rules';

export const CONDITION_VIEW_CODES = Object.freeze([
  'LID_TOP',
  'PALMREST',
  'KEYBOARD',
  'SCREEN_ON',
  'PORTS_LEFT',
  'PORTS_RIGHT',
  'BASE',
  'HINGE',
  'CORNER_WEAR',
  'SCREEN_DEFECT',
] as const);

export type ConditionViewCode = (typeof CONDITION_VIEW_CODES)[number];

/** Which level of the catalog an image is attached to. */
export type ImageAnchor = 'SKU' | 'MODEL' | 'SERIES';

/** How the returned set was arrived at. Always shown to the caller, never hidden. */
export type ImageMatch = 'SKU' | 'MODEL' | 'SERIES' | 'PLACEHOLDER';

export interface ConditionImage {
  id: string;
  anchor: ImageAnchor;
  /** The id of whatever the anchor points at. */
  anchorId: string;
  grade: Grade;
  viewCode: ConditionViewCode;
  s3Key: string;
  altText: string;
  isPrimary: boolean;
  sortOrder: number;
  blurDataUri?: string | null;
}

export interface ResolveRequest {
  skuId: string;
  modelId: string;
  seriesId: string;
  grade: Grade;
}

export interface ResolvedImages {
  /** Empty only when `match` is PLACEHOLDER. */
  images: ConditionImage[];
  match: ImageMatch;
  /**
   * True when the set came from a broader anchor than the SKU. The UI says so:
   * a series-level photograph of a different model in the same family is an
   * honest illustration only while it is labelled as one.
   */
  isGeneric: boolean;
  /** Present when `match` is PLACEHOLDER, so the caller can render the reason. */
  placeholderReason?: string;
}

/**
 * Deterministic ordering. CAT-005 requires two units of the same SKU and grade
 * to resolve to a byte-identical set, so nothing here may depend on insertion
 * order, map iteration or the database's physical row order.
 */
function inRenderOrder(images: ConditionImage[]): ConditionImage[] {
  const viewRank = new Map<string, number>(CONDITION_VIEW_CODES.map((v, i) => [v, i]));
  return [...images].sort(
    (a, b) =>
      Number(b.isPrimary) - Number(a.isPrimary) ||
      a.sortOrder - b.sortOrder ||
      (viewRank.get(a.viewCode) ?? 99) - (viewRank.get(b.viewCode) ?? 99) ||
      // Final tie-break on a stable id, so the order cannot depend on the query
      // plan. Without this two identical requests can legitimately differ.
      a.id.localeCompare(b.id),
  );
}

/**
 * Pick the image set for one (SKU, grade).
 *
 * `candidates` is everything the repository found for the SKU's model and
 * series, at any grade — the filtering happens here so the rule lives in one
 * testable place rather than in a SQL string.
 */
export function resolveConditionImages(
  req: ResolveRequest,
  candidates: readonly ConditionImage[],
): ResolvedImages {
  // Grade first, and it is not negotiable. Everything below chooses an anchor
  // among images that already match the grade being sold.
  const forGrade = candidates.filter((c) => c.grade === req.grade);

  const levels: Array<[ImageMatch, ImageAnchor, string]> = [
    ['SKU', 'SKU', req.skuId],
    ['MODEL', 'MODEL', req.modelId],
    ['SERIES', 'SERIES', req.seriesId],
  ];

  for (const [match, anchor, anchorId] of levels) {
    const hit = forGrade.filter((c) => c.anchor === anchor && c.anchorId === anchorId);
    if (hit.length > 0) {
      return { images: inRenderOrder(hit), match, isGeneric: match !== 'SKU' };
    }
  }

  return {
    images: [],
    match: 'PLACEHOLDER',
    isGeneric: true,
    // Named so the coverage grid and the storefront can say the same thing, and
    // so an alert can name the gap rather than a page silently rendering a box.
    placeholderReason: `No ${req.grade} images for this model or its series`,
  };
}

/**
 * Which (grade, view) slots a model is missing — the coverage grid, as data.
 *
 * A gap is not cosmetic: it is what produces a placeholder on a live listing,
 * so a model with gaps has to be visible at a glance rather than discovered by
 * a buyer.
 */
export interface CoverageGap {
  grade: Grade;
  viewCode: ConditionViewCode;
}

export function coverageGaps(
  images: readonly ConditionImage[],
  opts: {
    grades?: readonly Grade[];
    /** The views a set must contain to be publishable. */
    requiredViews?: readonly ConditionViewCode[];
  } = {},
): CoverageGap[] {
  const grades = opts.grades ?? GRADES;
  const required = opts.requiredViews ?? REQUIRED_VIEWS;
  const have = new Set(images.map((i) => `${i.grade}|${i.viewCode}`));

  const gaps: CoverageGap[] = [];
  for (const grade of grades) {
    for (const viewCode of required) {
      if (!have.has(`${grade}|${viewCode}`)) gaps.push({ grade, viewCode });
    }
  }
  return gaps;
}

/**
 * The views a grade's set must contain before that grade can be published.
 *
 * SCREEN_DEFECT is deliberately not required for every grade — see
 * `isPublishable`, where Grade B needs proof of its worst permissible defect
 * and A+ must not manufacture one.
 */
export const REQUIRED_VIEWS: readonly ConditionViewCode[] = Object.freeze([
  'LID_TOP',
  'PALMREST',
  'KEYBOARD',
  'SCREEN_ON',
  'PORTS_LEFT',
  'BASE',
]);

export interface PublishCheck {
  publishable: boolean;
  gaps: CoverageGap[];
  reasons: string[];
}

/**
 * §3C.2: "each grade must have a complete set before that grade can be
 * published for a SKU family; a Grade B set must include an image of the worst
 * permissible defect for that grade."
 *
 * The second half is the one that matters. A Grade B listing illustrated only
 * with its good angles is a technically-true set of photographs that leaves the
 * buyer surprised on delivery, and "surprised on delivery" is a return we
 * cannot refuse and a Rule 7(2) exposure we would deserve.
 */
export function isPublishable(
  grade: Grade,
  images: readonly ConditionImage[],
  opts: { requiredViews?: readonly ConditionViewCode[] } = {},
): PublishCheck {
  const forGrade = images.filter((i) => i.grade === grade);
  const gaps = coverageGaps(forGrade, { grades: [grade], ...opts });
  const reasons: string[] = [];

  if (gaps.length > 0) {
    reasons.push(
      `Grade ${grade} is missing ${gaps.map((g) => g.viewCode).join(', ')}. Buyers would see a placeholder.`,
    );
  }

  if (grade === 'B') {
    const showsWear = forGrade.some(
      (i) => i.viewCode === 'CORNER_WEAR' || i.viewCode === 'SCREEN_DEFECT',
    );
    if (!showsWear) {
      reasons.push(
        'A Grade B set must show the worst wear the grade permits. Add a CORNER_WEAR or SCREEN_DEFECT frame.',
      );
    }
  }

  if (forGrade.some((i) => i.isPrimary) === false && forGrade.length > 0) {
    reasons.push('No primary image chosen, so there is no hero frame for the listing card.');
  }

  return { publishable: reasons.length === 0, gaps, reasons };
}
