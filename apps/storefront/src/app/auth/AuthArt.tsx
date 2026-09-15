import * as React from 'react';
import { BRAND } from '@trugrade/config/brand';

/**
 * The picture beside the sign-in form: a laptop, opened, with the three
 * measurements a certificate is built on drawn as readings rather than words.
 *
 * Drawn, not photographed. A stock photo of a laptop that is not one of ours
 * is the same fabrication as an invented counter, so the art shows the shape
 * of the product and the claim, and nothing it cannot back. Tokens only.
 */
export function AuthArt(): React.JSX.Element {
  return (
    <div className="authart grid-bg" aria-hidden="true">
      <svg viewBox="0 0 320 240" className="authart__svg" role="presentation">
        {/* Lid */}
        <rect x="50" y="34" width="220" height="140" rx="10" fill="var(--chrome-2)" stroke="var(--chrome-line)" strokeWidth="2" />
        <rect x="62" y="46" width="196" height="116" rx="4" fill="var(--chrome)" />
        {/* Screen: three readings */}
        <g fontFamily="IBM Plex Mono, ui-monospace, monospace" fontSize="11" fill="var(--on-chrome-2)">
          <text x="76" y="70">BATTERY</text>
          <text x="76" y="104">KEYS</text>
          <text x="76" y="138">SCREEN</text>
        </g>
        <g fontFamily="IBM Plex Mono, ui-monospace, monospace" fontSize="12" fontWeight="700" fill="var(--acc)">
          <text x="228" y="70" textAnchor="end">92%</text>
          <text x="228" y="104" textAnchor="end">104/104</text>
          <text x="228" y="138" textAnchor="end">0 dead px</text>
        </g>
        <g stroke="var(--chrome-3)" strokeWidth="4" strokeLinecap="round">
          <line x1="76" y1="80" x2="228" y2="80" />
          <line x1="76" y1="114" x2="228" y2="114" />
          <line x1="76" y1="148" x2="228" y2="148" />
        </g>
        <g stroke="var(--acc)" strokeWidth="4" strokeLinecap="round">
          <line x1="76" y1="80" x2="216" y2="80" />
          <line x1="76" y1="114" x2="228" y2="114" />
          <line x1="76" y1="148" x2="228" y2="148" />
        </g>
        {/* Base and hinge */}
        <path d="M30 178h260l14 20a6 6 0 0 1-5 9H21a6 6 0 0 1-5-9z" fill="var(--chrome-2)" stroke="var(--chrome-line)" strokeWidth="2" />
        <rect x="132" y="184" width="56" height="6" rx="3" fill="var(--chrome-3)" />
        {/* Seal */}
        <circle cx="270" cy="52" r="16" fill="var(--acc)" />
        <path d="m263 52 5 5 9-10" fill="none" stroke="var(--acc-on)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <h2 className="authart__claim">Every machine measured, not described.</h2>
      <p className="authart__body">
        Opened at the supplier&rsquo;s warehouse, graded on measurements, sealed until it reaches
        your dock. {BRAND.name} is the seller on the invoice.
      </p>
    </div>
  );
}
