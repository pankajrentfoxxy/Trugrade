/**
 * Processor, memory and storage as pills beside grade — only where the model
 * differs, each pill leading to the sibling that changes just that one thing.
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
  it('draws a row for each dimension the model differs on, and none for one it does not', () => {
    const choices = configChoices(VARIANTS, here);
    expect(choices.map((c) => c.key)).toEqual(['cpu', 'ram', 'storage']);
    // Same model held in one storage type only: no storage-type row is a
    // storage row here because size differs; a model all at 512 GB gets none.
    const uniform = configChoices(
      VARIANTS.map((r) => ({ ...r, ramGb: 16, storageGb: 512 })),
      here,
    );
    expect(uniform.map((c) => c.key)).toEqual(['cpu']);
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

  it('falls to another grade only when this grade has no such sibling, and says so', () => {
    const cpu = configChoices(VARIANTS, here).find((c) => c.key === 'cpu')!;
    const i7 = cpu.options.find((o) => o.value === 'Core i7-1185G7')!;
    expect(i7).toMatchObject({ skuId: 'i7-16-512', grade: 'A' });
    render(
      <ConfigPicker
        variants={VARIANTS}
        current={here}
        hrefFor={(s, g) => `/laptops/${s}?grade=${g}`}
      />,
    );
    const link = screen.getByRole('link', { name: /Core i7-1185G7/ });
    expect(link).toHaveAttribute('href', '/laptops/i7-16-512?grade=A');
    expect(link).toHaveTextContent('Grade A');
  });

  it('draws nothing for a model with one configuration', () => {
    expect(configChoices([row({})], here)).toEqual([]);
    const { container } = render(
      <ConfigPicker variants={[row({})]} current={here} hrefFor={() => '/x'} />,
    );
    expect(container).toBeEmptyDOMElement();
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
    expect(memory.getByRole('link', { name: /8 GB RAM/ })).toHaveTextContent(
      '3 units · 1 supply point',
    );
  });
});
