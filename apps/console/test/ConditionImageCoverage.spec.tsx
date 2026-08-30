import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { REQUIRED_VIEWS, type ConditionImage, type Grade } from '@trugrade/contracts';
import {
  ConditionImageCoverageRoute,
  type CoverageImage,
  type ModelCoverage,
} from '../src/routes/ConditionImageCoverage';

const GRADES: Grade[] = ['A_PLUS', 'A', 'B'];

let seq = 0;
function image(grade: Grade, viewCode: ConditionImage['viewCode']): CoverageImage {
  seq += 1;
  return {
    id: `img-${seq}`,
    anchor: 'MODEL',
    anchorId: 'model-1',
    grade,
    viewCode,
    s3Key: `k/${seq}.webp`,
    altText: 'Grade B lid with fine scratches near the hinge',
    // A set with no primary is a separate publish blocker, so every fixture that
    // is meant to be complete has one — otherwise the tests below would pass for
    // the wrong reason.
    isPrimary: viewCode === 'LID_TOP',
    sortOrder: seq,
    // An opaque object token, never the key — the same shape the API mints.
    url: `http://api.test/api/objects/tok-${seq}`,
  };
}

/** Every required view in every grade, plus the wear frame Grade B needs. */
function completeSet(): CoverageImage[] {
  return [
    ...GRADES.flatMap((g) => REQUIRED_VIEWS.map((v) => image(g, v))),
    image('B', 'CORNER_WEAR'),
  ];
}

function model(over: Partial<ModelCoverage>): ModelCoverage {
  return {
    modelId: 'model-1',
    brandName: 'Dell',
    seriesName: 'Latitude',
    modelName: 'Latitude 5420',
    images: completeSet(),
    ...over,
  };
}

function renderWith(models: ModelCoverage[]): ReturnType<typeof render> {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => models,
  } as Response);
  // The open model now lives in the query string, so the route reads router
  // state. The assertions below are unchanged — this is a harness fix.
  return render(
    <MemoryRouter>
      <ConditionImageCoverageRoute />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  seq = 0;
  vi.restoreAllMocks();
});

describe('a gap is visible at a glance', () => {
  it('renders a missing (grade, view) differently from a filled one and states the count', async () => {
    const withGap = completeSet().filter((i) => !(i.grade === 'B' && i.viewCode === 'PALMREST'));
    const { container } = renderWith([
      model({ modelId: 'gap', modelName: 'Latitude 5420', images: withGap }),
      model({ modelId: 'ok', modelName: 'ThinkPad T14 Gen 2' }),
    ]);
    await screen.findByText('Latitude 5420');

    // The ten view slots of a grade now live inside that grade's single cell —
    // a thirty-two-column table is not readable at admin density, and DataBoard
    // is the one table component. The marker, its two states and the
    // never-colour-alone glyph are unchanged; only the element carrying them is.
    const gaps = container.querySelectorAll('[data-state="gap"]');
    const filled = container.querySelectorAll('[data-state="filled"]');

    // The whole point of the screen. If these two ever render identically the
    // grid is decoration, and the gap is found by a buyer instead.
    expect(gaps).toHaveLength(1);
    expect(filled.length).toBe(GRADES.length * REQUIRED_VIEWS.length * 2 - 1);
    expect(gaps[0]?.className).not.toBe(filled[0]?.className);

    // Colour is never the only signal — the empty slot says so in words too.
    expect(screen.getByText(/No image for Latitude 5420 · Grade B · palmrest/)).toBeInTheDocument();

    // Counted, not just coloured: "some cells are red" is not a work item.
    expect(screen.getByText('1 gap')).toBeInTheDocument();
    expect(screen.getByText('1 of 2 models have gaps')).toBeInTheDocument();
    expect(screen.getByText(/1 empty slot/)).toBeInTheDocument();
  });

  it('puts the model with gaps above the complete ones', async () => {
    renderWith([
      model({ modelId: 'ok', modelName: 'ThinkPad T14 Gen 2' }),
      model({
        modelId: 'gap',
        modelName: 'Latitude 5420',
        images: completeSet().filter((i) => i.viewCode !== 'BASE'),
      }),
    ]);
    await screen.findByText('Latitude 5420');

    const names = screen.getAllByRole('row').flatMap((r) => {
      const cell = within(r).queryAllByRole('cell')[0];
      return cell?.textContent?.startsWith('Latitude') || cell?.textContent?.startsWith('ThinkPad')
        ? [cell.textContent]
        : [];
    });
    // A gap sorted below two hundred complete models is a gap nobody sees.
    expect(names[0]).toMatch(/^Latitude 5420/);
  });

  it('marks a complete model complete and shows no publish reasons for it', async () => {
    renderWith([model({})]);
    await screen.findByText('Latitude 5420');

    expect(screen.getByText('Complete')).toBeInTheDocument();
    expect(screen.getByText('Every model has a complete set in every grade.')).toBeInTheDocument();
    expect(screen.queryByText('Cannot publish')).not.toBeInTheDocument();
  });
});

describe('the per-grade publish gate', () => {
  it('blocks Grade B when the set never shows the worst wear the grade permits', async () => {
    // Every required view present, so the grid has zero gaps — and Grade B is
    // still unpublishable. A row that read "Complete" here would let a listing
    // go live illustrated only with its good angles.
    renderWith([model({ images: completeSet().filter((i) => i.viewCode !== 'CORNER_WEAR') })]);
    await screen.findByText('Latitude 5420');

    expect(screen.queryByText(/^\d+ gaps?$/)).not.toBeInTheDocument();
    expect(screen.getByText('1 grade blocked')).toBeInTheDocument();
    expect(
      screen.getByText(/A Grade B set must show the worst wear the grade permits/),
    ).toBeInTheDocument();
    expect(screen.getByText('Cannot publish')).toBeInTheDocument();
    // The other two grades are unaffected, and the screen says which is which.
    expect(screen.getAllByText('Publishable')).toHaveLength(2);
  });

  it('names the missing views in the reason, per grade', async () => {
    renderWith([
      model({
        images: completeSet().filter((i) => !(i.grade === 'A' && i.viewCode === 'KEYBOARD')),
      }),
    ]);
    await screen.findByText('Latitude 5420');

    expect(screen.getByText(/Grade A is missing KEYBOARD/)).toBeInTheDocument();
    expect(screen.getByText(/Buyers would see a placeholder/)).toBeInTheDocument();
  });
});

describe('loading, empty and error', () => {
  it('says the grid did not load, and that nothing changed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 503 } as Response);
    render(
      <MemoryRouter>
        <ConditionImageCoverageRoute />
      </MemoryRouter>,
    );

    expect(await screen.findByText('The coverage grid did not load')).toBeInTheDocument();
    expect(screen.getByText(/Coverage unavailable \(503\)/)).toBeInTheDocument();
  });

  it('explains the empty catalog rather than rendering an empty table', async () => {
    renderWith([]);
    expect(await screen.findByText('No models in the catalog yet')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
