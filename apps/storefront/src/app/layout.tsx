import type { Metadata } from 'next';
import { BRAND, LEGAL_DISCLOSURE } from '@trugrade/config/brand';
import '@trugrade/ui/globals.css';
import './globals.css';

export const metadata: Metadata = {
  title: { default: BRAND.name, template: `%s · ${BRAND.name}` },
  description: `Inspected, graded refurbished laptops for business, from ${BRAND.legalEntity}.`,
};

/**
 * The storefront stays on the App Router because it genuinely needs SSR/ISR:
 * model and brand pages are the SEO surface, and they change when stock changes.
 * The console has neither property, which is why it moved to Vite.
 */
export default function RootLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Sans+Devanagari:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-paper text-ink">
        {children}
        {/*
          Rule 4(2) of the Consumer Protection (e-Commerce) Rules 2020: legal
          name, registered address and grievance contact, on every page. It is
          the cheapest compliance obligation in the whole product and the one
          most often left to a footer nobody templated.
        */}
        <footer className="mt-9 border-t border-rule">
          <div className="mx-auto max-w-container px-5 py-6 text-body-sm text-ink-2">
            <p className="text-ink">{LEGAL_DISCLOSURE.legalName}</p>
            <p className="mt-1">
              {[
                LEGAL_DISCLOSURE.registeredOffice.line1,
                LEGAL_DISCLOSURE.registeredOffice.city,
                LEGAL_DISCLOSURE.registeredOffice.state,
                LEGAL_DISCLOSURE.registeredOffice.pincode,
              ].join(', ')}
            </p>
            <p className="mt-1">
              {LEGAL_DISCLOSURE.grievanceOfficer.designation}:{' '}
              {LEGAL_DISCLOSURE.grievanceOfficer.name} ·{' '}
              <a
                className="underline decoration-rule underline-offset-4 hover:decoration-acc"
                href={`mailto:${LEGAL_DISCLOSURE.grievanceOfficer.email}`}
              >
                {LEGAL_DISCLOSURE.grievanceOfficer.email}
              </a>
            </p>
            <p className="mt-1">
              Customer care: {LEGAL_DISCLOSURE.customerCare.email} ·{' '}
              {LEGAL_DISCLOSURE.customerCare.hours}
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
