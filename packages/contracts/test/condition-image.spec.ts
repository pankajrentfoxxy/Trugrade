import {
  resolveConditionImages,
  coverageGaps,
  isPublishable,
  REQUIRED_VIEWS,
  type ConditionImage,
  type ConditionViewCode,
  type ImageAnchor,
} from '../src/condition-image';
import type { Grade } from '../src/rules';

const SKU = 'sku-1';
const MODEL = 'model-1';
const SERIES = 'series-1';

let seq = 0;
function img(
  anchor: ImageAnchor,
  anchorId: string,
  grade: Grade,
  viewCode: ConditionViewCode = 'LID_TOP',
  over: Partial<ConditionImage> = {},
): ConditionImage {
  seq += 1;
  return {
    id: `img-${String(seq).padStart(3, '0')}`,
    anchor,
    anchorId,
    grade,
    viewCode,
    s3Key: `k/${anchor}/${grade}/${viewCode}`,
    altText: `Grade ${grade} ${viewCode.toLowerCase()}`,
    isPrimary: false,
    sortOrder: 0,
    ...over,
  };
}

const REQ = { skuId: SKU, modelId: MODEL, seriesId: SERIES, grade: 'B' as Grade };

describe('the anchor falls back, in order', () => {
  it('prefers the SKU set when one exists', () => {
    const r = resolveConditionImages(REQ, [
      img('SERIES', SERIES, 'B'),
      img('MODEL', MODEL, 'B'),
      img('SKU', SKU, 'B'),
    ]);
    expect(r.match).toBe('SKU');
    expect(r.isGeneric).toBe(false);
    expect(r.images).toHaveLength(1);
    expect(r.images[0]!.anchor).toBe('SKU');
  });

  it('falls back to the model when the SKU has none', () => {
    const r = resolveConditionImages(REQ, [img('SERIES', SERIES, 'B'), img('MODEL', MODEL, 'B')]);
    expect(r.match).toBe('MODEL');
    expect(r.isGeneric).toBe(true);
  });

  it('falls back to the series when neither SKU nor model has any', () => {
    const r = resolveConditionImages(REQ, [img('SERIES', SERIES, 'B')]);
    expect(r.match).toBe('SERIES');
    expect(r.isGeneric).toBe(true);
  });

  it('falls back to a labelled placeholder, never to nothing', () => {
    const r = resolveConditionImages(REQ, []);
    expect(r.match).toBe('PLACEHOLDER');
    expect(r.images).toEqual([]);
    // Named, so the coverage grid and an alert can say what is missing rather
    // than a page quietly rendering an empty box.
    expect(r.placeholderReason).toMatch(/No B images/);
  });

  it('walks the whole chain as each level is removed in turn', () => {
    const all = [img('SKU', SKU, 'B'), img('MODEL', MODEL, 'B'), img('SERIES', SERIES, 'B')];
    expect(resolveConditionImages(REQ, all).match).toBe('SKU');
    expect(resolveConditionImages(REQ, all.slice(1)).match).toBe('MODEL');
    expect(resolveConditionImages(REQ, all.slice(2)).match).toBe('SERIES');
    expect(resolveConditionImages(REQ, []).match).toBe('PLACEHOLDER');
  });

  it('ignores images anchored to a different model or series', () => {
    const r = resolveConditionImages(REQ, [
      img('MODEL', 'some-other-model', 'B'),
      img('SERIES', 'some-other-series', 'B'),
    ]);
    expect(r.match).toBe('PLACEHOLDER');
  });
});

describe('the grade never falls back', () => {
  it('will not show a Grade A image on a Grade B listing', () => {
    // The single most tempting shortcut in this feature: the A images exist,
    // they look fine, and using them misrepresents quality under Rule 7(2).
    const r = resolveConditionImages(REQ, [
      img('SKU', SKU, 'A'),
      img('MODEL', MODEL, 'A'),
      img('SERIES', SERIES, 'A'),
    ]);
    expect(r.match).toBe('PLACEHOLDER');
    expect(r.images).toEqual([]);
  });

  it('prefers a broader anchor at the right grade over a closer one at the wrong grade', () => {
    // A series photo of the right grade is an honest illustration. A SKU photo
    // of the wrong grade is not, however specific it is.
    const r = resolveConditionImages(REQ, [img('SKU', SKU, 'A_PLUS'), img('SERIES', SERIES, 'B')]);
    expect(r.match).toBe('SERIES');
    expect(r.images[0]!.grade).toBe('B');
  });

  it.each(['A_PLUS', 'A', 'B'] as Grade[])(
    'returns only grade %s when %s is asked for',
    (grade) => {
      const candidates = (['A_PLUS', 'A', 'B'] as Grade[]).map((g) => img('MODEL', MODEL, g));
      const r = resolveConditionImages({ ...REQ, grade }, candidates);
      expect(r.images.every((i) => i.grade === grade)).toBe(true);
      expect(r.images).toHaveLength(1);
    },
  );
});

describe('CAT-005 — resolution is deterministic', () => {
  it('returns a byte-identical set for two identical requests', () => {
    const candidates = [
      img('MODEL', MODEL, 'B', 'BASE', { sortOrder: 2 }),
      img('MODEL', MODEL, 'B', 'KEYBOARD', { sortOrder: 1 }),
      img('MODEL', MODEL, 'B', 'LID_TOP', { sortOrder: 0, isPrimary: true }),
    ];
    const a = resolveConditionImages(REQ, candidates);
    // Reversed input: two units of the same SKU must not depend on row order.
    const b = resolveConditionImages(REQ, [...candidates].reverse());
    expect(a.images.map((i) => i.s3Key)).toEqual(b.images.map((i) => i.s3Key));
  });

  it('puts the primary first, then sort order', () => {
    const r = resolveConditionImages(REQ, [
      img('MODEL', MODEL, 'B', 'BASE', { sortOrder: 1 }),
      img('MODEL', MODEL, 'B', 'PALMREST', { sortOrder: 5, isPrimary: true }),
      img('MODEL', MODEL, 'B', 'KEYBOARD', { sortOrder: 2 }),
    ]);
    expect(r.images.map((i) => i.viewCode)).toEqual(['PALMREST', 'BASE', 'KEYBOARD']);
  });

  it('breaks a full tie on id rather than on input order', () => {
    const x = img('MODEL', MODEL, 'B', 'LID_TOP');
    const y = img('MODEL', MODEL, 'B', 'LID_TOP');
    const forward = resolveConditionImages(REQ, [x, y]).images.map((i) => i.id);
    const backward = resolveConditionImages(REQ, [y, x]).images.map((i) => i.id);
    expect(forward).toEqual(backward);
  });

  it('does not mutate the array it was given', () => {
    const candidates = [
      img('MODEL', MODEL, 'B', 'BASE', { sortOrder: 3 }),
      img('MODEL', MODEL, 'B', 'LID_TOP', { sortOrder: 1 }),
    ];
    const before = candidates.map((c) => c.id);
    resolveConditionImages(REQ, candidates);
    expect(candidates.map((c) => c.id)).toEqual(before);
  });
});

describe('coverage gaps', () => {
  it('names every missing (grade, view) slot', () => {
    const gaps = coverageGaps([img('MODEL', MODEL, 'B', 'LID_TOP')], { grades: ['B'] });
    expect(gaps.map((g) => g.viewCode)).toEqual(REQUIRED_VIEWS.filter((v) => v !== 'LID_TOP'));
  });

  it('reports nothing when a grade is complete', () => {
    const complete = REQUIRED_VIEWS.map((v) => img('MODEL', MODEL, 'B', v));
    expect(coverageGaps(complete, { grades: ['B'] })).toEqual([]);
  });

  it('covers all three grades by default', () => {
    const gaps = coverageGaps([]);
    expect(gaps).toHaveLength(3 * REQUIRED_VIEWS.length);
  });
});

describe('a grade cannot be published on a partial set', () => {
  const completeB = () => [
    ...REQUIRED_VIEWS.map((v) => img('MODEL', MODEL, 'B', v)),
    img('MODEL', MODEL, 'B', 'CORNER_WEAR', { isPrimary: true }),
  ];

  it('accepts a complete Grade B set that shows its worst permitted wear', () => {
    const r = isPublishable('B', completeB());
    expect(r.publishable).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  it('refuses a Grade B set that only shows the good angles', () => {
    // Technically-true photographs that leave the buyer surprised on delivery.
    // That is a return we cannot refuse and a Rule 7(2) exposure we would deserve.
    const noWear = REQUIRED_VIEWS.map((v, i) =>
      img('MODEL', MODEL, 'B', v, { isPrimary: i === 0 }),
    );
    const r = isPublishable('B', noWear);
    expect(r.publishable).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/worst wear/);
  });

  it('does not demand a defect frame from A+', () => {
    const aPlus = REQUIRED_VIEWS.map((v, i) =>
      img('MODEL', MODEL, 'A_PLUS', v, { isPrimary: i === 0 }),
    );
    // A+ is near-new; manufacturing a defect shot for it would be the opposite
    // problem.
    expect(isPublishable('A_PLUS', aPlus).publishable).toBe(true);
  });

  it('names the missing views so the gap is actionable', () => {
    const partial = [img('MODEL', MODEL, 'A', 'LID_TOP', { isPrimary: true })];
    const r = isPublishable('A', partial);
    expect(r.publishable).toBe(false);
    expect(r.reasons[0]).toMatch(/PALMREST/);
    expect(r.reasons[0]).toMatch(/placeholder/);
  });

  it('refuses a set with no primary, because the card has no hero frame', () => {
    const noPrimary = REQUIRED_VIEWS.map((v) => img('MODEL', MODEL, 'A', v));
    const r = isPublishable('A', noPrimary);
    expect(r.publishable).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/primary/);
  });
});
