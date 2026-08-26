/**
 * The validation meta-tests. 04_TEST_PLAN.md Part 2.
 *
 * These do not test a rule; they test that the *catalogue* cannot rot. A duplicated
 * regex, an error message that leaks a vendor name, or a countdown in a message are
 * all things that pass every other test and still break the product.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { RULES, VENDOR_IDENTITY_BANNED_KEYS, type Rule } from '../src/rules';
import { RULE_BOUND_SCHEMAS } from '../src/primitives';

const SRC = path.join(__dirname, '..', 'src');

describe('VR-META-01 — client and DTO validators resolve to the identical constant', () => {
  it('every rule-bound schema carries the very object from rules.ts, not a copy', () => {
    for (const [name, schema] of Object.entries(RULE_BOUND_SCHEMAS)) {
      const bound = schema._trugradeRule;
      expect(bound).toBeDefined();
      const canonical = RULES[bound.id];
      if (!canonical) {
        throw new Error(`Schema "${name}" claims ${bound.id}, which is not in the catalogue.`);
      }
      // Reference identity, not deep equality. Two regexes that merely look alike
      // today are exactly the drift this test exists to prevent.
      expect(schema._trugradeRule).toBe(canonical);
      if (canonical.pattern) {
        expect(schema._trugradeRule.pattern).toBe(canonical.pattern);
      }
    }
  });

  it('no regex literal is duplicated across the source', () => {
    const files = fs
      .readdirSync(SRC)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => path.join(SRC, f));

    const seen = new Map<string, string[]>();
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      // Regex literals long enough to be a real validation pattern.
      const matches = text.match(/\/\^[^\n/]{12,}\$\//g) ?? [];
      for (const m of matches) {
        seen.set(m, [...(seen.get(m) ?? []), path.basename(file)]);
      }
    }
    const duplicates = [...seen.entries()].filter(([, files]) => files.length > 1);
    expect(duplicates).toEqual([]);
  });

  it('every catalogued rule has an id, a field and a human message', () => {
    for (const [id, r] of Object.entries(RULES) as [string, Rule][]) {
      expect(id).toMatch(/^VR-\d{3}[a-z]?$/);
      expect(r.field.length).toBeGreaterThan(2);
      expect(r.message.length).toBeGreaterThan(5);
      expect(r.enforcedAt.length).toBeGreaterThan(0);
    }
  });
});

describe('VR-META-03 — error messages are safe to show a stranger', () => {
  const messages = Object.values(RULES).map((r) => r.message);

  it('contains no stack detail, SQL, or internal identifier', () => {
    for (const m of messages) {
      expect(m).not.toMatch(/\b(select|insert|update|delete|from|join)\b\s+\w+\./i);
      expect(m).not.toMatch(/\bat\s+\w+\.\w+\s*\(/);
      expect(m).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
      expect(m).not.toMatch(/\b(Error|Exception|null|undefined|NaN)\b/);
    }
  });

  it('names no vendor identity field', () => {
    for (const m of messages) {
      for (const key of VENDOR_IDENTITY_BANNED_KEYS) {
        // The GSTIN and PAN *fields* are legitimately named in their own messages,
        // which are shown to the person who owns them, not to a buyer.
        if (key === 'gstin' || key === 'pan') continue;
        expect(m.toLowerCase()).not.toContain(key.toLowerCase());
      }
    }
  });

  it('every message ends as a complete sentence', () => {
    for (const m of messages) {
      expect(m).toMatch(/[.!?)]$/);
    }
  });
});

describe('VR-META-04 — no dark patterns in the copy (CCPA Guidelines 2023)', () => {
  const messages = Object.values(RULES).map((r) => r.message);

  it('uses no false urgency or scarcity device', () => {
    for (const m of messages) {
      expect(m).not.toMatch(
        /\b(hurry|only \d+ left|last chance|act now|limited time|ending soon)\b/i,
      );
    }
  });

  it('uses no confirm-shaming', () => {
    for (const m of messages) {
      expect(m).not.toMatch(/\b(no,? I (don't|do not)|I'?ll pay more|miss out|no thanks,? I)\b/i);
    }
  });

  it('the only countdown anywhere is the OTP resend cooldown', () => {
    // The catalogue's messages are static; the OTP cooldown is rendered by the
    // client from `OTP_POLICY.resendCooldownSeconds` and is the sanctioned exception.
    for (const m of messages) {
      expect(m).not.toMatch(/\b\d+\s*(seconds?|minutes?)\s+(left|remaining)\b/i);
    }
  });
});
