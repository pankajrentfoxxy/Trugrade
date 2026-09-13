/**
 * Blunt 120-character cap on JSX text in the new MANIFEST screens.
 * Long explanations belong in InfoPopover, not on the page.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FILES = [
  'Dashboard.tsx',
  'Team.tsx',
  'Facilities.tsx',
  'Documents.tsx',
  'Dispatch.tsx',
  'Payouts.tsx',
] as const;

describe('vendor surface copy stays short', () => {
  it('has no single-line JSX text node over 120 characters', () => {
    const hits: string[] = [];
    for (const name of FILES) {
      const src = readFileSync(join(__dirname, name), 'utf8');
      for (const line of src.split('\n')) {
        for (const match of line.matchAll(/>[^<>{}][^<>{}]*</g)) {
          const text = match[0].slice(1, -1).trim();
          if (text.length > 120) hits.push(`${name}: ${text.slice(0, 80)}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });
});
