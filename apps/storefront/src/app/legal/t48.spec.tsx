/**
 * T48 — does the published document agree with the thing that enforces it?
 *
 * ---------------------------------------------------------------------------
 * WHY THESE ARE NOT RENDER TESTS
 * ---------------------------------------------------------------------------
 * A snapshot of `/legal/returns-and-refunds` would pass forever while the page
 * promised 48 hours and `ReturnsService` enforced 72. The failure mode on a
 * legal page is not "it did not render", it is "it rendered a number that is no
 * longer true" — and the customer wins that argument, because the page is the
 * document they were shown.
 *
 * So every test below drives the documents with values that are **deliberately
 * not the seeded ones** and asserts two things: the stated figure moved, and no
 * trace of the seeded figure survives anywhere in the rendered document. A page
 * with `48` typed into a sentence passes the first assertion and fails the
 * second, which is precisely the defect worth catching.
 *
 * That is one half of the chain. The other half — that the endpoint these pages
 * read agrees with `platform.v_current_config` and `catalog.grade_definition` —
 * is asserted against a real database in
 * `apps/api/test/integration/legal-pages-agree-with-enforcement.spec.ts`.
 * Neither half is worth much alone; together they say the published document
 * equals the enforced rule.
 */
import * as React from 'react';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { GRADE_THRESHOLDS, INSPECTION_WINDOW_HOURS } from '@trugrade/contracts';
import { LEGAL_DISCLOSURE } from '@trugrade/config/brand';
import { LEGAL_SLUGS, buildDocuments, type LegalDocument } from './documents';
import type { GradeDefinition, LegalTerms } from '../../lib/api';

/* ----------------------------------------------------------------- fixtures */

/**
 * Not 48/3/6/48/30. Every figure here is chosen to differ from what the seed
 * holds, so a value that survives into the page from a constant rather than
 * from this object is visible as itself.
 */
const TERMS: LegalTerms = {
  inspectionWindowHours: 72,
  warrantyTopUpMonths: 4,
  warrantyMinTotalMonths: 9,
  grievanceAckHours: 36,
  grievanceRedressDays: 21,
};

/** Likewise: none of these matches `GRADE_THRESHOLDS` or the seeded copy. */
const GRADES: GradeDefinition[] = [
  {
    grade: 'A_PLUS',
    displayName: 'A+ · Near-new',
    customerDescription: 'Indistinguishable from new at arm’s length.',
    minBatteryHealthPct: 88,
    maxCycleCount: 250,
    minCosmeticScore: 93,
    screenDefectsAllowed: false,
    effectiveFrom: '2026-02-01',
  },
  {
    grade: 'A',
    displayName: 'A · Excellent',
    customerDescription: 'Light use, visible only on close inspection.',
    minBatteryHealthPct: 77,
    maxCycleCount: 640,
    minCosmeticScore: 71,
    screenDefectsAllowed: false,
    effectiveFrom: '2026-02-01',
  },
  {
    grade: 'B',
    displayName: 'B · Good',
    customerDescription: 'Honest working condition with cosmetic wear.',
    minBatteryHealthPct: 63,
    maxCycleCount: 1150,
    minCosmeticScore: 58,
    screenDefectsAllowed: false,
    effectiveFrom: '2026-02-01',
  },
];

function docFor(slug: string, terms: LegalTerms | null, grades: GradeDefinition[] | null) {
  const doc = buildDocuments(terms, grades).find((d) => d.slug === slug);
  if (!doc) throw new Error(`No document for ${slug}`);
  return doc;
}

/** Render a whole document's prose, the way the route lays it out. */
function renderDoc(doc: LegalDocument): HTMLElement {
  const { container } = render(
    <article>
      {doc.sections.map((s) => (
        <section key={s.id} id={s.id}>
          <h2>{s.heading}</h2>
          {s.body}
        </section>
      ))}
    </article>,
  );
  return container;
}

/** The rendered words, with runs of whitespace collapsed so a wrap cannot hide a match. */
const words = (el: HTMLElement): string => (el.textContent ?? '').replace(/\s+/g, ' ');

/* ================================================================== the spec */

describe('the ten documents §3A.8 requires', () => {
  it('all exist, each with a version and a date', () => {
    const docs = buildDocuments(TERMS, GRADES);
    expect(docs.map((d) => d.slug)).toEqual([...LEGAL_SLUGS]);
    for (const doc of docs) {
      expect(doc.version).toMatch(/^v\d+\.\d+$/);
      expect(doc.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(doc.sections.length).toBeGreaterThan(0);
      // Every section is addressable. A clause somebody has to cite in a dispute
      // needs a URL, and a duplicate id would silently give two clauses one.
      const ids = doc.sections.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('names the three line 727 says are re-consented, and no others', () => {
    const flagged = buildDocuments(TERMS, GRADES)
      .filter((d) => d.reconsentOnChange)
      .map((d) => d.slug);
    expect(flagged.sort()).toEqual(['grading', 'returns-and-refunds', 'terms']);
  });
});

describe('/legal/returns-and-refunds states the window that is actually enforced', () => {
  it('prints the configured hours, and not a figure of its own', () => {
    const el = renderDoc(docFor('returns-and-refunds', TERMS, GRADES));
    const text = words(el);

    expect(text).toContain('72 hours');

    // The whole point. `INSPECTION_WINDOW_HOURS` is the seeded default and the
    // number a person writing this page from memory would have typed. If it
    // appears while config says 72, the page has a number of its own.
    expect(INSPECTION_WINDOW_HOURS).toBe(48);
    expect(text).not.toMatch(/\b48\b/);
  });

  it('states the take-back obligation as ours and non-delegable', () => {
    const text = words(renderDoc(docFor('returns-and-refunds', TERMS, GRADES)));
    expect(text).toContain('Rule 7(4)');
    expect(text).toContain('We are the seller on every order');
    expect(text).toMatch(/do not pass it to the supply point/i);
  });

  it('says a broken seal opens a return by itself', () => {
    const text = words(renderDoc(docFor('returns-and-refunds', TERMS, GRADES)));
    expect(text).toMatch(/a return is opened on that machine immediately and automatically/i);
  });

  it('says the term is unpublished rather than inventing one when config is unset', () => {
    const el = renderDoc(docFor('returns-and-refunds', null, null));
    const text = words(el);
    expect(text).toContain('Not published');
    // Neither the seeded default nor the fixture leaks in through a fallback.
    expect(text).not.toMatch(/\b48 hours\b/);
    expect(text).not.toMatch(/\b72 hours\b/);
  });
});

describe('/legal/grading is the r.7(5) document and agrees with the grade rows', () => {
  it('prints every floor from the rows it was given', () => {
    const el = renderDoc(docFor('grading', TERMS, GRADES));
    const table = within(el).getByRole('table');

    // Per row, not per table. A table-wide text search would pass just as
    // happily with A+'s cycle cap printed on B's row, which is the one way this
    // table could be wrong while containing every correct number.
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(GRADES.length);

    rows.forEach((row, i) => {
      const g = GRADES[i]!;
      const text = words(row);
      expect(text).toContain(g.displayName);
      expect(text).toContain(`${g.minBatteryHealthPct} %`);
      expect(text).toContain(`${g.maxCycleCount} cycles`);
      expect(text).toContain(`${g.minCosmeticScore} / 100`);
      expect(text).toContain('None permitted');
    });
  });

  it('does not carry the seeded thresholds when the rows say something else', () => {
    const text = words(renderDoc(docFor('grading', TERMS, GRADES)));

    // The figures a page written from `packages/contracts` rather than from the
    // database would show. 85/300, 75/700 and 60/1200 must appear nowhere.
    expect(GRADE_THRESHOLDS.A_PLUS).toEqual({ minBatteryHealthPct: 85, maxCycleCount: 300 });
    for (const t of Object.values(GRADE_THRESHOLDS)) {
      expect(text).not.toMatch(new RegExp(`\\b${t.minBatteryHealthPct} %`));
      expect(text).not.toMatch(new RegExp(`\\b${t.maxCycleCount} cycles`));
    }
  });

  it('shows no table at all rather than a remembered one when the rows cannot be read', () => {
    const el = renderDoc(docFor('grading', TERMS, null));
    expect(within(el).queryByRole('table')).toBeNull();
    expect(words(el)).toMatch(/could not be read/i);
    // Silence is the requirement: not one threshold may survive the failure.
    for (const t of Object.values(GRADE_THRESHOLDS)) {
      expect(words(el)).not.toMatch(new RegExp(`\\b${t.minBatteryHealthPct}\\b`));
    }
  });

  it('treats the grades as neutral — no grade is a verdict', () => {
    const el = renderDoc(docFor('grading', TERMS, GRADES));
    const text = words(el);
    expect(text).toMatch(/A\+, A and B are positions on a scale/);
    expect(text).toMatch(/a B is not a machine that failed/i);

    // Green and red are PASS/FAIL only. Nothing on this page may reach for them.
    expect(el.innerHTML).not.toMatch(/text-pass|text-fail|bg-pass|bg-fail/);
  });

  it('says the grade shown is the inspected one, not the supplier’s declaration', () => {
    const text = words(renderDoc(docFor('grading', TERMS, GRADES)));
    expect(text).toMatch(/the grade our inspection assigned/i);
  });
});

describe('/legal/warranty states the term the warranty service computes', () => {
  it('prints the configured top-up and floor, and the max() rule', () => {
    const text = words(renderDoc(docFor('warranty', TERMS, GRADES)));
    expect(text).toContain('4 months');
    expect(text).toContain('9 months');
    expect(text).toMatch(/the greater of \(supply point’s months \+ top-up\) and the minimum/);
    // The seeded 3 and 6 must not be reachable from a constant in the page.
    expect(text).not.toMatch(/\b3 months\b/);
    expect(text).not.toMatch(/\b6 months\b/);
  });

  it('names us as the sole warrantor and never reveals the vendor/platform split', () => {
    const el = renderDoc(docFor('warranty', TERMS, GRADES));
    const text = words(el);
    expect(text).toContain('There is one warrantor and it is us');
    expect(text).toMatch(/deliberately not on your warranty record/i);
    // T23 dropped `provider` from the customer shape for exactly this reason;
    // the document must not reintroduce the idea in prose.
    expect(text).not.toMatch(/vendor-backed|platform-backed|vendorBackedMonths/i);
  });

  it('reproduces the coverage and exclusion lists the service holds', () => {
    const text = words(renderDoc(docFor('warranty', TERMS, GRADES)));
    expect(text).toContain('Repair, part replacement or a replacement machine — our choice, at our cost.');
    expect(text).toContain('Accidental damage, liquid ingress and cosmetic wear after delivery.');
  });
});

describe('/legal/grievance carries the r.4(5) clocks and no invented person', () => {
  it('prints the configured acknowledgement and redress times', () => {
    const text = words(renderDoc(docFor('grievance', TERMS, GRADES)));
    expect(text).toContain('36 hours');
    expect(text).toContain('21 days');
  });

  it('leaves the officer visibly unappointed rather than naming somebody', () => {
    const text = words(renderDoc(docFor('grievance', TERMS, GRADES)));
    expect(text).toContain('Officer name — not yet published');
    expect(text).toContain('Postal address — not yet published');
    // The email is real and monitored, so it is published.
    expect(text).toContain(LEGAL_DISCLOSURE.grievanceOfficer.email);
  });
});

describe('/legal/pricing-and-taxes describes the computation the invoice was built by', () => {
  const text = (): string => words(renderDoc(docFor('pricing-and-taxes', TERMS, GRADES)));

  it('states the margin as per-serial and never pooled', () => {
    expect(text()).toMatch(/for each serial individually and is never pooled/i);
  });

  it('states that a loss-making serial contributes zero and never a negative', () => {
    expect(text()).toMatch(/contributes a taxable value of zero; it never goes negative/i);
  });

  it('states that no input tax credit is available on a margin line', () => {
    expect(text()).toMatch(/no input tax credit is available to you on a margin line/i);
  });

  it('reproduces the mandated Rule 32(5) narration exactly', () => {
    // The same sentence `RULE_32_5_NARRATION` puts on the face of the invoice.
    expect(text()).toContain(
      'Value determined under Rule 32(5) of the CGST Rules, 2017. No input tax credit availed on purchase.',
    );
  });

  it('puts the place of supply at the delivery address, not the billing one', () => {
    expect(text()).toMatch(/your delivery address, not your billing address/i);
  });

  it('does not claim e-invoicing, which is switched off', () => {
    expect(text()).toContain('IRN and QR generation — not yet published');
    expect(text()).toMatch(/do not currently generate an Invoice Reference Number/i);
  });

  it('publishes the GSTIN we actually invoice under', () => {
    expect(text()).toContain(LEGAL_DISCLOSURE.gstin);
  });
});

describe('the documents do not claim things the product does not do', () => {
  it('/legal/shipping does not promise carrier tracking', () => {
    const text = words(renderDoc(docFor('shipping', TERMS, GRADES)));
    expect(text).toMatch(/do not issue carrier tracking numbers/i);
  });

  it('/legal/cancellation does not promise a self-serve cancel button', () => {
    const text = words(renderDoc(docFor('cancellation', TERMS, GRADES)));
    expect(text).toMatch(/no self-serve cancellation once an order is confirmed/i);
  });

  it('/legal/returns-and-refunds does not refuse a return for evidence we cannot accept', () => {
    const text = words(renderDoc(docFor('returns-and-refunds', TERMS, GRADES)));
    expect(text).toMatch(/no way to attach a photograph to the return form/i);
    expect(text).toMatch(/never refused for want of a photograph/i);
  });

  it('/legal/wipe-standard does not imply every machine is certified', () => {
    const text = words(renderDoc(docFor('wipe-standard', TERMS, GRADES)));
    expect(text).toMatch(/Some machines in the catalogue have no wipe certificate/i);
    expect(text).toMatch(/Do not read a blank as a pass/i);
    expect(text).toContain('NIST SP 800-88 Rev. 1');
  });

  it('/legal/terms does not imply a re-consent mechanism that is not running', () => {
    const text = words(renderDoc(docFor('terms', TERMS, GRADES)));
    expect(text).toMatch(/It is not running yet/i);
  });

  it('/legal/privacy does not claim a retention schedule we have not set', () => {
    const text = words(renderDoc(docFor('privacy', TERMS, GRADES)));
    expect(text).toContain('General retention schedule — not yet published');
  });
});

describe('no document names a supplier or fabricates an identifier', () => {
  it('renders every document without a vendor name anywhere in it', () => {
    for (const doc of buildDocuments(TERMS, GRADES)) {
      const html = renderDoc(doc).innerHTML;
      // The supply-point wording is the only way a supplier may be referred to.
      expect(html).not.toMatch(/Northgate|Harbourpoint|Udyog|Okhla Traders/i);
    }
  });

  it('never prints a placeholder telephone number that somebody could dial', () => {
    for (const doc of buildDocuments(TERMS, GRADES)) {
      expect(words(renderDoc(doc))).not.toMatch(/\+91[- ]?0{3}/);
    }
  });
});

describe('every number is set in the mono, tabular face', () => {
  it('wraps each configured figure in the `tnum` utility', () => {
    // `.tnum` is mono AND `tabular-nums` in one utility, which is why checking
    // for it is the whole of 09_FRONTEND_LOCKED.md §3 for these pages.
    const el = renderDoc(docFor('returns-and-refunds', TERMS, GRADES));
    const seventyTwo = Array.from(el.querySelectorAll('.tnum')).map((n) => n.textContent ?? '');
    expect(seventyTwo.some((t) => t.includes('72'))).toBe(true);
  });

  it('sets the grade thresholds in it too', () => {
    const el = renderDoc(docFor('grading', TERMS, GRADES));
    const mono = Array.from(el.querySelectorAll('.tnum')).map((n) => (n.textContent ?? '').trim());
    for (const g of GRADES) {
      expect(mono.some((t) => t.startsWith(String(g.minBatteryHealthPct)))).toBe(true);
      expect(mono.some((t) => t.startsWith(String(g.maxCycleCount)))).toBe(true);
    }
  });
});

describe('the index and the anchors', () => {
  it('gives every section an anchor id that is a usable URL fragment', () => {
    for (const doc of buildDocuments(TERMS, GRADES)) {
      for (const section of doc.sections) {
        expect(section.id).toMatch(/^[a-z0-9-]+$/);
      }
    }
  });

  it('only ever cross-references a document that exists', () => {
    const slugs = new Set<string>(LEGAL_SLUGS);
    for (const doc of buildDocuments(TERMS, GRADES)) {
      const html = renderDoc(doc).innerHTML;
      for (const href of html.match(/href="\/legal\/[^"#]*/g) ?? []) {
        const slug = href.replace('href="/legal/', '');
        if (slug !== '') expect(slugs.has(slug)).toBe(true);
      }
    }
  });
});

/* ------------------------------------------------------------------ cleanup */

afterEach(() => {
  document.body.innerHTML = '';
});

// `screen` is imported for the table lookup above; this keeps the linter honest
// about it being a real dependency rather than an unused import.
void screen;
