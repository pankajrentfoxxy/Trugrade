/**
 * DocumentViewer — the KYC review viewer.
 *
 * The zoomed page overflows its box, so the box has to be reachable without a
 * pointer (WCAG 2.1.1). That is asserted here rather than left to axe, which
 * cannot tell a scrollable region from a static one.
 */

import * as React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { DocumentViewer, type DocumentPage } from './DocumentViewer';

const PAGES: DocumentPage[] = [
  { src: '/kyc/9/1.png', alt: 'GST registration certificate, page 1 of 2' },
  { src: '/kyc/9/2.png', alt: 'GST registration certificate, page 2 of 2' },
];

describe('DocumentViewer', () => {
  it('shows the page position in mono and moves through the pages', async () => {
    render(<DocumentViewer name="GST certificate" pages={PAGES} />);
    expect(screen.getByRole('status')).toHaveTextContent('1 / 2');
    expect(screen.getByRole('status')).toHaveClass('tnum');

    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByRole('status')).toHaveTextContent('2 / 2');
    expect(screen.getByAltText('GST registration certificate, page 2 of 2')).toBeInTheDocument();
  });

  it('does not run off either end of the document', async () => {
    render(<DocumentViewer name="GST certificate" pages={PAGES} />);
    await userEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(screen.getByRole('status')).toHaveTextContent('1 / 2');

    const next = screen.getByRole('button', { name: 'Next page' });
    await userEvent.click(next);
    await userEvent.click(next);
    expect(screen.getByRole('status')).toHaveTextContent('2 / 2');
  });

  it('zooms on a fixed ladder, so two documents can be compared at one size', async () => {
    render(<DocumentViewer name="Address proof" pages={PAGES} />);
    expect(screen.getByText('100%')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByText('150%')).toBeInTheDocument();
    expect(screen.getByAltText(PAGES[0]!.alt)).toHaveStyle({ width: '150%' });

    await userEvent.click(screen.getByRole('button', { name: 'Reset zoom to 100 percent' }));
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('keeps the overflowing page reachable without a pointer', () => {
    render(<DocumentViewer name="Address proof" pages={PAGES} />);
    expect(screen.getByRole('region', { name: /Address proof, page 1 of 2/ })).toHaveAttribute(
      'tabindex',
      '0',
    );
  });

  it('offers the original file, because a watermark does not survive a downscale', () => {
    render(
      <DocumentViewer
        name="Cancelled cheque"
        pages={PAGES}
        downloadHref="/api/kyc/9/original.pdf"
        downloadName="cheque.pdf"
      />,
    );
    const link = screen.getByRole('link', { name: 'Download original' });
    expect(link).toHaveAttribute('href', '/api/kyc/9/original.pdf');
    expect(link).toHaveAttribute('download', 'cheque.pdf');
  });

  it('says so in words when there is nothing to render', () => {
    render(<DocumentViewer name="Board resolution" pages={[]} />);
    expect(screen.getByText(/no pages we can render/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next page' })).not.toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <DocumentViewer
        name="GST certificate"
        meta="PDF · 1.2 MB · 4 Aug 2026"
        pages={PAGES}
        downloadHref="/api/kyc/9/original.pdf"
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
