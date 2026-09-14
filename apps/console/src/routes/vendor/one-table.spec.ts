import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * CLAUDE.md: "One DataBoard component, three settings. Writing a second table
 * component means the system has already failed." Ten seller screens had their
 * own `<table>` with their own row height, hover and empty state. This keeps the
 * count at zero.
 */
const ROOTS = ['src/routes/vendor', 'src/routes/team', 'src/routes/sell', 'src/shell'];

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx$/.test(name) && !/\.spec\.tsx$/.test(name) ? [path] : [];
  });

describe('seller screens render tables through DataBoard only', () => {
  it('has no hand-rolled <table> in any seller route or the supplier shell', () => {
    const offenders = ROOTS.flatMap((root) => sources(join(process.cwd(), root)))
      .filter((file) => /<table[\s>]/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(process.cwd(), file));
    expect(offenders).toEqual([]);
  });
});
