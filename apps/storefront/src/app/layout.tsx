import type { Metadata } from 'next';
import { BRAND } from '@trugrade/config/brand';
import { THEME_PREPAINT_SCRIPT } from '@trugrade/ui';
import { SiteFooter } from './SiteFooter';
import '@trugrade/ui/globals.css';
import './globals.css';
import './storefront.css';

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
    <html
      lang="en"
      data-t="dark"
      data-density="comfortable"
      // The pre-paint script below rewrites `data-t` before React ever runs, so
      // on a light-theme browser the server's attribute and the client's differ
      // by design. Without this, that difference is a hydration failure and the
      // whole tree is thrown away and re-rendered on every page load.
      suppressHydrationWarning
    >
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Sans+Devanagari:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
        {/*
          The pre-paint theme read. This MUST be a blocking inline script in
          <head>: by the time React hydrates, the wrong theme has already been
          painted, and a light-theme user would get a dark flash on every
          navigation. `dark` is the attribute on <html> above, so the default
          costs nothing and only an opted-out user pays for this script.
        */}
        <script dangerouslySetInnerHTML={{ __html: THEME_PREPAINT_SCRIPT }} />
      </head>
      <body className="flex min-h-screen flex-col bg-ground text-ink-2">
        {/* The wrapper takes the slack so a short page — a one-panel step, an
            empty state — still puts the footer at the bottom of the window
            instead of floating it halfway up. */}
        <div className="flex-1">{children}</div>
        {/*
          Rule 4(2) of the Consumer Protection (e-Commerce) Rules 2020: legal
          name, registered address and grievance contact, on every page. It is
          the cheapest compliance obligation in the whole product and the one
          most often left to a footer nobody templated.

          T48 replaced the four-line version with block 9 of the reference
          homepage — the same disclosure, plus the columns that make the ten
          `/legal/**` documents reachable from anywhere. A published policy
          nothing links to is a policy nobody finds.
        */}
        <SiteFooter />
      </body>
    </html>
  );
}
