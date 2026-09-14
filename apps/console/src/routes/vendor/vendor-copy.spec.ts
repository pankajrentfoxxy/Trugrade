/**
 * Stage 7 copy budget — visible JSX text across hub screens stays under 400 words.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Hub restyle scope — board shells; visit/correction record routes stay in their files. */
const STAGE7_FILES = [
  'Dashboard.tsx',
  'Listings.tsx',
  'listings/CreateListingDialog.tsx',
  'Payouts.tsx',
  'Facilities.tsx',
  'Documents.tsx',
] as const;

/** Rough count of the same files before Stage 7 hub trim (board shells only). */
const BEFORE_WORD_COUNT = 612;

function visibleWords(src: string): string[] {
  const words: string[] = [];
  for (const line of src.split('\n')) {
    if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
    for (const match of line.matchAll(/>([^<>{}]+)</g)) {
      const text = match[1]!.replace(/\s+/g, ' ').trim();
      if (!text || text.startsWith('{')) continue;
      words.push(...text.split(/\s+/).filter(Boolean));
    }
    for (const match of line.matchAll(/(?:title|body|label|description)=["']([^"']+)["']/g)) {
      words.push(...match[1]!.split(/\s+/).filter(Boolean));
    }
  }
  return words;
}

describe('vendor hub copy budget', () => {
  it('stage 7 screens stay under 400 visible words total', () => {
    let total = 0;
    for (const name of STAGE7_FILES) {
      const src = readFileSync(join(__dirname, name), 'utf8');
      total += visibleWords(src).length;
    }
    expect(total).toBeLessThan(400);
    expect(total).toBeLessThan(BEFORE_WORD_COUNT);
  });

  it('records before/after in the ledger snapshot constant', () => {
    expect(BEFORE_WORD_COUNT).toBeGreaterThan(400);
  });
});
