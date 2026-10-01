/**
 * Memory, storage and processor as pills beside grade, each pill leading to
 * the sibling that changes just that one thing; a row with one option is said as a fact rather than drawn as a switch.
 */
import * as React from 'react';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { SearchResult } from '../../../lib/api';
import { ConfigPicker, configChoices } from './ConfigPicker';

const row = (over: Partial<SearchResult>): SearchResult => ({
  skuId: 'i5-16-512',
  grade: 'B',
  brand: 'Dell',
  model: 'Latitude 5420',
  spec: '',
  fromPrice: 36500,
  unitsAvailable: 5,
  supplyPoints: 2,
  avgQcScore: 88,
  batteryMin: 82,
  batteryMax: 89,
  batteryMeasured: 5,
  shipHours: 48,
  warrantyMonths: 6,
  cities: ['Ghaziabad'],
  sampleSerial: 'X',
  ramGb: 16,
  storageGb: 512,
  storageType: 'NVME_SSD',
  cpuLine: 'Core i5-1135G7',
  displayLine: '',
  ...over,
});

const VARIANTS: SearchResult[] = [
  row({}),
  row({ grade: 'A', unitsAvailable: 88, supplyPoints: 9 }),
  row({
    skuId: 'i5-8-256',
    ramGb: 8,
    storageGb: 256,
    grade: 'B',
    unitsAvailable: 3,
    supplyPoints: 1,
  }),
  // The i7 exists only at grade A.
  row({
    skuId: 'i7-16-512',
    cpuLine: 'Core i7-1185G7',
    grade: 'A',
    unitsAvailable: 2,
    supplyPoints: 1,
  }),
];

const here = { skuId: 'i5-16-512', grade: 'B' };

describe('configChoices', () => {
  it('draws every row from the rows sealed AT THIS GRADE only', () => {
    // At grade B the index holds the i5 in two memory/storage builds and no
    // i7 — so memory and storage offer two pills and the processor row holds
    // the one processor sealed at B. Rows run memory, storage, processor.
    const choices = configChoices(VARIANTS, here);
    expect(choices.map((c) => [c.key, c.options.length])).toEqual([
      ['ram', 2],
      ['storage', 2],
      ['cpu', 1],
    ]);
    // At grade A the i5 and the i7 are both sealed, in one build each.
    const atA = configChoices(VARIANTS, { skuId: 'i5-16-512', grade: 'A' });
    expect(atA.map((c) => [c.key, c.options.length])).toEqual([
      ['ram', 1],
      ['storage', 1],
      ['cpu', 2],
    ]);
    // A grade with nothing sealed at all gets no rows, not rows of nothing.
    expect(configChoices(VARIANTS, { skuId: 'i5-16-512', grade: 'A_PLUS' })).toEqual([]);
  });

  it('leads to the sibling that changes only that one thing, at this grade where it exists', () => {
    const ram = configChoices(VARIANTS, here).find((c) => c.key === 'ram')!;
    const eight = ram.options.find((o) => o.value === '8')!;
    expect(eight).toMatchObject({
      skuId: 'i5-8-256',
      grade: 'B',
      current: false,
      unitsAvailable: 3,
    });
    expect(ram.options.find((o) => o.value === '16')).toMatchObject({
      current: true,
      skuId: 'i5-16-512',
    });
  });

  it('never offers a configuration sealed only at another grade', () => {
    // The i7 exists only at grade A. On the grade B page it is not drawn —
    // not greyed, not linked to grade A, simply absent: the grade row above
    // is where a buyer changes grade.
    render(
      <ConfigPicker
        variants={VARIANTS}
        current={here}
        hrefFor={(s, g) => `/laptops/${s}?grade=${g}`}
      />,
    );
    expect(screen.queryByText(/Core i7-1185G7/)).toBeNull();
    // The processor row still stands, holding the one processor sealed at B —
    // said as a fact, not drawn as a switch. The i7 is sealed at A, so the
    // note names the grade rather than claiming the model has no other.
    const cpu = within(screen.getByTestId('config-cpu'));
    expect(cpu.queryAllByRole('link')).toHaveLength(0);
    expect(cpu.getByText('Core i5-1135G7')).toBeInTheDocument();
    expect(cpu.getByText('Only option at Grade B')).toBeInTheDocument();
  });

  it('on the grade where it is sealed, opens it at that same grade', () => {
    render(
      <ConfigPicker
        variants={VARIANTS}
        current={{ skuId: 'i5-16-512', grade: 'A' }}
        hrefFor={(s, g) => `/laptops/${s}?grade=${g}`}
      />,
    );
    const link = screen.getByRole('link', { name: /Core i7-1185G7/ });
    expect(link).toHaveAttribute('href', '/laptops/i7-16-512?grade=A');
    expect(link).not.toHaveAttribute('title');
  });

  it('says "only option for this model" on every row of a one-configuration model', () => {
    // One build sealed: three rows, one option each, all current. The rows say
    // "this, only this" rather than disappearing, and offer no dead switch.
    const choices = configChoices([row({})], here);
    expect(choices.map((c) => c.options.length)).toEqual([1, 1, 1]);
    expect(choices.every((c) => c.options[0]!.current && c.onlyForModel)).toBe(true);
    render(<ConfigPicker variants={[row({})]} current={here} hrefFor={() => '/x'} />);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.getAllByText('Only option for this model')).toHaveLength(3);
  });

  it('does not draw a configuration nothing is sealed at, at any grade', () => {
    // The index holds no 32 GB row for this model at any grade — so there is
    // no 32 GB pill. A switch that opened nothing at every grade is not drawn.
    const ram = configChoices(VARIANTS, here).find((c) => c.key === 'ram')!;
    expect(ram.options.map((o) => o.value)).toEqual(['8', '16']);
    render(
      <ConfigPicker
        variants={VARIANTS}
        current={here}
        hrefFor={(s, g) => `/laptops/${s}?grade=${g}`}
      />,
    );
    const memory = within(screen.getByTestId('config-ram'));
    expect(memory.queryByText(/32 GB RAM/)).toBeNull();
    // Nothing greyed anywhere: every pill drawn is a link that opens a board.
    expect(document.querySelectorAll('.gpill.off')).toHaveLength(0);
  });

  it('marks the configuration being viewed and counts what each pill opens', () => {
    render(
      <ConfigPicker
        variants={VARIANTS}
        current={here}
        hrefFor={(s, g) => `/laptops/${s}?grade=${g}`}
      />,
    );
    const memory = within(screen.getByTestId('config-ram'));
    expect(memory.getByRole('link', { name: /16 GB RAM/ })).toHaveAttribute('aria-current', 'true');
    // The count is what the pill's target carries; the pill itself no longer
    // prints it. The board the click opens is where a buyer reads stock.
    const eight = memory.getByRole('link', { name: /8 GB RAM/ });
    expect(eight).toHaveAttribute('href', '/laptops/i5-8-256?grade=B');
    expect(eight).not.toHaveTextContent(/units?/);
    // Nor a price: the panel's one price is the figure above the switches.
    expect(eight).not.toHaveTextContent(/₹/);
  });
});
