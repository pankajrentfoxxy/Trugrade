/**
 * Loads .env.test before any module reads process.env.
 * Kept separate from the app's own env loading so a stray DATABASE_URL in a
 * developer's shell cannot point an integration run at the dev database.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const file = join(__dirname, '..', '..', '.env.test');
if (existsSync(file)) {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    process.env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
}
