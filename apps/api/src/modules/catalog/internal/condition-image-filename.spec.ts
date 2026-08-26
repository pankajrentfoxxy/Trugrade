import {
  CONDITION_FILENAME_CONVENTION,
  normaliseFilenameToken,
  parseConditionImageFilename,
} from './condition-image-filename';

/**
 * The filename convention, exercised on the names a photographer's folder
 * actually contains.
 *
 * The case that carries the whole file is `LID_TOP`: six of the ten view codes
 * contain an underscore, so any implementation that splits the stem on `_` and
 * takes four parts is wrong on the majority of real uploads while looking
 * perfectly correct on `PALMREST`.
 */

function ok(name: string) {
  const r = parseConditionImageFilename(name);
  if (!r.ok) throw new Error(`expected ${name} to parse, got: ${r.error}`);
  return r;
}

describe('a name that follows the convention', () => {
  it('reads the grade, the view and the frame number', () => {
    expect(ok('Latitude 5320_B_LID_TOP_1.jpg')).toMatchObject({
      modelToken: 'LATITUDE_5320',
      grade: 'B',
      viewCode: 'LID_TOP',
      sortOrder: 1,
    });
  });

  it('survives an underscored view code sitting next to an underscored model', () => {
    // ThinkPad T14 Gen 2 + SCREEN_DEFECT is seven underscore-separated tokens
    // for four fields. Position-based parsing cannot do this.
    expect(ok('ThinkPad T14 Gen 2_A+_SCREEN_DEFECT_3.jpg')).toMatchObject({
      modelToken: 'THINKPAD_T14_GEN_2',
      grade: 'A_PLUS',
      viewCode: 'SCREEN_DEFECT',
      sortOrder: 3,
    });
  });

  it.each([
    ['Latitude 5320_A+_BASE_1.jpg', 'A_PLUS'],
    ['Latitude 5320_A_PLUS_BASE_1.jpg', 'A_PLUS'],
    ['latitude-5320_aplus_base_1.JPG', 'A_PLUS'],
    ['Latitude 5320_A_BASE_1.png', 'A'],
    ['Latitude 5320_B_BASE_1.webp', 'B'],
  ])('accepts %s as grade %s', (name, grade) => {
    expect(ok(name).grade).toBe(grade);
  });

  it('strips a folder path, because a directory drop carries one', () => {
    expect(ok('shoot-2026-08/gradeB/Latitude 5320_B_KEYBOARD_2.jpeg')).toMatchObject({
      viewCode: 'KEYBOARD',
      sortOrder: 2,
    });
  });
});

describe('a name that does not', () => {
  it('names the views when none is present, rather than restating the pattern', () => {
    const r = parseConditionImageFilename('Latitude 5320_B_TOPLID_1.jpg');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('LID_TOP');
    expect(r.expected).toBe(CONDITION_FILENAME_CONVENTION);
  });

  it('names the grades when the grade token is not one we sell', () => {
    // C and D exist in DeviceSure's vocabulary and are not sellable here, so a
    // C-graded photograph is a folder that should never have been dropped.
    const r = parseConditionImageFilename('Latitude 5320_C_LID_TOP_1.jpg');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/nothing below B is sold/);
  });

  it('rejects a missing frame number instead of guessing one', () => {
    // Guessing would silently collapse two frames of the same slot onto one
    // sort_order, and the second insert would fail the partial unique index
    // halfway through a sixty-file batch.
    expect(parseConditionImageFilename('Latitude 5320_B_LID_TOP.jpg').ok).toBe(false);
  });

  it('rejects a format we cannot store, naming the ones we can', () => {
    const r = parseConditionImageFilename('Latitude 5320_B_LID_TOP_1.heic');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('jpg');
  });

  it('rejects a file with no extension at all', () => {
    expect(parseConditionImageFilename('Latitude 5320_B_LID_TOP_1').ok).toBe(false);
  });
});

describe('the model token', () => {
  it('folds spacing and punctuation away so one machine is one answer', () => {
    const forms = ['Latitude 5320', 'latitude-5320', 'LATITUDE__5320', ' Latitude 5320 '];
    expect(new Set(forms.map(normaliseFilenameToken)).size).toBe(1);
  });
});
