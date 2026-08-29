/**
 * The five ways the verification screen could be silently wrong.
 *
 * None of these asserts that a guard exists. Each renders the REAL page — the
 * async server component, awaited, with `getVerification` standing in for the
 * network — and reads back what somebody standing over an open laptop sees.
 *
 * 1. **An expired report does not render as a failure.** The machine passed and
 *    the paperwork went stale, and those are different sentences. A screen that
 *    paints the second in `--fail` tells a receiving clerk to refuse a delivery
 *    they should accept.
 * 2. **An unknown code and a malformed code read differently.** This route was
 *    dead for weeks because two validators on one column disagreed and every
 *    unit answered 422; a screen that renders "we could not have issued that"
 *    and "we have not issued that" identically hides exactly that class of bug,
 *    and sends a person hunting for a forgery when they dropped a character.
 * 3. **The rate limit shows the server's own remaining seconds, and invents
 *    none.** Without a `Retry-After` there is no timer at all.
 * 4. **A void seal is said before the verdict is believed.** A BROKEN seal under
 *    a green PASS is a true statement arranged into a misleading page.
 * 5. **Nothing in the rendered output names a supplier.** This is the most
 *    public, least authenticated page in the product.
 */
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { findVendorIdentityLeaks, type VendorIdentity } from '@trugrade/contracts';
import type { PassportResult, UnitPassport } from '../../../../lib/api';

jest.mock('../../../../lib/api', () => ({
  ...jest.requireActual('../../../../lib/api'),
  getVerification: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const api = require('../../../../lib/api') as { getVerification: jest.Mock };

import VerifyPage from './page';

/* ----------------------------------------------------------------- fixtures */

const VENDOR: VendorIdentity = {
  orgId: '112077be-4b0c-416c-8f61-e3af0a20c53d',
  legalName: 'Harbourpoint Technologies Private Limited',
  tradeName: 'Harbourpoint IT',
  gstin: '06AABCH1234M1Z7',
  pan: 'AABCH1234M',
  addressLines: ['Plot 44, Udyog Vihar Phase IV, Gurugram'],
  phones: ['+919810011122'],
  emails: ['ops@harbourpoint.example'],
  slug: 'harbourpoint-technologies',
};

const AREA_CODES = [
  'DISPLAY',
  'KEYBOARD',
  'BATTERY',
  'STORAGE',
  'MEMORY_CPU',
  'PORTS',
  'CONNECTIVITY',
  'CAMERA_AUDIO',
  'THERMAL',
  'BIOS_SECURITY',
  'DATA_SECURITY',
  'PHYSICAL',
] as const;

const CODE = 'DMZENSTV2J78V3';

const passport = (over: Partial<UnitPassport> = {}): UnitPassport => ({
  serialNumber: 'TGD9D078116',
  verdict: 'PASS',
  grade: 'A',
  qcScore: 92,
  inspectedOn: '2026-08-26',
  validUntil: '2026-11-22',
  expired: false,
  rulesVersion: '2026.08',
  seal: { code: 'TG-TGD9D078116', status: 'APPLIED', appliedOn: '2026-08-24' },
  hardware: null,
  areas: AREA_CODES.map((area) => ({ area, score: 9.2, maxScore: 10, status: 'PASS' as const })),
  photos: [{ angle: 'LID', url: 'http://localhost:4000/api/objects/opaque-token' }],
  wipeCertificate: null,
  deviceSure: null,
  ...over,
});

/** The page is an async server component: call it, await it, render the tree. */
const show = async (result: PassportResult, code = CODE): Promise<HTMLElement> => {
  api.getVerification.mockResolvedValue(result);
  const tree = await VerifyPage({ params: Promise.resolve({ code }) });
  return render(tree).container;
};

/* ================================================================= the tests */

describe('an expired report is not a failed one', () => {
  it('keeps the verdict word and the verdict colour', async () => {
    const container = await show({
      kind: 'FOUND',
      passport: passport({ expired: true, validUntil: '2026-08-26' }),
    });

    const verdict = container.querySelector('[data-testid="verdict"]');
    // The machine passed. Nothing about the paperwork going stale changes that,
    // and the class that paints red must not be anywhere on this block.
    expect(container.querySelector('.vbig')?.className).toContain('pass');
    expect(container.querySelector('.vbig')?.className).not.toContain('fail');
    expect(verdict?.className).not.toContain('fail');
    expect(screen.getByText('PASS', { selector: '.vbig' })).toBeInTheDocument();
  });

  it('says the staleness out loud, in its own band, and calls it not a failure', async () => {
    const container = await show({
      kind: 'FOUND',
      passport: passport({ expired: true, validUntil: '2026-08-26' }),
    });

    // `stale`, which is `--warn`. Not `fail`, which is red and means the
    // machine failed something.
    expect(container.querySelector('[data-testid="verdict"]')?.className).toContain('stale');
    expect(container.querySelector('.expired')).not.toBeNull();
    expect(container.querySelector('.voidseal')).toBeNull();
    const band = container.querySelector('.expired')?.textContent ?? '';
    expect(band).toContain('out of date');
    expect(band).toContain('did not fail');
  });

  it('draws no staleness band at all when the certificate is current', async () => {
    const container = await show({ kind: 'FOUND', passport: passport() });
    expect(container.querySelector('.expired')).toBeNull();
    expect(container.querySelector('[data-testid="verdict"]')?.className).toContain('pass');
    expect(container.textContent).not.toContain('out of date');
  });
});

describe('an unknown code and a malformed code are different answers', () => {
  it('renders two different headlines and two different explanations', async () => {
    const unknown = (await show({ kind: 'NOT_FOUND' }, '00000000000000')).textContent ?? '';
    const malformed =
      (await show({ kind: 'MALFORMED', message: 'ignored' }, 'NOTACODE1234')).textContent ?? '';

    expect(unknown).not.toEqual(malformed);
    expect(unknown).toContain('We hold no record of this code');
    expect(malformed).toContain('not the shape');
    // The distinguishing half: only one of them can say what the shape is,
    // because only one of them is about the shape.
    expect(malformed).toContain('14 characters');
    expect(unknown).not.toContain('14 characters');
  });

  it('does not imply a forgery when we simply hold no record', async () => {
    const container = await show({ kind: 'NOT_FOUND' }, '00000000000000');
    const text = container.textContent ?? '';
    expect(text).toMatch(/does not mean the machine is fake/i);
    expect(text).not.toMatch(/\bforged\b|\bcounterfeit\b|\bfraud\b|\bfake certificate\b/i);
    // A mistyped character is the likely cause, so the alphabet is on screen.
    expect(text).toContain('U');
  });

  it('echoes back exactly what was checked, so a typo is visible', async () => {
    const container = await show({ kind: 'MALFORMED', message: 'ignored' }, 'notacode1234');
    expect(container.querySelector('.vsub')?.textContent).toContain('NOTACODE1234');
  });
});

describe('the rate limit is the server’s wait, not ours', () => {
  it('prints the server sentence verbatim and counts its seconds down', async () => {
    const container = await show({
      kind: 'RATE_LIMITED',
      message: 'Too many attempts. Try again in 4 minutes.',
      retryAfterSeconds: 240,
    });
    expect(screen.getByText('Too many attempts. Try again in 4 minutes.')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="rate-limit-countdown"]')?.textContent).toBe(
      '4:00',
    );
  });

  it('invents no timer when the server sent no Retry-After', async () => {
    const container = await show({
      kind: 'RATE_LIMITED',
      message: 'Too many attempts. Try again shortly.',
      retryAfterSeconds: null,
    });
    expect(container.querySelector('[data-testid="rate-limit-countdown"]')).toBeNull();
    expect(container.textContent).toContain('Too many attempts. Try again shortly.');
  });
});

describe('a seal that is not intact outranks the verdict above it', () => {
  it('says do not sign, before the reader gets to the seal panel', async () => {
    const container = await show({
      kind: 'FOUND',
      passport: passport({
        seal: { code: 'TG-TGD3F4C4014', status: 'BROKEN', appliedOn: '2026-08-24' },
      }),
    });
    const band = container.querySelector('.voidseal');
    expect(band).not.toBeNull();
    expect(band?.textContent).toContain('Do not sign');
    // Inside the verdict block, not appended at the foot of the document.
    expect(container.querySelector('[data-testid="verdict"] .voidseal')).not.toBeNull();
  });

  it('draws no such band on a sealed machine', async () => {
    const container = await show({ kind: 'FOUND', passport: passport() });
    expect(container.querySelector('.voidseal')).toBeNull();
  });
});

describe('a missing value never renders as a passing one', () => {
  it('prints "Not measured" rather than a zero for every reading we lack', async () => {
    const container = await show({
      kind: 'FOUND',
      passport: passport({ qcScore: null, grade: null, rulesVersion: null, hardware: null }),
    });
    expect(screen.getAllByText('Not measured').length).toBeGreaterThanOrEqual(4);
    // The specific lie: a score of nothing rendered as a score of zero.
    expect(container.querySelector('.vfacts')?.textContent).not.toMatch(/\b0\s*\/\s*100\b/);
    expect(container.querySelector('.vfacts')?.textContent).not.toMatch(/\b0%/);
  });

  it('says so for the verdict itself when no verdict was recorded', async () => {
    const container = await show({ kind: 'FOUND', passport: passport({ verdict: null }) });
    expect(container.querySelector('.vbig')?.textContent).toContain('No verdict recorded');
    expect(container.querySelector('.vbig')?.className).not.toContain('pass');
  });

  it('states the absence of photographs rather than showing none silently', async () => {
    const container = await show({ kind: 'FOUND', passport: passport({ photos: [] }) });
    expect(container.textContent).toContain('No photographs were kept');
    // No viewfinder brackets over nothing: the motif asserts a capture.
    expect(container.querySelector('[data-testid="viewfinder"]')).toBeNull();
  });
});

describe('nothing on this public page names a supplier', () => {
  it('leaks no vendor identifier at any depth of the rendered HTML', async () => {
    // The whole page, serialised, swept for every field a vendor is identifiable
    // by. This is the only check a future `{...row}` cannot slip past — an
    // assertion that one field is absent only covers the fields somebody
    // thought of.
    const container = await show({
      kind: 'FOUND',
      passport: passport({
        hardware: {
          model: 'DEL-LAT5420-I51135G7-16-512',
          cpu: null,
          ramDetectedGb: 16,
          ramModules: null,
          ramType: null,
          storageType: null,
          storageDetectedGb: null,
          gpu: null,
          screenSizeIn: null,
          smartStatus: 'OK',
          batteryHealthPct: 88,
          cycleCount: 148,
          tpmVersion: null,
          secureBoot: null,
        },
      }),
    });
    expect(findVendorIdentityLeaks(container.innerHTML, VENDOR)).toEqual([]);
  });

  it('names no city, no supply point and no organisation id', async () => {
    const html = (await show({ kind: 'FOUND', passport: passport() })).innerHTML;
    expect(html).not.toMatch(/orgId|org_id|organisation_id/i);
    // The passport payload carries no supply point at all, so the screen must
    // not have invented one to fill the gap.
    expect(html).not.toMatch(/Supply Point/i);
    expect(html).not.toMatch(/Gurugram|Noida|Faridabad|Palwal/i);
  });

  it('leaks nothing on the refusal screens either', async () => {
    for (const result of [
      { kind: 'NOT_FOUND' } as const,
      { kind: 'MALFORMED', message: 'x' } as const,
      { kind: 'RATE_LIMITED', message: 'x', retryAfterSeconds: 60 } as const,
      { kind: 'ERROR' } as const,
    ]) {
      const container = await show(result, '00000000000000');
      expect(findVendorIdentityLeaks(container.innerHTML, VENDOR)).toEqual([]);
    }
  });
});

describe('the QR is a real one', () => {
  it('encodes the canonical verification URL rather than drawing a checkerboard', async () => {
    const container = await show({ kind: 'FOUND', passport: passport() });
    const qr = container.querySelector('[data-testid="qr"]');
    expect(qr?.getAttribute('data-value')).toBe(`http://localhost:3000/qc/verify/${CODE}`);
    // A placeholder has no modules. A real symbol has hundreds.
    const path = qr?.querySelector('path')?.getAttribute('d') ?? '';
    expect(path.length).toBeGreaterThan(500);
  });
});
