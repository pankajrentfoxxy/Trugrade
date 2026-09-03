import type { Metadata } from 'next';
import { BRAND } from '@trugrade/config/brand';
import { THEME_STOREFRONT_PREPAINT_SCRIPT } from '@trugrade/ui';
import { FooterGate } from './FooterGate';
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
      data-t="light"
      data-density="comfortable"
      // Pre-paint script forces light before hydration; suppressHydrationWarning
      // covers any SSR/client attribute drift until the script runs.
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
          Storefront is light-only for now. `THEME_STOREFRONT_PREPAINT_SCRIPT`
          forces `data-t="light"` before first paint; `ThemeToggle` is
          suppressed in the header until multi-theme returns.
        */}
        <script dangerouslySetInnerHTML={{ __html: THEME_STOREFRONT_PREPAINT_SCRIPT }} />
      </head>
      <body className="flex min-h-screen flex-col bg-ground text-ink-2">
        {/* The wrapper takes the slack so a short page — a one-panel step, an
            empty state — still puts the footer at the bottom of the window
            instead of floating it halfway up. */}
        {/* `id="content"` is the skip link's target (SiteHeader). It sits on the
            wrapper rather than on each route's own <main>, because sixteen
            storefront routes render no <main> at all and a skip link that
            silently lands nowhere is worse than none. */}
        <div className="flex-1" id="content">
          {children}
        </div>
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
        <FooterGate />
      </body>
    </html>
  );
}
