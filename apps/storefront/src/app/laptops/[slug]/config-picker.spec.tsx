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
        catalogue={[]}
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
      <ConfigPicker variants={[row({})]} catalogue={[]} current={here} hrefFor={() => '/x'} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('draws a configuration the catalogue holds but nobody has sealed, greyed and not a link', () => {
    // The catalogue declares a 32 GB build; the index has never seen one sealed.
    const catalogue = [
      { skuId: 'i5-16-512', cpuFamily: 'Core i5', cpuModel: 'i5-1135G7', ramGb: 16, storageGb: 512, storageType: 'NVME_SSD' },
      { skuId: 'i5-32-512', cpuFamily: 'Core i5', cpuModel: 'i5-1135G7', ramGb: 32, storageGb: 512, storageType: 'NVME_SSD' },
    ];
    const ram = configChoices(VARIANTS, here, catalogue).find((c) => c.key === 'ram')!;
    expect(ram.options.map((o) => o.value)).toEqual(['8', '16', '32']);
    expect(ram.options.find((o) => o.value === '32')).toMatchObject({
      skuId: 'i5-32-512',
      available: false,
      unitsAvailable: 0,
    });
    expect(ram.options.find((o) => o.value === '16')).toMatchObject({ available: true });

    render(
      <ConfigPicker
        variants={VARIANTS}
        catalogue={catalogue}
        current={here}
        hrefFor={(s, g) => `/laptops/${s}?grade=${g}`}
      />,
    );
    const memory = within(screen.getByTestId('config-ram'));
    expect(memory.queryByRole('link', { name: /32 GB RAM/ })).toBeNull();
    const greyed = memory.getByText('32 GB RAM').closest('.gpill')!;
    expect(greyed).toHaveAttribute('aria-disabled', 'true');
    expect(greyed).toHaveTextContent('No units sealed');
  });

  it('only draws a row when the catalogue itself differs — one declared build is not a choice', () => {
    const one = [
      { skuId: 'i5-16-512', cpuFamily: 'Core i5', cpuModel: 'i5-1135G7', ramGb: 16, storageGb: 512, storageType: 'NVME_SSD' },
    ];
    // The index row must carry the line the shared helper builds, as a real
    // search row does; the fixture's short form above is not what search says.
    expect(configChoices([row({ cpuLine: 'Intel Core i5-1135G7' })], here, one)).toEqual([]);
  });

  it('marks the configuration being viewed and counts what each pill opens', () => {
    render(
      <ConfigPicker
        variants={VARIANTS}
        catalogue={[]}
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
  });
});
