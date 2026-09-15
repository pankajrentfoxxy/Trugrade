import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ResumableOnboarding } from '@trugrade/contracts';

const api = vi.hoisted(() => ({
  saveStep: vi.fn(),
  completeStep: vi.fn(),
  getDocuments: vi.fn(),
  uploadDocument: vi.fn(),
}));
vi.mock('../../../../../storefront/src/app/register/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...api,
}));

import { DocumentsSection } from './sections/DocumentsSection';
import { PROFILE_SECTIONS, sectionSummary } from './sections.config';

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.getDocuments.mockResolvedValue({ ok: true, data: [] });
  api.saveStep.mockResolvedValue({ ok: true });
  api.completeStep.mockResolvedValue({ ok: true });
});

/**
 * The bug this pins: the card listed three documents and refused to save until
 * all three were there, with "Still needed: cancelled cheque." — on a section
 * whose documents are optional. A supplier without a cheque to hand was stuck
 * on a card that had nothing to wait for.
 */
describe('the Documents card saves with any number of documents', () => {
  it('saves with none uploaded and records that none were', async () => {
    const onSaved = vi.fn();
    render(<DocumentsSection open onClose={() => {}} onSaved={onSaved} initial={{}} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(screen.queryByText(/Still needed/)).toBeNull();
    expect(api.saveStep).toHaveBeenCalledWith(
      'DOCUMENTS_BANK',
      { documentsComplete: true, uploadedDocTypes: [] },
      100,
    );
    expect(api.completeStep).toHaveBeenCalledWith('DOCUMENTS_BANK');
  });

  it('records exactly the documents that are there', async () => {
    api.getDocuments.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'd1',
          docType: 'PAN_CARD',
          originalFilename: 'pan.png',
          sizeBytes: 455 * 1024,
        },
      ],
    });
    const onSaved = vi.fn();
    render(<DocumentsSection open onClose={() => {}} onSaved={onSaved} initial={{}} />);
    await screen.findByText('pan.png · 455 KB');

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(api.saveStep).toHaveBeenCalledWith(
      'DOCUMENTS_BANK',
      { documentsComplete: true, uploadedDocTypes: ['PAN_CARD'] },
      100,
    );
  });

  it('says so on the hub card', () => {
    const section = PROFILE_SECTIONS.find((s) => s.id === 'documents')!;
    expect(section.blurb).toMatch(/optional/);
  });
});

describe('the hub summary counts uploads rather than assuming three', () => {
  const withAnswers = (answers: Record<string, unknown>): ResumableOnboarding =>
    ({
      answers: { DOCUMENTS_BANK: answers },
      progress: { steps: [] },
    }) as unknown as ResumableOnboarding;
  const section = PROFILE_SECTIONS.find((s) => s.id === 'documents')!;

  it.each([
    [{ documentsComplete: true, uploadedDocTypes: [] }, 'No documents uploaded'],
    [{ documentsComplete: true, uploadedDocTypes: ['PAN_CARD'] }, '1 of 3 documents uploaded'],
    [
      { documentsComplete: true, uploadedDocTypes: ['PAN_CARD', 'GST_CERTIFICATE'] },
      '2 of 3 documents uploaded',
    ],
    // Saved before the list was recorded: say nothing we cannot back.
    [{ documentsComplete: true }, 'Saved'],
    [{}, 'Uploads pending'],
  ])('%j reads %s', (answers, expected) => {
    expect(sectionSummary(section, withAnswers(answers))).toBe(expected);
  });
});
