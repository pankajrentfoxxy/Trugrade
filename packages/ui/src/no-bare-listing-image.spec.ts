/**
 * Exit criterion 4: "a component test asserts it cannot be rendered without one."
 *
 * A component test proves `RepresentativeImage` is honest. It proves nothing
 * about the next engineer who reaches for `<img src={listing.imageKey}>` on a
 * new card, which renders a buyer-facing photograph with no caption at all and
 * passes every existing test.
 *
 * So this reads the source instead. It is the only assertion in the suite that
 * can fail because of code that does not exist yet, which is exactly the point.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const UI_SRC = join(__dirname);

function tsxFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      out.push(...tsxFilesUnder(full));
    } else if (/\.tsx$/.test(entry) && !/\.(spec|stories)\.tsx$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * The one file allowed to render a raw <img> for a buyer-facing photograph,
 * because it is the file that attaches the caption.
 */
const CAPTION_OWNER = 'primitives.tsx';

/**
 * The one exemption, and it is narrow on purpose.
 *
 * `DocumentViewer` renders a page of a KYC document under review — a GST
 * certificate, a cancelled cheque. It is not a photograph of a machine, it is
 * never reachable from a buyer surface, and a representative-image caption on
 * it would be nonsense. The rule it must still obey is asserted separately
 * below: its `alt` comes from a REQUIRED prop, so no caller can render one of
 * these unlabelled.
 */
const NOT_A_PRODUCT_PHOTOGRAPH = 'DocumentViewer.tsx';

describe('no component renders a buyer-facing photograph without the caption', () => {
  const files = tsxFilesUnder(UI_SRC);

  it('finds components to check, so an empty sweep cannot pass vacuously', () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it.each(files.map((f) => [f.slice(UI_SRC.length + 1), f]))(
    '%s uses RepresentativeImage rather than a bare <img>',
    (relative, full) => {
      if (relative.endsWith(CAPTION_OWNER) || relative.endsWith(NOT_A_PRODUCT_PHOTOGRAPH))
        return;
      const source = readFileSync(full, 'utf8');

      // Inline SVG is fine — logos, marks, the score ring. A raster <img> in a
      // buyer-facing component is what needs the caption, and the brand mark is
      // drawn as SVG precisely so it is not one.
      const bareImg = /<img\b/.exec(source);
      expect(bareImg).toBeNull();
    },
  );

  it('keeps the caption inside the component, not at the call site', () => {
    const source = readFileSync(join(UI_SRC, 'components', CAPTION_OWNER), 'utf8');
    // If this string ever moves out into a prop, a caller can pass "" and the
    // liability control silently disappears.
    expect(source).toContain('Representative image of Grade');
    expect(source).toContain('unit passport');
  });

  it('has no prop that could switch the caption off', () => {
    const source = readFileSync(join(UI_SRC, 'components', CAPTION_OWNER), 'utf8');
    expect(source).not.toMatch(/hideCaption|showCaption|withCaption|noCaption/);
  });

  /**
   * The exemption's own guard. If `alt` ever becomes optional, or gains a
   * default, a reviewer could be shown a page they cannot identify — and the
   * exemption would have become a hole rather than a carve-out.
   */
  it('holds the document viewer to a required alt instead', () => {
    const source = readFileSync(join(UI_SRC, 'components', NOT_A_PRODUCT_PHOTOGRAPH), 'utf8');
    expect(source).toContain('export interface DocumentPage {');
    // `alt: string`, never `alt?: string`, and never a literal in the JSX.
    expect(source).toContain('alt: string;');
    expect(source).not.toContain('alt?:');
    expect(source).toContain('alt={current.alt}');
  });
});
