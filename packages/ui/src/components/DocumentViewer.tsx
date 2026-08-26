'use client';

// Interactive: this module uses React state, refs or context, none of which
// exist in a server component. The storefront is a Next App Router app, so
// without this directive importing anything from the package barrel drags a
// client-only API into an RSC render and fails at request time rather than at
// build time.
import * as React from 'react';
import { cn } from '../lib/cn';
import { Button } from './primitives';

export interface DocumentPage {
  /** A rendered page image. The API renders PDFs server-side; this shows them. */
  src: string;
  /**
   * What the page IS — "GST registration certificate, page 1 of 2" — not
   * "document". A reviewer using a screen reader is checking a document they
   * cannot see, so the caller must say which one it is.
   */
  alt: string;
}

export interface DocumentViewerProps {
  /** The document's name, as the applicant uploaded it or as we classify it. */
  name: string;
  /** Type, size, uploaded-on. Rendered mono beside the name. */
  meta?: React.ReactNode;
  pages: readonly DocumentPage[];
  /**
   * Where the original file is. A reviewer who needs to check a watermark will
   * open the real file, and refusing to give it to them means they approve on a
   * downscaled JPEG instead.
   */
  downloadHref?: string;
  downloadName?: string;
  className?: string;
}

/** 50% to 300%. Below 50 nothing is legible; above 300 a scan is only blur. */
const ZOOM_STEPS = [50, 75, 100, 150, 200, 300] as const;
const DEFAULT_ZOOM_INDEX = 2;

/**
 * A document with zoom, page controls and a download — the KYC review viewer.
 *
 * This is the component the 48-hour onboarding SLA runs through: a reviewer
 * looks at eight documents per application and decides whether an address proof
 * is within three months. Everything it does is in service of that one job, so
 * there is no annotation layer, no thumbnail rail and no rotate — those are
 * features of a document *editor*, and nobody here edits the applicant's PDF.
 *
 * Zoom is a fixed ladder rather than a continuous slider because a reviewer
 * comparing two documents wants the same magnification on both, and a slider
 * cannot be landed on the same value twice.
 */
export function DocumentViewer({
  name,
  meta,
  pages,
  downloadHref,
  downloadName,
  className,
}: DocumentViewerProps): React.JSX.Element {
  const [page, setPage] = React.useState(0);
  const [zoomIndex, setZoomIndex] = React.useState<number>(DEFAULT_ZOOM_INDEX);
  const zoom = ZOOM_STEPS[zoomIndex] ?? 100;
  const current = pages[page];
  const headingId = React.useId();

  return (
    <figure
      aria-labelledby={headingId}
      className={cn('flex flex-col rounded-lg border border-rule bg-sheet', className)}
      data-testid="document-viewer"
    >
      <figcaption className="tg-cell flex flex-wrap items-center gap-3 border-b border-rule bg-sheet-2">
        <span id={headingId} className="text-body-sm font-medium text-ink">
          {name}
        </span>
        {meta ? (
          <span className="font-mono text-label uppercase tracking-[0.13em] tnum text-ink-3">
            {meta}
          </span>
        ) : null}
        {downloadHref ? (
          <a
            href={downloadHref}
            download={downloadName}
            className="ml-auto text-body-sm text-acc-ink underline underline-offset-4"
          >
            Download original
          </a>
        ) : null}
      </figcaption>

      {pages.length === 0 ? (
        // Not a grey rectangle. A reviewer who sees an empty frame assumes the
        // viewer is loading; the words are what send them to chase the upload.
        <p className="tg-card text-body-sm text-ink-4">
          This document has no pages we can render. Download the original to review it.
        </p>
      ) : (
        <>
          <div
            role="group"
            aria-label={`${name} controls`}
            className="tg-cell flex flex-wrap items-center gap-3 border-b border-rule-2"
          >
            <Button
              size="sm"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabledReason={page === 0 ? 'This is the first page.' : undefined}
              aria-label="Previous page"
            >
              Previous
            </Button>
            <span className="font-mono text-data tnum text-ink" role="status">
              {page + 1} / {pages.length}
            </span>
            <Button
              size="sm"
              onClick={() => setPage((p) => Math.min(pages.length - 1, p + 1))}
              disabledReason={page === pages.length - 1 ? 'This is the last page.' : undefined}
              aria-label="Next page"
            >
              Next
            </Button>

            <span aria-hidden="true" className="text-ink-4">
              |
            </span>

            <Button
              size="sm"
              onClick={() => setZoomIndex((i) => Math.max(0, i - 1))}
              disabledReason={zoomIndex === 0 ? 'Already at the smallest zoom.' : undefined}
              aria-label="Zoom out"
            >
              −
            </Button>
            <span className="font-mono text-data tnum text-ink">{zoom}%</span>
            <Button
              size="sm"
              onClick={() => setZoomIndex((i) => Math.min(ZOOM_STEPS.length - 1, i + 1))}
              disabledReason={
                zoomIndex === ZOOM_STEPS.length - 1 ? 'Already at the largest zoom.' : undefined
              }
              aria-label="Zoom in"
            >
              +
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setZoomIndex(DEFAULT_ZOOM_INDEX)}
              aria-label="Reset zoom to 100 percent"
            >
              Fit
            </Button>
          </div>

          {/* Scrollable and focusable: a zoomed page overflows, and a region
              that can only be scrolled with a pointer is unreachable without
              one (WCAG 2.1.1). */}
          <div
            tabIndex={0}
            role="region"
            aria-label={`${name}, page ${page + 1} of ${pages.length}`}
            className="max-h-[70vh] overflow-auto bg-sheet-3 p-5"
          >
            {current ? (
              <img
                src={current.src}
                alt={current.alt}
                style={{ width: `${zoom}%` }}
                className="mx-auto block max-w-none border border-rule bg-sheet"
              />
            ) : null}
          </div>
        </>
      )}
    </figure>
  );
}
