/**
 * The four ways the unit passport could be silently wrong on screen.
 *
 * None of these asserts that a guard exists. Each renders the real components
 * with the real payload shape and reads back what a buyer sees.
 *
 * 1. **All twelve areas render, including the ones nobody measured.** The
 *    database stores an unmeasured area as an absent row, so a screen driven by
 *    the rows would show nine passes and never mention the other three — and a
 *    reader counting ticks would conclude the machine passed twelve checks.
 * 2. **An unmeasured area shows no score, and specifically no zero.** `0 / 10`
 *    says we tested it and it scored nothing; the truth is that nobody looked.
 * 3. **A null wipe certificate reads as absent, not as a blank panel.** Roughly
 *    one unit in twelve genuinely has none, and an empty card looks like a
 *    rendering fault rather than a fact about the machine.
 * 4. **Nothing in the rendered output names a supplier.** This page is public
 *    and unauthenticated, so it is the easiest place in the product to leak one.
 */
import * as React from 'react';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { findVendorIdentityLeaks, type VendorIdentity } from '@trugrade/contracts';
import { Areas } from './Areas';
import { WipeCertificate, Hardware } from './panels';
import type { PassportArea, PassportHardware, UnitPassport } from '../../../lib/api';

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

/** `QC_AREA_CODES`, in order. The API always sends all twelve. */
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

/**
 * The seeded shape of `TGD000E733`: eight measured, four not. The unmeasured
 * four carry null in BOTH score fields, which is the only honest way the payload
 * has to say "nobody looked".
 */
const UNMEASURED = new Set(['BATTERY', 'STORAGE', 'MEMORY_CPU', 'CAMERA_AUDIO']);

const areas = (): PassportArea[] =>
  AREA_CODES.map((area) =>
    UNMEASURED.has(area)
      ? { area, score: null, maxScore: null, status: 'NOT_MEASURED' as const }
      : { area, score: 8.9, maxScore: 10, status: 'PASS' as const },
  );

const hardware = (over: Partial<PassportHardware> = {}): PassportHardware => ({
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
  batteryHealthPct: 91,
  cycleCount: null,
  tpmVersion: null,
  secureBoot: null,
  ...over,
});

const wipe = (): NonNullable<UnitPassport['wipeCertificate']> => ({
  standard: 'NIST_800_88_PURGE',
  method: 'NVME_CRYPTO_ERASE',
  passes: 1,
  verificationStatus: 'VERIFIED',
  issuedAt: '2026-08-27T20:37:13.930Z',
});

/* ================================================================= the tests */

describe('all twelve areas, including the ones nobody measured', () => {
  it('renders one row per area code, never one row per measured area', () => {
    const { container } = render(<Areas areas={areas()} />);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(12);
  });

  it('names each of the four unmeasured areas on screen', () => {
    render(<Areas areas={areas()} />);
    // If the component ever filtered the rows, these four would be the ones it
    // dropped — and the screen would read as a machine that passed twelve.
    for (const label of ['Battery', 'Storage', 'Memory and processor', 'Camera and audio']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('says how many of the twelve were measured, with the denominator', () => {
    const { container } = render(<Areas areas={areas()} />);
    expect(container.querySelector('caption')?.textContent).toContain('8 of 12 were measured');
  });
});

describe('an unmeasured area', () => {
  const rowFor = (area: string): HTMLElement => {
    const { container } = render(<Areas areas={areas()} />);
    const row = [...container.querySelectorAll('tbody tr')].find(
      (r) => r.querySelector('.areaname')?.textContent === area,
    );
    if (!row) throw new Error(`no row for ${area}`);
    return row as HTMLElement;
  };

  it('shows no score rather than a zero', () => {
    const battery = rowFor('Battery');
    expect(within(battery).getAllByText('Not measured').length).toBeGreaterThan(0);
    // The specific lie this screen must not tell. `0`, `0.0`, `0 / 10` and a
    // maximum with nothing in front of it are all it in different clothes.
    expect(battery.textContent).not.toMatch(/\b0(\.0)?\s*\/\s*10\b/);
    expect(battery.textContent).not.toMatch(/\b0(\.0)?\b/);
    expect(battery.textContent).not.toContain('/ 10');
  });

  it('draws no bar at all, not a bar at zero width', () => {
    // An empty track in the column reads as a measurement of nothing. There is
    // no track.
    expect(rowFor('Battery').querySelector('.ameter')).toBeNull();
    expect(rowFor('Display').querySelector('.ameter')).not.toBeNull();
  });

  it('carries no tick, no pass and no green', () => {
    const battery = rowFor('Battery');
    expect(battery.textContent).not.toContain('PASS');
    expect(battery.textContent).not.toContain('Pass');
    expect(battery.querySelector('[data-status="PASS"]')).toBeNull();
    expect(battery.querySelector('.astat')?.getAttribute('data-status')).toBe('NOT_MEASURED');
  });

  it('leaves the measured areas alone', () => {
    const display = rowFor('Display');
    expect(display.textContent).toContain('8.9');
    expect(display.textContent).toContain('/ 10');
    expect(display.querySelector('.astat')?.getAttribute('data-status')).toBe('PASS');
  });
});

describe('a null wipe certificate', () => {
  it('reads as absent, in words, rather than as a blank panel', () => {
    const { container } = render(<WipeCertificate certificate={null} />);
    expect(screen.getByText(/No wipe certificate is recorded/i)).toBeInTheDocument();
    // Not an empty card. A panel with a heading and nothing under it is what a
    // rendering fault looks like, and a buyer cannot tell the two apart.
    expect(container.textContent?.trim().length).toBeGreaterThan(120);
  });

  it('claims neither that the drive was wiped nor that it was not', () => {
    const { container } = render(<WipeCertificate certificate={null} />);
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/\bVERIFIED\b/);
    expect(text).not.toMatch(/NIST/);
    expect(text).not.toMatch(/\b0 passes\b/);
  });

  it('still prints the real certificate when there is one', () => {
    render(<WipeCertificate certificate={wipe()} />);
    expect(screen.getByText('NIST 800 88 PURGE')).toBeInTheDocument();
    expect(screen.getByText('VERIFIED')).toBeInTheDocument();
  });
});

describe('absent hardware is not zeroed hardware', () => {
  it('says the readings were not captured when the whole row is missing', () => {
    render(<Hardware hardware={null} />);
    expect(screen.getByText(/No hardware readings were captured/i)).toBeInTheDocument();
  });

  it('renders every field it holds nothing for as "Not measured", never as 0', () => {
    const { container } = render(<Hardware hardware={hardware()} />);
    // Ten of the fourteen fields are null on a real seeded inspection.
    expect(screen.getAllByText('Not measured').length).toBeGreaterThanOrEqual(7);
    expect(container.textContent).toContain('16 GB');
    // A cycle count of 0 on a worn battery is a collector defaulting, not a
    // measurement, and `BatteryBar` must not have been handed one.
    expect(container.textContent).not.toContain('0c');
  });

  it('prints a measured cycle count when the tool reported one', () => {
    const { container } = render(<Hardware hardware={hardware({ cycleCount: 148 })} />);
    expect(container.textContent).toContain('148');
  });
});

describe('nothing on this public page names a supplier', () => {
  it('leaks no vendor identifier at any depth of the rendered HTML', () => {
    // The whole evidence column, serialised, swept for every field a vendor is
    // identifiable by. This is the only check a future `{...row}` cannot slip
    // past — an assertion that a field is absent only covers the fields somebody
    // thought of.
    const { container } = render(
      <>
        <Areas areas={areas()} />
        <Hardware hardware={hardware()} />
        <WipeCertificate certificate={wipe()} />
      </>,
    );
    expect(findVendorIdentityLeaks(container.innerHTML, VENDOR)).toEqual([]);
  });

  it('names no city, no supply point and no organisation id', () => {
    const { container } = render(
      <>
        <Areas areas={areas()} />
        <Hardware hardware={hardware()} />
      </>,
    );
    const html = container.innerHTML;
    expect(html).not.toMatch(/orgId|org_id|organisation_id/i);
    // The passport payload carries no supply point at all, so the screen must
    // not have invented one to fill the gap.
    expect(html).not.toMatch(/Supply Point/i);
    expect(html).not.toMatch(/Gurugram|Noida|Faridabad|Palwal/i);
  });
});
